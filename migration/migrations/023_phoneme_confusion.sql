CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per detected phoneme-confusion occurrence (an event log, not a
-- running counter) - lets "top confusion pairs for this student" be a simple
-- GROUP BY / COUNT query, which is what Feature 3's personalized-exercise
-- selection needs.
--
-- IMPORTANT: confusion_key is derived from comparing the STT transcript's
-- text spelling against the target word's expected spelling (see
-- src/utils/tagalogPhonemes.ts) - it is NOT an acoustic pronunciation
-- measurement. A row here means "the speech recognizer's text output showed
-- this substitution pattern," not "the student definitely mispronounced
-- this phoneme."
CREATE TABLE IF NOT EXISTS public.phoneme_confusion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  confusion_key TEXT NOT NULL,
  target_word TEXT NOT NULL,
  transcript_word TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'practice',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phoneme_confusion_student_key
ON public.phoneme_confusion(student_id, confusion_key);

CREATE INDEX IF NOT EXISTS idx_phoneme_confusion_student_created
ON public.phoneme_confusion(student_id, created_at DESC);

ALTER TABLE public.phoneme_confusion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can insert own phoneme confusion" ON public.phoneme_confusion;
CREATE POLICY "Students can insert own phoneme confusion"
ON public.phoneme_confusion
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.phoneme_confusion.student_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Students can view own phoneme confusion" ON public.phoneme_confusion;
CREATE POLICY "Students can view own phoneme confusion"
ON public.phoneme_confusion
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.phoneme_confusion.student_id
      AND c.auth_uid = auth.uid()
  )
);

DROP POLICY IF EXISTS "Parents can view child phoneme confusion" ON public.phoneme_confusion;
CREATE POLICY "Parents can view child phoneme confusion"
ON public.phoneme_confusion
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.children c
    WHERE c.id = public.phoneme_confusion.student_id
      AND c.parent_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Service role can manage phoneme confusion" ON public.phoneme_confusion;
CREATE POLICY "Service role can manage phoneme confusion"
ON public.phoneme_confusion
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
