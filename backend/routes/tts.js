require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const GOOGLE_TTS_API_KEY = (process.env.GOOGLE_TTS_API_KEY || '').trim();
const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const CACHE_BUCKET = 'tts-cache';
const DEFAULT_VOICE = 'fil-PH-Wavenet-A';
const ALLOWED_VOICES = new Set(['fil-PH-Wavenet-A', 'fil-PH-Wavenet-C']);
const LANGUAGE_CODE = 'fil-PH';

// Google bills per character - this is a hard ceiling on any single request,
// independent of the free-tier/cost tracking below (protects against a
// pathological caller sending a huge blob of text in one call).
const MAX_TEXT_LENGTH = 500;

const postJson = (res, statusCode, payload) => res.status(statusCode).json(payload);

const cacheKeyFor = (text, voice) =>
  crypto.createHash('sha256').update(`${voice}::${text}`).digest('hex');

// Supabase Storage has no "create if not exists" - listBuckets/createBucket
// is the closest thing, and createBucket simply errors (harmlessly) if the
// bucket is already there. Memoized so this only runs once per server
// process, not on every request.
let bucketReadyPromise = null;
function ensureCacheBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = supabaseAdmin.storage
      .createBucket(CACHE_BUCKET, { public: true, fileSizeLimit: '5MB' })
      .then(({ error }) => {
        if (error && !/already exists/i.test(error.message || '')) {
          console.warn('[TTS] Could not ensure cache bucket exists:', error.message);
        }
      })
      .catch((error) => {
        console.warn('[TTS] ensureCacheBucket failed:', error?.message || error);
      });
  }
  return bucketReadyPromise;
}

router.post('/speak', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const requestedVoice = typeof req.body?.voice === 'string' ? req.body.voice.trim() : '';
    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE;

    if (!text) {
      return postJson(res, 400, { success: false, message: 'Missing text to synthesize.' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return postJson(res, 400, { success: false, message: `Text is too long (max ${MAX_TEXT_LENGTH} characters).` });
    }
    if (!GOOGLE_TTS_API_KEY) {
      return postJson(res, 503, { success: false, message: 'Cloud text-to-speech is not configured.' });
    }

    await ensureCacheBucket();

    const cacheKey = cacheKeyFor(text, voice);
    const cachePath = `${cacheKey}.mp3`;
    const { data: publicUrlData } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(cachePath);
    const publicUrl = publicUrlData?.publicUrl;

    // Cache check: a public bucket means we can just HEAD the object's public
    // URL rather than doing a signed download - cheap, and works the same
    // whether or not the bucket-listing permissions are fully configured.
    if (publicUrl) {
      try {
        const headResponse = await fetch(publicUrl, { method: 'HEAD' });
        if (headResponse.ok) {
          console.log('[TTS] cache hit', { voice, characters: text.length });
          return postJson(res, 200, { success: true, url: publicUrl, cached: true });
        }
      } catch (headError) {
        // Cache-check failing is not fatal - fall through and synthesize fresh.
        console.warn('[TTS] cache HEAD check failed, synthesizing fresh:', headError?.message || headError);
      }
    }

    const googleResponse = await fetch(`${TTS_ENDPOINT}?key=${encodeURIComponent(GOOGLE_TTS_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: LANGUAGE_CODE, name: voice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });

    const googlePayload = await googleResponse.json().catch(() => ({}));

    if (!googleResponse.ok || !googlePayload?.audioContent) {
      console.error('[TTS] Google synthesis failed:', {
        status: googleResponse.status,
        error: googlePayload?.error?.message || googlePayload,
      });
      return postJson(res, 502, { success: false, message: 'Could not generate speech right now.' });
    }

    // Usage tracking: character count per real (non-cached) API call, so
    // Railway logs can be grepped for "[TTS] usage" to tally spend against
    // the 1M free WaveNet characters/month.
    console.log('[TTS] usage', { voice, characters: text.length, cached: false });

    const audioBuffer = Buffer.from(googlePayload.audioContent, 'base64');

    const { error: uploadError } = await supabaseAdmin.storage
      .from(CACHE_BUCKET)
      .upload(cachePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

    if (uploadError) {
      // Caching is best-effort - the student still gets their audio even if
      // the cache write fails, they just won't benefit from it next time.
      console.warn('[TTS] Failed to cache audio:', uploadError.message);
      return postJson(res, 200, {
        success: true,
        audioContent: googlePayload.audioContent,
        cached: false,
      });
    }

    return postJson(res, 200, { success: true, url: publicUrl, cached: false });
  } catch (err) {
    console.error('[TTS] /speak failed:', { message: err?.message, stack: err?.stack });
    return postJson(res, 500, { success: false, message: 'Could not generate speech right now.' });
  }
});

module.exports = router;
