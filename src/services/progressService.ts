import { buildApiUrl, postJson } from '../config/api';

export type ReadingLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export type ChildProgress = {
  child_id: string;
  xp: number;
  level: ReadingLevel;
  streak: number;
  // Personal-best streak - never decreases, even after `streak` resets to 0.
  // Separate column (021_longest_streak.sql); defaults to 0 until that
  // migration has run, so callers should treat it as possibly undefined.
  longest_streak?: number;
  last_practice_date: string | null;
  completed_words: string[];
  word_count?: number;
  total_attempts: number;
  achievements: { id: string; unlockedAt: string }[];
  badges: any[];
  updated_at?: string;
  // Baseline accuracy is captured once, on the student's first scored practice,
  // and never overwritten again — it's the reference point for "improvement" badges.
  baseline_accuracy?: number | null;
  // Running sum of every scored practice's accuracy_percentage; average accuracy
  // = accuracy_sum / total_attempts. Kept as a sum (not a running average) so it
  // stays exact regardless of how many attempts have accumulated.
  accuracy_sum?: number;
  activities_completed?: number;
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
  options: { countsAsPracticeSession?: boolean; accuracy?: number } = {},
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
  const hasAccuracy = typeof options.accuracy === 'number' && Number.isFinite(options.accuracy);
  const baselineAccuracy = current.baseline_accuracy ?? (hasAccuracy ? options.accuracy! : null);
  const accuracySum = (current.accuracy_sum || 0) + (hasAccuracy ? options.accuracy! : 0);
  const longestStreak = Math.max(current.longest_streak || 0, streak);

  return {
    ...current,
    xp,
    streak,
    longest_streak: longestStreak,
    // XP is reward currency only. Reading level is recalculated by the
    // server-owned curriculum completion transaction.
    level: current.level,
    last_practice_date: lastPracticeDate,
    completed_words: completedWords,
    word_count: completedWords.length,
    total_attempts: (current.total_attempts || 0) + 1,
    baseline_accuracy: baselineAccuracy,
    accuracy_sum: accuracySum,
  };
};

export const saveProgress = async (progress: ChildProgress) => {
  // newlyPersistedAchievementIds - badge ids the SERVER confirms were not
  // already in this student's stored achievements before this call (see
  // backend/routes/progress.js's merge-on-save). This is the only reliable
  // signal for "should the unlock celebration fire" - the achievements array
  // on `progress` (this function's argument) can be stale if another save
  // raced ahead of it, so callers must not use it to decide what's "new".
  return postJson<{ success: boolean; progress: ChildProgress; newlyPersistedAchievementIds?: string[] }>(buildApiUrl('/progress/update'), {
    xp: progress.xp,
    streak: progress.streak,
    longestStreak: progress.longest_streak ?? 0,
    longest_streak: progress.longest_streak ?? 0,
    lastPracticeDate: progress.last_practice_date,
    last_practice_date: progress.last_practice_date,
    completedWords: progress.completed_words,
    wordCount: progress.word_count ?? progress.completed_words?.length ?? 0,
    word_count: progress.word_count ?? progress.completed_words?.length ?? 0,
    achievements: progress.achievements,
    badges: progress.badges,
    totalAttempts: progress.total_attempts,
    baselineAccuracy: progress.baseline_accuracy ?? null,
    accuracySum: progress.accuracy_sum ?? 0,
    activitiesCompleted: progress.activities_completed ?? 0,
  });
};
