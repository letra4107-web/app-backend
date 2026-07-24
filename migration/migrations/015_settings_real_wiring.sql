-- Supports actually wiring settings that were previously stored but never
-- read anywhere: text-to-speech master switch, speech rate, whether to show
-- the accuracy score after a practice attempt, whether to auto-speak a word
-- on selection, and a real tri-state (light/system/dark) appearance choice
-- replacing the redundant dark_mode boolean + light/dark/sepia reading_theme.

ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS speech_rate TEXT DEFAULT 'normal' CHECK (speech_rate IN ('slow', 'normal', 'fast'));
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS show_accuracy_score BOOLEAN DEFAULT true;
ALTER TABLE public.parents_settings ADD COLUMN IF NOT EXISTS auto_read_words BOOLEAN DEFAULT true;

ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS speech_rate TEXT DEFAULT 'normal' CHECK (speech_rate IN ('slow', 'normal', 'fast'));
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS show_accuracy_score BOOLEAN DEFAULT true;
ALTER TABLE public.student_settings ADD COLUMN IF NOT EXISTS auto_read_words BOOLEAN DEFAULT true;

-- tts_enabled has always defaulted to false, but speakWord/speakPhrase have
-- always fired unconditionally regardless of this column's value - it was
-- never actually read anywhere. Now that it's wired to a real master switch,
-- flip existing rows and the default to true so this change doesn't silently
-- mute an app that has always spoken aloud for every user.
UPDATE public.parents_settings SET tts_enabled = true WHERE tts_enabled = false;
UPDATE public.student_settings SET tts_enabled = true WHERE tts_enabled = false;
ALTER TABLE public.parents_settings ALTER COLUMN tts_enabled SET DEFAULT true;
ALTER TABLE public.student_settings ALTER COLUMN tts_enabled SET DEFAULT true;

-- Allow 'system' as a real reading_theme value (additive - existing 'sepia'
-- rows are left alone since dropping it would break rows that already use
-- it, even though nothing renders it differently today).
ALTER TABLE public.parents_settings DROP CONSTRAINT IF EXISTS parents_settings_reading_theme_check;
ALTER TABLE public.parents_settings ADD CONSTRAINT parents_settings_reading_theme_check CHECK (reading_theme IN ('light', 'dark', 'sepia', 'system'));

ALTER TABLE public.student_settings DROP CONSTRAINT IF EXISTS student_settings_reading_theme_check;
ALTER TABLE public.student_settings ADD CONSTRAINT student_settings_reading_theme_check CHECK (reading_theme IN ('light', 'dark', 'sepia', 'system'));

NOTIFY pgrst, 'reload schema';
