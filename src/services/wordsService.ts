import { buildApiUrl, getJson } from '../config/api';

export type WordLevel = 'beginner' | 'intermediate' | 'advanced';

export type WordBankEntry = {
  id: string;
  word: string;
  level: WordLevel;
  syllable_count: number | null;
  has_diphthong: boolean;
  has_consonant_cluster: boolean;
};

export const fetchWords = async (level: string, limit = 24): Promise<string[]> => {
  try {
    const response = await getJson<{ success: boolean; words?: WordBankEntry[]; message?: string }>(
      buildApiUrl(`/words?level=${encodeURIComponent(level)}&limit=${limit}`),
      15000,
    );
    if (!response?.success) {
      throw new Error(response?.message || 'Unable to load words.');
    }
    return (response.words || []).map((w) => w.word);
  } catch (error: any) {
    console.warn('[Words] fetch failed:', error?.message || error);
    throw new Error('Hindi ma-load ang mga salita.');
  }
};
