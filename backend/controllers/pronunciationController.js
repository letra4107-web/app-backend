const crypto = require('crypto');

const POSITIVE_MESSAGES = [
  'Good job!',
  'Great try!',
  'Congratulations!',
  "You're doing great!",
  'Nice work!',
  'Keep it up!'
];

function pickPositiveMessage(seed) {
  const idx = Math.abs(seed) % POSITIVE_MESSAGES.length;
  return POSITIVE_MESSAGES[idx];
}

function simpleHash(str) {
  return crypto.createHash('md5').update(str || '').digest().readUInt32BE(0);
}

function clamp(v, a = 0, b = 100) {
  return Math.max(a, Math.min(b, Math.round(v)));
}

function splitPhonemes(word) {
  // Very simple phoneme splitter for mock: split on hyphen, else characters
  if (!word) return [];
  if (word.includes('-')) return word.split('-').map((p) => p.trim()).filter(Boolean);
  return word.replace(/[^a-zA-Z]/g, '').split('').map((c) => c);
}

async function processRequest(body = {}, headers = {}) {
  const { user_id, word, audio_base64, retries_used = 0 } = body;
  if (!user_id || !word || !audio_base64) {
    const err = new Error('Missing required fields: user_id, word, audio_base64');
    err.status = 400;
    throw err;
  }

  // Allow explicit mock selection via header for frontend testing
  const mockCase = headers['x-mock-case'] ? Number(headers['x-mock-case']) : null;

  // Deterministic pseudo-random based on audio content and word
  const seed = simpleHash((audio_base64 || '') + '|' + (word || ''));
  const phonemes = splitPhonemes(word.toLowerCase());

  // If header mock_case maps to a sample, load from a small built-in set
  if (mockCase && mockCase >= 1 && mockCase <= 10) {
    // Use seed to vary slightly
    const sample = require('../mocks/pronunciation_samples.json')[String(mockCase)];
    if (sample) {
      // compute retry logic
      const maxRetries = 2;
      const remaining = Math.max(0, maxRetries - (Number(retries_used) || 0));
      sample.retry_allowed = remaining;
      if (!sample.is_correct && remaining > 0) {
        sample.action = 'repeat_word';
      } else {
        sample.action = 'none';
      }
      sample.positive_message = pickPositiveMessage(seed);
      sample.phoneme_scores = sample.phoneme_scores || phonemes.map((p) => ({ phoneme: p, score: 50 }));
      sample.score = clamp(Math.round(sample.phoneme_scores.reduce((s, p) => s + p.score, 0) / sample.phoneme_scores.length));
      return sample;
    }
  }

  // Generate per-phoneme scores based on seed
  const phoneme_scores = phonemes.map((ph, idx) => {
    // base around 70 with variation derived from seed
    const base = 70 + ((seed >> (idx % 24)) & 31) - 16; // -16..+15
    return { phoneme: ph, score: clamp(base) };
  });

  // Aggregate score
  const score = phoneme_scores.length ? Math.round(phoneme_scores.reduce((s, p) => s + p.score, 0) / phoneme_scores.length) : 0;

  const is_correct = score >= 75;

  const maxRetries = 2;
  const remainingRetries = Math.max(0, maxRetries - (Number(retries_used) || 0));

  const action = !is_correct && remainingRetries > 0 ? 'repeat_word' : 'none';

  const suggestion = is_correct ? `Great pronunciation of ${word}!` : `Try to make the first sound clearer for ${word}`;

  const positive_message = pickPositiveMessage(seed);

  // Provide a canonical audio identifier (frontend may use local TTS if preferred)
  const audio_url = `/assets/audio/${word.replace(/[^a-z0-9_-]/gi, '_')}.mp3`;

  // Response per contract (plus audio_url)
  const response = {
    word,
    score: clamp(score),
    is_correct,
    phoneme_scores,
    suggestion,
    positive_message,
    action,
    retry_allowed: remainingRetries,
    audio_url,
  };

  // Log anonymized metrics (console for now)
  try {
    const log = {
      ts: new Date().toISOString(),
      user_hash: simpleHash(user_id).toString(16).slice(0, 8),
      word,
      score: response.score,
      is_correct: response.is_correct,
      latency_ms: null // set by actual handler if measured
    };
    console.log('[PronunciationMetric]', JSON.stringify(log));
  } catch {
    // ignore logging errors
  }

  return response;
}

module.exports = { processRequest };
