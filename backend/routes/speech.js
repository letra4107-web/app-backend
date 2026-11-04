require('dotenv').config();
const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { scorePracticeWord } = require('./practiceWordScoring');
const { supabaseAdmin } = require('../config/supabase');
const { buildAttemptFeedback } = require('../services/readingInsights');
const { recordWordOfDayAttempt } = require('../services/wordOfDayAttempt');

const router = express.Router();
let speechClient = null;
const GOOGLE_SPEECH_CREDENTIALS_JSON = String(
  process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || process.env.GOOGLE_CLOUD_CREDENTIALS_JSON || '',
).trim();

// multer in-memory so we can transform quickly (also supports 1–3s clips)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const postJson = (res, statusCode, payload) => {
  res.status(statusCode).json(payload);
};

const getSpeechClient = () => {
  if (!speechClient) {
    let options;
    if (GOOGLE_SPEECH_CREDENTIALS_JSON) {
      try {
        const credentials = JSON.parse(GOOGLE_SPEECH_CREDENTIALS_JSON);
        if (!credentials.client_email || !credentials.private_key) throw new Error('required fields are missing');
        options = {
          credentials: {
            ...credentials,
            private_key: String(credentials.private_key).replace(/\\n/g, '\n'),
          },
          projectId: credentials.project_id,
        };
      } catch (error) {
        const configError = new Error(`Google Speech credentials JSON is invalid: ${error.message}`);
        configError.code = 'SPEECH_NOT_CONFIGURED';
        throw configError;
      }
    } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Do not let google-auth probe Railway's unavailable metadata service.
      // Besides adding ~4 seconds, that path emitted an unhandled rejection
      // and restarted the whole backend when no ADC credentials existed.
      const configError = new Error('Google Speech service-account credentials are not configured.');
      configError.code = 'SPEECH_NOT_CONFIGURED';
      throw configError;
    }
    speechClient = new speech.SpeechClient(options);
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

const { todayKey, yesterdayKey } = require('../services/dateUtils');

const authenticateWordOfDay = async (req) => {
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return {errorStatus:401,errorMessage:'Please sign in again.'};
  const {data:auth,error}=await supabaseAdmin.auth.getUser(token);
  if(error||!auth?.user?.id) return {errorStatus:401,errorMessage:'Your sign-in session has expired.'};
  const {data:child,error:childError}=await supabaseAdmin.from('children').select('id').eq('auth_uid',auth.user.id).maybeSingle();
  if(childError) return {errorStatus:503,errorMessage:'Unable to verify this activity.'};
  if(!child||req.body?.childId&&req.body.childId!==child.id) return {errorStatus:403,errorMessage:'This activity is not available to your account.'};
  return {childId:child.id};
};
const completeWordOfDay = async (childId, body) => {
  const result=await recordWordOfDayAttempt(supabaseAdmin,{studentId:childId,logId:body.logId,attempts:body.attempts,transcript:body.transcript});
  return {success:true,transcript:body.transcript,accuracy:result.accuracy,
    completion:{attempts:body.attempts,completed:result.isFinal,correct:result.correct,replayed:result.replayed,
      xp_awarded:result.xpAwarded,total_xp:result.newXp,streak:result.newStreak},badgesPending:result.badgesPending};
};
router.get('/word-of-day',async(req,res)=>{try{const verified=await authenticateWordOfDay(req);if(verified.errorStatus)return postJson(res,verified.errorStatus,{success:false,message:verified.errorMessage});return res.json({success:true,log:await require('../services/wordOfDayInitialization').loadWordOfDay(supabaseAdmin,verified.childId)});}catch{return postJson(res,503,{success:false,message:'Hindi ma-load ang Salita ng Araw. Subukan muli.'});}});
router.post('/word-of-day-result',express.json({limit:'32kb'}),async(req,res)=>{
  try {
    const verified=await authenticateWordOfDay(req);
    if(verified.errorStatus) return postJson(res,verified.errorStatus,{success:false,message:verified.errorMessage});
    return res.json(await completeWordOfDay(verified.childId,req.body));
  } catch(error) {return postJson(res,error.status||503,{success:false,message:error.publicMessage||'The daily reward service is unavailable. Retry the same attempt later.'});}
});

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
      const verified = await authenticateWordOfDay(req);
      if (verified.errorStatus) return postJson(res, verified.errorStatus, { success: false, message: verified.errorMessage });
      wordOfDay = { childId: verified.childId };
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
    let accuracy = wordAccuracy(transcript, req.body?.target || '');
    let completion = null;
    if (wordOfDay) {
      const completed = await completeWordOfDay(wordOfDay.childId, {...req.body,transcript});
      completion = completed.completion;
      accuracy = completed.accuracy;
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
    const unavailable = err?.code === 'SPEECH_NOT_CONFIGURED'
      || /credential|permission|unauthenticated|deadline|unavailable/i.test(String(err?.message || err?.code || ''));
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
// Exported on the router object only for focused regression tests. The HTTP
// API remains the default Express-router export used by server.js.
module.exports.wordAccuracy = wordAccuracy;
