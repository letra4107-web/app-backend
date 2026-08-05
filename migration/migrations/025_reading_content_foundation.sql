CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Canonical, workbook-backed curriculum. The existing public.words table is
-- intentionally unchanged: each of its 600 rows is represented here through
-- a stable word_id, while non-word curriculum has no words-table surrogate.
CREATE TABLE IF NOT EXISTS public.reading_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id UUID REFERENCES public.words(id) ON DELETE RESTRICT,
  content_text TEXT NOT NULL CHECK (btrim(content_text) <> ''),
  normalized_text TEXT NOT NULL CHECK (btrim(normalized_text) <> ''),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('word', 'phonetic', 'phrase', 'sentence', 'paragraph')
  ),
  level TEXT NOT NULL CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK (source_row > 0),
  pattern_note TEXT,
  backend_category TEXT,
  is_assessment BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reading_content_word_link_check CHECK (
    (content_type = 'word' AND word_id IS NOT NULL)
    OR (content_type <> 'word' AND word_id IS NULL)
  ),
  CONSTRAINT reading_content_assessment_check CHECK (
    is_assessment = (content_type = 'paragraph')
  ),
  UNIQUE (normalized_text, content_type, level),
  UNIQUE (source_sheet, source_row),
  UNIQUE (word_id)
);

CREATE INDEX IF NOT EXISTS reading_content_lookup_idx
  ON public.reading_content(level, content_type, is_active, sequence_no);

-- Data-driven official progression requirements. Adding or revising a
-- curriculum requirement is a data migration, not an app-code threshold.
CREATE TABLE IF NOT EXISTS public.reading_level_requirements (
  level TEXT NOT NULL CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('word', 'phonetic', 'phrase', 'sentence', 'paragraph')
  ),
  required_count INTEGER NOT NULL CHECK (required_count > 0),
  completion_policy TEXT NOT NULL CHECK (
    completion_policy IN ('minimum_accuracy_75', 'full_scored_submission')
  ),
  next_level TEXT CHECK (next_level IN ('Intermediate', 'Advanced')),
  requirement_order INTEGER NOT NULL CHECK (requirement_order > 0),
  PRIMARY KEY (level, content_type),
  CONSTRAINT reading_level_next_level_check CHECK (
    (level = 'Beginner' AND next_level = 'Intermediate')
    OR (level = 'Intermediate' AND next_level = 'Advanced')
    OR (level = 'Advanced' AND next_level IS NULL)
  )
);

INSERT INTO public.reading_level_requirements
  (level, content_type, required_count, completion_policy, next_level, requirement_order)
VALUES
  ('Beginner', 'word',       200, 'minimum_accuracy_75',      'Intermediate', 1),
  ('Beginner', 'phonetic',   200, 'minimum_accuracy_75',      'Intermediate', 2),
  ('Intermediate', 'word',   200, 'minimum_accuracy_75',      'Advanced',     1),
  ('Intermediate', 'phrase', 200, 'minimum_accuracy_75',      'Advanced',     2),
  ('Advanced', 'word',       200, 'minimum_accuracy_75',      NULL,           1),
  ('Advanced', 'sentence',   200, 'minimum_accuracy_75',      NULL,           2),
  ('Advanced', 'paragraph',   20, 'full_scored_submission',   NULL,           3)
ON CONFLICT (level, content_type) DO UPDATE SET
  required_count = EXCLUDED.required_count,
  completion_policy = EXCLUDED.completion_policy,
  next_level = EXCLUDED.next_level,
  requirement_order = EXCLUDED.requirement_order;

-- Immutable scored event log. A paragraph submission must explicitly cover
-- the full assessment; its score is retained but never used as a pass gate.
CREATE TABLE IF NOT EXISTS public.student_content_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.reading_content(id) ON DELETE RESTRICT,
  accuracy NUMERIC(5,2) NOT NULL CHECK (accuracy >= 0 AND accuracy <= 100),
  transcript TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  is_full_submission BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'practice' CHECK (
    source IN ('practice', 'assessment', 'diagnostic', 'lesson', 'recommendation', 'import')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_content_attempts_student_created_idx
  ON public.student_content_attempts(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS student_content_attempts_content_idx
  ON public.student_content_attempts(student_id, content_id, created_at DESC);

-- One completion per student/content item. Only the server-owned transaction
-- may create this row after applying the requirement's completion policy.
CREATE TABLE IF NOT EXISTS public.student_content_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.reading_content(id) ON DELETE RESTRICT,
  qualifying_attempt_id UUID NOT NULL UNIQUE
    REFERENCES public.student_content_attempts(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, content_id)
);

CREATE INDEX IF NOT EXISTS student_content_completion_summary_idx
  ON public.student_content_completions(student_id, content_id);

-- Placement is not represented by fabricated completions. Each override is
-- separately attributable and requires a human-readable reason. Revocation
-- is retained on the same audit record rather than deleting history.
CREATE TABLE IF NOT EXISTS public.student_reading_level_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  override_level TEXT NOT NULL CHECK (override_level IN ('Beginner', 'Intermediate', 'Advanced')),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  created_by_auth_uid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by_auth_uid TEXT,
  revocation_reason TEXT,
  CONSTRAINT reading_level_override_revocation_check CHECK (
    (revoked_at IS NULL AND revoked_by_auth_uid IS NULL AND revocation_reason IS NULL)
    OR (
      revoked_at IS NOT NULL
      AND revoked_by_auth_uid IS NOT NULL
      AND btrim(COALESCE(revocation_reason, '')) <> ''
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_reading_level_override_per_student_idx
  ON public.student_reading_level_overrides(student_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.reading_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_level_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_content_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_content_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_reading_level_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users read active curriculum" ON public.reading_content;
CREATE POLICY "Authenticated users read active curriculum"
  ON public.reading_content FOR SELECT TO authenticated
  USING (is_active);

DROP POLICY IF EXISTS "Authenticated users read progression requirements" ON public.reading_level_requirements;
CREATE POLICY "Authenticated users read progression requirements"
  ON public.reading_level_requirements FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Students view own content attempts" ON public.student_content_attempts;
CREATE POLICY "Students view own content attempts"
  ON public.student_content_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.auth_uid::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Parents view child content attempts" ON public.student_content_attempts;
CREATE POLICY "Parents view child content attempts"
  ON public.student_content_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.parent_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Students view own content completions" ON public.student_content_completions;
CREATE POLICY "Students view own content completions"
  ON public.student_content_completions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.auth_uid::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Parents view child content completions" ON public.student_content_completions;
CREATE POLICY "Parents view child content completions"
  ON public.student_content_completions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.parent_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Students view own reading level overrides" ON public.student_reading_level_overrides;
CREATE POLICY "Students view own reading level overrides"
  ON public.student_reading_level_overrides FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.auth_uid::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Parents view child reading level overrides" ON public.student_reading_level_overrides;
CREATE POLICY "Parents view child reading level overrides"
  ON public.student_reading_level_overrides FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = student_id AND c.parent_id::text = auth.uid()::text
    )
  );

-- There are intentionally no authenticated INSERT/UPDATE/DELETE policies on
-- attempts, completions, or overrides. These records are server-owned.
NOTIFY pgrst, 'reload schema';
