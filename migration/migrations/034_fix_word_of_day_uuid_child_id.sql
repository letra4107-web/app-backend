-- Both word_of_day_log.child_id and child_progress.child_id are UUID on the
-- live database, not TEXT as 022/031/032/033 all assumed (same undocumented
-- drift class as children.id and notifications.user_id, found elsewhere in
-- the migration audit). This broke complete_personalized_word_of_day_attempt
-- outright ("operator does not exist: uuid = text", confirmed live in the
-- backend log). Re-declaring these functions with p_child_id TEXT again (as
-- 033 section 4 currently does) does NOT fix or replace anything - Postgres
-- treats a different parameter type as a distinct overload, leaving the old
-- TEXT-typed function in place alongside a new one and confusing PostgREST's
-- RPC resolution. Explicitly drop the old TEXT-typed signatures first, then
-- create the correct UUID-typed versions.

DROP FUNCTION IF EXISTS public.complete_word_of_day_attempt(TEXT, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.complete_personalized_word_of_day_attempt(TEXT, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.complete_word_of_day_attempt(
  p_child_id UUID,
  p_accuracy INTEGER,
  p_is_correct BOOLEAN
)
RETURNS TABLE(already_completed BOOLEAN, completed BOOLEAN, streak INTEGER, longest_streak INTEGER, attempts INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log public.word_of_day_log%ROWTYPE;
  v_progress public.child_progress%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_next_streak INTEGER;
BEGIN
  SELECT * INTO v_log FROM public.word_of_day_log
  WHERE child_id = p_child_id AND date = v_today FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Word of the Day has not been initialized'; END IF;
  SELECT * INTO v_progress FROM public.child_progress WHERE child_id = p_child_id FOR UPDATE;
  IF v_log.correct IS TRUE THEN
    RETURN QUERY SELECT TRUE, TRUE, COALESCE(v_progress.streak, 0), COALESCE(v_progress.longest_streak, 0), v_log.attempts;
    RETURN;
  END IF;

  UPDATE public.word_of_day_log
  SET attempts = COALESCE(word_of_day_log.attempts, 0) + 1,
      accuracy = GREATEST(0, LEAST(100, p_accuracy)),
      correct = p_is_correct,
      completed_at = CASE WHEN p_is_correct THEN now() ELSE NULL END
  WHERE id = v_log.id
  RETURNING * INTO v_log;

  IF NOT p_is_correct THEN
    RETURN QUERY SELECT FALSE, FALSE, 0, 0, v_log.attempts;
    RETURN;
  END IF;

  SELECT * INTO v_progress FROM public.child_progress WHERE child_id = p_child_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.child_progress (child_id, streak, longest_streak, last_practice_date)
    VALUES (p_child_id, 1, 1, v_today)
    RETURNING * INTO v_progress;
  ELSE
    v_next_streak := CASE
      WHEN v_progress.last_practice_date = v_today THEN GREATEST(COALESCE(v_progress.streak, 0), 1)
      WHEN v_progress.last_practice_date = v_today - 1 THEN COALESCE(v_progress.streak, 0) + 1
      ELSE 1
    END;
    UPDATE public.child_progress
    SET streak = v_next_streak,
        longest_streak = GREATEST(COALESCE(longest_streak, 0), v_next_streak),
        last_practice_date = v_today,
        updated_at = now()
    WHERE child_id = p_child_id
    RETURNING * INTO v_progress;
  END IF;
  RETURN QUERY SELECT FALSE, TRUE, v_progress.streak, COALESCE(v_progress.longest_streak, v_progress.streak), v_log.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_personalized_word_of_day_attempt(
  p_child_id UUID,
  p_accuracy INTEGER,
  p_is_correct BOOLEAN
)
RETURNS TABLE(
  already_completed BOOLEAN,
  completed BOOLEAN,
  streak INTEGER,
  longest_streak INTEGER,
  attempts INTEGER,
  xp_awarded INTEGER,
  total_xp INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log public.word_of_day_log%ROWTYPE;
  v_progress public.child_progress%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_next_streak INTEGER;
  v_reward INTEGER := 50;
BEGIN
  SELECT * INTO v_log FROM public.word_of_day_log
  WHERE child_id = p_child_id AND date = v_today FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Word of the Day has not been initialized'; END IF;

  SELECT * INTO v_progress FROM public.child_progress WHERE child_id = p_child_id FOR UPDATE;
  IF v_log.correct IS TRUE THEN
    RETURN QUERY SELECT TRUE, TRUE, COALESCE(v_progress.streak, 0),
      COALESCE(v_progress.longest_streak, 0), v_log.attempts, 0,
      COALESCE(v_progress.xp, 0);
    RETURN;
  END IF;

  UPDATE public.word_of_day_log
  SET attempts = COALESCE(word_of_day_log.attempts, 0) + 1,
      accuracy = GREATEST(0, LEAST(100, p_accuracy)),
      correct = p_is_correct,
      completed_at = CASE WHEN p_is_correct THEN now() ELSE NULL END,
      xp_awarded = CASE WHEN p_is_correct THEN v_reward ELSE 0 END
  WHERE id = v_log.id
  RETURNING * INTO v_log;

  IF NOT p_is_correct THEN
    RETURN QUERY SELECT FALSE, FALSE, COALESCE(v_progress.streak, 0),
      COALESCE(v_progress.longest_streak, 0), v_log.attempts, 0,
      COALESCE(v_progress.xp, 0);
    RETURN;
  END IF;

  IF v_progress.child_id IS NULL THEN
    INSERT INTO public.child_progress (child_id, xp, streak, longest_streak, last_practice_date)
    VALUES (p_child_id, v_reward, 1, 1, v_today)
    RETURNING * INTO v_progress;
  ELSE
    v_next_streak := CASE
      WHEN v_progress.last_practice_date = v_today THEN GREATEST(COALESCE(v_progress.streak, 0), 1)
      WHEN v_progress.last_practice_date = v_today - 1 THEN COALESCE(v_progress.streak, 0) + 1
      ELSE 1
    END;
    UPDATE public.child_progress
    SET xp = COALESCE(child_progress.xp, 0) + v_reward,
        streak = v_next_streak,
        longest_streak = GREATEST(COALESCE(child_progress.longest_streak, 0), v_next_streak),
        last_practice_date = v_today,
        updated_at = now()
    WHERE child_id = p_child_id
    RETURNING * INTO v_progress;
  END IF;

  RETURN QUERY SELECT FALSE, TRUE, v_progress.streak,
    COALESCE(v_progress.longest_streak, v_progress.streak), v_log.attempts,
    v_reward, v_progress.xp;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_personalized_word_of_day_attempt(UUID, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_personalized_word_of_day_attempt(UUID, INTEGER, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
