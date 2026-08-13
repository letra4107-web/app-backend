-- Let students showcase a completed presentation module as their profile icon.
-- The compact module-number key maps directly to the bundled mobile assets;
-- eligibility is always checked against authoritative module completions.

ALTER TABLE public.children
  DROP CONSTRAINT IF EXISTS children_avatar_key_check;
ALTER TABLE public.children
  ADD CONSTRAINT children_avatar_key_check CHECK (
    avatar_key IS NULL
    OR avatar_key IN ('default:reader', 'default:book', 'default:star', 'default:trophy')
    OR avatar_key ~ '^badge:[a-z0-9_]+$'
    OR avatar_key ~ '^module:[1-5]$'
  );

CREATE OR REPLACE FUNCTION public.validate_student_badge_avatar()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_badge_id TEXT;
  v_module_number INTEGER;
BEGIN
  IF NEW.avatar_key IS NULL OR NEW.avatar_key IS NOT DISTINCT FROM OLD.avatar_key THEN
    RETURN NEW;
  END IF;
  IF NEW.avatar_key LIKE 'default:%' THEN
    RETURN NEW;
  END IF;

  IF NEW.avatar_key LIKE 'badge:%' THEN
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
  END IF;

  IF NEW.avatar_key ~ '^module:[1-5]$' THEN
    v_module_number := substring(NEW.avatar_key FROM 8)::INTEGER;
    IF NOT EXISTS (
      SELECT 1
      FROM public.student_module_completions completion
      JOIN public.reading_modules module ON module.id = completion.module_id
      WHERE completion.student_id = NEW.id
        AND module.module_number = v_module_number
    ) THEN
      RAISE EXCEPTION 'This module avatar is locked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This avatar is invalid' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_student_avatar(p_avatar_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_child_id UUID;
  v_badge_id TEXT;
  v_module_number INTEGER;
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
  ELSIF p_avatar_key ~ '^module:[1-5]$' THEN
    v_module_number := substring(p_avatar_key FROM 8)::INTEGER;
    SELECT EXISTS (
      SELECT 1
      FROM public.student_module_completions completion
      JOIN public.reading_modules module ON module.id = completion.module_id
      WHERE completion.student_id = v_child_id
        AND module.module_number = v_module_number
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
