const LEVELS = ['beginner', 'intermediate', 'advanced'];
const CONFUSION_PAIRS = ['d-r', 'b-p', 'd-t', 'g-k', 'n-ng', 'm-n', 'l-r', 's-ts', 'e-i', 'o-u', 'a-o'];
const STRATEGY_VERSION = 'cold-start-ranker-v1';
const FEATURE_SCHEMA_VERSION = 'readiness-v1';
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
const normalizeWord = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
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

const wordPhonemes = (word) => {
  const normalized = normalizeWord(word).replace(/gui/g, 'gi').replace(/gue/g, 'ge');
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

const pairExposure = (word) => {
  const counts = wordPhonemes(word).reduce((map, phoneme) => ({ ...map, [phoneme]: (map[phoneme] || 0) + 1 }), {});
  return Object.fromEntries(CONFUSION_PAIRS.map((pair) => {
    const [left, right] = pair.split('-');
    return [pair, (counts[left] || 0) + (counts[right] || 0)];
  }));
};

const structuralLoad = (word) => clamp(
  (Math.max(1, asNumber(word.syllable_count) || 1) / 5)
  + (word.has_diphthong ? 0.15 : 0)
  + (word.has_consonant_cluster ? 0.20 : 0),
);

const latestDifficulty = (sessions, progressLevel) => {
  for (const session of [...sessions].reverse()) {
    const level = String(session.difficulty_level_at_attempt || '').toLowerCase();
    if (LEVELS.includes(level)) return level;
  }
  const fallback = String(progressLevel || '').toLowerCase();
  return LEVELS.includes(fallback) ? fallback : 'beginner';
};

const rankWords = ({ sessions = [], confusions = [], words = [], progressLevel = 'beginner', now = new Date(), limit = 10 }) => {
  const orderedSessions = [...sessions]
    .filter((row) => asDate(row.created_at))
    .sort((left, right) => asDate(left.created_at) - asDate(right.created_at));
  const recentFive = orderedSessions.slice(-5);
  const accuracies = recentFive.map((row) => asNumber(row.accuracy_percentage)).filter((value) => value !== null);
  const averageAccuracy = accuracies.length ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length : null;
  const successRate = recentFive.length ? recentFive.filter((row) => row.is_correct === true).length / recentFive.length : null;
  const trend = accuracySlope(accuracies);
  const hasMinimumHistory = recentFive.length === 5;
  const bootstrapReadiness = hasMinimumHistory
    ? averageAccuracy >= 80 && successRate >= 0.8 && trend >= -2
    : null;

  const currentDifficulty = latestDifficulty(orderedSessions, progressLevel);
  const canAdvance = currentDifficulty !== 'advanced';
  const shouldAdvance = bootstrapReadiness === true && canAdvance;
  const recommendedDifficulty = shouldAdvance
    ? LEVELS[LEVELS.indexOf(currentDifficulty) + 1]
    : currentDifficulty;

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

  const candidatePool = words.filter((word) => String(word.level || '').toLowerCase() === recommendedDifficulty);
  const targetStructuralLoad = shouldAdvance ? 0.65 : 0.40;
  const rawCandidates = candidatePool.map((word) => {
    const attempts = orderedSessions.filter((session) => (
      (session.word_id && String(session.word_id) === String(word.id))
      || (!session.word_id
        && normalizeWord(session.word) === normalizeWord(word.word)
        && String(session.difficulty_level_at_attempt || '').toLowerCase() === recommendedDifficulty)
    ));
    const priorAccuracies = attempts.map((row) => asNumber(row.accuracy_percentage)).filter((value) => value !== null);
    const priorAverage = priorAccuracies.length
      ? priorAccuracies.reduce((sum, value) => sum + value, 0) / priorAccuracies.length
      : null;
    const lastPracticed = attempts.map((row) => asDate(row.created_at)).filter(Boolean).sort((a, b) => b - a)[0] || null;
    const exposures = pairExposure(word.word);
    const matchedPairs = CONFUSION_PAIRS.filter((pair) => exposures[pair] > 0 && confusionRates[pair] > 0);
    const weaknessRaw = CONFUSION_PAIRS.reduce(
      (sum, pair) => sum + (confusionRates[pair] * Math.min(exposures[pair], 2)),
      0,
    );
    return {
      word,
      attempts: attempts.length,
      priorAverage,
      lastPracticed,
      matchedPairs,
      weaknessRaw,
      masteryGap: priorAverage === null ? 0.50 : clamp(1 - (priorAverage / 100)),
      recencyNeed: lastPracticed ? clamp(daysBetweenManila(lastPracticed, now) / 14) : 1,
      structuralLoad: structuralLoad(word),
    };
  });
  const maxWeakness = Math.max(0, ...rawCandidates.map((candidate) => candidate.weaknessRaw));
  const rankedWords = rawCandidates.map((candidate) => {
    const weaknessMatch = maxWeakness ? candidate.weaknessRaw / maxWeakness : 0;
    const structuralFit = clamp(1 - Math.abs(candidate.structuralLoad - targetStructuralLoad));
    const components = {
      weakness_match: round(weaknessMatch),
      mastery_gap: round(candidate.masteryGap),
      recency_need: round(candidate.recencyNeed),
      structural_fit: round(structuralFit),
    };
    const rankingScore = round(Object.entries(RANKING_WEIGHTS).reduce(
      (sum, [key, weight]) => sum + (components[key] * weight),
      0,
    ));
    const reasonCodes = [];
    if (candidate.matchedPairs.length) reasonCodes.push('targets_confusion_pair');
    if (candidate.priorAverage !== null && candidate.priorAverage < 75) reasonCodes.push('low_prior_accuracy');
    if (candidate.lastPracticed && daysBetweenManila(candidate.lastPracticed, now) >= 14) reasonCodes.push('not_practiced_recently');
    if (!candidate.attempts) reasonCodes.push('unseen_diagnostic_word');
    if (structuralFit >= 0.80) reasonCodes.push('appropriate_structural_load');
    return {
      id: candidate.word.id,
      word: candidate.word.word,
      level: candidate.word.level,
      syllableCount: candidate.word.syllable_count,
      rankingScore,
      componentScores: components,
      reasonCodes,
      matchedConfusionPairs: candidate.matchedPairs,
      priorAttemptCount: candidate.attempts,
      priorAverageAccuracy: candidate.priorAverage === null ? null : round(candidate.priorAverage),
      daysSincePracticed: candidate.lastPracticed ? daysBetweenManila(candidate.lastPracticed, now) : null,
      structuralLoad: round(candidate.structuralLoad),
    };
  }).sort((left, right) => (
    right.rankingScore - left.rankingScore
    || Number(right.priorAttemptCount === 0) - Number(left.priorAttemptCount === 0)
    || String(left.word).localeCompare(String(right.word), 'fil')
  )).slice(0, Math.min(Math.max(Number(limit) || 10, 1), 24));

  const readiness = {
    recent_attempt_count: recentFive.length,
    average_accuracy_last_5: averageAccuracy === null ? null : round(averageAccuracy),
    success_rate_last_5: successRate === null ? null : round(successRate),
    accuracy_trend_last_5: round(trend),
    current_streak: currentStreak(orderedSessions, now),
    total_attempts: orderedSessions.length,
    bootstrap_readiness: bootstrapReadiness,
    label_source: hasMinimumHistory ? 'bootstrap_rubric_v1' : null,
    confusion_window_days: OUTCOME_WINDOW_DAYS,
    confusion_rates: Object.fromEntries(Object.entries(confusionRates).map(([key, value]) => [key, round(value)])),
  };
  return {
    strategy: STRATEGY_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    weights: RANKING_WEIGHTS,
    currentDifficulty,
    recommendedDifficulty,
    shouldAdvance,
    predictedProbability: null,
    readiness,
    words: rankedWords.map((word, index) => ({ ...word, rank: index + 1 })),
  };
};

module.exports = {
  CONFUSION_PAIRS,
  FEATURE_SCHEMA_VERSION,
  RANKING_WEIGHTS,
  STRATEGY_VERSION,
  rankWords,
};
