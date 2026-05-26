ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS student_id TEXT REFERENCES public.children(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

UPDATE public.notifications
SET
  parent_id = COALESCE(parent_id, user_id),
  message = COALESCE(message, body),
  is_read = COALESCE(is_read, read, false)
WHERE parent_id IS NULL OR message IS NULL;

ALTER TABLE public.notifications ALTER COLUMN message SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN is_read SET DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notifications_parent_created
ON public.notifications(parent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_student_created
ON public.notifications(student_id, created_at DESC);

ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0;

UPDATE public.child_progress
SET word_count = COALESCE(word_count, cardinality(completed_words), 0);

CREATE TABLE IF NOT EXISTS public.student_progress (
  student_id TEXT PRIMARY KEY REFERENCES public.children(id) ON DELETE CASCADE,
  streak_count INTEGER DEFAULT 0,
  last_practice_date DATE,
  xp INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

INSERT INTO public.student_progress (student_id, streak_count, last_practice_date, xp, word_count, updated_at)
SELECT child_id, streak, last_practice_date, xp, COALESCE(word_count, cardinality(completed_words), 0), updated_at
FROM public.child_progress
ON CONFLICT (student_id) DO UPDATE
SET
  streak_count = EXCLUDED.streak_count,
  last_practice_date = EXCLUDED.last_practice_date,
  xp = EXCLUDED.xp,
  word_count = EXCLUDED.word_count,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE public.student_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents can view linked student progress" ON public.student_progress;
CREATE POLICY "Parents can view linked student progress"
ON public.student_progress
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.student_progress.student_id
      AND c.parent_id = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Students can manage own student progress" ON public.student_progress;
CREATE POLICY "Students can manage own student progress"
ON public.student_progress
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.student_progress.student_id
      AND c.auth_uid = auth.uid()::text
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.student_progress.student_id
      AND c.auth_uid = auth.uid()::text
  )
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.student_progress TO authenticated;

DROP POLICY IF EXISTS "users_read_notifications" ON public.notifications;
DROP POLICY IF EXISTS "users_insert_own_notifications" ON public.notifications;
DROP POLICY IF EXISTS "users_update_notifications" ON public.notifications;
DROP POLICY IF EXISTS "service_role_manage_notifications" ON public.notifications;

CREATE POLICY "Parents can view linked notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (parent_id = auth.uid()::text);

CREATE POLICY "Parents can mark linked notifications read"
ON public.notifications
FOR UPDATE
TO authenticated
USING (parent_id = auth.uid()::text)
WITH CHECK (parent_id = auth.uid()::text);

CREATE POLICY "Students can insert parent notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.notifications.student_id
      AND c.auth_uid = auth.uid()::text
      AND c.parent_id = public.notifications.parent_id
  )
);

CREATE POLICY "Service role can manage notifications"
ON public.notifications
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Validation:
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('notifications', 'student_progress')
-- ORDER BY tablename, policyname;

NOTIFY pgrst, 'reload schema';
