-- Staged foundation for the module curriculum requested in August 2026.
--
-- This migration intentionally does NOT seed or activate modules and does NOT
-- replace get_student_reading_progress(). The existing count-based snapshot
-- therefore remains operational until the client confirms the unresolved
-- Beginner sound coverage and replacement/supplement rules for later levels.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Assessment membership is now represented by reading_module_assessments and
-- reading_module_assessment_items. Keep is_assessment as a legacy marker for
-- the existing Advanced paragraph bank, but no longer derive it from type.
ALTER TABLE public.reading_content
  DROP CONSTRAINT IF EXISTS reading_content_assessment_check;

ALTER TABLE public.reading_content
  DROP CONSTRAINT IF EXISTS reading_content_content_type_check;
ALTER TABLE public.reading_content
  ADD CONSTRAINT reading_content_content_type_check CHECK (
    content_type IN ('word', 'phonetic', 'phrase', 'sentence', 'paragraph', 'story')
  );

-- This reporting table is retained for historical/count analytics. Allowing
-- story keeps it compatible with the new content vocabulary, but no story
-- requirement is seeded here and this migration does not change its gate.
ALTER TABLE public.reading_level_requirements
  DROP CONSTRAINT IF EXISTS reading_level_requirements_content_type_check;
ALTER TABLE public.reading_level_requirements
  ADD CONSTRAINT reading_level_requirements_content_type_check CHECK (
    content_type IN ('word', 'phonetic', 'phrase', 'sentence', 'paragraph', 'story')
  );

COMMENT ON COLUMN public.reading_content.is_assessment IS
  'Legacy marker retained for historical paragraph rows. New assessment identity is owned by reading_module_assessments and reading_module_assessment_items.';
COMMENT ON TABLE public.reading_level_requirements IS
  'Legacy/count-based curriculum coverage requirements retained for reporting and historical compatibility. Module completion becomes the progression authority only in a later cutover migration.';

CREATE TABLE IF NOT EXISTS public.reading_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_version TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
  module_number INTEGER NOT NULL CHECK (module_number > 0),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT,
  instructional_content_type TEXT NOT NULL CHECK (
    instructional_content_type IN ('word', 'phonetic', 'phrase', 'sentence', 'paragraph', 'story')
  ),
  assessment_pass_percentage NUMERIC(5,2) NOT NULL DEFAULT 75
    CHECK (assessment_pass_percentage > 0 AND assessment_pass_percentage <= 100),
  is_required BOOLEAN NOT NULL DEFAULT true,
  -- Inactive by default: activating curriculum is a separate client-approved
  -- seed/cutover step after the open content questions are resolved.
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (curriculum_version, level, module_number)
);

CREATE INDEX IF NOT EXISTS reading_modules_path_idx
  ON public.reading_modules(curriculum_version, level, module_number)
  WHERE is_active;

-- The table can retain historical versions, but runtime path queries must
-- never combine two active curriculum versions.
CREATE OR REPLACE FUNCTION public.validate_active_module_curriculum_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active AND EXISTS (
    SELECT 1 FROM public.reading_modules module
    WHERE module.is_active
      AND module.curriculum_version <> NEW.curriculum_version
      AND module.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Only one curriculum version can be active at a time'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reading_module_items item
    JOIN public.reading_content content ON content.id = item.content_id
    WHERE item.module_id = NEW.id
      AND content.content_type <> NEW.instructional_content_type
  ) THEN
    RAISE EXCEPTION 'A module type cannot conflict with its existing content items'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_active_module_curriculum_version_trigger
  ON public.reading_modules;
CREATE TRIGGER validate_active_module_curriculum_version_trigger
  BEFORE INSERT OR UPDATE OF curriculum_version, instructional_content_type, is_active
  ON public.reading_modules
  FOR EACH ROW EXECUTE FUNCTION public.validate_active_module_curriculum_version();

CREATE TABLE IF NOT EXISTS public.reading_module_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.reading_modules(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.reading_content(id) ON DELETE RESTRICT,
  item_order INTEGER NOT NULL CHECK (item_order > 0),
  role TEXT NOT NULL DEFAULT 'practice' CHECK (role IN ('instruction', 'practice', 'assessment')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_id, content_id),
  UNIQUE (module_id, item_order)
);

CREATE INDEX IF NOT EXISTS reading_module_items_content_idx
  ON public.reading_module_items(content_id);

CREATE TABLE IF NOT EXISTS public.reading_module_prerequisites (
  module_id UUID NOT NULL REFERENCES public.reading_modules(id) ON DELETE CASCADE,
  prerequisite_module_id UUID NOT NULL REFERENCES public.reading_modules(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, prerequisite_module_id),
  CHECK (module_id <> prerequisite_module_id)
);

CREATE INDEX IF NOT EXISTS reading_module_prerequisites_reverse_idx
  ON public.reading_module_prerequisites(prerequisite_module_id, module_id);

CREATE TABLE IF NOT EXISTS public.reading_module_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL UNIQUE REFERENCES public.reading_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  instructions TEXT,
  scoring_policy TEXT NOT NULL DEFAULT 'weighted_average_accuracy'
    CHECK (scoring_policy IN ('weighted_average_accuracy')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reading_module_assessment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.reading_module_assessments(id) ON DELETE CASCADE,
  module_item_id UUID NOT NULL REFERENCES public.reading_module_items(id) ON DELETE RESTRICT,
  item_order INTEGER NOT NULL CHECK (item_order > 0),
  weight NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, module_item_id),
  UNIQUE (assessment_id, item_order)
);

CREATE TABLE IF NOT EXISTS public.student_module_assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES public.reading_module_assessments(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  score NUMERIC(5,2) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  pass_percentage_snapshot NUMERIC(5,2) NOT NULL
    CHECK (pass_percentage_snapshot > 0 AND pass_percentage_snapshot <= 100),
  passed BOOLEAN,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  CONSTRAINT student_module_assessment_submission_check CHECK (
    (status = 'in_progress' AND score IS NULL AND passed IS NULL AND submitted_at IS NULL)
    OR
    (status = 'submitted' AND score IS NOT NULL AND passed IS NOT NULL AND submitted_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS student_module_assessment_attempts_student_idx
  ON public.student_module_assessment_attempts(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS student_module_assessment_attempts_assessment_idx
  ON public.student_module_assessment_attempts(assessment_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_in_progress_module_assessment_per_student_idx
  ON public.student_module_assessment_attempts(student_id, assessment_id)
  WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS public.student_module_assessment_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_attempt_id UUID NOT NULL
    REFERENCES public.student_module_assessment_attempts(id) ON DELETE CASCADE,
  assessment_item_id UUID NOT NULL
    REFERENCES public.reading_module_assessment_items(id) ON DELETE RESTRICT,
  content_attempt_id UUID NOT NULL UNIQUE
    REFERENCES public.student_content_attempts(id) ON DELETE RESTRICT,
  response_score NUMERIC(5,2) NOT NULL CHECK (response_score >= 0 AND response_score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assessment_attempt_id, assessment_item_id)
);

CREATE INDEX IF NOT EXISTS student_module_assessment_responses_attempt_idx
  ON public.student_module_assessment_responses(assessment_attempt_id);

CREATE TABLE IF NOT EXISTS public.student_module_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.reading_modules(id) ON DELETE RESTRICT,
  qualifying_assessment_attempt_id UUID NOT NULL UNIQUE
    REFERENCES public.student_module_assessment_attempts(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, module_id)
);

CREATE INDEX IF NOT EXISTS student_module_completions_student_idx
  ON public.student_module_completions(student_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.student_equipped_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.reading_modules(id) ON DELETE RESTRICT,
  slot_number INTEGER NOT NULL CHECK (slot_number > 0),
  equipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, module_id),
  UNIQUE (student_id, slot_number)
);

CREATE INDEX IF NOT EXISTS student_equipped_modules_student_idx
  ON public.student_equipped_modules(student_id, slot_number);

-- Cross-table CHECK constraints cannot compare a module's declared type with
-- its content row, so enforce module homogeneity at write time.
CREATE OR REPLACE FUNCTION public.validate_reading_module_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module_type TEXT;
  v_content_type TEXT;
BEGIN
  SELECT instructional_content_type INTO v_module_type
  FROM public.reading_modules
  WHERE id = NEW.module_id;

  SELECT content_type INTO v_content_type
  FROM public.reading_content
  WHERE id = NEW.content_id;

  IF v_module_type IS NULL OR v_content_type IS NULL THEN
    RAISE EXCEPTION 'Module and content must exist' USING ERRCODE = '23503';
  END IF;
  IF v_module_type <> v_content_type THEN
    RAISE EXCEPTION 'Module content must be homogeneous: module type %, content type %',
      v_module_type, v_content_type USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reading_module_assessment_items assessment_item
    JOIN public.reading_module_assessments assessment
      ON assessment.id = assessment_item.assessment_id
    WHERE assessment_item.module_item_id = NEW.id
      AND (assessment.module_id <> NEW.module_id OR NEW.role <> 'assessment')
  ) THEN
    RAISE EXCEPTION 'An assessment-linked module item must retain its module and assessment role'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_reading_module_item_trigger ON public.reading_module_items;
CREATE TRIGGER validate_reading_module_item_trigger
  BEFORE INSERT OR UPDATE OF module_id, content_id, role
  ON public.reading_module_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_reading_module_item();

CREATE OR REPLACE FUNCTION public.validate_reading_module_assessment_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assessment_module_id UUID;
  v_item_module_id UUID;
  v_item_role TEXT;
BEGIN
  SELECT module_id INTO v_assessment_module_id
  FROM public.reading_module_assessments
  WHERE id = NEW.assessment_id;

  SELECT module_id, role INTO v_item_module_id, v_item_role
  FROM public.reading_module_items
  WHERE id = NEW.module_item_id;

  IF v_assessment_module_id IS NULL OR v_item_module_id IS NULL THEN
    RAISE EXCEPTION 'Assessment and module item must exist' USING ERRCODE = '23503';
  END IF;
  IF v_assessment_module_id <> v_item_module_id OR v_item_role <> 'assessment' THEN
    RAISE EXCEPTION 'Assessment items must reference assessment-role content in the same module'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_reading_module_assessment_item_trigger
  ON public.reading_module_assessment_items;
CREATE TRIGGER validate_reading_module_assessment_item_trigger
  BEFORE INSERT OR UPDATE OF assessment_id, module_item_id
  ON public.reading_module_assessment_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_reading_module_assessment_item();

CREATE OR REPLACE FUNCTION public.validate_reading_module_assessment_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reading_module_assessment_items assessment_item
    JOIN public.reading_module_items module_item
      ON module_item.id = assessment_item.module_item_id
    WHERE assessment_item.assessment_id = NEW.id
      AND module_item.module_id <> NEW.module_id
  ) THEN
    RAISE EXCEPTION 'An assessment cannot move away from the module containing its configured items'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_reading_module_assessment_definition_trigger
  ON public.reading_module_assessments;
CREATE TRIGGER validate_reading_module_assessment_definition_trigger
  BEFORE UPDATE OF module_id
  ON public.reading_module_assessments
  FOR EACH ROW EXECUTE FUNCTION public.validate_reading_module_assessment_definition();

CREATE OR REPLACE FUNCTION public.validate_student_module_assessment_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.student_module_assessment_attempts module_attempt
    JOIN public.reading_module_assessment_items assessment_item
      ON assessment_item.id = NEW.assessment_item_id
     AND assessment_item.assessment_id = module_attempt.assessment_id
    JOIN public.reading_module_items module_item
      ON module_item.id = assessment_item.module_item_id
    JOIN public.student_content_attempts content_attempt
      ON content_attempt.id = NEW.content_attempt_id
     AND content_attempt.student_id = module_attempt.student_id
     AND content_attempt.content_id = module_item.content_id
     AND content_attempt.source = 'assessment'
    WHERE module_attempt.id = NEW.assessment_attempt_id
      AND NEW.response_score = content_attempt.accuracy
  ) THEN
    RAISE EXCEPTION 'Assessment response does not match its student, assessment item, content, or immutable score'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_student_module_assessment_response_trigger
  ON public.student_module_assessment_responses;
CREATE TRIGGER validate_student_module_assessment_response_trigger
  BEFORE INSERT OR UPDATE
  ON public.student_module_assessment_responses
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_module_assessment_response();

CREATE OR REPLACE FUNCTION public.validate_student_module_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.student_module_assessment_attempts attempt
    JOIN public.reading_module_assessments assessment
      ON assessment.id = attempt.assessment_id
    WHERE attempt.id = NEW.qualifying_assessment_attempt_id
      AND attempt.student_id = NEW.student_id
      AND assessment.module_id = NEW.module_id
      AND attempt.status = 'submitted'
      AND attempt.passed = true
  ) THEN
    RAISE EXCEPTION 'Module completion requires the same student''s passed assessment attempt for that module'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_student_module_completion_trigger
  ON public.student_module_completions;
CREATE TRIGGER validate_student_module_completion_trigger
  BEFORE INSERT OR UPDATE
  ON public.student_module_completions
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_module_completion();

CREATE OR REPLACE FUNCTION public.validate_student_equipped_module()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.student_module_completions completion
    WHERE completion.student_id = NEW.student_id
      AND completion.module_id = NEW.module_id
  ) THEN
    RAISE EXCEPTION 'Only a completed module can be equipped' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_student_equipped_module_trigger
  ON public.student_equipped_modules;
CREATE TRIGGER validate_student_equipped_module_trigger
  BEFORE INSERT OR UPDATE OF student_id, module_id
  ON public.student_equipped_modules
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_equipped_module();

-- Reject cyclic prerequisite graphs before curriculum activation.
CREATE OR REPLACE FUNCTION public.validate_reading_module_prerequisite()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module_version TEXT;
  v_prerequisite_version TEXT;
BEGIN
  SELECT curriculum_version INTO v_module_version
  FROM public.reading_modules WHERE id = NEW.module_id;
  SELECT curriculum_version INTO v_prerequisite_version
  FROM public.reading_modules WHERE id = NEW.prerequisite_module_id;

  IF v_module_version IS DISTINCT FROM v_prerequisite_version THEN
    RAISE EXCEPTION 'Module prerequisites must belong to the same curriculum version'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(module_id) AS (
      SELECT prerequisite_module_id
      FROM public.reading_module_prerequisites
      WHERE module_id = NEW.prerequisite_module_id
      UNION
      SELECT prerequisite.prerequisite_module_id
      FROM public.reading_module_prerequisites prerequisite
      JOIN ancestors ON prerequisite.module_id = ancestors.module_id
    )
    SELECT 1 FROM ancestors WHERE module_id = NEW.module_id
  ) THEN
    RAISE EXCEPTION 'Module prerequisite cycle detected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_reading_module_prerequisite_trigger
  ON public.reading_module_prerequisites;
CREATE TRIGGER validate_reading_module_prerequisite_trigger
  BEFORE INSERT OR UPDATE OF module_id, prerequisite_module_id
  ON public.reading_module_prerequisites
  FOR EACH ROW EXECUTE FUNCTION public.validate_reading_module_prerequisite();

-- Internal helper. Curriculum-specific edges are deliberately data-driven;
-- this function does not invent an implicit B/K/D or numeric prerequisite.
CREATE OR REPLACE FUNCTION public.is_student_module_unlocked(
  p_student_id UUID,
  p_module_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.reading_modules module
      WHERE module.id = p_module_id AND module.is_active
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.reading_module_prerequisites prerequisite
      JOIN public.reading_modules prerequisite_module
        ON prerequisite_module.id = prerequisite.prerequisite_module_id
       AND prerequisite_module.is_active
      LEFT JOIN public.student_module_completions completion
        ON completion.module_id = prerequisite.prerequisite_module_id
       AND completion.student_id = p_student_id
      WHERE prerequisite.module_id = p_module_id
        AND completion.id IS NULL
    );
$$;

-- Module-derived level snapshot. With no active modules it explicitly reports
-- configured=false and preserves the legacy child_progress level. A future
-- cutover migration will make this snapshot authoritative and create audited
-- transition overrides for existing Intermediate/Advanced students.
CREATE OR REPLACE FUNCTION public.get_student_module_level(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_configured BOOLEAN := false;
  v_beginner_complete BOOLEAN := false;
  v_intermediate_complete BOOLEAN := false;
  v_advanced_complete BOOLEAN := false;
  v_earned_level TEXT := 'Beginner';
  v_override_level TEXT;
  v_legacy_level TEXT := 'Beginner';
  v_effective_level TEXT := 'Beginner';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.reading_modules WHERE is_active)
  INTO v_configured;

  SELECT COALESCE(level, 'Beginner') INTO v_legacy_level
  FROM public.child_progress WHERE child_id = p_student_id;
  v_legacy_level := COALESCE(v_legacy_level, 'Beginner');

  SELECT override_level INTO v_override_level
  FROM public.student_reading_level_overrides
  WHERE student_id = p_student_id AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF NOT v_configured THEN
    RETURN jsonb_build_object(
      'configured', false,
      'official_earned_level', v_legacy_level,
      'placement_override_level', v_override_level,
      'effective_level', CASE
        WHEN v_legacy_level = 'Advanced' OR v_override_level = 'Advanced' THEN 'Advanced'
        WHEN v_legacy_level = 'Intermediate' OR v_override_level = 'Intermediate' THEN 'Intermediate'
        ELSE 'Beginner'
      END,
      'program_complete', false,
      'progression_authority', 'legacy_counts_pending_module_cutover'
    );
  END IF;

  SELECT
    COALESCE(bool_and(completion.id IS NOT NULL) FILTER (
      WHERE module.level = 'Beginner' AND module.is_required
    ), false),
    COALESCE(bool_and(completion.id IS NOT NULL) FILTER (
      WHERE module.level = 'Intermediate' AND module.is_required
    ), false),
    COALESCE(bool_and(completion.id IS NOT NULL) FILTER (
      WHERE module.level = 'Advanced' AND module.is_required
    ), false)
  INTO v_beginner_complete, v_intermediate_complete, v_advanced_complete
  FROM public.reading_modules module
  LEFT JOIN public.student_module_completions completion
    ON completion.module_id = module.id AND completion.student_id = p_student_id
  WHERE module.is_active;

  IF v_beginner_complete AND v_intermediate_complete THEN
    v_earned_level := 'Advanced';
  ELSIF v_beginner_complete THEN
    v_earned_level := 'Intermediate';
  END IF;

  -- An audited placement/transition override is a floor, never a fabricated
  -- module completion. Exact cross-level prerequisite treatment is deferred
  -- to the client-approved activation/cutover migration.
  v_effective_level := CASE
    WHEN v_override_level = 'Advanced' THEN 'Advanced'
    WHEN v_override_level = 'Intermediate' AND v_earned_level = 'Advanced' THEN 'Advanced'
    WHEN v_override_level = 'Intermediate' THEN 'Intermediate'
    ELSE v_earned_level
  END;

  RETURN jsonb_build_object(
    'configured', true,
    'official_earned_level', v_earned_level,
    'placement_override_level', v_override_level,
    'effective_level', v_effective_level,
    'beginner_complete', v_beginner_complete,
    'intermediate_complete', v_intermediate_complete,
    'advanced_complete', v_advanced_complete,
    'program_complete', v_beginner_complete AND v_intermediate_complete AND v_advanced_complete,
    'progression_authority', 'module_assessment_completions'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_module_path(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_level JSONB;
  v_modules JSONB;
  v_current_module JSONB;
BEGIN
  v_level := public.get_student_module_level(p_student_id);

  SELECT COALESCE(jsonb_agg(module_row.payload ORDER BY module_row.level_order, module_row.module_number), '[]'::jsonb)
  INTO v_modules
  FROM (
    SELECT
      CASE module.level WHEN 'Beginner' THEN 1 WHEN 'Intermediate' THEN 2 ELSE 3 END AS level_order,
      module.module_number,
      jsonb_build_object(
        'id', module.id,
        'curriculum_version', module.curriculum_version,
        'level', module.level,
        'module_number', module.module_number,
        'title', module.title,
        'description', module.description,
        'instructional_content_type', module.instructional_content_type,
        'assessment_pass_percentage', module.assessment_pass_percentage,
        'is_required', module.is_required,
        'state', CASE
          WHEN completion.id IS NOT NULL THEN 'completed'
          WHEN public.is_student_module_unlocked(p_student_id, module.id) THEN 'unlocked'
          ELSE 'locked'
        END,
        'completed_at', completion.completed_at,
        'content_item_count', (
          SELECT COUNT(*) FROM public.reading_module_items item
          WHERE item.module_id = module.id AND item.role <> 'assessment'
        ),
        'completed_content_item_count', (
          SELECT COUNT(*)
          FROM public.reading_module_items item
          JOIN public.student_content_completions content_completion
            ON content_completion.content_id = item.content_id
           AND content_completion.student_id = p_student_id
          WHERE item.module_id = module.id AND item.role <> 'assessment'
        )
      ) AS payload
    FROM public.reading_modules module
    LEFT JOIN public.student_module_completions completion
      ON completion.module_id = module.id AND completion.student_id = p_student_id
    WHERE module.is_active
  ) module_row;

  SELECT module_entry INTO v_current_module
  FROM jsonb_array_elements(v_modules) module_entry
  WHERE module_entry->>'state' = 'unlocked'
    AND module_entry->>'level' = v_level->>'effective_level'
  ORDER BY (module_entry->>'module_number')::INTEGER
  LIMIT 1;

  RETURN v_level || jsonb_build_object(
    'modules', v_modules,
    'current_module', v_current_module
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_reading_module_content(
  p_student_id UUID,
  p_module_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module public.reading_modules%ROWTYPE;
  v_items JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_module FROM public.reading_modules
  WHERE id = p_module_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active module not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_student_module_unlocked(p_student_id, p_module_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.student_module_completions
       WHERE student_id = p_student_id AND module_id = p_module_id
     ) THEN
    RAISE EXCEPTION 'Module is locked' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'module_item_id', item.id,
    'content_id', content.id,
    'content_text', content.content_text,
    'content_type', content.content_type,
    'level', content.level,
    'item_order', item.item_order,
    'role', item.role,
    'word_id', content.word_id,
    'pattern_note', content.pattern_note,
    'syllable_hyphenation', content.syllable_hyphenation,
    'completed', completion.id IS NOT NULL
  ) ORDER BY item.item_order), '[]'::jsonb)
  INTO v_items
  FROM public.reading_module_items item
  JOIN public.reading_content content ON content.id = item.content_id AND content.is_active
  LEFT JOIN public.student_content_completions completion
    ON completion.content_id = content.id AND completion.student_id = p_student_id
  WHERE item.module_id = p_module_id;

  RETURN jsonb_build_object(
    'module', jsonb_build_object(
      'id', v_module.id,
      'curriculum_version', v_module.curriculum_version,
      'level', v_module.level,
      'module_number', v_module.module_number,
      'title', v_module.title,
      'instructional_content_type', v_module.instructional_content_type,
      'assessment_pass_percentage', v_module.assessment_pass_percentage
    ),
    'items', v_items
  );
END;
$$;

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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.children WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_assessment FROM public.reading_module_assessments
  WHERE id = p_assessment_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active assessment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_module FROM public.reading_modules
  WHERE id = v_assessment.module_id AND is_active;

  IF NOT public.is_student_module_unlocked(p_student_id, v_module.id) THEN
    RAISE EXCEPTION 'Module is locked' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reading_module_items item
    LEFT JOIN public.student_content_completions completion
      ON completion.content_id = item.content_id AND completion.student_id = p_student_id
    WHERE item.module_id = v_module.id
      AND item.role <> 'assessment'
      AND completion.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Complete all instructional module items before starting the assessment'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reading_module_assessment_items
    WHERE assessment_id = p_assessment_id
  ) THEN
    RAISE EXCEPTION 'Assessment has no configured items' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent for retries/double taps: resume the one active attempt instead
  -- of creating parallel submissions for the same student and assessment.
  SELECT id INTO v_attempt_id
  FROM public.student_module_assessment_attempts
  WHERE student_id = p_student_id
    AND assessment_id = p_assessment_id
    AND status = 'in_progress'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_attempt_id IS NULL THEN
    INSERT INTO public.student_module_assessment_attempts (
      student_id, assessment_id, pass_percentage_snapshot
    ) VALUES (
      p_student_id, p_assessment_id, v_module.assessment_pass_percentage
    )
    ON CONFLICT (student_id, assessment_id) WHERE status = 'in_progress'
    DO NOTHING
    RETURNING id INTO v_attempt_id;
    IF v_attempt_id IS NULL THEN
      SELECT id INTO v_attempt_id
      FROM public.student_module_assessment_attempts
      WHERE student_id = p_student_id
        AND assessment_id = p_assessment_id
        AND status = 'in_progress'
      ORDER BY started_at DESC
      LIMIT 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'assessment_id', p_assessment_id,
    'module_id', v_module.id,
    'pass_percentage', v_module.assessment_pass_percentage,
    'status', 'in_progress'
  );
END;
$$;

-- p_responses is an array of:
-- [{"assessment_item_id":"...", "content_attempt_id":"..."}]
-- Each content attempt must already be an immutable assessment-source attempt
-- for the signed-in student and the configured assessment content.
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

  SELECT assessment.module_id INTO v_module_id
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
  v_passed := v_score >= v_attempt.pass_percentage_snapshot;

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

CREATE OR REPLACE FUNCTION public.equip_student_module(
  p_student_id UUID,
  p_module_id UUID,
  p_slot_number INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_slot_number IS NULL OR p_slot_number <= 0 THEN
    RAISE EXCEPTION 'slot_number must be positive' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.student_module_completions
    WHERE student_id = p_student_id AND module_id = p_module_id
  ) THEN
    RAISE EXCEPTION 'Only completed modules can be equipped' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.student_equipped_modules
  WHERE student_id = p_student_id AND module_id = p_module_id;

  INSERT INTO public.student_equipped_modules (student_id, module_id, slot_number)
  VALUES (p_student_id, p_module_id, p_slot_number)
  ON CONFLICT (student_id, slot_number) DO UPDATE SET
    module_id = EXCLUDED.module_id,
    equipped_at = now();

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'module_id', p_module_id,
    'slot_number', p_slot_number,
    'equipped', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unequip_student_module(
  p_student_id UUID,
  p_module_id UUID DEFAULT NULL,
  p_slot_number INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_removed INTEGER;
BEGIN
  IF p_module_id IS NULL AND p_slot_number IS NULL THEN
    RAISE EXCEPTION 'module_id or slot_number is required' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.student_equipped_modules
  WHERE student_id = p_student_id
    AND (p_module_id IS NULL OR module_id = p_module_id)
    AND (p_slot_number IS NULL OR slot_number = p_slot_number);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object('removed', v_removed, 'equipped', false);
END;
$$;

ALTER TABLE public.reading_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_module_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_module_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_module_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_module_assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_module_assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_module_assessment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_module_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_equipped_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read active modules"
  ON public.reading_modules FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "Authenticated users read active module items"
  ON public.reading_module_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reading_modules module
    WHERE module.id = module_id AND module.is_active
  ));
CREATE POLICY "Authenticated users read active module prerequisites"
  ON public.reading_module_prerequisites FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reading_modules module
    WHERE module.id = module_id AND module.is_active
  ));
CREATE POLICY "Authenticated users read active module assessments"
  ON public.reading_module_assessments FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "Authenticated users read active module assessment items"
  ON public.reading_module_assessment_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reading_module_assessments assessment
    WHERE assessment.id = assessment_id AND assessment.is_active
  ));

CREATE POLICY "Students view own module assessment attempts"
  ON public.student_module_assessment_attempts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = student_id AND child.auth_uid::text = auth.uid()::text
  ));
CREATE POLICY "Parents view child module assessment attempts"
  ON public.student_module_assessment_attempts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = student_id AND child.parent_id::text = auth.uid()::text
  ));
CREATE POLICY "Students view own module assessment responses"
  ON public.student_module_assessment_responses FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.student_module_assessment_attempts attempt
    JOIN public.children child ON child.id = attempt.student_id
    WHERE attempt.id = assessment_attempt_id AND child.auth_uid::text = auth.uid()::text
  ));
CREATE POLICY "Parents view child module assessment responses"
  ON public.student_module_assessment_responses FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.student_module_assessment_attempts attempt
    JOIN public.children child ON child.id = attempt.student_id
    WHERE attempt.id = assessment_attempt_id AND child.parent_id::text = auth.uid()::text
  ));
CREATE POLICY "Students view own module completions"
  ON public.student_module_completions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = student_id AND child.auth_uid::text = auth.uid()::text
  ));
CREATE POLICY "Parents view child module completions"
  ON public.student_module_completions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = student_id AND child.parent_id::text = auth.uid()::text
  ));
CREATE POLICY "Students view own equipped modules"
  ON public.student_equipped_modules FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = student_id AND child.auth_uid::text = auth.uid()::text
  ));
CREATE POLICY "Parents view child equipped modules"
  ON public.student_equipped_modules FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = student_id AND child.parent_id::text = auth.uid()::text
  ));

-- All mutations remain server-owned. Authenticated clients receive no direct
-- INSERT/UPDATE/DELETE policies on module progress, assessment, or showcase
-- tables; the backend service role calls these audited RPCs.
REVOKE ALL ON FUNCTION public.is_student_module_unlocked(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_student_module_level(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_student_module_path(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_reading_module_content(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_module_assessment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_module_assessment(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equip_student_module(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unequip_student_module(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_student_module_unlocked(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_student_module_level(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_student_module_path(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reading_module_content(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_module_assessment(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_module_assessment(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.equip_student_module(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.unequip_student_module(UUID, UUID, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
