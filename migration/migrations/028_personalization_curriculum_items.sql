-- Recommendation audit rows now cover canonical curriculum items, not only
-- public.words. Existing word recommendations are backfilled through the
-- stable reading_content.word_id link before content_id becomes mandatory.
ALTER TABLE public.personalization_recommendation_words
  ADD COLUMN IF NOT EXISTS content_id UUID;

UPDATE public.personalization_recommendation_words recommendation_word
SET content_id = content.id
FROM public.reading_content content
WHERE recommendation_word.content_id IS NULL
  AND content.word_id = recommendation_word.word_id
  AND content.content_type = 'word';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.personalization_recommendation_words
    WHERE content_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot require content_id: legacy recommendation rows remain unmapped';
  END IF;
END
$$;

ALTER TABLE public.personalization_recommendation_words
  ALTER COLUMN content_id SET NOT NULL,
  ALTER COLUMN word_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'personalization_recommendation_content_id_fkey'
      AND conrelid = 'public.personalization_recommendation_words'::regclass
  ) THEN
    ALTER TABLE public.personalization_recommendation_words
      ADD CONSTRAINT personalization_recommendation_content_id_fkey
      FOREIGN KEY (content_id) REFERENCES public.reading_content(id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS personalization_recommendation_content_unique_idx
  ON public.personalization_recommendation_words(recommendation_id, content_id);
CREATE INDEX IF NOT EXISTS personalization_recommendation_content_lookup_idx
  ON public.personalization_recommendation_words(content_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
