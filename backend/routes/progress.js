const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const asArray = (value) => (Array.isArray(value) ? value : []);
const asNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const asDateKey = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};
const isMissingColumnError = (error) =>
  error?.code === 'PGRST204' ||
  error?.code === '42703' ||
  String(error?.message || '').toLowerCase().includes('could not find') ||
  String(error?.message || '').toLowerCase().includes('schema cache');
const serializeSupabaseError = (error) => ({
  code: error?.code,
  message: error?.message || String(error),
  details: error?.details,
  hint: error?.hint,
  status: error?.status,
});

// Achievements are merge-only, never overwritten: a client can only ever
// race with itself here (each student writes just their own row), but two
// nearly-simultaneous saves built from slightly stale React state have
// caused already-persisted badges to get silently dropped from the array
// (bug: "unlocked badges don't persist" + "celebration re-triggers").
// Unioning with whatever is already in the DB - instead of trusting the
// client's array as the full truth - makes the achievements list
// monotonically growing regardless of request ordering, and lets us tell
// the client exactly which ids are genuinely new-to-storage this call, so
// the celebration modal only ever fires once per badge.
const mergeAchievements = (existing, incoming) => {
  const existingIds = new Set(existing.map((a) => a?.id).filter(Boolean));
  const newlyPersisted = incoming.filter((a) => a?.id && !existingIds.has(a.id));
  return {
    merged: [...existing, ...newlyPersisted],
    newlyPersistedIds: newlyPersisted.map((a) => a.id),
  };
};

router.post('/update', async (req, res) => {
  try {
    console.log('[progress] Progress update request:', req.body);
    console.log('[progress] Auth user:', {
      authorization: req.headers.authorization ? 'present' : 'missing',
      userIdHeader: req.headers['x-user-id'] || null,
    });

    const {
      childId,
      studentId,
      student_id,
      xp,
      streak,
      longestStreak,
      longest_streak,
      lastPracticeDate,
      last_practice_date,
      completedWords,
      completed_words,
      wordCount,
      word_count,
      achievements,
      level,
      totalAttempts,
      total_attempts,
      badges,
      baselineAccuracy,
      baseline_accuracy,
      accuracySum,
      accuracy_sum,
      activitiesCompleted,
      activities_completed,
    } = req.body || {};

    const progressStudentId = childId || studentId || student_id;
    if (!progressStudentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'student_id or childId is required',
      });
    }

    const normalizedCompletedWords = asArray(completedWords || completed_words);
    const normalizedWordCount = asNumber(wordCount ?? word_count, normalizedCompletedWords.length);
    const normalizedXp = asNumber(xp, 0);
    const normalizedStreak = asNumber(streak, 0);
    const normalizedLongestStreak = Math.max(asNumber(longestStreak ?? longest_streak, 0), normalizedStreak);
    const normalizedTotalAttempts = asNumber(totalAttempts ?? total_attempts, 0);
    const normalizedLastPracticeDate = asDateKey(lastPracticeDate || last_practice_date);
    const rawBaselineAccuracy = baselineAccuracy ?? baseline_accuracy;
    const normalizedBaselineAccuracy =
      rawBaselineAccuracy === null || rawBaselineAccuracy === undefined ? null : asNumber(rawBaselineAccuracy, null);
    const normalizedAccuracySum = asNumber(accuracySum ?? accuracy_sum, 0);
    const normalizedActivitiesCompleted = asNumber(activitiesCompleted ?? activities_completed, 0);

    const { data: existingRow, error: existingRowError } = await supabaseAdmin
      .from('child_progress')
      .select('achievements')
      .eq('child_id', progressStudentId)
      .maybeSingle();
    if (existingRowError) {
      console.warn('[progress] could not read existing achievements before merge (proceeding with client array as-is):', serializeSupabaseError(existingRowError));
    }
    const existingAchievements = asArray(existingRow?.achievements);
    const { merged: mergedAchievements, newlyPersistedIds } = mergeAchievements(existingAchievements, asArray(achievements));

    const payload = {
      child_id: progressStudentId,
      xp: normalizedXp,
      streak: normalizedStreak,
      longest_streak: normalizedLongestStreak,
      last_practice_date: normalizedLastPracticeDate,
      completed_words: normalizedCompletedWords,
      word_count: normalizedWordCount,
      achievements: mergedAchievements,
      badges: asArray(badges),
      total_attempts: normalizedTotalAttempts,
      level: ['Beginner', 'Intermediate', 'Advanced'].includes(level) ? level : 'Beginner',
      baseline_accuracy: normalizedBaselineAccuracy,
      accuracy_sum: normalizedAccuracySum,
      activities_completed: normalizedActivitiesCompleted,
      updated_at: new Date().toISOString(),
    };

    console.log('[progress] Normalized progress payload:', payload);

    let { data, error } = await supabaseAdmin
      .from('child_progress')
      .upsert(payload, { onConflict: 'child_id' })
      .select()
      .single();

    const optionalColumns = ['word_count', 'baseline_accuracy', 'accuracy_sum', 'activities_completed', 'longest_streak'];
    let fallbackPayload = payload;
    while (error && isMissingColumnError(error)) {
      const message = String(error.message || '').toLowerCase();
      const missingColumn = optionalColumns.find((column) => column in fallbackPayload && message.includes(column));
      if (!missingColumn) break;

      console.warn(`[progress] ${missingColumn} column unavailable; retrying without optional column:`, serializeSupabaseError(error));
      fallbackPayload = { ...fallbackPayload };
      delete fallbackPayload[missingColumn];
      const fallback = await supabaseAdmin
        .from('child_progress')
        .upsert(fallbackPayload, { onConflict: 'child_id' })
        .select()
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('[progress] Supabase upsert failed:', serializeSupabaseError(error));
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to update progress',
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
    }

    return res.json({ success: true, progress: data, newlyPersistedAchievementIds: newlyPersistedIds });
  } catch (error) {
    console.error('[progress] update failed:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update progress',
      message: error?.message || 'Failed to update progress',
    });
  }
});

module.exports = router;
