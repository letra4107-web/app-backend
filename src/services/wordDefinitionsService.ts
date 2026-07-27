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

export const loadWordDefinitions = async (): Promise<Map<string, WordDefinition>> => {
  const { data, error } = await supabase.from('word_definitions').select('*');
  if (error) throw error;
  const map = new Map<string, WordDefinition>();
  (data || []).forEach((row: WordDefinition) => map.set(row.word_key, row));
  return map;
};
