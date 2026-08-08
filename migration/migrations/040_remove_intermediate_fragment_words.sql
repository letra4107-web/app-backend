-- Removes the 10 Level 2 Intermediate words confirmed to be fragments from
-- a data-extraction bug in the original workbook generation (a phrase like
-- "apat na buwan, limang taon, anim na oras, pitong linggo, walong..." was
-- tokenized into individual words instead of staying as a phrase). Flagged
-- "[NEEDS REVIEW - fragment/unclear entry]" in the client's updated
-- workbook and confirmed by the client for removal.
--
-- Same pattern as migration 029's "shorts" exclusion: deactivate rather
-- than delete (preserves any historical foreign-key references), and
-- temporarily reduce the Intermediate word requirement to match the real
-- available count so level-up isn't permanently blocked. Restore to 200
-- only if/when the client supplies and approves 10 replacement words.

UPDATE public.reading_content
SET is_active = false, updated_at = now()
WHERE content_type = 'word'
  AND level = 'Intermediate'
  AND normalized_text IN ('apat', 'na', 'buwan', 'limang', 'taon', 'anim', 'oras', 'pitong', 'linggo', 'walong');

UPDATE public.reading_level_requirements
SET required_count = 190
WHERE level = 'Intermediate' AND content_type = 'word';

NOTIFY pgrst, 'reload schema';
