-- Adds the 4 trigger functions confirmed missing live via a direct
-- pg_proc query (SELECT proname FROM pg_proc WHERE prorettype =
-- 'trigger'::regtype), cross-checked against every CREATE TRIGGER in the
-- committed migration files (003_parents.sql, 004_user_settings.sql,
-- 005_activities.sql, 006_lessons.sql). Bodies copied verbatim from those
-- files - no behavior change from what was originally intended, just
-- catching up the live database to match.
--
-- Confirmed impact before this fix: low/none. The three touch_*_updated_at
-- gaps left parents.updated_at / activities.updated_at / lessons.updated_at
-- stale on UPDATE, but grepping src/ found nothing reads any of those three
-- columns. The handle_new_auth_user_settings gap meant new signups didn't
-- get an instant parents_settings/student_settings row - but
-- settingsService.ts's fetchDashboardSettings already lazily inserts one
-- on first dashboard load, so this was silently degraded (a few seconds'
-- delay), not broken. This migration removes both gaps going forward.
--
-- All CREATE TRIGGER statements are guarded with an existence check, so
-- this file is idempotent and safe to run even if some triggers already
-- exist.

CREATE OR REPLACE FUNCTION public.touch_parent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_parent_updated_at') THEN
    CREATE TRIGGER touch_parent_updated_at
    BEFORE UPDATE ON public.parents
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_parent_updated_at();
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.touch_activities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_activities_updated_at') THEN
    CREATE TRIGGER touch_activities_updated_at
    BEFORE UPDATE ON public.activities
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_activities_updated_at();
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.touch_lessons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_lessons_updated_at') THEN
    CREATE TRIGGER touch_lessons_updated_at
    BEFORE UPDATE ON public.lessons
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_lessons_updated_at();
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_settings()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'parent');
BEGIN
  IF user_role = 'student' THEN
    INSERT INTO public.student_settings (auth_uid)
    VALUES (NEW.id)
    ON CONFLICT (auth_uid) DO NOTHING;
  ELSE
    INSERT INTO public.parents_settings (auth_uid)
    VALUES (NEW.id)
    ON CONFLICT (auth_uid) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'create_user_settings_after_auth_insert') THEN
    CREATE TRIGGER create_user_settings_after_auth_insert
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user_settings();
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
