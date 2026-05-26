CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.parents_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dark_mode BOOLEAN DEFAULT false,
  font_size TEXT DEFAULT 'medium' CHECK (font_size IN ('small', 'medium', 'large')),
  dyslexia_font BOOLEAN DEFAULT true,
  notifications_enabled BOOLEAN DEFAULT true,
  assignment_notifications BOOLEAN DEFAULT true,
  lesson_notifications BOOLEAN DEFAULT true,
  deadline_notifications BOOLEAN DEFAULT true,
  progress_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT true,
  reading_theme TEXT DEFAULT 'light' CHECK (reading_theme IN ('light', 'dark', 'sepia')),
  tts_enabled BOOLEAN DEFAULT false,
  stt_enabled BOOLEAN DEFAULT false,
  high_contrast BOOLEAN DEFAULT false,
  reading_guide BOOLEAN DEFAULT false,
  two_factor_enabled BOOLEAN DEFAULT false,
  weekly_progress_reports BOOLEAN DEFAULT true,
  daily_activity_summary BOOLEAN DEFAULT true,
  teacher_updates BOOLEAN DEFAULT true,
  milestone_alerts BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dark_mode BOOLEAN DEFAULT false,
  font_size TEXT DEFAULT 'medium' CHECK (font_size IN ('small', 'medium', 'large')),
  dyslexia_font BOOLEAN DEFAULT true,
  notifications_enabled BOOLEAN DEFAULT true,
  assignment_notifications BOOLEAN DEFAULT true,
  lesson_notifications BOOLEAN DEFAULT true,
  deadline_notifications BOOLEAN DEFAULT true,
  progress_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT true,
  reading_theme TEXT DEFAULT 'light' CHECK (reading_theme IN ('light', 'dark', 'sepia')),
  tts_enabled BOOLEAN DEFAULT false,
  stt_enabled BOOLEAN DEFAULT false,
  high_contrast BOOLEAN DEFAULT false,
  reading_guide BOOLEAN DEFAULT false,
  two_factor_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

DO $$ BEGIN
  IF to_regclass('public.students_settings') IS NOT NULL THEN
    EXECUTE '
      INSERT INTO public.student_settings (
        auth_uid,
        dark_mode,
        font_size,
        dyslexia_font,
        notifications_enabled,
        assignment_notifications,
        lesson_notifications,
        progress_notifications,
        push_notifications,
        reading_theme,
        tts_enabled,
        stt_enabled,
        high_contrast,
        reading_guide,
        two_factor_enabled,
        created_at,
        updated_at
      )
      SELECT
        auth_uid,
        dark_mode,
        font_size,
        dyslexia_font,
        notifications_enabled,
        assignment_notifications,
        lesson_notifications,
        progress_notifications,
        push_notifications,
        reading_theme,
        tts_enabled,
        stt_enabled,
        high_contrast,
        reading_guide,
        two_factor_enabled,
        created_at,
        updated_at
      FROM public.students_settings
      ON CONFLICT (auth_uid) DO NOTHING
    ';
  END IF;
END$$;

ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT false;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS font_size TEXT DEFAULT 'medium';
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS dyslexia_font BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS assignment_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS lesson_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS deadline_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS progress_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS push_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS reading_theme TEXT DEFAULT 'light';
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS tts_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS stt_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS high_contrast BOOLEAN DEFAULT false;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS reading_guide BOOLEAN DEFAULT false;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS weekly_progress_reports BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS daily_activity_summary BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS teacher_updates BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS milestone_alerts BOOLEAN DEFAULT true;

ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT false;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS font_size TEXT DEFAULT 'medium';
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS dyslexia_font BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS assignment_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS lesson_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS deadline_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS progress_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS push_notifications BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS reading_theme TEXT DEFAULT 'light';
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS tts_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS stt_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS high_contrast BOOLEAN DEFAULT false;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS reading_guide BOOLEAN DEFAULT false;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parents_settings'
      AND column_name = 'lesson_updates'
  ) THEN
    EXECUTE 'UPDATE public.parents_settings SET lesson_notifications = COALESCE(lesson_notifications, lesson_updates)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parents_settings'
      AND column_name = 'progress_reports'
  ) THEN
    EXECUTE 'UPDATE public.parents_settings SET progress_notifications = COALESCE(progress_notifications, progress_reports)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_settings'
      AND column_name = 'lesson_updates'
  ) THEN
    EXECUTE 'UPDATE public.student_settings SET lesson_notifications = COALESCE(lesson_notifications, lesson_updates)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_settings'
      AND column_name = 'progress_reports'
  ) THEN
    EXECUTE 'UPDATE public.student_settings SET progress_notifications = COALESCE(progress_notifications, progress_reports)';
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_settings_auth_uid ON public.parents_settings(auth_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_settings_auth_uid ON public.student_settings(auth_uid);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parents_settings_auth_uid_fkey'
      AND conrelid = 'public.parents_settings'::regclass
  ) THEN
    ALTER TABLE public.parents_settings
    ADD CONSTRAINT parents_settings_auth_uid_fkey
    FOREIGN KEY (auth_uid) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_settings_auth_uid_fkey'
      AND conrelid = 'public.student_settings'::regclass
  ) THEN
    ALTER TABLE public.student_settings
    ADD CONSTRAINT student_settings_auth_uid_fkey
    FOREIGN KEY (auth_uid) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.touch_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_parents_settings_updated_at') THEN
    CREATE TRIGGER touch_parents_settings_updated_at
    BEFORE UPDATE ON public.parents_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_settings_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_student_settings_updated_at') THEN
    CREATE TRIGGER touch_student_settings_updated_at
    BEFORE UPDATE ON public.student_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_settings_updated_at();
  END IF;
END$$;

INSERT INTO public.parents_settings (auth_uid)
SELECT id
FROM auth.users
WHERE COALESCE(raw_user_meta_data->>'role', 'parent') = 'parent'
ON CONFLICT (auth_uid) DO NOTHING;

INSERT INTO public.student_settings (auth_uid)
SELECT id
FROM auth.users
WHERE raw_user_meta_data->>'role' = 'student'
ON CONFLICT (auth_uid) DO NOTHING;

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

ALTER TABLE public.parents_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents can view own settings" ON public.parents_settings;
CREATE POLICY "Parents can view own settings"
ON public.parents_settings
FOR SELECT
USING (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Parents can insert own settings" ON public.parents_settings;
DROP POLICY IF EXISTS "Allow insert own settings" ON public.parents_settings;
CREATE POLICY "Parents can insert own settings"
ON public.parents_settings
FOR INSERT
WITH CHECK (auth.uid() = auth_uid);

CREATE POLICY "Allow insert own settings"
ON public.parents_settings
FOR INSERT
WITH CHECK (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Parents can update own settings" ON public.parents_settings;
CREATE POLICY "Parents can update own settings"
ON public.parents_settings
FOR UPDATE
USING (auth.uid() = auth_uid)
WITH CHECK (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Students can view own settings" ON public.student_settings;
CREATE POLICY "Students can view own settings"
ON public.student_settings
FOR SELECT
USING (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Students can insert own settings" ON public.student_settings;
CREATE POLICY "Students can insert own settings"
ON public.student_settings
FOR INSERT
WITH CHECK (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Students can update own settings" ON public.student_settings;
CREATE POLICY "Students can update own settings"
ON public.student_settings
FOR UPDATE
USING (auth.uid() = auth_uid)
WITH CHECK (auth.uid() = auth_uid);

NOTIFY pgrst, 'reload schema';
