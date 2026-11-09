const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { transcribeFilipinoAudio } = require('../services/elevenLabsSpeech');
require.cache[require.resolve('../config/supabase')] = { exports: { supabaseAdmin: {} } };
const { createCloudSpeechRouter } = require('../routes/cloudSpeech');
const audio = Buffer.alloc(512, 1);
const mimeType = 'audio/mp4';

test('ElevenLabs receives Filipino audio without expected-answer bias or identity', async () => {
  let request;
  const result = await transcribeFilipinoAudio({ audio, mimeType }, { apiKey: 'test-secret', fetchImpl: async (url, options) => {
    request = options;
    assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
    return { ok: true, json: async () => ({ text: ' walo ', words: [{ type: 'word', text: 'walo' }] }) };
  } });
  assert.deepEqual(result, { transcript: 'walo', languageCode: 'fil', provider: 'elevenlabs' });
  assert.equal(request.body.get('model_id'), 'scribe_v2');
  assert.equal(request.body.get('language_code'), 'fil');
  assert.equal(request.body.get('diarize'), 'false');
  assert.deepEqual(Buffer.from(await request.body.get('file').arrayBuffer()), audio);
  assert.deepEqual([...request.body.keys()].sort(), ['diarize', 'file', 'language_code', 'model_id', 'tag_audio_events']);
});
test('silence and audio-event-only responses never become a learner answer', async () => {
  for (const body of [{ text: '', words: [] }, { text: '[noise]', words: [{ type: 'audio_event', text: '[noise]' }] }]) {
    await assert.rejects(transcribeFilipinoAudio({ audio, mimeType }, { apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => body }) }), error => error.status === 422 && error.code === 'NO_SPEECH');
  }
});
test('provider failures return safe errors without echoing provider secrets', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(transcribeFilipinoAudio({ audio, mimeType }, { apiKey: 'secret', fetchImpl: async () => ({ ok: false, status, json: async () => ({ detail: 'private provider diagnostic' }) }) }), error => {
      assert.equal(error.status, status === 429 ? 429 : 503);
      assert.equal(error.message.includes('private'), false);
      assert.equal(error.publicMessage.includes('secret'), false);
      return true;
    });
  }
});

const client = {
  auth: { getUser: async token => ({ data: { user: token === 'invalid' ? null : { id: token } } }) },
  from(table) {
    assert.equal(table, 'children', 'Transcription must not write progress, scores, or XP.');
    let uid;
    return { select() { return this; }, eq(_key, value) { uid = value; return this; }, async maybeSingle() { return { data: uid === 'student' ? { id: 'child' } : null }; } };
  },
};
async function withApi(action, options = {}) {
  let calls = 0;
  const app = express(); app.use(express.json({ limit: '4mb' }));
  app.use('/speech', createCloudSpeechRouter({ client, transcribe: async input => { calls++; assert.equal(input.mimeType, mimeType); return { transcript: 'walo' }; }, ...options }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const post = async (token, body = { audioBase64: audio.toString('base64'), mimeType }) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/speech/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try { await action(post, () => calls); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('authentication and a stored student identity are required before provider use', () => withApi(async (post, calls) => {
  assert.equal((await post()).status, 401);
  assert.equal((await post('invalid')).status, 401);
  assert.equal((await post('parent')).status, 403);
  assert.equal(calls(), 0);
}));
test('iOS M4A recording is accepted and returns transcription without awarding progress', () => withApi(async (post, calls) => {
  const result = await post('student'); assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, transcript: 'walo' });
  assert.equal(calls(), 1);
}));
test('invalid base64 and unsupported formats never call the provider', () => withApi(async (post, calls) => {
  assert.equal((await post('student', { audioBase64: 'not valid audio', mimeType })).status, 400);
  assert.equal((await post('student', { audioBase64: audio.toString('base64'), mimeType: 'image/png' })).status, 400);
  assert.equal(calls(), 0);
}));
test('the provider is rate limited per verified student', () => withApi(async (post, calls) => {
  assert.equal((await post('student')).status, 200);
  assert.equal((await post('student')).status, 429);
  assert.equal(calls(), 1);
}, { maxRequests: 1 }));
