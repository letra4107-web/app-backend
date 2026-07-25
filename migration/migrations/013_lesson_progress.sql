-- Tracks per-student progress on teacher-uploaded PDF lessons so the Learn
-- tab can show real not-started/in-progress/completed states and a real
-- "Continue Reading" card. No ordering/locking concept is introduced here:
-- lessons have no sequence field and teachers upload them in any order, so
-- a "locked / coming next" state would fabricate a curriculum that doesn't
-- exist.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_student ON public.lesson_progress(student_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON public.lesson_progress(lesson_id);

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own lesson progress" ON public.lesson_progress;
CREATE POLICY "Students can view own lesson progress"
ON public.lesson_progress
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.lesson_progress.student_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Students can upsert own lesson progress" ON public.lesson_progress;
CREATE POLICY "Students can upsert own lesson progress"
ON public.lesson_progress
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.lesson_progress.student_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Students can update own lesson progress" ON public.lesson_progress;
CREATE POLICY "Students can update own lesson progress"
ON public.lesson_progress
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.lesson_progress.student_id
      AND c.auth_uid = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.lesson_progress.student_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Parents can view child lesson progress" ON public.lesson_progress;
CREATE POLICY "Parents can view child lesson progress"
ON public.lesson_progress
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.lesson_progress.student_id
      AND c.parent_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Service role can manage lesson progress" ON public.lesson_progress;
CREATE POLICY "Service role can manage lesson progress"
ON public.lesson_progress
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
