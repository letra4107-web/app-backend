CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Preserve the exact practice context needed for future outcome-derived
-- readiness labels. Legacy attempts deliberately remain nullable because a
-- word can appear in more than one difficulty level and cannot be backfilled
-- reliably from its text alone.
ALTER TABLE public.pronunciation_practice_sessions
  ADD COLUMN IF NOT EXISTS word_id UUID,
  ADD COLUMN IF NOT EXISTS difficulty_level_at_attempt TEXT,
  ADD COLUMN IF NOT EXISTS practice_source TEXT NOT NULL DEFAULT 'practice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pronunciation_sessions_word_id_fkey'
      AND conrelid = 'public.pronunciation_practice_sessions'::regclass
  ) THEN
    ALTER TABLE public.pronunciation_practice_sessions
      ADD CONSTRAINT pronunciation_sessions_word_id_fkey
      FOREIGN KEY (word_id) REFERENCES public.words(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pronunciation_sessions_difficulty_check'
      AND conrelid = 'public.pronunciation_practice_sessions'::regclass
  ) THEN
    ALTER TABLE public.pronunciation_practice_sessions
      ADD CONSTRAINT pronunciation_sessions_difficulty_check
      CHECK (
        difficulty_level_at_attempt IS NULL
        OR difficulty_level_at_attempt IN ('beginner', 'intermediate', 'advanced')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pronunciation_sessions_source_check'
      AND conrelid = 'public.pronunciation_practice_sessions'::regclass
  ) THEN
    ALTER TABLE public.pronunciation_practice_sessions
      ADD CONSTRAINT pronunciation_sessions_source_check
      CHECK (practice_source IN ('practice', 'word_of_day', 'diagnostic', 'lesson', 'recommendation'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_student_difficulty_created
  ON public.pronunciation_practice_sessions(student_id, difficulty_level_at_attempt, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pronunciation_sessions_student_word_created
  ON public.pronunciation_practice_sessions(student_id, word_id, created_at DESC);

-- Confusion events are spelling-vs-transcript inferences, not acoustic
-- phoneme measurements. The optional session link makes their time window and
-- practice context exact for new data while preserving legacy events.
ALTER TABLE public.phoneme_confusion
  ADD COLUMN IF NOT EXISTS session_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phoneme_confusion_session_id_fkey'
      AND conrelid = 'public.phoneme_confusion'::regclass
  ) THEN
    ALTER TABLE public.phoneme_confusion
      ADD CONSTRAINT phoneme_confusion_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.pronunciation_practice_sessions(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_phoneme_confusion_session
  ON public.phoneme_confusion(session_id)
  WHERE session_id IS NOT NULL;

-- One immutable record per recommendation decision. A cold-start strategy
-- leaves predicted_probability null because its score is not a calibrated ML
-- probability. feature_snapshot preserves the exact evidence used.
CREATE TABLE IF NOT EXISTS public.personalization_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  recommendation_strategy TEXT NOT NULL,
  model_version TEXT NOT NULL,
  feature_schema_version TEXT NOT NULL,
  current_difficulty TEXT,
  recommended_difficulty TEXT NOT NULL,
  predicted_probability NUMERIC(6,5),
  should_advance BOOLEAN NOT NULL,
  feature_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personalization_current_difficulty_check CHECK (
    current_difficulty IS NULL
    OR current_difficulty IN ('beginner', 'intermediate', 'advanced')
  ),
  CONSTRAINT personalization_recommended_difficulty_check CHECK (
    recommended_difficulty IN ('beginner', 'intermediate', 'advanced')
  ),
  CONSTRAINT personalization_probability_check CHECK (
    predicted_probability IS NULL
    OR (predicted_probability >= 0 AND predicted_probability <= 1)
  )
);

CREATE INDEX IF NOT EXISTS idx_personalization_recommendations_student_created
  ON public.personalization_recommendations(student_id, created_at DESC);

-- Ranked candidate words are normalized so each stable word id, rank, score,
-- and explanation remains independently queryable.
CREATE TABLE IF NOT EXISTS public.personalization_recommendation_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL
    REFERENCES public.personalization_recommendations(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES public.words(id) ON DELETE RESTRICT,
  rank INTEGER NOT NULL CHECK (rank > 0),
  ranking_score NUMERIC,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id, word_id),
  UNIQUE (recommendation_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_personalization_words_recommendation_rank
  ON public.personalization_recommendation_words(recommendation_id, rank);

-- Rows appear only after the evaluation window is observable. readiness_label
-- is the eventual supervised target and is never derived from XP progression.
CREATE TABLE IF NOT EXISTS public.personalization_recommendation_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL UNIQUE
    REFERENCES public.personalization_recommendations(id) ON DELETE CASCADE,
  evaluation_attempt_count INTEGER NOT NULL CHECK (evaluation_attempt_count > 0),
  correct_attempt_count INTEGER NOT NULL CHECK (
    correct_attempt_count >= 0
    AND correct_attempt_count <= evaluation_attempt_count
  ),
  average_accuracy NUMERIC(5,2) NOT NULL CHECK (average_accuracy >= 0 AND average_accuracy <= 100),
  readiness_label BOOLEAN NOT NULL,
  success_criteria JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.personalization_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personalization_recommendation_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personalization_recommendation_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own recommendations" ON public.personalization_recommendations;
CREATE POLICY "Students view own recommendations"
  ON public.personalization_recommendations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.auth_uid::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Parents view child recommendations" ON public.personalization_recommendations;
CREATE POLICY "Parents view child recommendations"
  ON public.personalization_recommendations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.parent_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Students view own recommended words" ON public.personalization_recommendation_words;
CREATE POLICY "Students view own recommended words"
  ON public.personalization_recommendation_words FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.personalization_recommendations r
      JOIN public.children c ON c.id = r.student_id
      WHERE r.id = recommendation_id AND c.auth_uid::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Parents view child recommended words" ON public.personalization_recommendation_words;
CREATE POLICY "Parents view child recommended words"
  ON public.personalization_recommendation_words FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.personalization_recommendations r
      JOIN public.children c ON c.id = r.student_id
      WHERE r.id = recommendation_id AND c.parent_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Students view own recommendation outcomes" ON public.personalization_recommendation_outcomes;
CREATE POLICY "Students view own recommendation outcomes"
  ON public.personalization_recommendation_outcomes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.personalization_recommendations r
      JOIN public.children c ON c.id = r.student_id
      WHERE r.id = recommendation_id AND c.auth_uid::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Parents view child recommendation outcomes" ON public.personalization_recommendation_outcomes;
CREATE POLICY "Parents view child recommendation outcomes"
  ON public.personalization_recommendation_outcomes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.personalization_recommendations r
      JOIN public.children c ON c.id = r.student_id
      WHERE r.id = recommendation_id AND c.parent_id::text = auth.uid()::text
    )
  );

-- No authenticated INSERT/UPDATE policies are defined. Recommendation events
-- and outcome labels are server-owned records.
NOTIFY pgrst, 'reload schema';
