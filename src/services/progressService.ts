import { API_BASE_URL, postJson } from '../config/api';

export type ReadingLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export type ChildProgress = {
  child_id: string;
  xp: number;
  level: ReadingLevel;
  streak: number;
  last_practice_date: string | null;
  completed_words: string[];
  word_count?: number;
  total_attempts: number;
  achievements: Array<{ id: string; unlockedAt: string }>;
  badges: any[];
  updated_at?: string;
};

export const levelForXp = (xp: number): ReadingLevel => {
  if (xp >= 250) return 'Advanced';
  if (xp >= 100) return 'Intermediate';
  return 'Beginner';
};

const toDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const yesterdayKey = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
};

export const buildNextProgress = (
  current: ChildProgress,
  word: string,
  xpAward: number,
  options: { countsAsPracticeSession?: boolean } = {},
) => {
  const today = toDateKey();
  const lastPractice = current.last_practice_date;
  let streak = current.streak || 0;
  let lastPracticeDate = current.last_practice_date;

  if (options.countsAsPracticeSession) {
    if (lastPractice === today) {
      streak = current.streak || 1;
    } else if (lastPractice === yesterdayKey()) {
      streak = (current.streak || 0) + 1;
    } else {
      streak = 1;
    }
    lastPracticeDate = today;
  }

  const completedWords = Array.from(new Set([...(current.completed_words || []), word]));
  const xp = (current.xp || 0) + xpAward;

  return {
    ...current,
    xp,
    streak,
    level: levelForXp(xp),
    last_practice_date: lastPracticeDate,
    completed_words: completedWords,
    word_count: completedWords.length,
    total_attempts: (current.total_attempts || 0) + 1,
  };
};

export const saveProgress = async (progress: ChildProgress) => {
  return postJson<{ success: boolean; progress: ChildProgress }>(`${API_BASE_URL}/progress/update`, {
    childId: progress.child_id,
    student_id: progress.child_id,
    xp: progress.xp,
    streak: progress.streak,
    lastPracticeDate: progress.last_practice_date,
    last_practice_date: progress.last_practice_date,
    completedWords: progress.completed_words,
    wordCount: progress.word_count ?? progress.completed_words?.length ?? 0,
    word_count: progress.word_count ?? progress.completed_words?.length ?? 0,
    achievements: progress.achievements,
    badges: progress.badges,
    level: progress.level,
    totalAttempts: progress.total_attempts,
  });
};
