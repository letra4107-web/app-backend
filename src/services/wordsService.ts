import { buildApiUrl, getJson, postJson } from '../config/api';

export type WordLevel = 'beginner' | 'intermediate' | 'advanced';

export type WordBankEntry = {
  id: string;
  word: string;
  level: WordLevel;
  syllable_count: number | null;
  has_diphthong: boolean;
  has_consonant_cluster: boolean;
};

export type RankedWordEntry = {
  id: string;
  word: string;
  level: WordLevel;
  rank: number;
  rankingScore: number;
  componentScores: {
    weakness_match: number;
    mastery_gap: number;
    recency_need: number;
    structural_fit: number;
  };
  reasonCodes: string[];
  matchedConfusionPairs: string[];
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

export const fetchPersonalizedWords = async (limit = 24): Promise<string[]> => {
  const response = await postJson<{
    success: boolean;
    recommendation?: { words?: RankedWordEntry[] };
    message?: string;
  }>(buildApiUrl('/personalization/recommend'), { limit }, 15000);
  if (!response?.success || !response.recommendation?.words?.length) {
    throw new Error(response?.message || 'No personalized words are available.');
  }
  return response.recommendation.words.map((entry) => entry.word);
};

type PracticeWordLoader = (level: string, limit: number) => Promise<string[]>;

/**
 * Personalization is an enhancement, never a prerequisite for practice.
 * Dependency parameters keep the failure path directly testable without a
 * network request.
 */
export const fetchPracticeWords = async (
  level: string,
  limit = 24,
  personalizedLoader: PracticeWordLoader = (_level, requestedLimit) => fetchPersonalizedWords(requestedLimit),
  standardLoader: PracticeWordLoader = fetchWords,
): Promise<string[]> => {
  try {
    const personalized = await personalizedLoader(level, limit);
    if (personalized.length) return personalized;
  } catch (error: any) {
    console.warn('[Words] personalization unavailable; using ordinary level word bank:', error?.message || error);
  }
  return standardLoader(level, limit);
};
