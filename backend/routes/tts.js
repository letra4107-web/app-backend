require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();
const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_VOICE_ID = (process.env.ELEVENLABS_VOICE_ID || '').trim();
const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const CACHE_BUCKET = 'tts-cache';
const MAX_TEXT_LENGTH = 500;
const MAX_SYLLABLES = 12;
const KARAOKE_CACHE_PREFIX = 'karaoke';

const postJson = (res, statusCode, payload) => res.status(statusCode).json(payload);
const cacheKeyFor = (text, kind) => crypto.createHash('sha256')
  .update(`elevenlabs:${ELEVENLABS_VOICE_ID}:${kind}:${text}`)
  .digest('hex');

let bucketReadyPromise = null;
function ensureCacheBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = supabaseAdmin.storage.createBucket(CACHE_BUCKET, { public: true, fileSizeLimit: '5MB' })
      .then(({ error }) => {
        if (error && !/already exists/i.test(error.message || '')) console.warn('[TTS] Could not ensure cache bucket exists:', error.message);
      })
      .catch((error) => console.warn('[TTS] ensureCacheBucket failed:', error?.message || error));
  }
  return bucketReadyPromise;
}

// The former Google route received SSML. ElevenLabs accepts plain text, so
// retain the endpoint contract while removing markup before synthesis.
function plainTextFromSsml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

async function synthesizeWithTiming(text) {
  const response = await fetch(`${ELEVENLABS_ENDPOINT}/${encodeURIComponent(ELEVENLABS_VOICE_ID)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL, apply_text_normalization: 'auto' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.audio_base64) {
    console.error('[TTS] ElevenLabs synthesis failed:', { status: response.status, error: payload?.detail || payload?.message || payload });
    throw new Error('ElevenLabs could not generate speech.');
  }
  return payload;
}

async function cachedUrl(path) {
  const { data } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) return null;
  try {
    return (await fetch(url, { method: 'HEAD' })).ok ? url : null;
  } catch {
    return null;
  }
}

async function cacheAudio(path, audioBase64) {
  const { error } = await supabaseAdmin.storage.from(CACHE_BUCKET).upload(
    path, Buffer.from(audioBase64, 'base64'), { contentType: 'audio/mpeg', upsert: true },
  );
  return error;
}

function timepointsForSyllables(syllables, alignment) {
  const starts = Array.isArray(alignment?.character_start_times_seconds)
    ? alignment.character_start_times_seconds : [];
  let offset = 0;
  return syllables.map((syllable, index) => {
    const timeSeconds = Number(starts[offset]) || 0;
    offset += syllable.length + 1; // syllables are sent separated by one space
    return { markName: `s${index}`, timeSeconds };
  });
}

function isConfigured() {
  return Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
}

router.post('/speak', async (req, res) => {
  try {
    const text = plainTextFromSsml(req.body?.ssml || req.body?.text);
    if (!text) return postJson(res, 400, { success: false, message: 'Missing text to synthesize.' });
    if (text.length > MAX_TEXT_LENGTH) return postJson(res, 400, { success: false, message: `Text is too long (max ${MAX_TEXT_LENGTH} characters).` });
    if (!isConfigured()) return postJson(res, 503, { success: false, message: 'ElevenLabs text-to-speech is not configured.' });

    await ensureCacheBucket();
    const path = `${cacheKeyFor(text, 'speech')}.mp3`;
    const url = await cachedUrl(path);
    if (url) return postJson(res, 200, { success: true, url, cached: true });

    const speech = await synthesizeWithTiming(text);
    const uploadError = await cacheAudio(path, speech.audio_base64);
    if (uploadError) {
      console.warn('[TTS] Failed to cache ElevenLabs audio:', uploadError.message);
      return postJson(res, 200, { success: true, audioContent: speech.audio_base64, cached: false });
    }
    const { data } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(path);
    console.log('[TTS] ElevenLabs usage', { characters: text.length, cached: false });
    return postJson(res, 200, { success: true, url: data?.publicUrl, cached: false });
  } catch (err) {
    console.error('[TTS] /speak failed:', { message: err?.message });
    return postJson(res, 502, { success: false, message: 'Could not generate speech right now.' });
  }
});

router.post('/speak-syllables', async (req, res) => {
  try {
    const syllables = (Array.isArray(req.body?.syllables) ? req.body.syllables : [])
      .map((s) => typeof s === 'string' ? s.trim() : '').filter(Boolean);
    if (!syllables.length) return postJson(res, 400, { success: false, message: 'Missing syllables to synthesize.' });
    if (syllables.length > MAX_SYLLABLES || syllables.join('').length > MAX_TEXT_LENGTH) {
      return postJson(res, 400, { success: false, message: 'Text is too long.' });
    }
    if (!isConfigured()) return postJson(res, 503, { success: false, message: 'ElevenLabs text-to-speech is not configured.' });

    const text = syllables.join(' ');
    await ensureCacheBucket();
    const key = cacheKeyFor(text, 'karaoke');
    const audioPath = `${KARAOKE_CACHE_PREFIX}/${key}.mp3`;
    const metaPath = `${KARAOKE_CACHE_PREFIX}/${key}.json`;
    const audioUrl = await cachedUrl(audioPath);
    if (audioUrl) {
      const { data: metaUrlData } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(metaPath);
      try {
        const metaResponse = await fetch(metaUrlData?.publicUrl);
        const meta = await metaResponse.json();
        if (metaResponse.ok && Array.isArray(meta?.timepoints) && meta.timepoints.length === syllables.length) {
          return postJson(res, 200, { success: true, url: audioUrl, timepoints: meta.timepoints, cached: true });
        }
      } catch { /* regenerate incomplete cache entries */ }
    }

    const speech = await synthesizeWithTiming(text);
    const timepoints = timepointsForSyllables(syllables, speech.alignment || speech.normalized_alignment);
    const [audioError, metaResult] = await Promise.all([
      cacheAudio(audioPath, speech.audio_base64),
      supabaseAdmin.storage.from(CACHE_BUCKET).upload(metaPath, Buffer.from(JSON.stringify({ timepoints })), { contentType: 'application/json', upsert: true }),
    ]);
    if (audioError || metaResult.error) {
      console.warn('[TTS] Failed to cache ElevenLabs karaoke audio:', audioError?.message || metaResult.error?.message);
      return postJson(res, 200, { success: true, audioContent: speech.audio_base64, timepoints, cached: false });
    }
    const { data } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(audioPath);
    console.log('[TTS] ElevenLabs karaoke usage', { syllableCount: syllables.length, characters: text.length, cached: false });
    return postJson(res, 200, { success: true, url: data?.publicUrl, timepoints, cached: false });
  } catch (err) {
    console.error('[TTS] /speak-syllables failed:', { message: err?.message });
    return postJson(res, 502, { success: false, message: 'Could not generate syllable speech right now.' });
  }
});

module.exports = router;
