-- Phase A of the Parent Dashboard Calendar feature: a real data model for
-- scheduled activities (reading lessons, practice sessions, reminders,
-- appointments). No auto-population from real lesson/practice data yet -
-- that's Phase C. This phase is schema + RLS only; rows are created
-- manually via the backend CRUD routes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.scheduled_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL DEFAULT 'parent' CHECK (created_by IN ('parent', 'teacher', 'system')),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('reading_lesson', 'practice', 'reminder', 'appointment')),
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'missed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_activities_child_date
ON public.scheduled_activities(child_id, scheduled_date);

ALTER TABLE public.scheduled_activities ENABLE ROW LEVEL SECURITY;

-- Parents create/edit/delete/view the schedule for their own children.
DROP POLICY IF EXISTS "Parents can manage own child scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Parents can manage own child scheduled activities"
ON public.scheduled_activities
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.scheduled_activities.child_id
      AND c.parent_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.scheduled_activities.child_id
      AND c.parent_id = auth.uid()
  )
);

-- Students can see their own schedule and update status (e.g. mark an item
-- in_progress/completed as they do it), but can't create or delete entries.
DROP POLICY IF EXISTS "Students can view own scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Students can view own scheduled activities"
ON public.scheduled_activities
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.scheduled_activities.child_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Students can update own scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Students can update own scheduled activities"
ON public.scheduled_activities
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.scheduled_activities.child_id
      AND c.auth_uid = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.scheduled_activities.child_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Service role can manage scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Service role can manage scheduled activities"
ON public.scheduled_activities
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
