const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { availablePracticeWords } = require('../services/practiceWordAccess');
require.cache[require.resolve('../config/supabase')] = { exports: { supabaseAdmin: {} } };
const { createWordsRouter } = require('../routes/words');
const link = (id, role = 'instruction', active = true) => ({ module_id: id, role, reading_modules: { is_active: active } });
const word = (id, links = []) => ({ id, word_id: 'legacy-' + id, content_text: id, level: 'Beginner', is_assessment: false, reading_module_items: links });
const scope = (allowed = []) => ({ calls: [], async rpc(name, args) {
  assert.equal(name, 'is_student_module_unlocked'); assert.equal(args.p_student_id, 'learner');
  this.calls.push(args.p_module_id); return { data: allowed.includes(args.p_module_id), error: null };
} });

test('word bank excludes words that the save RPC rejects as Module is locked', async () => {
  const client = scope(['open']);
  const rows = [word('ordinary'), word('open-word', [link('open')]), word('locked-word', [link('locked')])];
  assert.deepEqual((await availablePracticeWords(client, 'learner', rows)).map(w => w.id), ['ordinary', 'open-word']);
});
test('inactive module history does not hide usable words', async () => {
  const client = scope();
  assert.equal((await availablePracticeWords(client, 'learner', [word('review', [link('old', 'instruction', false)])])).length, 1);
  assert.deepEqual(client.calls, []);
});
test('assessment membership cannot unlock practice; an open instructional membership can', async () => {
  const client = scope(['open']);
  const rows = [word('assessment-only', [link('open', 'assessment')]), word('shared', [link('locked'), link('open', 'practice')])];
  assert.deepEqual((await availablePracticeWords(client, 'learner', rows)).map(w => w.id), ['shared']);
});
test('canonical assessment content stays excluded even without module membership', async () => {
  assert.deepEqual(await availablePracticeWords(scope(), 'learner', [{ ...word('exam'), is_assessment: true }]), []);
});
test('one authoritative access check per distinct module; newly unlocked words become available', async () => {
  const rows = [word('one', [link('module')]), word('two', [link('module')])], before = scope();
  assert.equal((await availablePracticeWords(before, 'learner', rows)).length, 0); assert.deepEqual(before.calls, ['module']);
  assert.equal((await availablePracticeWords(scope(['module']), 'learner', rows)).length, 2);
});
test('access lookup failures and missing module metadata never expose locked words', async () => {
  for (const result of [{ error: { code: 'PGRST202' } }, { data: null }, { data: 'true' }]) {
    await assert.rejects(availablePracticeWords({ rpc: async () => result }, 'learner', [word('target', [link('module')])]));
  }
  await assert.rejects(availablePracticeWords(scope(), 'learner', [word('target', [{ module_id: 'module', role: 'practice', reading_modules: null }])]));
});
test('actual word-bank HTTP response only offers targets that the learner may submit', async () => {
  const rows = [word('mata', [link('later')]), word('kumot')];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth' } } }) },
    from(table) {
      const query = { select() { return query; }, eq() { return query; },
        async maybeSingle() { return { data: { id: 'learner' } }; },
        then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); } };
      assert(['children', 'reading_content'].includes(table));return query;
    },
    async rpc(name) { return { data: name === 'get_student_reading_progress' ? { effective_level: 'Beginner' } : false }; },
  };
  const app = express(); app.use('/words', createWordsRouter(client));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/words?level=advanced&limit=100`, { headers: { Authorization: 'Bearer test' } });
    assert.equal(response.status, 200);const data = await response.json();
    assert.equal(data.effectiveLevel, 'beginner');assert.deepEqual(data.words.map(w => w.word), ['kumot']);
    assert.equal(data.words[0].contentId, 'kumot');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
