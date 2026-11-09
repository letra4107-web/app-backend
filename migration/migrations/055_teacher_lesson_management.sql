-- Published-only SELECT prevents an owner from unpublishing a lesson: the new
-- draft fails SELECT RLS. DELETE also needs its own policy; UPDATE is not enough.
-- Keep the published student feed and existing insert/update policies intact.
BEGIN;

DROP POLICY IF EXISTS "Teachers can read own lessons" ON public.lessons;
CREATE POLICY "Teachers can read own lessons"
ON public.lessons FOR SELECT TO authenticated
USING (teacher_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Teachers can delete own lessons" ON public.lessons;
CREATE POLICY "Teachers can delete own lessons"
ON public.lessons FOR DELETE TO authenticated
USING (teacher_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
COMMIT;
