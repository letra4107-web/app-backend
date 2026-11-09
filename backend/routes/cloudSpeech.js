const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { createStudentGuard } = require('../middleware/studentIdentity');
const { transcribeFilipinoAudio, MAX_AUDIO_BYTES, TYPES } = require('../services/elevenLabsSpeech');

function createCloudSpeechRouter({ client = supabaseAdmin, transcribe = transcribeFilipinoAudio, maxRequests = 30 } = {}) {
  const router = express.Router();
  const requests = new Map();
  router.use(createStudentGuard(client));
  router.post('/transcribe', async (req, res) => {
    const now = Date.now();
    const studentId = req.authenticatedStudentId;
    let usage = requests.get(studentId);
    if (!usage || usage.resetAt <= now) { usage = { count: 0, resetAt: now + 60000 }; requests.set(studentId, usage); }
    if (usage.count >= maxRequests) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((usage.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, message: 'Sandali lang. Subukan muli ang pagbigkas.' });
    }
    usage.count++;
    if (requests.size > 5000) for (const [key, value] of requests) if (value.resetAt <= now) requests.delete(key);
    const encoded = req.body?.audioBase64;
    const mimeType = String(req.body?.mimeType || '').toLowerCase().split(';')[0].trim();
    if (typeof encoded !== 'string' || !encoded || !TYPES[mimeType]) {
      return res.status(400).json({ success: false, message: 'I-record muna ang iyong bigkas.' });
    }
    if (encoded.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
      return res.status(413).json({ success: false, message: 'Masyadong mahaba ang recording. Subukan ang mas maikling bigkas.' });
    }
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return res.status(400).json({ success: false, message: 'Hindi mabasa ang recording. I-record muli ang iyong bigkas.' });
    }
    const audio = Buffer.from(encoded, 'base64');
    if (audio.length < 256 || audio.length > MAX_AUDIO_BYTES || audio.toString('base64') !== encoded) {
      return res.status(400).json({ success: false, message: 'Hindi mabasa ang recording. I-record muli ang iyong bigkas.' });
    }
    try {
      const result = await transcribe({ audio, mimeType });
      return res.json({ success: true, ...result });
    } catch (error) {
      console.warn('[CloudSpeech] request failed', { code: error.code || 'UNKNOWN', status: error.status || 503 });
      return res.status(error.status || 503).json({ success: false, code: error.code || 'SPEECH_UNAVAILABLE', message: error.publicMessage || 'Hindi naproseso ang bigkas. Subukan muli.' });
    }
  });
  return router;
}
module.exports = createCloudSpeechRouter();
module.exports.createCloudSpeechRouter = createCloudSpeechRouter;
