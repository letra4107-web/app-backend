-- Client-approved curriculum correction: "shorts" was an accidental English
-- row in Level 1 Simple. Preserve the stable row for audit/history and any
-- existing foreign-key references, but remove it from all active curriculum
-- reads and recommendation candidates. The approved phonetic drills
-- dra/dre/dri/dro/dru intentionally remain active.
UPDATE public.reading_content
SET is_active = false,
    updated_at = now()
WHERE normalized_text = 'shorts'
  AND content_type = 'word'
  AND level = 'Beginner';

-- TEMPORARY progression adjustment: removing the rejected row leaves only
-- 199 approved Beginner words. Keep advancement achievable at 199 until the
-- client supplies a replacement word; when that replacement is approved and
-- seeded, restore ONLY this Beginner/word requirement to 200. Intermediate
-- and Advanced requirements are intentionally untouched.
UPDATE public.reading_level_requirements
SET required_count = 199
WHERE level = 'Beginner'
  AND content_type = 'word';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reading_content
    WHERE normalized_text = 'shorts'
      AND content_type = 'word'
      AND level = 'Beginner'
      AND is_active = false
  ) THEN
    RAISE EXCEPTION 'Expected rejected shorts curriculum row was not deactivated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.reading_level_requirements
    WHERE level = 'Beginner'
      AND content_type = 'word'
      AND required_count = 199
  ) THEN
    RAISE EXCEPTION 'Expected temporary Beginner word requirement of 199 was not applied';
  END IF;
END $$;
