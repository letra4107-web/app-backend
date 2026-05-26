ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS last_practice_date DATE;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS completed_words TEXT[] DEFAULT '{}';
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS total_attempts INTEGER DEFAULT 0;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

UPDATE public.child_progress
SET
  word_count = COALESCE(word_count, cardinality(completed_words), 0),
  xp = COALESCE(xp, 0),
  streak = COALESCE(streak, 0),
  completed_words = COALESCE(completed_words, '{}'),
  total_attempts = COALESCE(total_attempts, 0);

CREATE INDEX IF NOT EXISTS idx_child_progress_last_practice
ON public.child_progress(last_practice_date);

-- Validation:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'child_progress'
--   AND column_name IN ('child_id', 'xp', 'streak', 'word_count', 'last_practice_date')
-- ORDER BY column_name;

NOTIFY pgrst, 'reload schema';
