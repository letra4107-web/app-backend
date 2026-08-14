-- ADVANCED COMPREHENSION ASSESSMENT INFRASTRUCTURE (Stage 4 scaffolding)
--
-- Prepares the backend for Advanced's 5 short-story modules. This migration
-- is infrastructure only - no Advanced modules or story content are seeded
-- here; that comes in a later migration once real story text is supplied.
--
-- Two additions, per explicit product decision:
--
-- 1. A new 'full_submission_diagnostic' scoring_policy for module
--    assessments. Reading comprehension of a fixed short story is a
--    different skill than the oral pronunciation accuracy the existing
--    'weighted_average_accuracy' policy was built for (Beginner phonetic/
--    word, Intermediate phrase): forcing a retry-until-75% loop on a fixed
--    5-question comprehension quiz risks answer-memorization rather than
--    genuine re-comprehension. Under this new policy, the module completes
--    on the first full submission of all required items regardless of
--    score - the score is still computed and stored (parent/teacher-
--    visible diagnostic), it just never gates completion. This mirrors the
--    existing content_type='paragraph' precedent in record_student_content_
--    attempt (migration 026), which already treats "submitted" as
--    "complete" for paragraphs rather than gating on accuracy.
--
-- 2. answer_options/correct_answer_index columns on reading_module_
--    assessment_items, so multiple-choice comprehension questions can be
--    represented. The question text itself still flows through the
--    existing reading_content/reading_module_items pipeline (content_type
--    ='paragraph', role='assessment') so it reuses the same TTS narration
--    path as everything else - these two new columns hold only the
--    MC-specific pieces (4 options, which one is correct) that reading_
--    content has no field for. NOTE: consistent with how pronunciation
--    accuracy is already fully client-computed and server-trusted
--    throughout this app, correct_answer_index is returned to the client
--    at assessment-start time so it can locally score the student's
--    selection - this migration does not add server-side answer
--    verification. That is a reasonable simplification for this MVP (low-
--    stakes literacy practice, not a proctored exam) but is a deliberate
--    choice, not an oversight - flagged here for visibility.
--
-- Module type note: Advanced story modules should use instructional_
-- content_type='paragraph' (not the 'story' value also allowed by
-- reading_modules' CHECK constraint) - reading_content.content_type has no
-- 'story' value, and validate_active_module_curriculum_version_trigger
-- requires every linked item's content_type to exactly match the module's
-- instructional_content_type, so 'story' would be unusable without a
-- further, unnecessary schema change. 'paragraph' already carries the
-- exact full-submission-completion semantics this format needs.

BEGIN;

ALTER TABLE public.reading_module_assessments
  DROP CONSTRAINT IF EXISTS reading_module_assessments_scoring_policy_check;
ALTER TABLE public.reading_module_assessments
  ADD CONSTRAINT reading_module_assessments_scoring_policy_check
  CHECK (scoring_policy IN ('weighted_average_accuracy', 'full_submission_diagnostic'));

ALTER TABLE public.reading_module_assessment_items
  ADD COLUMN IF NOT EXISTS answer_options JSONB,
  ADD COLUMN IF NOT EXISTS correct_answer_index SMALLINT;

ALTER TABLE public.reading_module_assessment_items
  DROP CONSTRAINT IF EXISTS reading_module_assessment_items_mc_shape_check;
ALTER TABLE public.reading_module_assessment_items
  ADD CONSTRAINT reading_module_assessment_items_mc_shape_check CHECK (
    (answer_options IS NULL AND correct_answer_index IS NULL)
    OR (
      answer_options IS NOT NULL AND correct_answer_index IS NOT NULL
      AND jsonb_typeof(answer_options) = 'array'
      AND jsonb_array_length(answer_options) = 4
      AND correct_answer_index BETWEEN 0 AND 3
    )
  );

-- ============================================================
-- start_module_assessment: expose answer_options/correct_answer_index
-- per item so the client can render MC choices and score locally. No
-- other behavior changes from migration 048's version.
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_module_assessment(
  p_student_id UUID,
  p_assessment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assessment public.reading_module_assessments%ROWTYPE;
  v_module public.reading_modules%ROWTYPE;
  v_attempt_id UUID;
  v_level TEXT;
  v_items JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id=p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE='P0002';
  END IF;
  v_level := public.get_student_official_reading_level(p_student_id);
  SELECT * INTO v_assessment FROM public.reading_module_assessments
  WHERE id=p_assessment_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active assessment not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_module FROM public.reading_modules
  WHERE id=v_assessment.module_id AND is_active AND level=v_level;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment module is not at the student official level' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_student_module_unlocked(p_student_id,v_module.id) THEN
    RAISE EXCEPTION 'Module is locked' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reading_module_items item
    LEFT JOIN public.student_content_completions completion
      ON completion.content_id=item.content_id AND completion.student_id=p_student_id
    WHERE item.module_id=v_module.id AND item.role<>'assessment' AND completion.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete all instructional module items before starting the assessment'
      USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_attempt_id FROM public.student_module_assessment_attempts
  WHERE student_id=p_student_id AND assessment_id=p_assessment_id AND status='in_progress'
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF v_attempt_id IS NULL THEN
    INSERT INTO public.student_module_assessment_attempts(
      student_id,assessment_id,pass_percentage_snapshot
    ) VALUES (p_student_id,p_assessment_id,v_module.assessment_pass_percentage)
    ON CONFLICT (student_id,assessment_id) WHERE status='in_progress' DO NOTHING
    RETURNING id INTO v_attempt_id;
    IF v_attempt_id IS NULL THEN
      SELECT id INTO v_attempt_id FROM public.student_module_assessment_attempts
      WHERE student_id=p_student_id AND assessment_id=p_assessment_id AND status='in_progress'
      ORDER BY started_at DESC LIMIT 1;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assessment_item_id',assessment_item.id,
    'content_id',content.id,'content_text',content.content_text,
    'content_type',content.content_type,'level',content.level,
    'syllable_hyphenation',content.syllable_hyphenation,
    'answer_options',assessment_item.answer_options,
    'correct_answer_index',assessment_item.correct_answer_index,
    'item_order',assessment_item.item_order
  ) ORDER BY assessment_item.item_order),'[]'::jsonb) INTO v_items
  FROM public.reading_module_assessment_items assessment_item
  JOIN public.reading_module_items module_item
    ON module_item.id=assessment_item.module_item_id
   AND module_item.module_id=v_module.id
  JOIN public.reading_content content
    ON content.id=module_item.content_id AND content.is_active
   AND content.level=v_module.level
   AND content.content_type=v_module.instructional_content_type
  WHERE assessment_item.assessment_id=p_assessment_id;

  IF jsonb_array_length(v_items) < 1 THEN
    RAISE EXCEPTION 'Assessment has no configured items' USING ERRCODE='P0001';
  END IF;
  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'assessment_id',p_assessment_id,
    'module_id',v_module.id,'module_level',v_module.level,
    'pass_percentage',v_module.assessment_pass_percentage,
    'status','in_progress','items',v_items
  );
END;
$$;

-- ============================================================
-- submit_module_assessment: branch on scoring_policy. Score computation
-- is unchanged either way (still recorded for diagnostic visibility);
-- only whether it gates completion changes.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_module_assessment(
  p_student_id UUID,
  p_attempt_id UUID,
  p_responses JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.student_module_assessment_attempts%ROWTYPE;
  v_module_id UUID;
  v_scoring_policy TEXT;
  v_expected_required INTEGER;
  v_received_required INTEGER;
  v_score NUMERIC(5,2);
  v_passed BOOLEAN;
  v_completion_rows INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'responses must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.student_module_assessment_attempts
  WHERE id = p_attempt_id AND student_id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment attempt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Assessment attempt was already submitted' USING ERRCODE = 'P0001';
  END IF;

  SELECT assessment.module_id, assessment.scoring_policy
  INTO v_module_id, v_scoring_policy
  FROM public.reading_module_assessments assessment
  WHERE assessment.id = v_attempt.assessment_id AND assessment.is_active;
  IF v_module_id IS NULL THEN
    RAISE EXCEPTION 'Active assessment not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.student_module_assessment_responses (
    assessment_attempt_id, assessment_item_id, content_attempt_id, response_score
  )
  SELECT
    v_attempt.id,
    assessment_item.id,
    content_attempt.id,
    content_attempt.accuracy
  FROM jsonb_array_elements(p_responses) response
  JOIN public.reading_module_assessment_items assessment_item
    ON assessment_item.id = (response->>'assessment_item_id')::UUID
   AND assessment_item.assessment_id = v_attempt.assessment_id
  JOIN public.reading_module_items module_item
    ON module_item.id = assessment_item.module_item_id
  JOIN public.student_content_attempts content_attempt
    ON content_attempt.id = (response->>'content_attempt_id')::UUID
   AND content_attempt.student_id = p_student_id
   AND content_attempt.content_id = module_item.content_id
   AND content_attempt.source = 'assessment';

  IF (SELECT COUNT(*) FROM public.student_module_assessment_responses
      WHERE assessment_attempt_id = v_attempt.id) <> jsonb_array_length(p_responses) THEN
    RAISE EXCEPTION 'One or more assessment responses are invalid or duplicated'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_expected_required
  FROM public.reading_module_assessment_items
  WHERE assessment_id = v_attempt.assessment_id AND is_required;

  SELECT COUNT(*) INTO v_received_required
  FROM public.student_module_assessment_responses response
  JOIN public.reading_module_assessment_items item ON item.id = response.assessment_item_id
  WHERE response.assessment_attempt_id = v_attempt.id AND item.is_required;

  IF v_received_required <> v_expected_required THEN
    RAISE EXCEPTION 'All required assessment items must be submitted'
      USING ERRCODE = '22023';
  END IF;

  SELECT ROUND((SUM(response.response_score * item.weight) / SUM(item.weight))::NUMERIC, 2)
  INTO v_score
  FROM public.student_module_assessment_responses response
  JOIN public.reading_module_assessment_items item ON item.id = response.assessment_item_id
  WHERE response.assessment_attempt_id = v_attempt.id;

  IF v_score IS NULL THEN
    RAISE EXCEPTION 'Assessment has no scored responses' USING ERRCODE = '22023';
  END IF;

  IF v_scoring_policy = 'full_submission_diagnostic' THEN
    -- Diagnostic only: score is recorded but never gates completion. A
    -- full submission of all required items is itself the pass condition.
    v_passed := true;
  ELSE
    v_passed := v_score >= v_attempt.pass_percentage_snapshot;
  END IF;

  UPDATE public.student_module_assessment_attempts
  SET status = 'submitted', score = v_score, passed = v_passed, submitted_at = now()
  WHERE id = v_attempt.id;

  IF v_passed THEN
    INSERT INTO public.student_module_completions (
      student_id, module_id, qualifying_assessment_attempt_id
    ) VALUES (
      p_student_id, v_module_id, v_attempt.id
    )
    ON CONFLICT (student_id, module_id) DO NOTHING;
    GET DIAGNOSTICS v_completion_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'module_id', v_module_id,
    'score', v_score,
    'pass_percentage', v_attempt.pass_percentage_snapshot,
    'passed', v_passed,
    'completion_awarded', v_completion_rows = 1,
    'module_level', public.get_student_module_level(p_student_id)
  );
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
