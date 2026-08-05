-- Production had an additional authenticated child_progress write policy
-- whose name was not represented in the repository migrations. Remove all
-- non-SELECT policies deterministically so clients cannot forge reading level
-- (or any other progress field) through direct Supabase access.
DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'child_progress'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.child_progress', policy_row.policyname);
  END LOOP;
END
$$;

-- Preserve explicit student read access after removing ALL policies, because
-- PostgreSQL's ALL command also covers SELECT.
DROP POLICY IF EXISTS "Students read own child progress" ON public.child_progress;
CREATE POLICY "Students read own child progress"
  ON public.child_progress FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = child_id AND c.auth_uid::text = auth.uid()::text
    )
  );

NOTIFY pgrst, 'reload schema';
