const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { rankWords, STRATEGY_VERSION } = require('../services/coldStartRanker');

const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
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
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 24)
        : 10;

      const [sessionsResult, confusionsResult, progressResult, wordsResult] = await Promise.all([
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
          .from('child_progress')
          .select('level')
          .eq('child_id', studentId)
          .maybeSingle(),
        supabase
          .from('words')
          .select('id,word,level,syllable_count,has_diphthong,has_consonant_cluster'),
      ]);

      const readError = sessionsResult.error || confusionsResult.error || progressResult.error || wordsResult.error;
      if (readError) {
        console.error('[Personalization] feature data load failed:', readError.message || readError);
        return res.status(503).json({ success: false, message: 'Personalized recommendations are temporarily unavailable.' });
      }

      const result = rankWords({
        sessions: sessionsResult.data || [],
        confusions: confusionsResult.data || [],
        words: wordsResult.data || [],
        progressLevel: progressResult.data?.level || 'Beginner',
        limit,
      });
      if (!result.words.length) {
        return res.status(503).json({ success: false, message: 'No personalized practice words are available yet.' });
      }

      const { data: recommendation, error: recommendationError } = await supabase
        .from('personalization_recommendations')
        .insert({
          student_id: studentId,
          recommendation_strategy: 'weakness_based_cold_start',
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
            limitation: 'Tune and validate weights only after sufficient real recommendation outcomes accumulate.',
          },
        })
        .select('id,created_at')
        .single();
      if (recommendationError || !recommendation?.id) {
        console.error('[Personalization] recommendation log failed:', recommendationError?.message || recommendationError);
        return res.status(503).json({ success: false, message: 'Unable to record the personalized recommendation.' });
      }

      const recommendationWords = result.words.map((word) => ({
        recommendation_id: recommendation.id,
        word_id: word.id,
        rank: word.rank,
        ranking_score: word.rankingScore,
        reason_codes: {
          codes: word.reasonCodes,
          component_scores: word.componentScores,
          matched_confusion_pairs: word.matchedConfusionPairs,
          prior_attempt_count: word.priorAttemptCount,
          prior_average_accuracy: word.priorAverageAccuracy,
          days_since_practiced: word.daysSincePracticed,
          structural_load: word.structuralLoad,
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
        },
      });
    } catch (error) {
      console.error('[Personalization] recommendation threw:', error.message || error);
      return res.status(500).json({ success: false, message: 'Unable to build personalized recommendations.' });
    }
  });

  return router;
};

module.exports = createPersonalizationRouter();
module.exports.createPersonalizationRouter = createPersonalizationRouter;
