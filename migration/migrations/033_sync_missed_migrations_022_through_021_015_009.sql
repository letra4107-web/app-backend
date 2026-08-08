-- Consolidated catch-up migration, written after a full audit (2026-08-08)
-- found several earlier migration files were committed to the repo but never
-- actually executed against the live Supabase database. Every statement here
-- is idempotent (IF NOT EXISTS / ON CONFLICT) and safe to run even if parts
-- of it already landed. See the audit report for how each gap was found and
-- verified live.
--
-- Run this entire file once in the Supabase SQL editor, top to bottom.

-- ============================================================================
-- 1. child_progress.word_count (009_parent_monitoring_notifications.sql /
--    010_child_progress_stability.sql - declared in both, applied by neither)
--    Read/written by backend/routes/progress.js and src/services/progressService.ts.
--    progress.js already has a defensive retry that drops this column on a
--    schema error, so its absence has been silently degrading (word counts on
--    the Parent Dashboard undercount) rather than crashing outright.
-- ============================================================================
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0;
UPDATE public.child_progress
SET word_count = COALESCE(word_count, cardinality(completed_words), 0)
WHERE word_count IS NULL OR word_count = 0;

-- ============================================================================
-- 2. child_progress.longest_streak (021_longest_streak.sql - never applied)
--    Read/written by src/services/progressService.ts and
--    src/screens/StudentDashboard.tsx (personal-best streak badge/display).
--    Same defensive-retry protection as word_count in progress.js, so this
--    has been silently dropped rather than crashing - the personal-best
--    streak has effectively never persisted.
-- ============================================================================
ALTER TABLE public.child_progress ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;
UPDATE public.child_progress
SET longest_streak = GREATEST(longest_streak, streak)
WHERE longest_streak < streak;

-- ============================================================================
-- 3. word_of_day_log.accuracy / .completed_at
--    (022_word_of_day_server_streak.sql - never applied)
--    This is the confirmed root cause of the "We could not save that
--    attempt" bug: backend/routes/speech.js's pure-JS fallback
--    (completeWordOfDayAttemptDirect) tried to write these columns and hit a
--    hard PGRST204 error with no defensive retry, unlike progress.js/
--    settingsService.ts. The just-shipped code fix (commit 8a3445c) stopped
--    writing to these two columns since nothing in the app reads them, so
--    this ALTER is optional going forward, but is included here to bring the
--    schema in line with what 022 originally intended, in case something
--    else comes to depend on it later.
-- ============================================================================
ALTER TABLE public.word_of_day_log
  ADD COLUMN IF NOT EXISTS accuracy INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ============================================================================
-- 4. complete_word_of_day_attempt() ambiguous-column bug
--    (022_word_of_day_server_streak.sql's function body - never applied
--    correctly; migration 032, already in this repo, fixes it. Included here
--    again so this single file is a complete catch-up in one run - safe to
--    run twice, CREATE OR REPLACE is idempotent.)
-- ============================================================================
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

-- ============================================================================
-- 5. parents_settings / student_settings: speech_rate, show_accuracy_score,
--    auto_read_words (015_settings_real_wiring.sql - never applied).
--    Read/written by src/services/settingsService.ts,
--    DashboardSettingsScreen.tsx, ParentDashboardEnhanced.tsx. Already has a
--    defensive schema-retry in settingsService.ts, so this has been silently
--    degrading (these 3 preferences never actually persist - they always
--    reset to the client-side default on next load) rather than crashing.
-- ============================================================================
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS speech_rate TEXT DEFAULT 'normal' CHECK (speech_rate IN ('slow', 'normal', 'fast'));
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS show_accuracy_score BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS auto_read_words BOOLEAN DEFAULT true;

ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS speech_rate TEXT DEFAULT 'normal' CHECK (speech_rate IN ('slow', 'normal', 'fast'));
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS show_accuracy_score BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS auto_read_words BOOLEAN DEFAULT true;

-- tts_enabled has always defaulted to false pre-015, but TTS playback itself
-- (speakWord/speakPhrase) has never actually been gated by this column - so
-- this is a display-only fix (the Settings toggle currently shows "off" for
-- existing users despite TTS always actually playing), not a functional one.
UPDATE public.parents_settings SET tts_enabled = true WHERE tts_enabled = false;
UPDATE public.student_settings SET tts_enabled = true WHERE tts_enabled = false;
ALTER TABLE public.parents_settings ALTER COLUMN tts_enabled SET DEFAULT true;
ALTER TABLE public.student_settings ALTER COLUMN tts_enabled SET DEFAULT true;

ALTER TABLE public.parents_settings DROP CONSTRAINT IF EXISTS parents_settings_reading_theme_check;
ALTER TABLE public.parents_settings ADD CONSTRAINT parents_settings_reading_theme_check CHECK (reading_theme IN ('light', 'dark', 'sepia', 'system'));

ALTER TABLE public.student_settings DROP CONSTRAINT IF EXISTS student_settings_reading_theme_check;
ALTER TABLE public.student_settings ADD CONSTRAINT student_settings_reading_theme_check CHECK (reading_theme IN ('light', 'dark', 'sepia', 'system'));

-- ============================================================================
-- 6. notifications RLS policy rewrite (009_parent_monitoring_notifications.sql
--    tail section - unverified either way; included for completeness).
--    Low risk either way: every current notifications read/write goes
--    through backend/routes/notifications.js using the service-role key,
--    which bypasses RLS entirely, and no frontend code queries this table
--    directly. This only matters if something starts querying notifications
--    directly from the client in the future.
-- ============================================================================
DROP POLICY IF EXISTS "users_read_notifications" ON public.notifications;
DROP POLICY IF EXISTS "users_insert_own_notifications" ON public.notifications;
DROP POLICY IF EXISTS "users_update_notifications" ON public.notifications;
DROP POLICY IF EXISTS "service_role_manage_notifications" ON public.notifications;
DROP POLICY IF EXISTS "Parents can view linked notifications" ON public.notifications;
DROP POLICY IF EXISTS "Parents can mark linked notifications read" ON public.notifications;
DROP POLICY IF EXISTS "Students can insert parent notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role can manage notifications" ON public.notifications;

CREATE POLICY "Parents can view linked notifications"
ON public.notifications FOR SELECT TO authenticated
USING (parent_id = auth.uid()::text);

CREATE POLICY "Parents can mark linked notifications read"
ON public.notifications FOR UPDATE TO authenticated
USING (parent_id = auth.uid()::text)
WITH CHECK (parent_id = auth.uid()::text);

CREATE POLICY "Students can insert parent notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.children c
    WHERE c.id = public.notifications.student_id
      AND c.auth_uid = auth.uid()::text
      AND c.parent_id = public.notifications.parent_id
  )
);

CREATE POLICY "Service role can manage notifications"
ON public.notifications FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- NOT included: public.student_progress (009_parent_monitoring_notifications.sql).
-- Confirmed via grep that nothing in the current codebase queries this table
-- (`.from('student_progress')` has zero matches) - it was superseded by
-- reading child_progress directly for the Parent Dashboard. Dead schema, not
-- a live bug; skipped deliberately rather than resurrecting an unused table.
-- If you want it created anyway for historical parity, see 009's original
-- CREATE TABLE block.
-- ============================================================================

NOTIFY pgrst, 'reload schema';
