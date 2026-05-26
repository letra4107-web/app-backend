ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "users_read_notifications" ON public.notifications;
CREATE POLICY "users_read_notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "users_insert_own_notifications" ON public.notifications;
CREATE POLICY "users_insert_own_notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "users_update_notifications" ON public.notifications;
CREATE POLICY "users_update_notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid()::text)
WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "service_role_manage_notifications" ON public.notifications;
CREATE POLICY "service_role_manage_notifications"
ON public.notifications
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Validation query for Supabase SQL editor:
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'notifications'
-- ORDER BY policyname;
