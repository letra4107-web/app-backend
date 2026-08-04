-- Word of the Day completion is owned by the server.  Clients may read their
-- log but must not be able to set correctness, accuracy, or streak values.
ALTER TABLE public.word_of_day_log
  ADD COLUMN IF NOT EXISTS accuracy INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- The backend invokes this after it has authenticated the student and scored
-- the audio. The unique child/date row makes duplicate same-day completion
-- idempotent even when two requests arrive concurrently.
CREATE OR REPLACE FUNCTION public.complete_word_of_day_attempt(
  p_child_id TEXT,
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
  SET attempts = COALESCE(attempts, 0) + 1,
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

-- Existing student ALL policy would let the client forge a completion.
DROP POLICY IF EXISTS "students_manage_own_word_log" ON public.word_of_day_log;
CREATE POLICY "students_insert_own_word_log" ON public.word_of_day_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.children
      -- Cast only inside the policy because this established log table has a
      -- text child_id while the current children table uses UUID identifiers.
      WHERE children.id::text = child_id
        AND children.auth_uid::text = auth.uid()::text
    )
  );

NOTIFY pgrst, 'reload schema';
