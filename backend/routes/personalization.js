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

const isMissingModuleFoundation = (error) => (
  error?.code === 'PGRST202'
  || /could not find (the )?function/i.test(String(error?.message || ''))
);

// Staged rollout: before migration 042 is applied (or before modules are
// activated), personalization safely remains on the legacy level frontier.
// Once configured=true, the RPC becomes the sole source of candidate scope.
const loadModuleScope = async (supabase, studentId, officialLevel = null) => {
  const pathResult = await supabase.rpc('get_student_module_path', { p_student_id: studentId });
  if (pathResult.error) {
    if (isMissingModuleFoundation(pathResult.error)) {
      return { data: { configured: false, currentModule: null, contentIds: [] }, error: null };
    }
    return { data: null, error: pathResult.error };
  }

  const path = pathResult.data || {};
  const currentModule = path.current_module || null;
  if (officialLevel && path.configured === true
      && String(path.effective_level || '').toLowerCase() !== String(officialLevel).toLowerCase()) {
    return { data: null, error: new Error('Module path level does not match official progression.') };
  }
  if (officialLevel && currentModule?.level
      && String(currentModule.level).toLowerCase() !== String(officialLevel).toLowerCase()) {
    return { data: null, error: new Error('Current module is outside the student official level.') };
  }
  if (path.configured !== true || !currentModule?.id) {
    // The module system can be globally active (path.configured === true)
    // while this particular student has no currentModule (not yet placed,
    // or between modules). That is not the same as "use module curriculum" -
    // report configured=false here so the caller falls back to the legacy
    // reading_content frontier instead of an empty module curriculum.
    return {
      data: { configured: false, currentModule, contentIds: [], curriculum: [] },
      error: null,
    };
  }

  const contentResult = await supabase.rpc('get_reading_module_content', {
    p_student_id: studentId,
    p_module_id: currentModule.id,
  });
  if (contentResult.error) return { data: null, error: contentResult.error };

  const items = Array.isArray(contentResult.data?.items) ? contentResult.data.items : [];
  const curriculum = items.map((item) => ({
    id: item.content_id,
    word_id: item.word_id || null,
    content_text: item.content_text,
    content_type: item.content_type,
    level: item.level,
    sequence_no: item.item_order,
    source_row: item.item_order,
    pattern_note: item.pattern_note || null,
    is_assessment: false,
    module_role: item.role,
  }));
  return {
    data: {
      configured: true,
      currentModule,
      contentIds: curriculum.filter((item) => item.module_role !== 'assessment').map((item) => item.id),
      curriculum,
    },
    error: null,
  };
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
      // Word of the Day remains a separate daily feature. Ordinary Practice is
      // module-scoped as soon as modules are activated; until then this helper
      // returns configured=false and preserves the existing frontier.
      const moduleScopeResult = purpose === 'practice'
        ? await loadModuleScope(supabase, studentId, officialProgression.effective_level || 'Beginner')
        : { data: { configured: false, currentModule: null, contentIds: [] }, error: null };
      if (moduleScopeResult.error) {
        console.error('[Personalization] module scope load failed:', moduleScopeResult.error.message || moduleScopeResult.error);
        return res.status(503).json({ success: false, message: 'Personalized recommendations are temporarily unavailable.' });
      }
      const moduleScope = moduleScopeResult.data;

      let curriculum;
      if (moduleScope.configured) {
        curriculum = moduleScope.curriculum || [];
      } else {
        const currentLevel = String(officialProgression.effective_level || 'Beginner');
        const canAdvance = currentLevel !== 'Advanced' && officialProgression.official_progression_eligible === true;
        const targetLevel = canAdvance
          ? ({ Beginner: 'Intermediate', Intermediate: 'Advanced' }[currentLevel] || currentLevel)
          : currentLevel;
        // Legacy compatibility path until the separate module activation and
        // progression-cutover migration is approved.
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
        curriculum = curriculumResult.data || [];
      }

      const result = rankCurriculum({
        sessions: sessionsResult.data || [],
        confusions: confusionsResult.data || [],
        contentAttempts: attemptsResult.data || [],
        completedContentIds: completionsResult.data || [],
        curriculum,
        officialProgression,
        moduleScope,
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
            candidate_policy: moduleScope.configured
              ? 'first_incomplete_item_inside_current_unlocked_module'
              : 'legacy_first_incomplete_item_per_required_content_track',
            sequence_authority: moduleScope.configured
              ? 'reading_module_items.item_order_then_content_id'
              : 'reading_content.sequence_no_then_source_row_then_id',
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
module.exports.loadModuleScope = loadModuleScope;
