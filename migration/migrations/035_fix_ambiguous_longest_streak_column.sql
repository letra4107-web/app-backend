-- complete_word_of_day_attempt (034's UUID-typed version) still had one
-- more ambiguous-column instance, same class as the "attempts" bug 032
-- fixed: RETURNS TABLE(..., longest_streak INTEGER, ...) implicitly
-- declares longest_streak as a plpgsql variable, ambiguous with
-- child_progress.longest_streak inside the unqualified UPDATE ... SET
-- longest_streak = GREATEST(COALESCE(longest_streak, 0), ...) statement.
-- Confirmed live: RPC call returned 42702 "column reference longest_streak
-- is ambiguous". complete_personalized_word_of_day_attempt already
-- schema-qualifies this correctly and is unaffected - this function is
-- only reached as a fallback when that one errors, so this was not
-- currently blocking Word of Day saves, but is fixed here for correctness.

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
        longest_streak = GREATEST(COALESCE(child_progress.longest_streak, 0), v_next_streak),
        last_practice_date = v_today,
        updated_at = now()
    WHERE child_id = p_child_id
    RETURNING * INTO v_progress;
  END IF;
  RETURN QUERY SELECT FALSE, TRUE, v_progress.streak, COALESCE(v_progress.longest_streak, v_progress.streak), v_log.attempts;
END;
$$;

NOTIFY pgrst, 'reload schema';
