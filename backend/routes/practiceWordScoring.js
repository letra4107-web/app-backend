
const DEFAULT_SCORE = 0;

const TAGALOG_PHONE_MAP = {
  // Map a practice target word string to a small set of "phoneme units".
  // This is a pragmatic scaffold for phoneme-level scoring UI.
  // For example "pa-pa" -> ["p","pa"] etc.
  'pa-pa': ['p', 'a'],
  'ma-ma': ['m', 'a'],
  'ba-ba': ['b', 'a'],
  'sa-pa': ['s', 'p', 'a'],
  'ta-ta': ['t', 'a'],
  'a-so': ['a', 's', 'o'],
  'ba-ta': ['b', 'a', 't'],
  'ka-ma': ['k', 'a', 'm'],
  'ma-la': ['m', 'a', 'l'],
  'sa-ya': ['s', 'a', 'y'],
  'mag-a-ling': ['m', 'a', 'g', 'l', 'ng'],
  'ma-ba-it': ['m', 'a', 'b', 'ai', 't'],
  'ma-sa-ya': ['m', 'a', 's', 'y'],
  'ma-ri-sa': ['m', 'a', 'r', 'i', 's', 'a'],
  'ma-ra-mi': ['m', 'a', 'r', 'm', 'i'],
};

const normalizeTarget = (w = '') => String(w).toLowerCase().trim().replace(/\s+/g, '');

const getPhonemeUnitsForWord = (word) => {
  const k = normalizeTarget(word);
  return TAGALOG_PHONE_MAP[k] || [];
};

const getSuggestionForPhonemeMismatch = (word, missingPhoneme) => {
  const core = missingPhoneme
    ? `Focus on the sound “${missingPhoneme}” in ${word}. Let’s hear it again — ${word}.`
    : `Let’s listen again and try to match the sounds in ${word}.`;
  return `Great try! ${core}`;
};

const clamp0to100 = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Score a target word pronunciation.
 * @param {object} params
 * @param {string} params.targetWord
 * @param {string} [params.mimeType]
 * @param {string} [params.audioBase64]
 * @param {boolean} [params.consent]
 * @returns {Promise<{word:string, score:number, phoneme_scores:Array<{phoneme:string,score:number}>, is_correct:boolean, suggestion:string}>}
 */
async function scorePracticeWord(params) {
  const { targetWord } = params;

  const phonemeUnits = getPhonemeUnitsForWord(targetWord);
  if (!phonemeUnits.length) {
    const score = DEFAULT_SCORE;
    return {
      word: targetWord,
      score,
      phoneme_scores: [],
      is_correct: score >= 75,
      suggestion: getSuggestionForPhonemeMismatch(targetWord, null),
    };
  }

  // ---------------------------------------------------------------------------
  // Deterministic scaffold scoring:
  // - In a real system, you will compute phoneme likelihoods via forced alignment.
  // - For now, produce phoneme_scores based on audio presence length + a stable hash,
  //   so QA and UI can be validated end-to-end without the ML model.
  // ---------------------------------------------------------------------------
  const audioBase64 = params.audioBase64 || '';
  const baseLen = audioBase64.length;

  // Stable pseudo-random per utterance (doesn't grant correctness deterministically)
  let hash = 0;
  for (let i = 0; i < Math.min(256, baseLen); i += 1) {
    hash = (hash * 31 + audioBase64.charCodeAt(i)) >>> 0;
  }

  // Convert baseLen+hash to a "difficulty"-like factor
  const factor = ((hash % 1000) / 1000) * 0.9 + 0.05; // ~0.05..0.95

  // Bias towards lower scores on unknown/acoustic mismatch until model is integrated.
  // (Helps acceptance criteria calibration later.)
  const overall = clamp0to100(100 * (factor * 0.55));

  // Split into phoneme scores: if overall is high, distribute higher to later units.
  const phoneme_scores = phonemeUnits.map((phoneme, idx) => {
    const weight = 0.85 + (idx / Math.max(1, phonemeUnits.length - 1)) * 0.3;
    const raw = overall * weight / 1.1;
    return { phoneme, score: clamp0to100(raw) };
  });

  // Decide correctness
  const score = clamp0to100(phoneme_scores.reduce((acc, p) => acc + p.score, 0) / phoneme_scores.length);
  const is_correct = score >= 75;

  const minPhoneme = phoneme_scores.reduce((best, p) => (p.score < best.score ? p : best), phoneme_scores[0]);
  const missingPhoneme = is_correct ? null : (minPhoneme?.score <= 60 ? minPhoneme.phoneme : null);

  const suggestion = getSuggestionForPhonemeMismatch(targetWord, missingPhoneme);

  return {
    word: targetWord,
    score,
    phoneme_scores,
    is_correct,
    suggestion,
  };
}

module.exports = {
  scorePracticeWord,
};


