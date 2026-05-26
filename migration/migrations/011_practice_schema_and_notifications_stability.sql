CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pronunciation_practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  spoken_text TEXT,
  accuracy_percentage INTEGER NOT NULL CHECK (accuracy_percentage >= 0 AND accuracy_percentage <= 100),
  is_correct BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS student_id TEXT;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS word TEXT;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS spoken_text TEXT;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS accuracy_percentage INTEGER;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS is_correct BOOLEAN DEFAULT false;
ALTER TABLE public.pronunciation_practice_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

UPDATE public.pronunciation_practice_sessions
SET is_correct = COALESCE(is_correct, accuracy_percentage >= 70)
WHERE is_correct IS NULL;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  student_id TEXT,
  parent_id TEXT,
  title TEXT NOT NULL,
  message TEXT,
  body TEXT,
  type TEXT,
  is_read BOOLEAN DEFAULT false,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS student_id TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

UPDATE public.notifications
SET
  message = COALESCE(message, body),
  body = COALESCE(body, message),
  is_read = COALESCE(is_read, read, false),
  read = COALESCE(read, is_read, false)
WHERE message IS NULL OR body IS NULL OR is_read IS NULL OR read IS NULL;

CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_student_created
ON public.pronunciation_practice_sessions(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_correct
ON public.pronunciation_practice_sessions(student_id, is_correct, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.pronunciation_practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

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

-- Validation:
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('pronunciation_practice_sessions', 'notifications')
--   AND column_name IN ('student_id', 'word', 'spoken_text', 'accuracy_percentage', 'is_correct', 'user_id', 'message', 'type', 'is_read', 'created_at')
-- ORDER BY table_name, column_name;

NOTIFY pgrst, 'reload schema';
