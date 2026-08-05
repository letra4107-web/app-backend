const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

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
  error?.code === 'PGRST204'
  || error?.code === '42703'
  || String(error?.message || '').toLowerCase().includes('could not find')
  || String(error?.message || '').toLowerCase().includes('schema cache');
const serializeSupabaseError = (error) => ({
  code: error?.code,
  message: error?.message || String(error),
  details: error?.details,
  hint: error?.hint,
  status: error?.status,
});
const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const mergeAchievements = (existing, incoming) => {
  const existingIds = new Set(existing.map((achievement) => achievement?.id).filter(Boolean));
  const newlyPersisted = incoming.filter((achievement) => achievement?.id && !existingIds.has(achievement.id));
  return {
    merged: [...existing, ...newlyPersisted],
    newlyPersistedIds: newlyPersisted.map((achievement) => achievement.id),
  };
};

const createProgressRouter = (supabase = supabaseAdmin) => {
  const router = express.Router();

  const requireAuthenticatedStudent = async (req, res, next) => {
    try {
      const token = bearerTokenFrom(req.headers.authorization);
      if (!token) return res.status(401).json({ success: false, message: 'Authentication is required.' });
      const { data: auth, error: authError } = await supabase.auth.getUser(token);
      if (authError || !auth?.user?.id) {
        return res.status(401).json({ success: false, message: 'Your sign-in session is invalid or expired.' });
      }
      const { data: child, error: childError } = await supabase
        .from('children')
        .select('id')
        .eq('auth_uid', auth.user.id)
        .maybeSingle();
      if (childError) {
        console.error('[progress] authenticated student lookup failed:', serializeSupabaseError(childError));
        return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
      }
      if (!child?.id) {
        return res.status(403).json({ success: false, message: 'This endpoint is available only to student accounts.' });
      }
      req.authenticatedStudentId = child.id;
      return next();
    } catch (error) {
      console.error('[progress] authentication check threw:', error?.message || error);
      return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
    }
  };

  router.post('/update', requireAuthenticatedStudent, async (req, res) => {
    try {
      const progressStudentId = req.authenticatedStudentId;
      const {
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

      // childId/studentId/student_id and level are intentionally not read.
      // Identity comes only from the verified Bearer token; reading level is
      // owned by record_student_content_attempt's official progression logic.
      const normalizedCompletedWords = asArray(completedWords || completed_words);
      const normalizedWordCount = asNumber(wordCount ?? word_count, normalizedCompletedWords.length);
      const normalizedXp = asNumber(xp, 0);
      const normalizedStreak = asNumber(streak, 0);
      const normalizedLongestStreak = Math.max(asNumber(longestStreak ?? longest_streak, 0), normalizedStreak);
      const normalizedTotalAttempts = asNumber(totalAttempts ?? total_attempts, 0);
      const normalizedLastPracticeDate = asDateKey(lastPracticeDate || last_practice_date);
      const rawBaselineAccuracy = baselineAccuracy ?? baseline_accuracy;
      const normalizedBaselineAccuracy = rawBaselineAccuracy == null ? null : asNumber(rawBaselineAccuracy, null);
      const normalizedAccuracySum = asNumber(accuracySum ?? accuracy_sum, 0);
      const normalizedActivitiesCompleted = asNumber(activitiesCompleted ?? activities_completed, 0);

      const { data: existingRow, error: existingRowError } = await supabase
        .from('child_progress')
        .select('achievements,level')
        .eq('child_id', progressStudentId)
        .maybeSingle();
      if (existingRowError) {
        console.error('[progress] existing progress read failed:', serializeSupabaseError(existingRowError));
        return res.status(500).json({ success: false, message: 'Unable to load current progress safely.' });
      }
      const existingAchievements = asArray(existingRow?.achievements);
      const { merged: mergedAchievements, newlyPersistedIds } = mergeAchievements(
        existingAchievements,
        asArray(achievements),
      );

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
        level: existingRow?.level || 'Beginner',
        baseline_accuracy: normalizedBaselineAccuracy,
        accuracy_sum: normalizedAccuracySum,
        activities_completed: normalizedActivitiesCompleted,
        updated_at: new Date().toISOString(),
      };

      let { data, error } = await supabase
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
        fallbackPayload = { ...fallbackPayload };
        delete fallbackPayload[missingColumn];
        const fallback = await supabase
          .from('child_progress')
          .upsert(fallbackPayload, { onConflict: 'child_id' })
          .select()
          .single();
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        console.error('[progress] Supabase upsert failed:', serializeSupabaseError(error));
        return res.status(500).json({ success: false, message: 'Failed to update reward progress.' });
      }
      return res.json({ success: true, progress: data, newlyPersistedAchievementIds: newlyPersistedIds });
    } catch (error) {
      console.error('[progress] update failed:', error);
      return res.status(500).json({ success: false, message: error?.message || 'Failed to update progress.' });
    }
  });

  router.post('/content-attempt', requireAuthenticatedStudent, async (req, res) => {
    try {
      const contentId = String(req.body?.contentId || req.body?.content_id || '').trim();
      const accuracy = Number(req.body?.accuracy);
      const durationValue = req.body?.durationSeconds ?? req.body?.duration_seconds;
      const durationSeconds = durationValue == null ? null : Number(durationValue);
      const source = String(req.body?.source || 'practice').trim();
      const allowedSources = ['practice', 'assessment', 'diagnostic', 'lesson', 'recommendation', 'import'];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contentId)) {
        return res.status(400).json({ success: false, message: 'A valid contentId is required.' });
      }
      if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
        return res.status(400).json({ success: false, message: 'accuracy must be between 0 and 100.' });
      }
      if (durationSeconds != null && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
        return res.status(400).json({ success: false, message: 'durationSeconds cannot be negative.' });
      }
      if (!allowedSources.includes(source)) {
        return res.status(400).json({ success: false, message: 'Unsupported attempt source.' });
      }

      const { data, error } = await supabase.rpc('record_student_content_attempt', {
        p_student_id: req.authenticatedStudentId,
        p_content_id: contentId,
        p_accuracy: accuracy,
        p_transcript: req.body?.transcript == null ? null : String(req.body.transcript).slice(0, 10000),
        p_duration_seconds: durationSeconds == null ? null : Math.trunc(durationSeconds),
        p_is_full_submission: req.body?.isFullSubmission === true || req.body?.is_full_submission === true,
        p_source: source,
      });
      if (error) {
        console.error('[progress] transactional content attempt failed:', serializeSupabaseError(error));
        const status = error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 500;
        return res.status(status).json({ success: false, message: error.message || 'Unable to record content attempt.' });
      }
      return res.json({ success: true, result: data });
    } catch (error) {
      console.error('[progress] content attempt threw:', error?.message || error);
      return res.status(500).json({ success: false, message: 'Unable to record content attempt.' });
    }
  });

  router.get('/reading-status', requireAuthenticatedStudent, async (req, res) => {
    try {
      const { data, error } = await supabase.rpc('get_student_reading_progress', {
        p_student_id: req.authenticatedStudentId,
      });
      if (error) {
        console.error('[progress] reading status failed:', serializeSupabaseError(error));
        return res.status(500).json({ success: false, message: 'Unable to load official reading progress.' });
      }
      return res.json({ success: true, progression: data });
    } catch (error) {
      console.error('[progress] reading status threw:', error?.message || error);
      return res.status(500).json({ success: false, message: 'Unable to load official reading progress.' });
    }
  });

  return router;
};

module.exports = createProgressRouter();
module.exports.createProgressRouter = createProgressRouter;
module.exports.mergeAchievements = mergeAchievements;
