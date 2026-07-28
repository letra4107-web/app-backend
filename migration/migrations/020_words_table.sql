-- NOTE: requested as 012_words_table.sql, but 012 is already taken by
-- 012_achievement_badges_v2.sql (migrations run up to 019 this session) -
-- numbered 020 to continue the real sequence instead of colliding.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  syllable_count INTEGER,
  has_diphthong BOOLEAN NOT NULL DEFAULT false,
  has_consonant_cluster BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.words ADD COLUMN IF NOT EXISTS word TEXT;
ALTER TABLE public.words ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE public.words ADD COLUMN IF NOT EXISTS syllable_count INTEGER;
ALTER TABLE public.words ADD COLUMN IF NOT EXISTS has_diphthong BOOLEAN DEFAULT false;
ALTER TABLE public.words ADD COLUMN IF NOT EXISTS has_consonant_cluster BOOLEAN DEFAULT false;
ALTER TABLE public.words ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Same word can legitimately appear at more than one level in the source
-- data (e.g. "isda" is listed under both Level 1 and Level 2) - uniqueness
-- is on the (word, level) pair, not the word alone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_words_word_level ON public.words (word, level);
CREATE INDEX IF NOT EXISTS idx_words_level ON public.words (level);

ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_words" ON public.words;
CREATE POLICY "authenticated_read_words"
ON public.words
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "service_role_manage_words" ON public.words;
CREATE POLICY "service_role_manage_words"
ON public.words
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
