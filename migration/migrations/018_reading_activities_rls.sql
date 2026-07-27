-- reading_activities has no RLS in any prior migration. It's a shared,
-- per-grade curriculum word list — read-only from the client
-- (wordOfDayService.ts only ever SELECTs from it) but with RLS disabled,
-- nothing stops a client from writing to it either, which could corrupt the
-- word pool for an entire grade level. Locking writes to service_role only;
-- any authenticated user can still read it, matching current behavior.

ALTER TABLE public.reading_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_reading_activities" ON public.reading_activities
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_manage_reading_activities" ON public.reading_activities
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
