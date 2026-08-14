-- MODULE 17 METADATA CONSISTENCY FIX
--
-- Verification after migration 048 found that the 10 of Module 17's 20
-- words that already existed as active Beginner/word content (from the
-- unrelated "Level 1 Simple" seed) kept their old backend_category
-- ('beginner_word') and null pattern_note, while the 10 newly-inserted
-- words got 'presentation_mvp_module_17' and the pattern note - migration
-- 048's ON CONFLICT clause only refreshed word_id/is_active/
-- syllable_hyphenation/definition/definition_needs_review, not these two
-- columns. Backfills the same tagging onto the pre-existing 10 so all 20
-- of Module 17's words are consistently tagged. source_sheet/source_row
-- are deliberately left untouched on the pre-existing 10 - that's their
-- genuine original provenance, not something to overwrite.

BEGIN;

UPDATE public.reading_content
SET
  backend_category = 'presentation_mvp_module_17',
  pattern_note = 'Pure open-CV word spanning Modules 5-16 consonants'
WHERE content_type = 'word' AND level = 'Beginner'
  AND normalized_text IN ('bata','puti','pula','gabi','tawa','sabi','hila','ngiti','wala','kusina');

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reading_content
      WHERE content_type='word' AND level='Beginner'
        AND backend_category='presentation_mvp_module_17') <> 20 THEN
    RAISE EXCEPTION 'Expected all 20 Module 17 words to share backend_category presentation_mvp_module_17';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
