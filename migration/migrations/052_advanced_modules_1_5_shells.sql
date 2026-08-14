-- ADVANCED MODULES 1-5 (shell-only placeholders, Stage 4)
--
-- Replaces migration 047's 10 generic sentence-based Advanced modules with
-- 5 placeholder shells for the new short-story + comprehension design.
-- This is intentionally the same replacement pattern used for Intermediate
-- in migration 050: the old modules use module_number 1-10 under the same
-- curriculum_version/level, which would collide with the new modules'
-- 1-5 numbering, so they're removed here rather than left alongside.
-- Verified zero completions/attempts on the old Advanced modules
-- immediately before writing this migration - see the guard below, which
-- re-checks the same thing at migration time.
--
-- Deliberately no reading_content, reading_module_items, or reading_module_
-- assessments are created here - there is no real story text yet. Each
-- shell module has a placeholder title ("Kwento 1".."Kwento 5") and
-- description, zero instructional items (content_item_count will read 0,
-- which get_student_module_path already handles safely), and no
-- assessment_id (null) until a later migration seeds the real story text
-- plus its 5 MC comprehension questions per module (using the answer_
-- options/correct_answer_index columns and full_submission_diagnostic
-- scoring policy added in migration 051).
--
-- Per the earlier approved design: the 5 story modules are NOT sequential
-- (no reading_module_prerequisites between them) - each story is
-- independent comprehension content, not cumulative phonetic/vocabulary
-- building like Beginner/Intermediate. module_number is kept only for
-- stable display ordering in the Learn tab. All 5 are active/visible as
-- soon as a student reaches Advanced level.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_module_completions completion
    JOIN public.reading_modules module ON module.id = completion.module_id
    WHERE module.level = 'Advanced'
  ) THEN
    RAISE EXCEPTION 'Advanced modules already have student completions - aborting replacement';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.student_module_assessment_attempts attempt
    JOIN public.reading_module_assessments assessment ON assessment.id = attempt.assessment_id
    JOIN public.reading_modules module ON module.id = assessment.module_id
    WHERE module.level = 'Advanced'
  ) THEN
    RAISE EXCEPTION 'Advanced modules already have assessment attempts - aborting replacement';
  END IF;
END;
$$;

-- ============================================================
-- PART 1: Remove migration 047's old 10 Advanced modules (confirmed
-- empty above). The underlying 200-sentence reading_content pool is left
-- untouched - unlinked, not deleted.
-- ============================================================
DELETE FROM public.reading_module_assessment_items
WHERE assessment_id IN (
  SELECT assessment.id FROM public.reading_module_assessments assessment
  JOIN public.reading_modules module ON module.id = assessment.module_id
  WHERE module.level = 'Advanced'
);
DELETE FROM public.reading_module_assessments
WHERE module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Advanced');
DELETE FROM public.reading_module_prerequisites
WHERE module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Advanced')
   OR prerequisite_module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Advanced');
DELETE FROM public.reading_module_items
WHERE module_id IN (SELECT id FROM public.reading_modules WHERE level = 'Advanced');
DELETE FROM public.reading_modules WHERE level = 'Advanced';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reading_modules WHERE level = 'Advanced') THEN
    RAISE EXCEPTION 'Expected zero Advanced modules after clearing migration 047 content';
  END IF;
END;
$$;

-- ============================================================
-- PART 2: Five placeholder shells. Active immediately (per explicit
-- request, so locked/unlocked rendering can be checked on-device before
-- real content exists) but with zero items and no assessment - a later
-- migration fills each one in as its story is supplied.
-- ============================================================
INSERT INTO public.reading_modules (
  curriculum_version, level, module_number, title, description,
  instructional_content_type, assessment_pass_percentage, is_required, is_active
)
VALUES
  ('presentation_beginner_mvp_v1','Advanced',1,'Kwento 1','Darating na ang kwentong ito.','paragraph',75,true,true),
  ('presentation_beginner_mvp_v1','Advanced',2,'Kwento 2','Darating na ang kwentong ito.','paragraph',75,true,true),
  ('presentation_beginner_mvp_v1','Advanced',3,'Kwento 3','Darating na ang kwentong ito.','paragraph',75,true,true),
  ('presentation_beginner_mvp_v1','Advanced',4,'Kwento 4','Darating na ang kwentong ito.','paragraph',75,true,true),
  ('presentation_beginner_mvp_v1','Advanced',5,'Kwento 5','Darating na ang kwentong ito.','paragraph',75,true,true)
ON CONFLICT (curriculum_version, level, module_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  instructional_content_type = EXCLUDED.instructional_content_type,
  assessment_pass_percentage = 75,
  is_required = true,
  is_active = true;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_modules WHERE level = 'Advanced' AND is_active) <> 5 THEN
    RAISE EXCEPTION 'Expected exactly 5 active Advanced placeholder shells';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
