-- Retroactively documents every trigger function that exists live but has
-- no corresponding migration file in this repo, closing the "created
-- directly in the Supabase SQL editor, never committed" gap found during
-- the migration audit. Bodies pulled live via:
--   SELECT proname, prosrc FROM pg_proc WHERE proname IN (...)
-- and attachment points via a pg_trigger/pg_class/pg_proc join.
--
-- Three functions were found:
--
-- 1. handle_auth_user_update - APP-SPECIFIC, documented and (re)created
--    below. Trigger update_user_profile_after_auth_update fires AFTER
--    UPDATE ON auth.users, keeping public.users.email/.email_verified/
--    .metadata in sync whenever a user's auth record changes (e.g. email
--    change, email confirmation). This is the UPDATE-path counterpart to
--    handle_new_auth_user (003_parents.sql), which only handles INSERT -
--    that migration file was simply incomplete; this fills the gap.
--
-- 2. update_updated_at_column - NOT app-owned. Attached only to
--    storage.objects (BEFORE UPDATE). This is a generic trigger function
--    that ships as part of Supabase's built-in Storage schema, created
--    automatically when Storage is enabled on the project - not something
--    LinawLetra's own migrations ever created. Documented here for
--    completeness only; deliberately NOT recreated or altered, since this
--    repo does not own or manage the storage schema.
--
-- 3. protect_delete - NOT app-owned, same reasoning as above. Attached to
--    storage.buckets and storage.objects (BEFORE DELETE), part of
--    Supabase Storage's own safety guard against direct-SQL deletes
--    bypassing the Storage API. Documented only, not recreated.

CREATE OR REPLACE FUNCTION public.handle_auth_user_update()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.users
  SET
    email = NEW.email,
    email_verified = NEW.email_confirmed_at IS NOT NULL,
    metadata = COALESCE(NEW.raw_user_meta_data, '{}'::jsonb)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_profile_after_auth_update') THEN
    CREATE TRIGGER update_user_profile_after_auth_update
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_auth_user_update();
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
