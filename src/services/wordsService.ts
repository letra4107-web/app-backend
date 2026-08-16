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

export type RankedContentEntry = {
  id: string;
  contentId: string;
  wordId: string | null;
  contentText: string;
  contentType: 'word' | 'phonetic' | 'phrase' | 'sentence' | 'story';
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
  recommendationReason?: string;
  recommendationId?: string;
};

export const fetchWords = async (level: string, limit = 24): Promise<string[]> => {
  try {
    const response = await getJson<{ success: boolean; words?: WordBankEntry[]; message?: string }>(
      buildApiUrl(`/words?level=${encodeURIComponent(level)}&limit=${limit}`),
      15000,
    );
    if (!response?.success) {
      throw new Error(response?.message || 'Hindi ma-load ang mga salita.');
    }
    return (response.words || []).map((w) => w.word);
  } catch (error: any) {
    console.warn('[Words] fetch failed:', error?.message || error);
    throw new Error('Hindi ma-load ang mga salita.');
  }
};

// Panel item 2 (content-sourcing reconciliation): Word of the Day and the
// default Practice recommendation now pick a genuinely random word from the
// student's level-filtered word bank (the `words` table, already random via
// server-side Fisher-Yates shuffle) instead of the sequence-frontier
// personalization ranker - the ranker is left untouched for module-specific
// practice (which still needs its curriculum-sequencing/completion-tracking
// behavior intact). Wrapped into the same RankedContentEntry shape so the
// rest of the UI (which was built against the ranker's response) needs no
// changes.
export const fetchRandomWordEntry = async (level: WordLevel): Promise<RankedContentEntry | null> => {
  const words = await fetchWords(level, 24);
  if (!words.length) return null;
  const word = words[Math.floor(Math.random() * words.length)];
  return {
    id: `word-bank-${word}`,
    contentId: word,
    wordId: null,
    contentText: word,
    contentType: 'word',
    word,
    level,
    rank: 1,
    rankingScore: 0,
    componentScores: { weakness_match: 0, mastery_gap: 0, recency_need: 0, structural_fit: 0 },
    reasonCodes: [],
    matchedConfusionPairs: [],
    recommendationReason: 'Random na salita mula sa iyong antas.',
  };
};

export const fetchPersonalizedWords = async (limit = 24): Promise<string[]> => {
  const ranked = await fetchPersonalizedContent(limit);
  return ranked.map((entry) => entry.contentText || entry.word);
};

export const fetchPersonalizedContent = async (limit = 24, contentType?: string): Promise<RankedContentEntry[]> => {
  const response = await postJson<{
    success: boolean;
    recommendation?: { items?: RankedContentEntry[]; words?: RankedContentEntry[] };
    message?: string;
  }>(buildApiUrl('/personalization/recommend'), { limit, ...(contentType ? { contentType } : {}) }, 15000);
  const ranked = response.recommendation?.items || response.recommendation?.words || [];
  if (!response?.success || !ranked.length) {
    throw new Error(response?.message || 'No personalized words are available.');
  }
  return ranked;
};

export const fetchPersonalizedWordOfDay = async (): Promise<RankedContentEntry> => {
  const response = await postJson<{
    success: boolean;
    recommendation?: { id?: string; items?: RankedContentEntry[] };
    message?: string;
  }>(buildApiUrl('/personalization/recommend'), { limit: 1, purpose: 'word_of_day' }, 15000);
  const item = response.recommendation?.items?.[0];
  if (!response.success || !item || item.contentType !== 'word') {
    throw new Error(response.message || 'No personalized Word of the Day is available.');
  }
  return { ...item, recommendationId: response.recommendation?.id };
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
