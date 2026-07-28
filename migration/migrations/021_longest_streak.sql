-- Tracks each student's personal-best streak, separate from their current
-- (live, resettable) streak - a "personal best" the student keeps even
-- after their current streak breaks. Backfilled from existing streak
-- values so students who already have a streak > 0 don't start at 0.

ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;

UPDATE public.child_progress
SET longest_streak = GREATEST(COALESCE(longest_streak, 0), COALESCE(streak, 0));

NOTIFY pgrst, 'reload schema';
