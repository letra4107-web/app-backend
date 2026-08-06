-- Extends existing event logs with the recommendation/session context that is
-- not already represented elsewhere. Phoneme-error occurrences remain in
-- phoneme_confusion; they are intentionally not duplicated as JSON here.
ALTER TABLE public.word_of_day_log
  ADD COLUMN IF NOT EXISTS content_id UUID REFERENCES public.reading_content(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recommendation_id UUID REFERENCES public.personalization_recommendations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recommendation_reason TEXT;

ALTER TABLE public.pronunciation_practice_sessions
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS recommendation_reason TEXT;

CREATE INDEX IF NOT EXISTS word_of_day_log_content_idx
  ON public.word_of_day_log(child_id, content_id, date DESC)
  WHERE content_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
