-- Official reading progression is completion-driven and server-owned. XP is
-- deliberately absent from every function in this migration.

-- Remove every historical client-write policy, including environment-specific
-- names not present in the repository migrations. Students retain SELECT
-- access, but only the backend service role can mutate child_progress.
DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'child_progress'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.child_progress', policy_row.policyname);
  END LOOP;
END
$$;
DROP POLICY IF EXISTS "Students read own child progress" ON public.child_progress;
CREATE POLICY "Students read own child progress"
  ON public.child_progress FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = child_id AND c.auth_uid::text = auth.uid()::text
    )
  );

CREATE OR REPLACE FUNCTION public.get_student_reading_progress(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requirements JSONB;
  v_beginner_complete BOOLEAN := false;
  v_intermediate_complete BOOLEAN := false;
  v_advanced_complete BOOLEAN := false;
  v_official_level TEXT := 'Beginner';
  v_override_level TEXT;
  v_effective_level TEXT := 'Beginner';
  v_current_requirements_met BOOLEAN := false;
  v_program_complete BOOLEAN := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  WITH requirement_counts AS (
    SELECT
      r.level,
      r.content_type,
      r.required_count,
      r.completion_policy,
      r.next_level,
      r.requirement_order,
      COUNT(c.id)::INTEGER AS completed_count
    FROM public.reading_level_requirements r
    LEFT JOIN public.reading_content content
      ON content.level = r.level
     AND content.content_type = r.content_type
     AND content.is_active
    LEFT JOIN public.student_content_completions c
      ON c.content_id = content.id
     AND c.student_id = p_student_id
    GROUP BY
      r.level, r.content_type, r.required_count, r.completion_policy,
      r.next_level, r.requirement_order
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'level', level,
          'content_type', content_type,
          'required_count', required_count,
          'completed_count', completed_count,
          'remaining_count', GREATEST(required_count - completed_count, 0),
          'completion_policy', completion_policy,
          'requirement_met', completed_count >= required_count
        ) ORDER BY
          CASE level WHEN 'Beginner' THEN 1 WHEN 'Intermediate' THEN 2 ELSE 3 END,
          requirement_order
      ),
      '[]'::jsonb
    ),
    COALESCE(bool_and(completed_count >= required_count) FILTER (WHERE level = 'Beginner'), false),
    COALESCE(bool_and(completed_count >= required_count) FILTER (WHERE level = 'Intermediate'), false),
    COALESCE(bool_and(completed_count >= required_count) FILTER (WHERE level = 'Advanced'), false)
  INTO v_requirements, v_beginner_complete, v_intermediate_complete, v_advanced_complete
  FROM requirement_counts;

  IF v_beginner_complete AND v_intermediate_complete THEN
    v_official_level := 'Advanced';
  ELSIF v_beginner_complete THEN
    v_official_level := 'Intermediate';
  END IF;

  SELECT override_level
  INTO v_override_level
  FROM public.student_reading_level_overrides
  WHERE student_id = p_student_id AND revoked_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  v_effective_level := CASE
    WHEN v_override_level = 'Advanced' THEN 'Advanced'
    WHEN v_override_level = 'Intermediate' AND v_intermediate_complete THEN 'Advanced'
    WHEN v_override_level = 'Intermediate' THEN 'Intermediate'
    ELSE v_official_level
  END;

  v_current_requirements_met := CASE v_effective_level
    WHEN 'Beginner' THEN v_beginner_complete
    WHEN 'Intermediate' THEN v_intermediate_complete
    ELSE v_advanced_complete
  END;

  v_program_complete := v_advanced_complete AND CASE
    WHEN v_override_level = 'Advanced' THEN true
    WHEN v_override_level = 'Intermediate' THEN v_intermediate_complete
    ELSE v_beginner_complete AND v_intermediate_complete
  END;

  RETURN jsonb_build_object(
    'official_earned_level', v_official_level,
    'placement_override_level', v_override_level,
    'effective_level', v_effective_level,
    'official_progression_eligible', v_current_requirements_met,
    'program_complete', v_program_complete,
    'requirements', v_requirements
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_student_content_attempt(
  p_student_id UUID,
  p_content_id UUID,
  p_accuracy NUMERIC,
  p_transcript TEXT DEFAULT NULL,
  p_duration_seconds INTEGER DEFAULT NULL,
  p_is_full_submission BOOLEAN DEFAULT false,
  p_source TEXT DEFAULT 'practice'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_content public.reading_content%ROWTYPE;
  v_attempt_id UUID;
  v_completion_rows INTEGER := 0;
  v_qualifies BOOLEAN := false;
  v_snapshot JSONB;
  v_level TEXT;
BEGIN
  IF p_accuracy IS NULL OR p_accuracy < 0 OR p_accuracy > 100 THEN
    RAISE EXCEPTION 'accuracy must be between 0 and 100' USING ERRCODE = '22023';
  END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds < 0 THEN
    RAISE EXCEPTION 'duration_seconds cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('practice', 'assessment', 'diagnostic', 'lesson', 'recommendation', 'import') THEN
    RAISE EXCEPTION 'unsupported attempt source' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_content
  FROM public.reading_content
  WHERE id = p_content_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active reading content not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.student_content_attempts (
    student_id, content_id, accuracy, transcript, duration_seconds,
    is_full_submission, source
  ) VALUES (
    p_student_id, p_content_id, p_accuracy, NULLIF(btrim(p_transcript), ''),
    p_duration_seconds, p_is_full_submission, p_source
  )
  RETURNING id INTO v_attempt_id;

  -- Practice content requires >=75%. Paragraph assessments require a full
  -- scored submission, regardless of the score itself.
  v_qualifies := CASE
    WHEN v_content.content_type = 'paragraph' THEN p_is_full_submission
    ELSE p_accuracy >= 75
  END;

  IF v_qualifies THEN
    INSERT INTO public.student_content_completions (
      student_id, content_id, qualifying_attempt_id
    ) VALUES (
      p_student_id, p_content_id, v_attempt_id
    )
    ON CONFLICT (student_id, content_id) DO NOTHING;
    GET DIAGNOSTICS v_completion_rows = ROW_COUNT;
  END IF;

  v_snapshot := public.get_student_reading_progress(p_student_id);
  v_level := v_snapshot->>'effective_level';

  INSERT INTO public.child_progress (child_id, level, updated_at)
  VALUES (p_student_id, v_level, now())
  ON CONFLICT (child_id) DO UPDATE SET
    level = EXCLUDED.level,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'content_id', p_content_id,
    'content_type', v_content.content_type,
    'content_level', v_content.level,
    'completion_qualified', v_qualifies,
    'completion_awarded', v_completion_rows = 1,
    'progression', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_reading_progress(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_student_content_attempt(UUID, UUID, NUMERIC, TEXT, INTEGER, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_reading_progress(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_student_content_attempt(UUID, UUID, NUMERIC, TEXT, INTEGER, BOOLEAN, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
