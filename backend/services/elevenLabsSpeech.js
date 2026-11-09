const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const TYPES = { 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };
const failure = (status, code, publicMessage) => Object.assign(new Error(code), { status, code, publicMessage });

async function transcribeFilipinoAudio({ audio, mimeType }, { apiKey = process.env.ELEVENLABS_API_KEY, fetchImpl = global.fetch } = {}) {
  if (!apiKey?.trim()) throw failure(503, 'SPEECH_NOT_CONFIGURED', 'Hindi pa handa ang pagkilala sa boses. Subukan muli mamaya.');
  const extension = TYPES[mimeType];
  if (!extension || !Buffer.isBuffer(audio) || audio.length < 256 || audio.length > MAX_AUDIO_BYTES) {
    throw failure(400, 'INVALID_RECORDING', 'Hindi mabasa ang recording. I-record muli ang iyong bigkas.');
  }
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), `reading.${extension}`);
  form.append('model_id', 'scribe_v2');
  form.append('language_code', 'fil');
  form.append('tag_audio_events', 'false');
  form.append('diarize', 'false');
  // Send the actual recording only. Expected answers/keyterms must not bias
  // transcription into awarding a correct answer the learner did not say.
  let response;
  try {
    response = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': apiKey.trim() }, body: form,
      signal: AbortSignal.timeout(35000),
    });
  } catch { throw failure(503, 'SPEECH_UNAVAILABLE', 'Hindi makakonekta sa pagkilala ng boses. Subukan muli.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw failure(429, 'SPEECH_BUSY', 'Sandali lang. Subukan muli ang pagbigkas.');
    if ([400, 422].includes(response.status)) throw failure(422, 'INVALID_RECORDING', 'Hindi malinaw ang recording. I-record muli ang iyong bigkas.');
    throw failure(503, 'SPEECH_UNAVAILABLE', 'Hindi pa handa ang pagkilala sa boses. Subukan muli mamaya.');
  }
  const transcript = typeof body.text === 'string' ? body.text.trim() : '';
  const words = Array.isArray(body.words) ? body.words.filter(word => word.type === 'word' && word.text?.trim()) : [];
  if (!transcript || !words.length) throw failure(422, 'NO_SPEECH', 'Walang malinaw na narinig. Lumapit sa mikropono at subukan muli.');
  // Recognition is separate from assessment: this endpoint never saves an
  // answer, creates progress, awards XP, or invents a pronunciation score.
  return { transcript, languageCode: 'fil', provider: 'elevenlabs' };
}
module.exports = { transcribeFilipinoAudio, MAX_AUDIO_BYTES, TYPES };
