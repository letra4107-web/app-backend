import { supabase } from '../config/supabase';

export type WordDefinition = {
  word_key: string;
  display_word: string | null;
  meaning_fil: string;
  example_sentence: string | null;
  is_ambiguous: boolean;
};

// Same normalization scorePronunciation uses (StudentDashboard.tsx) - strips
// diacritics/hyphens/case so a lookup matches regardless of how a source
// list writes the word (e.g. "Ba-ba" vs "baba").
export const normalizeWordKey = (word = '') =>
  word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-znñ]/g, '')
    .replace(/ñ/g, 'n');

// word_definitions is the small, hand-curated set - the only place
// homographs are marked (is_ambiguous + accent-marked display_word).
// reading_content.definition is the much larger curriculum-wide batch (589
// words as of the workbook's syllable/definition columns) with no
// ambiguity tracking of its own, so it's merged in as a fallback layer:
// word_definitions entries always win on a key collision, since they carry
// richer, reviewed disambiguation that a plain curriculum definition can't
// replace.
export const loadWordDefinitions = async (): Promise<Map<string, WordDefinition>> => {
  const [curatedResult, curriculumResult] = await Promise.all([
    supabase.from('word_definitions').select('*'),
    supabase
      .from('reading_content')
      .select('content_text,definition')
      .eq('content_type', 'word')
      .eq('is_active', true)
      .not('definition', 'is', null),
  ]);
  if (curatedResult.error) throw curatedResult.error;
  if (curriculumResult.error) throw curriculumResult.error;

  const map = new Map<string, WordDefinition>();
  (curriculumResult.data || []).forEach((row: { content_text: string; definition: string }) => {
    map.set(normalizeWordKey(row.content_text), {
      word_key: normalizeWordKey(row.content_text),
      display_word: null,
      meaning_fil: row.definition,
      example_sentence: null,
      is_ambiguous: false,
    });
  });
  (curatedResult.data || []).forEach((row: WordDefinition) => map.set(row.word_key, row));
  return map;
};
