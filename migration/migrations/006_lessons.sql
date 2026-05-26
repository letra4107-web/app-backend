CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-pdfs', 'lesson-pdfs', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  grade_level TEXT,
  pdf_url TEXT NOT NULL,
  file_name TEXT,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS grade_level TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_lessons_published_created ON public.lessons(is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_grade_subject ON public.lessons(grade_level, subject);
CREATE INDEX IF NOT EXISTS idx_lessons_teacher ON public.lessons(teacher_id);

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

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can read published lessons" ON public.lessons;
CREATE POLICY "Students can read published lessons"
ON public.lessons
FOR SELECT
TO authenticated
USING (is_published = true);

DROP POLICY IF EXISTS "Teachers can insert own lessons" ON public.lessons;
CREATE POLICY "Teachers can insert own lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = teacher_id
  AND COALESCE(auth.jwt()->'user_metadata'->>'role', '') IN ('teacher', 'admin')
);

DROP POLICY IF EXISTS "Teachers can update own lessons" ON public.lessons;
CREATE POLICY "Teachers can update own lessons"
ON public.lessons
FOR UPDATE
TO authenticated
USING (
  auth.uid() = teacher_id
  OR COALESCE(auth.jwt()->'user_metadata'->>'role', '') = 'admin'
)
WITH CHECK (
  auth.uid() = teacher_id
  OR COALESCE(auth.jwt()->'user_metadata'->>'role', '') = 'admin'
);

DROP POLICY IF EXISTS "Lesson PDFs are readable" ON storage.objects;
CREATE POLICY "Lesson PDFs are readable"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'lesson-pdfs');

DROP POLICY IF EXISTS "Teachers can upload lesson PDFs" ON storage.objects;
CREATE POLICY "Teachers can upload lesson PDFs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'lesson-pdfs'
  AND COALESCE(auth.jwt()->'user_metadata'->>'role', '') IN ('teacher', 'admin')
);

ALTER TABLE public.lessons REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'lessons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lessons;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
