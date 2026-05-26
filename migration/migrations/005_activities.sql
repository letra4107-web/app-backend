CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  subject TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue')),
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS student_id UUID;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_activities_student_deadline ON public.activities(student_id, deadline);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activities_student_id_fkey'
      AND conrelid = 'public.activities'::regclass
  ) THEN
    ALTER TABLE public.activities
    ADD CONSTRAINT activities_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;
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

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own activities" ON public.activities;
CREATE POLICY "Students can view own activities"
ON public.activities
FOR SELECT
USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Parents can view child activities" ON public.activities;
CREATE POLICY "Parents can view child activities"
ON public.activities
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.parent_id = auth.uid()::text
      AND (c.id = public.activities.student_id::text OR c.auth_uid = public.activities.student_id::text)
  )
);

DROP POLICY IF EXISTS "Students can update own activities" ON public.activities;
CREATE POLICY "Students can update own activities"
ON public.activities
FOR UPDATE
USING (auth.uid() = student_id)
WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Teachers and service role can manage activities" ON public.activities;
CREATE POLICY "Teachers and service role can manage activities"
ON public.activities
FOR ALL
USING (
  auth.role() = 'service_role'
  OR COALESCE(auth.jwt()->'user_metadata'->>'role', '') IN ('teacher', 'admin')
)
WITH CHECK (
  auth.role() = 'service_role'
  OR COALESCE(auth.jwt()->'user_metadata'->>'role', '') IN ('teacher', 'admin')
);

NOTIFY pgrst, 'reload schema';
