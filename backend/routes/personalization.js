const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { rankCurriculum, STRATEGY_VERSION } = require('../services/coldStartRanker');
const { buildReadingProfile } = require('../services/readingInsights');

const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const loadCompletedContentIds = async (supabase, studentId) => {
  const contentIds = [];
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const result = await supabase
      .from('student_content_completions')
      .select('content_id')
      .eq('student_id', studentId)
      .range(start, start + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data || [];
    contentIds.push(...page.map((row) => row.content_id));
    if (page.length < pageSize) return { data: contentIds, error: null };
  }
};

const createPersonalizationRouter = (supabase = supabaseAdmin) => {
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
        console.error('[Personalization] student lookup failed:', childError.message || childError);
        return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
      }
      if (!child?.id) {
        return res.status(403).json({ success: false, message: 'Personalized practice is available only to student accounts.' });
      }
      req.authenticatedStudentId = child.id;
      return next();
    } catch (error) {
      console.error('[Personalization] authentication threw:', error.message || error);
      return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
    }
  };

  router.post('/recommend', requireAuthenticatedStudent, async (req, res) => {
    try {
      const studentId = req.authenticatedStudentId;
      const requestedLimit = Number(req.body?.limit);
      const purpose = req.body?.purpose === 'word_of_day' ? 'word_of_day' : 'practice';
      // Lets the Practice tab ask for just one track (e.g. after a Learn tab
      // category card) without exposing the rest of the level's curriculum.
      // Still safely intersected against PRACTICE_TYPES_BY_LEVEL[level] inside
      // rankCurriculum, so an invalid/unauthorized type can't slip through.
      const requestedContentType = typeof req.body?.contentType === 'string' ? req.body.contentType.trim() : '';
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 24)
        : 10;

      const [sessionsResult, confusionsResult, attemptsResult, completionsResult, progressionResult] = await Promise.all([
        supabase
          .from('pronunciation_practice_sessions')
          .select('id,student_id,word_id,word,accuracy_percentage,is_correct,duration_seconds,difficulty_level_at_attempt,practice_source,created_at')
          .eq('student_id', studentId)
          .order('created_at', { ascending: true })
          .limit(500),
        supabase
          .from('phoneme_confusion')
          .select('id,student_id,session_id,confusion_key,target_word,source,created_at')
          .eq('student_id', studentId)
          .order('created_at', { ascending: true })
          .limit(1000),
        supabase
          .from('student_content_attempts')
          .select('id,student_id,content_id,accuracy,is_full_submission,source,created_at')
          .eq('student_id', studentId)
          .order('created_at', { ascending: true })
          .limit(1000),
        loadCompletedContentIds(supabase, studentId),
        supabase.rpc('get_student_reading_progress', { p_student_id: studentId }),
      ]);

      const readError = sessionsResult.error || confusionsResult.error || attemptsResult.error
        || completionsResult.error || progressionResult.error;
      if (readError) {
        console.error('[Personalization] feature data load failed:', readError.message || readError);
        return res.status(503).json({ success: false, message: 'Personalized recommendations are temporarily unavailable.' });
      }

      const officialProgression = progressionResult.data || {};
      const currentLevel = String(officialProgression.effective_level || 'Beginner');
      const canAdvance = currentLevel !== 'Advanced' && officialProgression.official_progression_eligible === true;
      const targetLevel = canAdvance
        ? ({ Beginner: 'Intermediate', Intermediate: 'Advanced' }[currentLevel] || currentLevel)
        : currentLevel;
      // A level contains at most 400 rankable items (200 words + 200 companion
      // activities), so this query stays below the project 1,000-row cap.
      const curriculumResult = await supabase
        .from('reading_content')
        .select('id,word_id,content_text,content_type,level,sequence_no,source_row,pattern_note,is_assessment')
        .eq('level', targetLevel)
        .eq('is_active', true)
        .neq('content_type', 'paragraph')
        .order('sequence_no', { ascending: true });
      if (curriculumResult.error) {
        console.error('[Personalization] curriculum load failed:', curriculumResult.error.message || curriculumResult.error);
        return res.status(503).json({ success: false, message: 'Personalized recommendations are temporarily unavailable.' });
      }

      const result = rankCurriculum({
        sessions: sessionsResult.data || [],
        confusions: confusionsResult.data || [],
        contentAttempts: attemptsResult.data || [],
        completedContentIds: completionsResult.data || [],
        curriculum: curriculumResult.data || [],
        officialProgression,
        limit,
        allowedContentTypes: purpose === 'word_of_day'
          ? ['word']
          : requestedContentType
            ? [requestedContentType]
            : null,
      });
      if (!result.items.length) {
        return res.status(503).json({ success: false, message: 'No personalized curriculum practice is available yet.' });
      }

      const { data: recommendation, error: recommendationError } = await supabase
        .from('personalization_recommendations')
        .insert({
          student_id: studentId,
          // Sequence order is the binding constraint (see coldStartRanker.js's
          // buildTrackFrontier); weakness/mastery/recency/structural_fit only
          // tie-break between simultaneously-requested tracks, they never
          // reorder within a track. 'weakness_based_cold_start' overstated
          // the ranker's actual effect - renamed for accuracy.
          recommendation_strategy: 'sequence_frontier_with_weakness_tiebreak',
          model_version: STRATEGY_VERSION,
          feature_schema_version: result.featureSchemaVersion,
          current_difficulty: result.currentDifficulty,
          recommended_difficulty: result.recommendedDifficulty,
          predicted_probability: null,
          should_advance: result.shouldAdvance,
          feature_snapshot: result.readiness,
          rationale: {
            weights: result.weights,
            weight_origin: 'manually_selected_domain_reasoning_not_empirically_tuned',
            primary_priority: 'weakness_targeting',
            candidate_policy: 'first_incomplete_item_per_required_content_track',
            sequence_authority: 'reading_content.sequence_no_then_source_row_then_id',
            limitation: 'Tune and validate weights only after sufficient real recommendation outcomes accumulate.',
            purpose,
          },
        })
        .select('id,created_at')
        .single();
      if (recommendationError || !recommendation?.id) {
        console.error('[Personalization] recommendation log failed:', recommendationError?.message || recommendationError);
        return res.status(503).json({ success: false, message: 'Unable to record the personalized recommendation.' });
      }

      const recommendationWords = result.items.map((item) => ({
        recommendation_id: recommendation.id,
        content_id: item.contentId,
        word_id: item.wordId,
        rank: item.rank,
        ranking_score: item.rankingScore,
        reason_codes: {
          codes: item.reasonCodes,
          content_type: item.contentType,
          component_scores: item.componentScores,
          matched_confusion_pairs: item.matchedConfusionPairs,
          prior_attempt_count: item.priorAttemptCount,
          prior_average_accuracy: item.priorAverageAccuracy,
          days_since_practiced: item.daysSincePracticed,
          structural_load: item.structuralLoad,
        },
      }));
      const { error: wordsLogError } = await supabase
        .from('personalization_recommendation_words')
        .insert(recommendationWords);
      if (wordsLogError) {
        console.error('[Personalization] ranked-word log failed:', wordsLogError.message || wordsLogError);
        return res.status(503).json({ success: false, message: 'Unable to record the ranked practice words.' });
      }

      return res.json({
        success: true,
        recommendation: {
          id: recommendation.id,
          createdAt: recommendation.created_at,
          ...result,
          purpose,
          readingProfile: buildReadingProfile({
            sessions: sessionsResult.data || [],
            confusions: confusionsResult.data || [],
            completions: (completionsResult.data || []).map((content_id) => ({ content_id })),
          }),
        },
      });
    } catch (error) {
      console.error('[Personalization] recommendation threw:', error.message || error);
      return res.status(500).json({ success: false, message: 'Unable to build personalized recommendations.' });
    }
  });

  router.get('/profile', async (req, res) => {
    try {
      const token = bearerTokenFrom(req.headers.authorization);
      if (!token) return res.status(401).json({ success: false, message: 'Authentication is required.' });
      const { data: auth, error: authError } = await supabase.auth.getUser(token);
      if (authError || !auth?.user?.id) {
        return res.status(401).json({ success: false, message: 'Your sign-in session is invalid or expired.' });
      }

      const requestedStudentId = String(req.query?.studentId || '').trim();
      let childQuery = supabase.from('children').select('id,auth_uid,parent_id,name');
      childQuery = requestedStudentId
        ? childQuery.eq('id', requestedStudentId)
        : childQuery.eq('auth_uid', auth.user.id);
      const { data: child, error: childError } = await childQuery.maybeSingle();
      if (childError) throw childError;
      const canView = !!child && (
        String(child.auth_uid) === String(auth.user.id) || String(child.parent_id) === String(auth.user.id)
      );
      if (!child || !canView) {
        return res.status(403).json({ success: false, message: 'You cannot view this reading profile.' });
      }

      const [sessionsResult, confusionsResult, completionsResult] = await Promise.all([
        supabase.from('pronunciation_practice_sessions')
          .select('id,word,spoken_text,accuracy_percentage,is_correct,duration_seconds,practice_source,created_at')
          .eq('student_id', child.id).order('created_at', { ascending: true }).limit(500),
        supabase.from('phoneme_confusion')
          .select('confusion_key,target_word,source,created_at')
          .eq('student_id', child.id).order('created_at', { ascending: true }).limit(1000),
        loadCompletedContentIds(supabase, child.id),
      ]);
      const readError = sessionsResult.error || confusionsResult.error || completionsResult.error;
      if (readError) throw readError;
      return res.json({
        success: true,
        student: { id: child.id, name: child.name || 'Student' },
        profile: buildReadingProfile({
          sessions: sessionsResult.data || [],
          confusions: confusionsResult.data || [],
          completions: (completionsResult.data || []).map((content_id) => ({ content_id })),
        }),
      });
    } catch (error) {
      console.error('[Personalization] profile failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Unable to build the reading profile.' });
    }
  });

  return router;
};

module.exports = createPersonalizationRouter();
module.exports.createPersonalizationRouter = createPersonalizationRouter;
