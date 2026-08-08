require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const GOOGLE_TTS_API_KEY = (process.env.GOOGLE_TTS_API_KEY || '').trim();
const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
// The v1 endpoint does not support enableTimePointing at all (confirmed live:
// it 400s with "Unknown name enableTimePointing"). Only v1beta1 returns real
// timepoints for SSML <mark> tags - confirmed live against fil-PH-Wavenet-A
// and fil-PH-Wavenet-C. Used only by /speak-syllables below; the plain
// /speak path is left on v1, unchanged, to avoid any behavior risk to the
// existing normal-speed playback path.
const TTS_ENDPOINT_BETA = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const CACHE_BUCKET = 'tts-cache';
const DEFAULT_VOICE = 'fil-PH-Wavenet-A';
const ALLOWED_VOICES = new Set(['fil-PH-Wavenet-A', 'fil-PH-Wavenet-C']);
const LANGUAGE_CODE = 'fil-PH';

// Google bills per character - this is a hard ceiling on any single request,
// independent of the free-tier/cost tracking below (protects against a
// pathological caller sending a huge blob of text in one call).
const MAX_TEXT_LENGTH = 500;
const MAX_SYLLABLES = 12;
const KARAOKE_CACHE_PREFIX = 'karaoke';
const DEFAULT_KARAOKE_RATE = 0.5;
const MIN_KARAOKE_RATE = 0.25;
const MAX_KARAOKE_RATE = 1.0;

const postJson = (res, statusCode, payload) => res.status(statusCode).json(payload);

const cacheKeyFor = (text, voice) =>
  crypto.createHash('sha256').update(`${voice}::${text}`).digest('hex');

// Separate key space from cacheKeyFor: rate and per-syllable boundaries are
// both part of the audio identity here (a slow, marked-up "ka-li-ka-san"
// request is a completely different synthesis than the normal-speed plain
// "kalikasan" request cached above), so both feed the hash, and the object
// path is further namespaced under karaoke/ so the two caches can never
// collide even if a hash somehow matched.
const karaokeCacheKeyFor = (syllables, voice, rate) =>
  crypto.createHash('sha256').update(`${voice}::${rate}::${syllables.join('|')}`).digest('hex');

const escapeSsmlText = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const buildMarkedSsml = (syllables) => {
  const body = syllables.map((syllable, index) => `<mark name="s${index}"/>${escapeSsmlText(syllable)}`).join('');
  return `<speak>${body}</speak>`;
};

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

router.post('/speak-syllables', async (req, res) => {
  try {
    const rawSyllables = Array.isArray(req.body?.syllables) ? req.body.syllables : [];
    const syllables = rawSyllables.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    const requestedVoice = typeof req.body?.voice === 'string' ? req.body.voice.trim() : '';
    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE;
    const requestedRate = Number(req.body?.rate);
    const rate = Number.isFinite(requestedRate)
      ? Math.min(MAX_KARAOKE_RATE, Math.max(MIN_KARAOKE_RATE, requestedRate))
      : DEFAULT_KARAOKE_RATE;

    if (!syllables.length) {
      return postJson(res, 400, { success: false, message: 'Missing syllables to synthesize.' });
    }
    if (syllables.length > MAX_SYLLABLES) {
      return postJson(res, 400, { success: false, message: `Too many syllables (max ${MAX_SYLLABLES}).` });
    }
    const joinedLength = syllables.join('').length;
    if (joinedLength > MAX_TEXT_LENGTH) {
      return postJson(res, 400, { success: false, message: `Text is too long (max ${MAX_TEXT_LENGTH} characters).` });
    }
    if (!GOOGLE_TTS_API_KEY) {
      return postJson(res, 503, { success: false, message: 'Cloud text-to-speech is not configured.' });
    }

    await ensureCacheBucket();

    const cacheKey = karaokeCacheKeyFor(syllables, voice, rate);
    const audioPath = `${KARAOKE_CACHE_PREFIX}/${cacheKey}.mp3`;
    const metaPath = `${KARAOKE_CACHE_PREFIX}/${cacheKey}.json`;
    const { data: audioUrlData } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(audioPath);
    const { data: metaUrlData } = supabaseAdmin.storage.from(CACHE_BUCKET).getPublicUrl(metaPath);
    const publicUrl = audioUrlData?.publicUrl;
    const metaUrl = metaUrlData?.publicUrl;

    // Timepoints aren't embedded in the mp3 bytes, so a cache hit needs both
    // the audio object AND its metadata JSON to be usable - if either is
    // missing (e.g. a partial write from a previous failed request), this
    // falls through and resynthesizes rather than returning audio with no
    // (or stale) timing data.
    if (publicUrl && metaUrl) {
      try {
        const [audioHead, metaResponse] = await Promise.all([
          fetch(publicUrl, { method: 'HEAD' }),
          fetch(metaUrl),
        ]);
        if (audioHead.ok && metaResponse.ok) {
          const meta = await metaResponse.json().catch(() => null);
          if (Array.isArray(meta?.timepoints) && meta.timepoints.length === syllables.length) {
            console.log('[TTS] karaoke cache hit', { voice, rate, syllableCount: syllables.length });
            return postJson(res, 200, { success: true, url: publicUrl, timepoints: meta.timepoints, cached: true });
          }
        }
      } catch (headError) {
        console.warn('[TTS] karaoke cache check failed, synthesizing fresh:', headError?.message || headError);
      }
    }

    const ssml = buildMarkedSsml(syllables);
    const googleResponse = await fetch(`${TTS_ENDPOINT_BETA}?key=${encodeURIComponent(GOOGLE_TTS_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: LANGUAGE_CODE, name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
        enableTimePointing: ['SSML_MARK'],
      }),
    });

    const googlePayload = await googleResponse.json().catch(() => ({}));

    if (!googleResponse.ok || !googlePayload?.audioContent) {
      console.error('[TTS] Google karaoke synthesis failed:', {
        status: googleResponse.status,
        error: googlePayload?.error?.message || googlePayload,
      });
      return postJson(res, 502, { success: false, message: 'Could not generate syllable speech right now.' });
    }

    // Google returns timepoints unordered - restore syllable order by the
    // numeric suffix on the mark name ("s0", "s1", ...) rather than trusting
    // array order.
    const timepoints = (Array.isArray(googlePayload.timepoints) ? googlePayload.timepoints : [])
      .map((tp) => ({ markName: tp.markName, timeSeconds: Number(tp.timeSeconds) || 0 }))
      .sort((a, b) => Number(String(a.markName).slice(1)) - Number(String(b.markName).slice(1)));

    console.log('[TTS] karaoke usage', { voice, rate, syllableCount: syllables.length, characters: joinedLength, cached: false });

    const audioBuffer = Buffer.from(googlePayload.audioContent, 'base64');

    const [{ error: uploadError }, { error: metaUploadError }] = await Promise.all([
      supabaseAdmin.storage.from(CACHE_BUCKET).upload(audioPath, audioBuffer, { contentType: 'audio/mpeg', upsert: true }),
      supabaseAdmin.storage.from(CACHE_BUCKET).upload(
        metaPath,
        Buffer.from(JSON.stringify({ timepoints, syllables, voice, rate })),
        { contentType: 'application/json', upsert: true },
      ),
    ]);

    if (uploadError || metaUploadError) {
      // Same best-effort caching policy as /speak: the student still gets
      // their audio + timepoints even if the cache write fails.
      console.warn('[TTS] Failed to cache karaoke audio/metadata:', uploadError?.message || metaUploadError?.message);
      return postJson(res, 200, {
        success: true,
        audioContent: googlePayload.audioContent,
        timepoints,
        cached: false,
      });
    }

    return postJson(res, 200, { success: true, url: publicUrl, timepoints, cached: false });
  } catch (err) {
    console.error('[TTS] /speak-syllables failed:', { message: err?.message, stack: err?.stack });
    return postJson(res, 500, { success: false, message: 'Could not generate syllable speech right now.' });
  }
});

module.exports = router;
