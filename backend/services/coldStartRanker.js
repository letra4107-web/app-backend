const LEVELS = ['beginner', 'intermediate', 'advanced'];
const PRACTICE_TYPES_BY_LEVEL = Object.freeze({
  beginner: ['word', 'phonetic'],
  intermediate: ['word', 'phrase'],
  advanced: ['word', 'sentence'],
});
const CONFUSION_PAIRS = ['d-r', 'b-p', 'd-t', 'g-k', 'n-ng', 'm-n', 'l-r', 's-ts', 'e-i', 'o-u', 'a-o'];
const STRATEGY_VERSION = 'cold-start-ranker-v4-module-frontier';
const FEATURE_SCHEMA_VERSION = 'readiness-v3-module-scope';
const OUTCOME_WINDOW_DAYS = 30;

// DESIGN LIMITATION: these weights were manually chosen from domain reasoning
// to prioritize weakness-targeting. They were not learned, tuned, or validated
// against student outcome data. Once personalization_recommendation_outcomes
// contains enough multi-student labels, future work should tune and validate
// them while retaining this version for reproducibility.
const RANKING_WEIGHTS = Object.freeze({
  weakness_match: 0.45,
  mastery_gap: 0.25,
  recency_need: 0.20,
  structural_fit: 0.10,
});

const sortableNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Number.MAX_SAFE_INTEGER;
};
const compareCurriculumOrder = (left, right) => (
  sortableNumber(left.sequence_no) - sortableNumber(right.sequence_no)
  || sortableNumber(left.source_row) - sortableNumber(right.source_row)
  || String(left.id).localeCompare(String(right.id))
);

const buildTrackFrontier = (curriculum, completedContentIds, allowedTypes) => {
  const completed = new Set(Array.from(completedContentIds || [], String));
  return allowedTypes.flatMap((contentType) => {
    const firstIncomplete = curriculum
      .filter((item) => item.content_type === contentType && !completed.has(String(item.id)))
      .sort(compareCurriculumOrder)[0];
    return firstIncomplete ? [firstIncomplete] : [];
  });
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const asDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const normalizeText = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
const dateKeyManila = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const daysBetweenManila = (earlier, later) => {
  const start = new Date(`${dateKeyManila(earlier)}T00:00:00+08:00`);
  const end = new Date(`${dateKeyManila(later)}T00:00:00+08:00`);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
};

const accuracySlope = (values) => {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const denominator = values.reduce((sum, _value, index) => sum + ((index - xMean) ** 2), 0);
  if (!denominator) return 0;
  return values.reduce((sum, value, index) => sum + ((index - xMean) * (value - yMean)), 0) / denominator;
};

const currentStreak = (sessions, now) => {
  const dates = Array.from(new Set(sessions.map((row) => asDate(row.created_at)).filter(Boolean).map(dateKeyManila))).sort();
  if (!dates.length) return 0;
  const last = new Date(`${dates.at(-1)}T00:00:00+08:00`);
  if (daysBetweenManila(last, now) > 1) return 0;
  let streak = 1;
  for (let index = dates.length - 1; index > 0; index -= 1) {
    const current = new Date(`${dates[index]}T00:00:00+08:00`);
    const previous = new Date(`${dates[index - 1]}T00:00:00+08:00`);
    if (Math.round((current - previous) / 86400000) !== 1) break;
    streak += 1;
  }
  return streak;
};

const textPhonemes = (text) => {
  const normalized = normalizeText(text).replace(/\s/g, '').replace(/gui/g, 'gi').replace(/gue/g, 'ge');
  const phonemes = [];
  for (let index = 0; index < normalized.length;) {
    const digraph = ['ng', 'ts', 'ny'].find((value) => normalized.startsWith(value, index));
    if (digraph) {
      phonemes.push(digraph);
      index += digraph.length;
    } else {
      phonemes.push(normalized[index]);
      index += 1;
    }
  }
  return phonemes;
};

const pairExposure = (text) => {
  const counts = textPhonemes(text).reduce((map, phoneme) => ({ ...map, [phoneme]: (map[phoneme] || 0) + 1 }), {});
  return Object.fromEntries(CONFUSION_PAIRS.map((pair) => {
    const [left, right] = pair.split('-');
    return [pair, (counts[left] || 0) + (counts[right] || 0)];
  }));
};

const structuralLoad = (item) => {
  const typeBase = {
    phonetic: 0.15, word: 0.30, phrase: 0.50, sentence: 0.72, paragraph: 0.82, story: 0.86,
  }[item.content_type] || 0.5;
  const textLengthLoad = clamp(normalizeText(item.content_text).replace(/\s/g, '').length / 80) * 0.20;
  return clamp(typeBase + textLengthLoad);
};

const nextLevel = (level) => LEVELS[LEVELS.indexOf(level) + 1] || level;

const rankCurriculum = ({
  sessions = [], confusions = [], contentAttempts = [], curriculum = [],
  completedContentIds = [], officialProgression = {}, now = new Date(), limit = 10,
  allowedContentTypes = null, moduleScope = null,
}) => {
  const orderedSessions = [...sessions].filter((row) => asDate(row.created_at))
    .sort((left, right) => asDate(left.created_at) - asDate(right.created_at));
  const recentFive = orderedSessions.slice(-5);
  const accuracies = recentFive.map((row) => asNumber(row.accuracy_percentage)).filter((value) => value !== null);
  const averageAccuracy = accuracies.length ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length : null;
  const successRate = recentFive.length ? recentFive.filter((row) => row.is_correct === true).length / recentFive.length : null;
  const trend = accuracySlope(accuracies);

  const moduleMode = moduleScope?.configured === true;
  const activeModule = moduleMode ? moduleScope?.currentModule || null : null;
  const officialLevel = String(officialProgression.effective_level || 'Beginner').toLowerCase();
  const moduleLevel = String(activeModule?.level || '').toLowerCase();
  // Defense in depth: RPCs already enforce this boundary, but the pure ranker
  // also refuses a mismatched module scope so a malformed caller/test fixture
  // cannot convert an off-level module into recommendation candidates.
  const isolatedModuleMode = moduleMode && !!activeModule && moduleLevel === officialLevel;
  const currentDifficultyRaw = String(
    isolatedModuleMode ? activeModule.level : officialProgression.effective_level || 'Beginner',
  ).toLowerCase();
  const currentDifficulty = LEVELS.includes(currentDifficultyRaw) ? currentDifficultyRaw : 'beginner';
  const officialProgressionEligible = officialProgression.official_progression_eligible === true;
  // Module advancement is owned by passed module assessments. The ranker is
  // never allowed to infer or perform a level transition while modules are
  // configured, even if the retained legacy count snapshot says eligible.
  const shouldAdvance = !isolatedModuleMode && officialProgressionEligible && currentDifficulty !== 'advanced';
  const recommendedDifficulty = shouldAdvance ? nextLevel(currentDifficulty) : currentDifficulty;

  const windowStart = now.getTime() - (OUTCOME_WINDOW_DAYS * 86400000);
  const windowSessions = orderedSessions.filter((row) => asDate(row.created_at).getTime() >= windowStart);
  const recentConfusions = confusions.filter((row) => {
    const created = asDate(row.created_at);
    return created && created.getTime() >= windowStart && created <= now;
  });
  const denominator = Math.max(windowSessions.length, 1);
  const confusionCounts = recentConfusions.reduce((counts, row) => {
    const pair = String(row.confusion_key || '');
    counts[pair] = (counts[pair] || 0) + 1;
    return counts;
  }, {});
  const confusionRates = Object.fromEntries(CONFUSION_PAIRS.map((pair) => [pair, (confusionCounts[pair] || 0) / denominator]));

  const levelTypes = isolatedModuleMode
    ? (activeModule?.instructional_content_type ? [activeModule.instructional_content_type] : [])
    : PRACTICE_TYPES_BY_LEVEL[recommendedDifficulty];
  const requestedTypes = Array.isArray(allowedContentTypes) ? allowedContentTypes : levelTypes;
  const allowedTypes = levelTypes.filter((contentType) => requestedTypes.includes(contentType));
  const moduleContentIds = new Set(isolatedModuleMode ? (moduleScope?.contentIds || []).map(String) : []);
  const eligibleCurriculum = curriculum.filter((item) => (
    String(item.level || '').toLowerCase() === recommendedDifficulty
    && allowedTypes.includes(item.content_type)
    && (!isolatedModuleMode || moduleContentIds.has(String(item.id)))
    && (!isolatedModuleMode || item.module_role !== 'assessment')
    && (isolatedModuleMode || (item.content_type !== 'paragraph' && item.is_assessment !== true))
  ));
  // The active module's item_order is binding in module mode. During staged
  // rollout, the legacy path retains workbook order inside each content track.
  // Personalization may tie-break only among valid frontier items and can
  // never move a later item ahead of an earlier incomplete item.
  const candidatePool = buildTrackFrontier(eligibleCurriculum, completedContentIds, allowedTypes);
  const baseStructuralLoad = { beginner: 0.35, intermediate: 0.55, advanced: 0.75 }[recommendedDifficulty];
  // Difficulty adapts only inside the authorized frontier. It never changes
  // the official level or unlocks a later item in a content track.
  const targetStructuralLoad = clamp(baseStructuralLoad + (
    averageAccuracy !== null && averageAccuracy >= 90 ? 0.12
      : averageAccuracy !== null && averageAccuracy < 75 ? -0.12
        : 0
  ));
  const rawCandidates = candidatePool.map((item) => {
    let attempts = contentAttempts.filter((attempt) => String(attempt.content_id) === String(item.id));
    if (!attempts.length && item.word_id) {
      attempts = orderedSessions.filter((session) => String(session.word_id || '') === String(item.word_id))
        .map((session) => ({ accuracy: session.accuracy_percentage, created_at: session.created_at }));
    }
    const priorAccuracies = attempts.map((row) => asNumber(row.accuracy ?? row.accuracy_percentage)).filter((value) => value !== null);
    const priorAverage = priorAccuracies.length
      ? priorAccuracies.reduce((sum, value) => sum + value, 0) / priorAccuracies.length
      : null;
    const lastPracticed = attempts.map((row) => asDate(row.created_at)).filter(Boolean).sort((a, b) => b - a)[0] || null;
    const exposures = pairExposure(item.content_text);
    const matchedPairs = CONFUSION_PAIRS.filter((pair) => exposures[pair] > 0 && confusionRates[pair] > 0);
    const weaknessRaw = CONFUSION_PAIRS.reduce(
      (sum, pair) => sum + (confusionRates[pair] * Math.min(exposures[pair], 2)), 0,
    );
    return {
      item, attempts: attempts.length, priorAverage, lastPracticed, matchedPairs, weaknessRaw,
      masteryGap: priorAverage === null ? 0.50 : clamp(1 - (priorAverage / 100)),
      recencyNeed: lastPracticed ? clamp(daysBetweenManila(lastPracticed, now) / 14) : 1,
      structuralLoad: structuralLoad(item),
    };
  });
  const maxWeakness = Math.max(0, ...rawCandidates.map((candidate) => candidate.weaknessRaw));
  const rankedItems = rawCandidates.map((candidate) => {
    const weaknessMatch = maxWeakness ? candidate.weaknessRaw / maxWeakness : 0;
    const fit = clamp(1 - Math.abs(candidate.structuralLoad - targetStructuralLoad));
    const componentScores = {
      weakness_match: round(weaknessMatch), mastery_gap: round(candidate.masteryGap),
      recency_need: round(candidate.recencyNeed), structural_fit: round(fit),
    };
    const rankingScore = round(Object.entries(RANKING_WEIGHTS).reduce(
      (sum, [key, weight]) => sum + (componentScores[key] * weight), 0,
    ));
    const reasonCodes = [];
    if (candidate.matchedPairs.length) reasonCodes.push('targets_confusion_pair');
    if (candidate.priorAverage !== null && candidate.priorAverage < 75) reasonCodes.push('low_prior_accuracy');
    if (candidate.lastPracticed && daysBetweenManila(candidate.lastPracticed, now) >= 14) reasonCodes.push('not_practiced_recently');
    if (!candidate.attempts) reasonCodes.push(candidate.item.content_type === 'word' ? 'unseen_diagnostic_word' : 'unseen_curriculum_item');
    if (fit >= 0.80) reasonCodes.push('appropriate_structural_load');
    const primaryReason = candidate.matchedPairs.length
      ? `Contains a sound connected to recent ${candidate.matchedPairs[0].toUpperCase()} confusion.`
      : candidate.priorAverage !== null && candidate.priorAverage < 75
        ? `Targets content with ${round(candidate.priorAverage)}% prior accuracy.`
        : candidate.lastPracticed
          ? `Current curriculum frontier; last practiced ${daysBetweenManila(candidate.lastPracticed, now)} days ago.`
          : 'Current unlocked curriculum frontier and not previously practiced.';
    return {
      id: candidate.item.id,
      contentId: candidate.item.id,
      wordId: candidate.item.word_id || null,
      contentText: candidate.item.content_text,
      word: candidate.item.content_text,
      contentType: candidate.item.content_type,
      level: recommendedDifficulty,
      rankingScore,
      componentScores,
      reasonCodes,
      recommendationReason: primaryReason,
      matchedConfusionPairs: candidate.matchedPairs,
      priorAttemptCount: candidate.attempts,
      priorAverageAccuracy: candidate.priorAverage === null ? null : round(candidate.priorAverage),
      daysSincePracticed: candidate.lastPracticed ? daysBetweenManila(candidate.lastPracticed, now) : null,
      structuralLoad: round(candidate.structuralLoad),
    };
  }).sort((left, right) => (
    right.rankingScore - left.rankingScore
    || Number(right.priorAttemptCount === 0) - Number(left.priorAttemptCount === 0)
    || String(left.contentText).localeCompare(String(right.contentText), 'fil')
  )).slice(0, Math.min(Math.max(Number(limit) || 10, 1), 24));

  const readiness = {
    recent_attempt_count: recentFive.length,
    average_accuracy_last_5: averageAccuracy === null ? null : round(averageAccuracy),
    success_rate_last_5: successRate === null ? null : round(successRate),
    accuracy_trend_last_5: round(trend),
    current_streak: currentStreak(orderedSessions, now),
    total_attempts: orderedSessions.length,
    official_progression_eligible: officialProgressionEligible,
    official_earned_level: officialProgression.official_earned_level || 'Beginner',
    placement_override_level: officialProgression.placement_override_level || null,
    program_complete: officialProgression.program_complete === true,
    official_requirements: officialProgression.requirements || [],
    module_scope: {
      configured: isolatedModuleMode,
      module_id: activeModule?.id || null,
      module_number: activeModule?.module_number || null,
      level: activeModule?.level || null,
      instructional_content_type: activeModule?.instructional_content_type || null,
      candidate_content_count: moduleContentIds.size,
    },
    label_source: 'authoritative_client_curriculum_v1',
    confusion_window_days: OUTCOME_WINDOW_DAYS,
    confusion_rates: Object.fromEntries(Object.entries(confusionRates).map(([key, value]) => [key, round(value)])),
  };
  const ranked = rankedItems.map((item, index) => ({ ...item, rank: index + 1 }));
  return {
    strategy: STRATEGY_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    weights: RANKING_WEIGHTS,
    currentDifficulty,
    recommendedDifficulty,
    shouldAdvance,
    predictedProbability: null,
    readiness,
    items: ranked,
    // Temporary response alias for older app builds. Entries now carry stable
    // contentId/contentType and may be non-word curriculum.
    words: ranked,
  };
};

module.exports = {
  buildTrackFrontier,
  compareCurriculumOrder,
  CONFUSION_PAIRS,
  FEATURE_SCHEMA_VERSION,
  PRACTICE_TYPES_BY_LEVEL,
  RANKING_WEIGHTS,
  STRATEGY_VERSION,
  rankCurriculum,
};
