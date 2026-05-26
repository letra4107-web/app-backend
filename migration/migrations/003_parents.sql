CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid UUID UNIQUE NOT NULL,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  phone_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS auth_uid UUID;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_auth_uid ON public.parents(auth_uid);

DROP INDEX IF EXISTS public.idx_parents_email;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parents_email_key'
      AND conrelid = 'public.parents'::regclass
  ) THEN
    ALTER TABLE public.parents DROP CONSTRAINT parents_email_key;
  END IF;
END$$;

INSERT INTO public.parents (auth_uid, full_name, email, created_at)
SELECT id::uuid, name, email::text, created_at
FROM public.users
WHERE COALESCE(role, 'parent') = 'parent'
  AND id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (auth_uid) DO UPDATE SET
  full_name = COALESCE(EXCLUDED.full_name, public.parents.full_name),
  email = COALESCE(EXCLUDED.email, public.parents.email),
  updated_at = now();

CREATE OR REPLACE FUNCTION public.touch_parent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'touch_parent_updated_at') THEN
    CREATE TRIGGER touch_parent_updated_at
    BEFORE UPDATE ON public.parents
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_parent_updated_at();
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'parent');
  display_name TEXT := NULLIF(
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      trim(concat_ws(' ', NEW.raw_user_meta_data->>'firstName', NEW.raw_user_meta_data->>'lastName'))
    ),
    ''
  );
BEGIN
  INSERT INTO public.users (id, email, name, role, created_at, email_verified, metadata)
  VALUES (
    NEW.id::text,
    NEW.email,
    display_name,
    user_role,
    now(),
    NEW.email_confirmed_at IS NOT NULL,
    NEW.raw_user_meta_data
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(public.users.name, EXCLUDED.name),
    role = COALESCE(public.users.role, EXCLUDED.role),
    email_verified = EXCLUDED.email_verified,
    metadata = COALESCE(public.users.metadata, '{}'::jsonb) || EXCLUDED.metadata;

  IF user_role = 'parent' THEN
    INSERT INTO public.parents (auth_uid, full_name, email, created_at)
    VALUES (NEW.id, display_name, NEW.email, now())
    ON CONFLICT (auth_uid) DO UPDATE SET
      full_name = COALESCE(EXCLUDED.full_name, public.parents.full_name),
      email = COALESCE(EXCLUDED.email, public.parents.email),
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parents can view own profile" ON public.parents;
CREATE POLICY "Parents can view own profile"
ON public.parents
FOR SELECT
USING (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Parents can insert own profile" ON public.parents;
CREATE POLICY "Parents can insert own profile"
ON public.parents
FOR INSERT
WITH CHECK (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Parents can update own profile" ON public.parents;
CREATE POLICY "Parents can update own profile"
ON public.parents
FOR UPDATE
USING (auth.uid() = auth_uid)
WITH CHECK (auth.uid() = auth_uid);

DROP POLICY IF EXISTS "Service role can manage parent profiles" ON public.parents;
CREATE POLICY "Service role can manage parent profiles"
ON public.parents
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
