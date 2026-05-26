-- Postgres schema for LinawLetra migrated from Firestore
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Users table (auth-managed users will be in supabase.auth.users; this table stores profile data)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email CITEXT UNIQUE,
  name TEXT,
  role TEXT,
  parent_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  email_verified BOOLEAN DEFAULT false,
  metadata JSONB
);

-- Children table
CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  grade_level INTEGER,
  username TEXT,
  auth_uid TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- OTP sessions
CREATE TABLE IF NOT EXISTS otp_sessions (
  user_id TEXT PRIMARY KEY,
  email CITEXT,
  otp TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  attempts INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT false,
  resend_count INTEGER DEFAULT 0,
  last_resend_at TIMESTAMP WITH TIME ZONE
);

-- Reading activities
CREATE TABLE IF NOT EXISTS reading_activities (
  id TEXT PRIMARY KEY,
  grade INTEGER,
  grade_label TEXT,
  words TEXT[],
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Teacher uploads (file metadata)
CREATE TABLE IF NOT EXISTS teacher_uploads (
  id TEXT PRIMARY KEY,
  uploader_id TEXT REFERENCES users(id),
  path TEXT,
  content_type TEXT,
  size BIGINT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Progress table
CREATE TABLE IF NOT EXISTS progress (
  student_id TEXT,
  run_id TEXT,
  data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY (student_id, run_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Optional: create profile on auth.users INSERT (keeps public.users in sync)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at, email_verified, metadata)
  VALUES (
    NEW.id,
    NEW.email,
    now(),
    NEW.email_confirmed_at IS NOT NULL,
    jsonb_build_object('role', COALESCE(NEW.raw_user_meta_data->>'role', 'parent'))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'create_user_profile_after_auth_insert') THEN
    CREATE TRIGGER create_user_profile_after_auth_insert
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();
  END IF;
END$$;

-- Ensure OTP sessions are only accessible via service_role (backend)
ALTER TABLE IF EXISTS public.otp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "OTP sessions: service role only" ON public.otp_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
