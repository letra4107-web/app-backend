import { buildApiUrl, getJson, postJson } from '../config/api';

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

export type CanonicalStudentStats = {
  studentId: string;
  childId: string;
  userId?: string | null;
  parentId?: string | null;
  name?: string;
  xp: number;
  level: ReadingLevel;
  streak: number;
  longestStreak: number;
  totalAttempts: number;
  total_attempts: number;
  correctAttempts: number;
  accuracy: number;
  accuracySum: number;
  accuracy_sum: number;
  activitiesCompleted: number;
  activities_completed: number;
  wordsCompleted: number;
  words_completed: number;
  completedWords: string[];
  completed_words: string[];
  lessonsCompleted: number;
  lessons_completed: number;
  baselineAccuracy?: number | null;
  baseline_accuracy?: number | null;
  dailyGoal: { target: number; completed: number; percentage: number };
  badges: any[];
  achievements: { id: string; unlockedAt?: string }[];
  recentActivity: any[];
  recentActivities: any[];
  notifications: any[];
  lastActivityAt?: string | null;
  childProgress: ChildProgress;
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
  return postJson<{ success: boolean; progress: ChildProgress; stats?: CanonicalStudentStats; newlyPersistedAchievementIds?: string[] }>(buildApiUrl('/progress/update'), {
    xp: progress.xp,
    // streak, longest_streak, and last_practice_date are intentionally not
    // submitted here. Only a successful server-side Word of the Day
    // completion owns those fields.
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

export const getCanonicalStudentStats = async (studentId: string) => {
  const response = await getJson<{ success: boolean; data: CanonicalStudentStats }>(
    buildApiUrl(`/progress/${studentId}/stats`),
  );
  return response.data;
};

export const progressFromCanonicalStats = (stats: CanonicalStudentStats): ChildProgress => ({
  ...(stats.childProgress || emptyFromStats(stats)),
  child_id: stats.childId || stats.studentId,
  xp: stats.xp || 0,
  level: stats.level || 'Beginner',
  streak: stats.streak || 0,
  longest_streak: stats.longestStreak || stats.childProgress?.longest_streak || 0,
  total_attempts: stats.totalAttempts || stats.total_attempts || 0,
  accuracy_sum: stats.accuracySum || stats.accuracy_sum || 0,
  baseline_accuracy: stats.baselineAccuracy ?? stats.baseline_accuracy ?? null,
  activities_completed: stats.activitiesCompleted || stats.activities_completed || 0,
  completed_words: stats.completedWords || stats.completed_words || [],
  word_count: stats.wordsCompleted || stats.words_completed || stats.completedWords?.length || 0,
  badges: stats.badges || [],
  achievements: (stats.achievements || []).map((achievement: any) => ({
    ...achievement,
    id: achievement.id,
    unlockedAt: achievement.unlockedAt || achievement.unlocked_at || new Date().toISOString(),
  })),
});

const emptyFromStats = (stats: CanonicalStudentStats): ChildProgress => ({
  child_id: stats.childId || stats.studentId,
  xp: 0,
  level: 'Beginner',
  streak: 0,
  longest_streak: 0,
  last_practice_date: null,
  completed_words: [],
  total_attempts: 0,
  achievements: [],
  badges: [],
  baseline_accuracy: null,
  accuracy_sum: 0,
  activities_completed: 0,
});
