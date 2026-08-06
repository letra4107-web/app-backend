const CONFUSION_PAIRS = ['d-r', 'b-p', 'd-t', 'g-k', 'n-ng', 'm-n', 'l-r', 's-ts', 'e-i', 'o-u', 'a-o'];

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(Number(value) || 0);
const asDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const normalize = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z-]/g, '');

const textPhonemes = (value) => {
  const text = normalize(value).replace(/-/g, '').replace(/gui/g, 'gi').replace(/gue/g, 'ge');
  const result = [];
  for (let index = 0; index < text.length;) {
    const unit = ['ng', 'ts', 'ny'].find((candidate) => text.startsWith(candidate, index));
    result.push(unit || text[index]);
    index += unit ? unit.length : 1;
  }
  return result;
};

const textSyllables = (value) => {
  const text = normalize(value);
  if (!text) return [];
  if (text.includes('-')) return text.split('-').filter(Boolean);
  // A conservative written-Tagalog approximation. These are diagnostic
  // spelling units, not acoustic forced-alignment measurements.
  return text.replace(/ng/g, 'ñ').match(/[^aeiou]*[aeiou]+(?:[^aeiou](?=[^aeiou]|$))?/g)
    ?.map((part) => part.replace(/ñ/g, 'ng')) || [text];
};

const average = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

const standardDeviation = (values) => {
  const mean = average(values);
  if (mean == null || values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
};

const trendPoints = (sessions) => {
  if (sessions.length < 2) return 0;
  const midpoint = Math.max(1, Math.floor(sessions.length / 2));
  const earlier = average(sessions.slice(0, midpoint).map((row) => Number(row.accuracy_percentage) || 0)) || 0;
  const later = average(sessions.slice(midpoint).map((row) => Number(row.accuracy_percentage) || 0)) || 0;
  return round(later - earlier);
};

const scoreUnits = (sessions, confusions, extractor) => {
  const units = new Map();
  sessions.forEach((session) => {
    const accuracy = clamp(Number(session.accuracy_percentage) || 0);
    new Set(extractor(session.word)).forEach((unit) => {
      const entry = units.get(unit) || { unit, scores: [], errors: 0 };
      entry.scores.push(accuracy);
      units.set(unit, entry);
    });
  });
  confusions.forEach((row) => {
    String(row.confusion_key || '').split('-').filter(Boolean).forEach((unit) => {
      const entry = units.get(unit) || { unit, scores: [], errors: 0 };
      entry.errors += 1;
      units.set(unit, entry);
    });
  });
  return [...units.values()].map((entry) => {
    const observedAccuracy = average(entry.scores) ?? 50;
    const errorPenalty = Math.min(35, entry.errors * 7);
    return {
      unit: entry.unit,
      attempts: entry.scores.length,
      errors: entry.errors,
      score: round(clamp(observedAccuracy - errorPenalty)),
      trendPoints: entry.scores.length >= 2
        ? round((average(entry.scores.slice(Math.floor(entry.scores.length / 2))) || 0)
          - (average(entry.scores.slice(0, Math.max(1, Math.floor(entry.scores.length / 2)))) || 0))
        : 0,
    };
  });
};

const buildReadingProfile = ({ sessions = [], confusions = [], completions = [], now = new Date() } = {}) => {
  const ordered = sessions.filter((row) => asDate(row.created_at))
    .sort((left, right) => asDate(left.created_at) - asDate(right.created_at));
  const recent = ordered.slice(-20);
  const accuracies = recent.map((row) => clamp(Number(row.accuracy_percentage) || 0));
  const averageAccuracy = average(accuracies);
  const consistency = accuracies.length ? clamp(100 - (standardDeviation(accuracies) * 2.5)) : 0;
  const durationValues = recent.map((row) => Number(row.duration_seconds)).filter((value) => Number.isFinite(value) && value > 0);
  const pace = durationValues.length
    ? average(durationValues.map((seconds) => seconds <= 15 ? 100 : clamp(100 - ((seconds - 15) * 3))))
    : 70;
  const attemptsByWord = new Map();
  recent.forEach((row) => attemptsByWord.set(normalize(row.word), (attemptsByWord.get(normalize(row.word)) || 0) + 1));
  const retryEfficiency = recent.length
    ? clamp(100 - ([...attemptsByWord.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0) / recent.length * 60))
    : 0;
  const confidenceScore = averageAccuracy == null ? 0 : round(
    (averageAccuracy * 0.55) + (consistency * 0.20) + (pace * 0.10) + (retryEfficiency * 0.15),
  );

  const phonemes = scoreUnits(recent, confusions, textPhonemes);
  const syllables = scoreUnits(recent, [], textSyllables);
  const strongSounds = phonemes.filter((item) => item.attempts > 0 && item.score >= 85)
    .sort((a, b) => b.score - a.score || b.attempts - a.attempts).slice(0, 5);
  const weakSounds = phonemes.filter((item) => item.errors > 0 || (item.attempts > 0 && item.score < 75))
    .sort((a, b) => a.score - b.score || b.errors - a.errors).slice(0, 5);
  const weakSyllables = syllables.filter((item) => item.attempts > 0 && item.score < 75)
    .sort((a, b) => a.score - b.score).slice(0, 5);

  const words = new Map();
  recent.forEach((row) => {
    const word = String(row.word || '').trim();
    if (!word) return;
    const entry = words.get(word) || [];
    entry.push(Number(row.accuracy_percentage) || 0);
    words.set(word, entry);
  });
  const weakWords = [...words.entries()].map(([word, scores]) => ({ word, score: round(average(scores)) }))
    .filter((item) => item.score < 75).sort((a, b) => a.score - b.score).slice(0, 5);

  const sevenDaysAgo = new Date(now.getTime() - (7 * 86400000));
  const weekly = ordered.filter((row) => asDate(row.created_at) >= sevenDaysAgo);
  const prior = ordered.filter((row) => {
    const date = asDate(row.created_at);
    return date < sevenDaysAgo && date >= new Date(now.getTime() - (14 * 86400000));
  });
  const weeklyAverage = average(weekly.map((row) => Number(row.accuracy_percentage) || 0));
  const priorAverage = average(prior.map((row) => Number(row.accuracy_percentage) || 0));
  const weeklyTrend = weeklyAverage == null || priorAverage == null ? trendPoints(recent) : round(weeklyAverage - priorAverage);
  const practiceDays = new Set(weekly.map((row) => asDate(row.created_at).toISOString().slice(0, 10))).size;

  const focus = weakSyllables[0]?.unit || weakSounds[0]?.unit || weakWords[0]?.word || null;
  const mostImprovedSound = phonemes.filter((item) => item.attempts >= 2)
    .sort((a, b) => b.trendPoints - a.trendPoints)[0] || null;
  const insights = [];
  if (weeklyTrend >= 3) insights.push(`Umangat nang ${weeklyTrend} puntos ang average accuracy ngayong linggo.`);
  else if (weeklyTrend <= -3) insights.push(`Bumaba nang ${Math.abs(weeklyTrend)} puntos ang recent accuracy; makakatulong ang mas mabagal na pagbasa.`);
  if (practiceDays >= 4) insights.push(`Nakapagsanay sa ${practiceDays} magkakaibang araw nitong linggo.`);
  if (weakSounds[0]) insights.push(`Makabubuting pagtuunan ang tunog na ${weakSounds[0].unit.toUpperCase()}.`);
  if (!insights.length && recent.length) insights.push('Patuloy na magsanay upang makabuo ng mas malinaw na reading trend.');

  return {
    generatedAt: now.toISOString(),
    sessionCount: ordered.length,
    recentSessionCount: recent.length,
    averageAccuracy: averageAccuracy == null ? null : round(averageAccuracy),
    confidenceScore,
    confidenceLabel: confidenceScore >= 80 ? 'Confident Reader' : confidenceScore >= 65 ? 'Developing Confidence' : 'Needs More Practice',
    consistencyScore: round(consistency),
    averageDurationSeconds: durationValues.length ? round(average(durationValues)) : null,
    accuracyTrendPoints: trendPoints(recent),
    weeklyAccuracyTrendPoints: weeklyTrend,
    weeklyPracticeDays: practiceDays,
    strongSounds,
    weakSounds,
    weakSyllables,
    weakWords,
    mostImprovedSound: mostImprovedSound && mostImprovedSound.trendPoints > 0 ? mostImprovedSound : null,
    recommendedFocus: focus ? `${String(focus).toUpperCase()} practice` : 'Continue the current curriculum frontier',
    recommendedHomePractice: focus
      ? `Magsanay ng mga salitang may ${String(focus).toUpperCase()} sa loob ng 5 minuto.`
      : 'Magbasa nang malakas sa loob ng 5 minuto.',
    insights,
    needsIntervention: recent.length >= 3 && ((averageAccuracy || 0) < 75 || confidenceScore < 60),
    completedContentCount: completions.length,
    readingJourney: completions.length >= 400 ? 'Advanced Reader' : completions.length >= 100 ? 'Intermediate Reader' : 'Beginner Reader',
    measurementNote: 'Sound and syllable findings are inferred from target-versus-transcript spelling and session scores, not acoustic forced alignment.',
  };
};

const buildAttemptFeedback = ({ target, accuracy, previousAccuracy = null, confusions = [] }) => {
  const score = clamp(Number(accuracy) || 0);
  const latestConfusion = confusions[0]?.confusion_key?.split('-')?.[0];
  if (previousAccuracy != null && score >= Number(previousAccuracy) + 5) {
    return `Napabuti ang pagbigkas mo nang ${round(score - Number(previousAccuracy))} puntos kumpara sa huling pagsubok.`;
  }
  if (score >= 90) return 'Magaling! Malinaw at tama ang pagbigkas mo.';
  if (latestConfusion) return `Subukan nating linawin ang tunog na '${String(latestConfusion).toLowerCase()}'.`;
  if (score >= 75) return 'Malapit na! Basahin muna ang bawat pantig bago buuin ang salita.';
  const firstSyllable = textSyllables(target)[0];
  return firstSyllable
    ? `Mas mabagal na pagbasa ay makakatulong. Simulan sa pantig na '${firstSyllable}'.`
    : 'Mas mabagal na pagbasa ay makakatulong. Subukan muli.';
};

module.exports = { CONFUSION_PAIRS, buildAttemptFeedback, buildReadingProfile, textPhonemes, textSyllables };
