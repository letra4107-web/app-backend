-- Root cause of "notifications don't appear live" (live-tested and confirmed
-- 2026-08-10): the client's subscribeToParentNotifications/
-- subscribeToStudentNotifications (src/services/notificationService.ts)
-- correctly open a postgres_changes channel on the notifications table -
-- that code is already right and was already fixed once before for the
-- unique-topic bug. But the notifications table itself was never added to
-- the supabase_realtime publication, so Postgres never emits any
-- replication events for it in the first place - the client-side
-- subscription is listening on a channel Postgres never talks on. Confirmed
-- by inserting a real notification row via the backend REST API while the
-- app was open on a live device: zero realtime callback fired, zero re-fetch
-- logged, only the two initial on-load fetches. Compare to public.lessons,
-- which DOES already have this same ALTER PUBLICATION step (migration 006)
-- and whose realtime subscription logs "SUBSCRIBED" and works correctly.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
