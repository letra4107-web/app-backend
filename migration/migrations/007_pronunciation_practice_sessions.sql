CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pronunciation_practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  spoken_text TEXT,
  accuracy_percentage INTEGER NOT NULL CHECK (accuracy_percentage >= 0 AND accuracy_percentage <= 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS student_id TEXT;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS word TEXT;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS spoken_text TEXT;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS accuracy_percentage INTEGER;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_student_created
ON public.pronunciation_practice_sessions(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_word
ON public.pronunciation_practice_sessions(word);

ALTER TABLE public.pronunciation_practice_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can insert own pronunciation sessions" ON public.pronunciation_practice_sessions;
CREATE POLICY "Students can insert own pronunciation sessions"
ON public.pronunciation_practice_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.pronunciation_practice_sessions.student_id
      AND c.auth_uid = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Students can view own pronunciation sessions" ON public.pronunciation_practice_sessions;
CREATE POLICY "Students can view own pronunciation sessions"
ON public.pronunciation_practice_sessions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.pronunciation_practice_sessions.student_id
      AND c.auth_uid = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Parents can view child pronunciation sessions" ON public.pronunciation_practice_sessions;
CREATE POLICY "Parents can view child pronunciation sessions"
ON public.pronunciation_practice_sessions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.pronunciation_practice_sessions.student_id
      AND c.parent_id = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Service role can manage pronunciation sessions" ON public.pronunciation_practice_sessions;
CREATE POLICY "Service role can manage pronunciation sessions"
ON public.pronunciation_practice_sessions
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
