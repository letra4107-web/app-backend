-- Adds real duration tracking to pronunciation sessions so "Practice Time"
-- on the Practice tab can be computed honestly instead of omitted or faked.
-- Duration is measured client-side from the moment speech recognition
-- actually starts listening to the moment a final transcript is scored.

ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

NOTIFY pgrst, 'reload schema';
