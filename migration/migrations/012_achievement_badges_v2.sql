-- Supports the 20-badge achievement system: baseline/average accuracy tracking
-- for improvement-based badges, and an activities_completed counter for the
-- lesson-count badges. Also adds a distinct "turned in late" activity status.

ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS baseline_accuracy INTEGER;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS accuracy_sum INTEGER DEFAULT 0;
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS activities_completed INTEGER DEFAULT 0;

UPDATE public.child_progress
SET
  accuracy_sum = COALESCE(accuracy_sum, 0),
  activities_completed = COALESCE(activities_completed, 0);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_status_check'
  ) THEN
    ALTER TABLE public.activities DROP CONSTRAINT activities_status_check;
  END IF;
END$$;

ALTER TABLE public.activities
  ADD CONSTRAINT activities_status_check
  CHECK (status IN ('pending', 'completed', 'completed_late', 'overdue'));

NOTIFY pgrst, 'reload schema';
