const DAILY_GOAL = 5;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const optionalTableCodes = new Set(['PGRST205', '42P01', '42703']);

const safeSelect = async (supabase, table, buildQuery) => {
  const result = await buildQuery(supabase.from(table));
  if (result.error) {
    if (optionalTableCodes.has(result.error.code)) return [];
    throw result.error;
  }
  return result.data || [];
};

const resolveChild = async (supabase, childIdOrAuthUid) => {
  const id = String(childIdOrAuthUid || '').trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from('children')
    .select('*')
    .or(`id.eq.${id},auth_uid.eq.${id}`)
    .maybeSingle();

  if (error) {
    if (optionalTableCodes.has(error.code)) return null;
    throw error;
  }

  return data || null;
};

const toTimestamp = (item = {}) =>
  item.completed_at || item.updated_at || item.created_at || item.timestamp || item.date || null;

const sortRecent = (items = []) =>
  [...items].sort((a, b) => {
    const aTime = new Date(toTimestamp(a) || 0).getTime();
    const bTime = new Date(toTimestamp(b) || 0).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });

const buildEmptyProgress = (childId) => ({
  child_id: childId,
  xp: 0,
  level: 'Beginner',
  streak: 0,
  longest_streak: 0,
  last_practice_date: null,
  completed_words: [],
  word_count: 0,
  total_attempts: 0,
  achievements: [],
  badges: [],
  baseline_accuracy: null,
  accuracy_sum: 0,
  activities_completed: 0,
});

const normalizeProgressRow = (childId, row = null) => ({
  ...buildEmptyProgress(childId),
  ...(row || {}),
  child_id: row?.child_id || childId,
  completed_words: asArray(row?.completed_words),
  achievements: asArray(row?.achievements),
  badges: asArray(row?.badges),
});

const buildRecentActivity = ({ sessions, lessonProgress }) => {
  const sessionActivity = asArray(sessions).map((session) => ({
    id: session.id,
    activityType: 'pronunciation_practice',
    lessonTitle: session.word || session.content_title || 'Reading practice',
    score: session.accuracy_percentage,
    completedAt: session.created_at,
  }));

  const lessonActivity = asArray(lessonProgress).map((lesson) => ({
    id: lesson.id,
    activityType: 'lesson',
    lessonTitle: lesson.lesson_title || lesson.title || 'Lesson',
    status: lesson.status,
    score: lesson.score ?? lesson.progress_percentage ?? null,
    completedAt: toTimestamp(lesson),
  }));

  return sortRecent([...sessionActivity, ...lessonActivity]).slice(0, 10);
};

async function getStudentStats(supabase, childIdOrAuthUid) {
  const child = await resolveChild(supabase, childIdOrAuthUid);
  if (!child?.id) return null;

  const [progressRows, sessions, lessonProgress, notifications] = await Promise.all([
    safeSelect(supabase, 'child_progress', (query) =>
      query.select('*').eq('child_id', child.id).order('updated_at', { ascending: false }).limit(1)
    ),
    safeSelect(supabase, 'pronunciation_practice_sessions', (query) =>
      query.select('*').eq('student_id', child.id).order('created_at', { ascending: false }).limit(500)
    ),
    safeSelect(supabase, 'lesson_progress', (query) =>
      query.select('*').eq('student_id', child.id).order('updated_at', { ascending: false }).limit(500)
    ),
    safeSelect(supabase, 'notifications', (query) =>
      query.select('*').in('user_id', [child.auth_uid, child.id].filter(Boolean)).order('created_at', { ascending: false }).limit(20)
    ),
  ]);

  const childProgress = normalizeProgressRow(child.id, progressRows[0]);
  const sessionScores = sessions
    .map((session) => asNumber(session.accuracy_percentage, null))
    .filter((score) => score != null);
  const totalAttempts = Math.max(asNumber(childProgress.total_attempts, 0), sessions.length);
  const accuracySum = asNumber(
    childProgress.accuracy_sum,
    sessionScores.reduce((sum, score) => sum + score, 0)
  );
  const accuracy = totalAttempts > 0 ? Math.round(accuracySum / totalAttempts) : 0;
  const lessonsCompleted = lessonProgress.filter((row) => {
    const status = String(row.status || '').toLowerCase();
    return status === 'completed' || row.completed === true;
  }).length;
  const activitiesCompleted = Math.max(asNumber(childProgress.activities_completed, 0), lessonsCompleted);
  const dailyCompleted = Math.min(totalAttempts % DAILY_GOAL, DAILY_GOAL);
  const recentActivity = buildRecentActivity({ sessions, lessonProgress });
  const badges = asArray(childProgress.badges).length
    ? asArray(childProgress.badges)
    : asArray(childProgress.achievements).map((achievement) =>
        typeof achievement === 'string' ? { id: achievement, unlocked: true } : achievement
      );

  return {
    studentId: child.id,
    childId: child.id,
    userId: child.auth_uid || null,
    parentId: child.parent_id || null,
    name: child.name || 'Student',
    xp: asNumber(childProgress.xp, 0),
    level: childProgress.level || 'Beginner',
    streak: asNumber(childProgress.streak, 0),
    longestStreak: Math.max(asNumber(childProgress.longest_streak, 0), asNumber(childProgress.streak, 0)),
    totalAttempts,
    total_attempts: totalAttempts,
    correctAttempts: sessions.filter((session) => asNumber(session.accuracy_percentage, 0) >= 80).length,
    accuracySum,
    accuracy_sum: accuracySum,
    accuracy,
    activitiesCompleted,
    activities_completed: activitiesCompleted,
    wordsCompleted: asNumber(childProgress.word_count, asArray(childProgress.completed_words).length),
    words_completed: asNumber(childProgress.word_count, asArray(childProgress.completed_words).length),
    completedWords: asArray(childProgress.completed_words),
    completed_words: asArray(childProgress.completed_words),
    lessonsCompleted,
    lessons_completed: lessonsCompleted,
    baselineAccuracy: childProgress.baseline_accuracy ?? null,
    baseline_accuracy: childProgress.baseline_accuracy ?? null,
    dailyGoal: {
      target: DAILY_GOAL,
      completed: dailyCompleted,
      percentage: Math.round((dailyCompleted / DAILY_GOAL) * 100),
    },
    wordOfTheDay: {
      completed: false,
      completedAt: childProgress.last_practice_date || null,
    },
    badges,
    achievements: asArray(childProgress.achievements),
    recentActivity,
    recentActivities: recentActivity,
    notifications,
    lastActivityAt: toTimestamp(recentActivity[0]) || childProgress.last_practice_date || null,
    childProgress: {
      ...childProgress,
      total_attempts: totalAttempts,
      accuracy_sum: accuracySum,
      activities_completed: activitiesCompleted,
      badges,
    },
  };
}

module.exports = {
  DAILY_GOAL,
  getStudentStats,
};
