-- The `children` table has never had Row Level Security enabled in any prior
-- migration - the parent/student scoping in the app has relied entirely on
-- the frontend's own `.eq('parent_id', ...)` / `.eq('auth_uid', ...)` filters,
-- not a database-enforced boundary. This closes that gap.
--
-- Separately, migration 002's "parents_read_child_progress" policy compares
-- children.parent_id (UUID) against auth.uid()::text - the same UUID/TEXT
-- cast bug already fixed in migrations 011/013 for other tables. Replacing
-- it here with the correct (uncast) comparison.

ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents can manage own children" ON public.children;
CREATE POLICY "Parents can manage own children"
ON public.children
FOR ALL
TO authenticated
USING (parent_id = auth.uid())
WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Students can view own child row" ON public.children;
CREATE POLICY "Students can view own child row"
ON public.children
FOR SELECT
TO authenticated
USING (auth_uid = auth.uid());

DROP POLICY IF EXISTS "Students can update own child row" ON public.children;
CREATE POLICY "Students can update own child row"
ON public.children
FOR UPDATE
TO authenticated
USING (auth_uid = auth.uid())
WITH CHECK (auth_uid = auth.uid());

DROP POLICY IF EXISTS "Service role can manage children" ON public.children;
CREATE POLICY "Service role can manage children"
ON public.children
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "parents_read_child_progress" ON public.child_progress;
CREATE POLICY "parents_read_child_progress"
ON public.child_progress
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.children
    WHERE children.id = child_progress.child_id
      AND children.parent_id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';
