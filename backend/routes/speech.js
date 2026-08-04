require('dotenv').config();
const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { scorePracticeWord } = require('./practiceWordScoring');

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

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    let audioBase64 = req.body?.audioBase64;
    const mimeType = req.file?.mimetype || req.body?.mimeType || '';
    if (req.file) {
      audioBase64 = req.file.buffer.toString('base64');
    }

    if (!audioBase64) {
      return postJson(res, 400, { success: false, message: 'Missing audioBase64 or audio file' });
    }

    const encoding = getEncoding(mimeType);
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

    postJson(res, 200, {
      success: true,
      transcript,
      confidence,
    });
  } catch (err) {
    console.error('[SpeechAPI] transcribe failed:', err);
    postJson(res, 500, { success: false, message: 'Speech transcription failed' });
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
