-- Adds columns for the client's updated curriculum workbook, which now
-- includes per-word syllable hyphenation and a short Tagalog definition
-- for all 600 words across Level 1/2/3 (Tagalog_Phonetic_Words_
-- Dyslexia_App_Updated_WITH_DEFINITIONS.xlsx).
--
-- definition_needs_review flags rows whose definition should not be
-- presented as final/authoritative without client/linguist review - set
-- true for all Level 3 Advanced rows by the seed script, since those 200
-- definitions are AI-drafted for compound phrases that aren't standard
-- Tagalog vocabulary (lower confidence than Level 1/2, which are real,
-- common words). Same "draft, needs review" status as the earlier
-- word_definitions Batch 1 (migration 038), just tracked as a real column
-- here since this batch is 6x larger and the whole Level 3 sheet is
-- flagged, not scattered individual words.
ALTER TABLE public.reading_content
  ADD COLUMN IF NOT EXISTS syllable_hyphenation TEXT,
  ADD COLUMN IF NOT EXISTS definition TEXT,
  ADD COLUMN IF NOT EXISTS definition_needs_review BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
