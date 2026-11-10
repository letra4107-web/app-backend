-- Email verification is granted only by a server that has validated the code.
-- Keep profile edits available; an Auth-confirmed password session alone is
-- not proof that the app's email verification was completed.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_app_email_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'authenticated' THEN
    IF (TG_OP = 'INSERT' AND NEW.email_verified IS TRUE) OR
       (TG_OP = 'UPDATE' AND NEW.email_verified IS DISTINCT FROM OLD.email_verified) THEN
      RAISE EXCEPTION 'Email verification must be completed on the server' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_app_email_verification ON public.users;
CREATE TRIGGER guard_app_email_verification
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_app_email_verification();

NOTIFY pgrst,'reload schema';
COMMIT;
