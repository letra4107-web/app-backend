-- Canonical student profile fields. Student avatars no longer create shadow
-- rows in the parent profile table; mobile and web can resolve the same key.

ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS avatar_key TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

ALTER TABLE public.children
  DROP CONSTRAINT IF EXISTS children_avatar_key_check;
ALTER TABLE public.children
  ADD CONSTRAINT children_avatar_key_check CHECK (
    avatar_key IS NULL
    OR avatar_key IN ('default:reader', 'default:book', 'default:star', 'default:trophy')
    OR avatar_key ~ '^badge:[a-z0-9_]+$'
  );

CREATE OR REPLACE FUNCTION public.validate_student_badge_avatar()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_badge_id TEXT;
BEGIN
  IF NEW.avatar_key IS NULL OR NEW.avatar_key IS NOT DISTINCT FROM OLD.avatar_key THEN
    RETURN NEW;
  END IF;
  IF NEW.avatar_key LIKE 'default:%' THEN
    RETURN NEW;
  END IF;

  v_badge_id := substring(NEW.avatar_key FROM 7);
  IF NOT EXISTS (
    SELECT 1
    FROM public.child_progress progress,
         jsonb_array_elements(COALESCE(progress.achievements, '[]'::jsonb)) achievement
    WHERE progress.child_id = NEW.id
      AND achievement->>'id' = v_badge_id
  ) THEN
    RAISE EXCEPTION 'This badge avatar is locked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_student_badge_avatar_trigger ON public.children;
CREATE TRIGGER validate_student_badge_avatar_trigger
  BEFORE UPDATE OF avatar_key ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_badge_avatar();

CREATE OR REPLACE FUNCTION public.set_student_avatar(p_avatar_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_child_id UUID;
  v_badge_id TEXT;
  v_unlocked BOOLEAN := false;
BEGIN
  SELECT child.id INTO v_child_id
  FROM public.children child
  WHERE child.auth_uid::text = auth.uid()::text;

  IF v_child_id IS NULL THEN
    RAISE EXCEPTION 'Student profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_avatar_key IN ('default:reader', 'default:book', 'default:star', 'default:trophy') THEN
    v_unlocked := true;
  ELSIF p_avatar_key ~ '^badge:[a-z0-9_]+$' THEN
    v_badge_id := substring(p_avatar_key FROM 7);
    SELECT EXISTS (
      SELECT 1
      FROM public.child_progress progress,
           jsonb_array_elements(COALESCE(progress.achievements, '[]'::jsonb)) achievement
      WHERE progress.child_id = v_child_id
        AND achievement->>'id' = v_badge_id
    ) INTO v_unlocked;
  END IF;

  IF NOT v_unlocked THEN
    RAISE EXCEPTION 'This avatar is locked or invalid' USING ERRCODE = '42501';
  END IF;

  UPDATE public.children
  SET avatar_key = p_avatar_key,
      avatar_url = NULL
  WHERE id = v_child_id;

  RETURN jsonb_build_object('avatar_key', p_avatar_key, 'avatar_url', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.set_student_avatar(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_student_avatar(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
