require('dotenv').config();
const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { scorePracticeWord } = require('./practiceWordScoring');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();
let speechClient = null;

// multer in-memory so we can transform quickly (also supports 1–3s clips)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const postJson = (res, statusCode, payload) => {
  res.status(statusCode).json(payload);
};

const getSpeechClient = () => {
  if (!speechClient) {
    speechClient = new speech.SpeechClient();
  }
  return speechClient;
};

const getEncoding = (mimeType = '') => {
  const normalized = String(mimeType).toLowerCase();
  if (normalized.includes('webm')) return 'WEBM_OPUS';
  if (normalized.includes('ogg')) return 'OGG_OPUS';
  if (normalized.includes('flac')) return 'FLAC';
  if (normalized.includes('wav') || normalized.includes('wave')) return 'LINEAR16';
  if (normalized.includes('mp3') || normalized.includes('mpeg')) return 'MP3';
  // AMR-NB, always 8kHz - the Word of Day screen's Android recording format.
  // NOTE: there is deliberately no case for m4a/aac here - Google Cloud
  // Speech-to-Text's encoding enum has no AAC/M4A option at all, so an m4a
  // upload can never be correctly decoded via this endpoint regardless of
  // what string is returned.
  if (normalized.includes('amr')) return 'AMR';
  return undefined;
};

// AMR requires an explicit sampleRateHertz (Google STT rejects the request
// without it); other encodings here rely on their container's own header.
const REQUIRED_SAMPLE_RATE_HERTZ = { AMR: 8000, AMR_WB: 16000 };
const normalizeWord = (value = '') => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
const wordAccuracy = (spoken, expected) => {
  const a = normalizeWord(spoken); const b = normalizeWord(expected);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return Math.max(0, Math.round((1 - previous[b.length] / Math.max(a.length, b.length)) * 100));
};

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    let audioBase64 = req.body?.audioBase64;
    const mimeType = req.file?.mimetype || req.body?.mimeType || '';
    if (req.file) {
      audioBase64 = req.file.buffer.toString('base64');
    }

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return postJson(res, 400, { success: false, message: 'Missing audioBase64 or audio file' });
    }

    const audioBytes = Buffer.from(audioBase64, 'base64');
    if (audioBytes.length < 256) {
      return postJson(res, 400, { success: false, message: 'The recording is empty or too short. Please hold the microphone and try again.' });
    }
    if (audioBytes.length > 8 * 1024 * 1024) {
      return postJson(res, 413, { success: false, message: 'The recording is too large. Please try a shorter recording.' });
    }

    const completingWordOfDay = req.body?.completeWordOfDay === true || req.body?.completeWordOfDay === 'true';
    let wordOfDay = null;
    if (completingWordOfDay) {
      const childId = String(req.body?.childId || '').trim();
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!childId || !token) return postJson(res, 401, { success: false, message: 'Please sign in again before completing Word of the Day.' });
      const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !auth?.user) return postJson(res, 401, { success: false, message: 'Your sign-in session has expired.' });
      const { data: child, error: childError } = await supabaseAdmin.from('children').select('id,auth_uid').eq('id', childId).maybeSingle();
      if (childError || !child || child.auth_uid !== auth.user.id) return postJson(res, 403, { success: false, message: 'You cannot complete this Word of the Day.' });
      const { data: log, error: logError } = await supabaseAdmin.from('word_of_day_log').select('word,correct').eq('child_id', childId).eq('date', new Date().toISOString().slice(0, 10)).maybeSingle();
      if (logError || !log) return postJson(res, 409, { success: false, message: "Today's word is not ready yet. Please reload and try again." });
      if (log.correct) return postJson(res, 200, { success: true, alreadyCompleted: true, transcript: '', accuracy: 100, message: "You already completed today's Word of the Day. Come back tomorrow!" });
      wordOfDay = { childId, word: log.word };
    }
    const encoding = getEncoding(mimeType);
    if (!encoding) {
      return postJson(res, 415, { success: false, message: `Unsupported recording format: ${mimeType || 'unknown'}.` });
    }
    const config = {
      languageCode: req.body?.language || 'tl-PH',
      alternativeLanguageCodes: ['fil-PH', 'en-PH'],
      enableAutomaticPunctuation: false,
      ...(encoding ? { encoding } : {}),
      ...(encoding && REQUIRED_SAMPLE_RATE_HERTZ[encoding] ? { sampleRateHertz: REQUIRED_SAMPLE_RATE_HERTZ[encoding] } : {}),
    };

    const [response] = await getSpeechClient().recognize({
      audio: { content: audioBase64 },
      config,
    });

    const transcript = (response.results || [])
      .map((result) => result.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();
    const confidence = response.results?.[0]?.alternatives?.[0]?.confidence || 0;

    if (!transcript) {
      return postJson(res, 422, { success: false, message: 'We could not hear a word clearly. Please move closer to the microphone and try again.' });
    }
    const accuracy = wordAccuracy(transcript, wordOfDay?.word || req.body?.target || '');
    let completion = null;
    if (wordOfDay) {
      const { data, error } = await supabaseAdmin.rpc('complete_word_of_day_attempt', {
        p_child_id: wordOfDay.childId, p_accuracy: accuracy, p_is_correct: accuracy >= 80,
      });
      if (error) throw error;
      completion = Array.isArray(data) ? data[0] : data;
    }
    postJson(res, 200, {
      success: true,
      transcript,
      accuracy,
      confidence,
      completion,
    });
  } catch (err) {
    // Log the full provider failure on the server, but return a stable,
    // user-safe message to the device.
    console.error('[SpeechAPI] transcribe failed:', { message: err?.message, code: err?.code, stack: err?.stack });
    const unavailable = /credential|permission|unauthenticated|deadline|unavailable/i.test(String(err?.message || err?.code || ''));
    postJson(res, unavailable ? 503 : 500, {
      success: false,
      message: unavailable
        ? 'Speech recognition is temporarily unavailable. Please try again shortly.'
        : 'We could not process that recording. Please try again.',
    });
  }
});

/**
 * Practice-word phoneme-level scoring endpoint.
 *
 * Frontend sends either:
 *  - audioBase64 + mimeType + filename
 *  - OR multipart/form-data file field named `audio`
 *
 * Returns:
 *  {
 *    word: string,
 *    score: number(0-100),
 *    phoneme_scores: [{ phoneme: string, score: number }],
 *    is_correct: boolean,
 *    suggestion: string
 *  }
 */
router.post('/practice-word', upload.single('audio'), async (req, res) => {
  const startedAt = Date.now();

  try {
    const {
      target,
      language,
      consent,
      clientId,
      analytics,
      attempt,
    } = req.body || {};

    const targetWord = typeof target === 'string' ? target : (req.body?.word || '');
    if (!targetWord) {
      return postJson(res, 400, { success: false, message: 'Missing target/word' });
    }

    // Privacy: only store audio if consent===true
    // Here, since we use in-memory processing, we don't persist audio at all.
    // We still accept the flag so downstream instrumentation can follow policy.
    const consentFlag = consent === true || consent === 'true' || consent === 1 || consent === '1';

    // Extract audio payload (base64 or multipart)
    let audioBase64 = req.body?.audioBase64;
    let mimeType = req.body?.mimeType;

    if (req.file) {
      const buf = req.file.buffer;
      audioBase64 = buf.toString('base64');
      mimeType = req.file.mimetype || mimeType || 'audio/wav';
    }

    if (!audioBase64) {
      return postJson(res, 400, { success: false, message: 'Missing audioBase64 or multipart audio file' });
    }

    const result = await scorePracticeWord({
      targetWord,
      language: typeof language === 'string' ? language : 'tl-PH',
      mimeType: mimeType || 'audio/wav',
      audioBase64,
      consent: consentFlag,
      analytics: analytics || null,
      clientId: clientId || null,
      attempt: typeof attempt === 'number' ? attempt : (attempt ? Number(attempt) : undefined),
      timing: { startedAt },
    });

    const timeToFeedbackMs = Date.now() - startedAt;

    // Analytics: anonymize and keep minimal
    // (placeholder: console log; wire to Supabase/Postgres analytics later)
    console.log('[PracticeWordAPI]', {
      targetWord,
      score: result?.score,
      is_correct: result?.is_correct,
      timeToFeedbackMs,
      phonemes: (result?.phoneme_scores || []).map(p => p.phoneme),
      attempt: typeof attempt === 'number' ? attempt : undefined,
      consent: consentFlag,
    });

    return postJson(res, 200, {
      word: targetWord,
      score: Number(result?.score ?? 0),
      phoneme_scores: Array.isArray(result?.phoneme_scores) ? result.phoneme_scores : [],
      is_correct: !!result?.is_correct,
      suggestion: result?.suggestion || '',
      // extra fields for calibration/QA
      timeToFeedbackMs,
    });
  } catch (err) {
    return postJson(res, 500, {
      success: false,
      message: err?.message || 'practice-word scoring failed',
    });
  }
});

module.exports = router;
