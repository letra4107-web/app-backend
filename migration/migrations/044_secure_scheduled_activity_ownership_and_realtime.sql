-- Makes calendar ownership attributable and enables live parent updates.
-- Existing rows remain readable; ownership is backfilled to the owning parent
-- when possible so parents retain control of their historical reminders.

ALTER TABLE public.scheduled_activities
  ADD COLUMN IF NOT EXISTS created_by_auth_uid UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.scheduled_activities activity
SET created_by_auth_uid = child.parent_id
FROM public.children child
WHERE child.id = activity.child_id
  AND activity.created_by = 'parent'
  AND activity.created_by_auth_uid IS NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_activities_creator
  ON public.scheduled_activities(created_by_auth_uid, scheduled_date);

DROP POLICY IF EXISTS "Parents can manage own child scheduled activities" ON public.scheduled_activities;
DROP POLICY IF EXISTS "Parents can view own child scheduled activities" ON public.scheduled_activities;
DROP POLICY IF EXISTS "Parents can create own child reminders" ON public.scheduled_activities;
DROP POLICY IF EXISTS "Parents can update own reminders" ON public.scheduled_activities;
DROP POLICY IF EXISTS "Parents can delete own reminders" ON public.scheduled_activities;
-- Status changes are routed through the authenticated backend, which limits
-- students to the status field. The old broad UPDATE policy allowed every
-- column (including title/owner) to be changed through PostgREST.
DROP POLICY IF EXISTS "Students can update own scheduled activities" ON public.scheduled_activities;

CREATE POLICY "Parents can view own child scheduled activities"
ON public.scheduled_activities FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = scheduled_activities.child_id
      AND child.parent_id = auth.uid()
  )
);

CREATE POLICY "Parents can create own child reminders"
ON public.scheduled_activities FOR INSERT TO authenticated
WITH CHECK (
  created_by = 'parent'
  AND created_by_auth_uid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = scheduled_activities.child_id
      AND child.parent_id = auth.uid()
  )
);

CREATE POLICY "Parents can update own reminders"
ON public.scheduled_activities FOR UPDATE TO authenticated
USING (
  created_by = 'parent'
  AND created_by_auth_uid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = scheduled_activities.child_id
      AND child.parent_id = auth.uid()
  )
)
WITH CHECK (
  created_by = 'parent'
  AND created_by_auth_uid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = scheduled_activities.child_id
      AND child.parent_id = auth.uid()
  )
);

CREATE POLICY "Parents can delete own reminders"
ON public.scheduled_activities FOR DELETE TO authenticated
USING (
  created_by = 'parent'
  AND created_by_auth_uid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.children child
    WHERE child.id = scheduled_activities.child_id
      AND child.parent_id = auth.uid()
  )
);

-- Without this, DELETE change events only carry the primary key (id), not
-- child_id, so subscribeToScheduledActivities can't tell which child's
-- calendar to refresh and silently drops the event. Same fix already
-- applied to notifications in migration 041.
ALTER TABLE public.scheduled_activities REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scheduled_activities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_activities;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
