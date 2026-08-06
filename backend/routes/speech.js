require('dotenv').config();
const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { scorePracticeWord } = require('./practiceWordScoring');
const { supabaseAdmin } = require('../config/supabase');
const { buildAttemptFeedback } = require('../services/readingInsights');

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

const authenticateWordOfDay = async (req) => {
  const childId = String(req.body?.childId || '').trim();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!childId || !token) return { errorStatus: 401, errorMessage: 'Please sign in again before completing Word of the Day.' };
  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !auth?.user) return { errorStatus: 401, errorMessage: 'Your sign-in session has expired.' };
  const { data: child, error: childError } = await supabaseAdmin.from('children').select('id,auth_uid').eq('id', childId).maybeSingle();
  if (childError || !child || child.auth_uid !== auth.user.id) {
    return { errorStatus: 403, errorMessage: 'You cannot complete this Word of the Day.' };
  }
  const { data: log, error: logError } = await supabaseAdmin
    .from('word_of_day_log')
    .select('word,correct,content_id,recommendation_reason')
    .eq('child_id', childId)
    .eq('date', new Date().toISOString().slice(0, 10))
    .maybeSingle();
  if (logError || !log) return { errorStatus: 409, errorMessage: "Today's word is not ready yet. Please reload and try again." };
  return { childId, log };
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const completeWordOfDayAttemptDirect = async (childId, accuracy, isCorrect) => {
  const today = getTodayKey();
  const reward = 50;

  const { data: logRow, error: logError } = await supabaseAdmin
    .from('word_of_day_log')
    .select('id,correct,attempts')
    .eq('child_id', childId)
    .eq('date', today)
    .maybeSingle();
  if (logError) throw logError;
  if (!logRow) throw new Error('Word of the Day has not been initialized');

  const currentAttempts = Number(logRow.attempts || 0);
  if (logRow.correct === true) {
    const { data: progressRow, error: progressError } = await supabaseAdmin
      .from('child_progress')
      .select('streak,longest_streak,xp')
      .eq('child_id', childId)
      .maybeSingle();
    if (progressError) throw progressError;

    return {
      already_completed: true,
      completed: true,
      streak: progressRow?.streak ?? 0,
      longest_streak: progressRow?.longest_streak ?? 0,
      attempts: currentAttempts,
      xp_awarded: 0,
      total_xp: progressRow?.xp ?? 0,
    };
  }

  const updatedAttempts = currentAttempts + 1;
  const { data: updatedLog, error: updateLogError } = await supabaseAdmin
    .from('word_of_day_log')
    .update({
      attempts: updatedAttempts,
      accuracy: Math.max(0, Math.min(100, accuracy)),
      correct: isCorrect,
      completed_at: isCorrect ? new Date().toISOString() : null,
      xp_awarded: isCorrect ? reward : 0,
    })
    .eq('id', logRow.id)
    .select()
    .maybeSingle();
  if (updateLogError || !updatedLog) {
    throw updateLogError || new Error('Unable to save Word of the Day attempt.');
  }

  const { data: progressRow, error: progressError } = await supabaseAdmin
    .from('child_progress')
    .select('id,streak,longest_streak,xp,last_practice_date')
    .eq('child_id', childId)
    .maybeSingle();
  if (progressError) throw progressError;

  if (!isCorrect) {
    return {
      already_completed: false,
      completed: false,
      streak: progressRow?.streak ?? 0,
      longest_streak: progressRow?.longest_streak ?? 0,
      attempts: updatedAttempts,
      xp_awarded: 0,
      total_xp: progressRow?.xp ?? 0,
    };
  }

  if (!progressRow) {
    const { data: insertedProgress, error: insertError } = await supabaseAdmin
      .from('child_progress')
      .insert({
        child_id: childId,
        xp: reward,
        streak: 1,
        longest_streak: 1,
        last_practice_date: today,
      })
      .select()
      .maybeSingle();
    if (insertError || !insertedProgress) {
      throw insertError || new Error('Unable to create child progress for Word of the Day.');
    }

    return {
      already_completed: false,
      completed: true,
      streak: insertedProgress.streak,
      longest_streak: insertedProgress.longest_streak,
      attempts: updatedAttempts,
      xp_awarded: reward,
      total_xp: insertedProgress.xp,
    };
  }

  const parseDate = (value) => {
    if (!value) return null;
    try {
      return new Date(value).toISOString().slice(0, 10);
    } catch {
      return null;
    }
  };
  const lastPracticeDate = parseDate(progressRow.last_practice_date);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nextStreak = lastPracticeDate === today
    ? Math.max(progressRow.streak || 0, 1)
    : lastPracticeDate === yesterday
      ? (progressRow.streak || 0) + 1
      : 1;

  const { data: updatedProgress, error: updateProgressError } = await supabaseAdmin
    .from('child_progress')
    .update({
      xp: (progressRow.xp || 0) + reward,
      streak: nextStreak,
      longest_streak: Math.max(progressRow.longest_streak || 0, nextStreak),
      last_practice_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq('child_id', childId)
    .select()
    .maybeSingle();
  if (updateProgressError || !updatedProgress) {
    throw updateProgressError || new Error('Unable to update child progress for Word of the Day.');
  }

  return {
    already_completed: false,
    completed: true,
    streak: updatedProgress.streak,
    longest_streak: updatedProgress.longest_streak,
    attempts: updatedAttempts,
    xp_awarded: reward,
    total_xp: updatedProgress.xp,
  };
};

const callWordOfDayCompletionRpc = async (childId, accuracy, isCorrect) => {
  const attempts = [
    {
      name: 'complete_personalized_word_of_day_attempt',
      params: {
        p_child_id: childId,
        p_accuracy: accuracy,
        p_is_correct: isCorrect,
      },
    },
    {
      name: 'complete_word_of_day_attempt',
      params: {
        p_child_id: childId,
        p_accuracy: accuracy,
        p_is_correct: isCorrect,
      },
    },
  ];

  for (const attempt of attempts) {
    const { data, error } = await supabaseAdmin.rpc(attempt.name, attempt.params);
    if (!error) {
      return Array.isArray(data) ? data[0] : data;
    }

    const message = String(error.message || '').toLowerCase();
    if (attempt.name === 'complete_personalized_word_of_day_attempt') {
      if (message.includes('uuid = text') || message.includes('operator does not exist') || message.includes('does not exist')) {
        console.warn('[SpeechAPI] falling back from personalized Word-of-the-Day RPC to legacy completion:', error.message);
        continue;
      }
    }
    if (attempt.name === 'complete_word_of_day_attempt') {
      if (message.includes('uuid = text') || message.includes('operator does not exist')) {
        console.warn('[SpeechAPI] falling back from legacy Word-of-the-Day RPC to direct completion:', error.message);
        continue;
      }
    }

    throw error;
  }

  return completeWordOfDayAttemptDirect(childId, accuracy, isCorrect);
};

const completeWordOfDay = async (childId, word, transcript) => {
  const accuracy = wordAccuracy(transcript, word);
  const { data: previousSessions } = await supabaseAdmin
    .from('pronunciation_practice_sessions')
    .select('accuracy_percentage')
    .eq('student_id', childId)
    .eq('word', word)
    .order('created_at', { ascending: false })
    .limit(1);
  const completion = await callWordOfDayCompletionRpc(childId, accuracy, accuracy >= 80);
  return {
    accuracy,
    completion,
    previousAccuracy: previousSessions?.[0]?.accuracy_percentage ?? null,
  };
};

// Native mobile recognition already powers Practice successfully. Word of the
// Day sends its transcript here so authentication, expected-word lookup,
// scoring, and completion remain server-owned without exposing cloud secrets
// in the APK or requiring unavailable Railway ADC credentials.
router.post('/word-of-day-result', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const transcript = String(req.body?.transcript || '').trim();
    if (!transcript) return postJson(res, 400, { success: false, message: 'No speech transcript was provided.' });
    if (transcript.length > 500) return postJson(res, 400, { success: false, message: 'Speech transcript is too long.' });

    const verified = await authenticateWordOfDay(req);
    if (verified.errorStatus) return postJson(res, verified.errorStatus, { success: false, message: verified.errorMessage });
    if (verified.log.correct) {
      return postJson(res, 200, {
        success: true,
        alreadyCompleted: true,
        transcript: '',
        accuracy: 100,
        message: "You already completed today's Word of the Day. Come back tomorrow!",
      });
    }

    const result = await completeWordOfDay(verified.childId, verified.log.word, transcript);
    if (result.completion?.already_completed) {
      return postJson(res, 200, {
        success: true,
        alreadyCompleted: true,
        transcript: '',
        accuracy: 100,
        completion: result.completion,
        message: "You already completed today's Word of the Day. Come back tomorrow!",
      });
    }
    const durationValue = Number(req.body?.durationSeconds);
    const durationSeconds = Number.isFinite(durationValue) && durationValue >= 0 ? Math.trunc(durationValue) : null;
    const attemptNumber = result.completion?.attempts || 1;
    const paceScore = durationSeconds == null ? 70 : Math.max(0, Math.min(100, durationSeconds <= 15 ? 100 : 100 - ((durationSeconds - 15) * 3)));
    const attemptEfficiency = Math.max(0, 100 - ((attemptNumber - 1) * 20));
    const confidenceScore = Math.round((result.accuracy * 0.70) + (paceScore * 0.10) + (attemptEfficiency * 0.20));
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('pronunciation_practice_sessions')
      .insert({
        student_id: verified.childId,
        word: verified.log.word,
        spoken_text: transcript,
        accuracy_percentage: result.accuracy,
        is_correct: result.accuracy >= 80,
        practice_source: 'word_of_day',
        duration_seconds: durationSeconds,
        attempts: attemptNumber,
        confidence_score: confidenceScore,
        recommendation_reason: verified.log.recommendation_reason || null,
      })
      .select('id')
      .maybeSingle();
    if (sessionError) console.warn('[SpeechAPI] Word-of-the-Day session log failed:', sessionError.message || sessionError);

    if (verified.log.content_id) {
      const { error: contentError } = await supabaseAdmin.rpc('record_student_content_attempt', {
        p_student_id: verified.childId,
        p_content_id: verified.log.content_id,
        p_accuracy: result.accuracy,
        p_transcript: transcript,
        p_duration_seconds: durationSeconds,
        p_is_full_submission: false,
        p_source: 'recommendation',
      });
      if (contentError) console.warn('[SpeechAPI] Word-of-the-Day curriculum attempt failed:', contentError.message || contentError);
    }
    const { data: recentConfusions } = await supabaseAdmin.from('phoneme_confusion')
      .select('confusion_key').eq('student_id', verified.childId).eq('target_word', verified.log.word)
      .order('created_at', { ascending: false }).limit(1);
    const feedback = buildAttemptFeedback({
      target: verified.log.word,
      accuracy: result.accuracy,
      previousAccuracy: result.previousAccuracy,
      confusions: recentConfusions || [],
    });
    return postJson(res, 200, { success: true, transcript, feedback, sessionId: session?.id || null, ...result });
  } catch (error) {
    console.error('[SpeechAPI] native Word-of-the-Day result failed:', {
      message: error?.message,
      code: error?.code,
    });
    return postJson(res, 500, { success: false, message: 'We could not save that attempt. Please try again.' });
  }
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
      if (verified.log.correct) return postJson(res, 200, { success: true, alreadyCompleted: true, transcript: '', accuracy: 100, message: "You already completed today's Word of the Day. Come back tomorrow!" });
      wordOfDay = { childId: verified.childId, word: verified.log.word };
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
      const completed = await completeWordOfDay(wordOfDay.childId, wordOfDay.word, transcript);
      completion = completed.completion;
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
