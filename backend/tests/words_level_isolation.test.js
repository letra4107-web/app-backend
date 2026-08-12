const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.NODE_ENV = 'test';

const { createWordsRouter } = require('../routes/words');

class Query {
  constructor(table, state) { this.table = table; this.state = state; this.filters = []; }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  neq(column, value) { this.filters.push([`${column}:neq`, value]); return this; }
  maybeSingle() {
    assert.strictEqual(this.table, 'children');
    return Promise.resolve({ data: { id: 'student-1' }, error: null });
  }
  then(resolve) {
    assert.strictEqual(this.table, 'words');
    this.state.wordLevel = this.filters.find(([column]) => column === 'level')?.[1];
    return Promise.resolve({
      data: [{ id: 'beginner-word', word: 'baka', level: this.state.wordLevel }], error: null,
    }).then(resolve);
  }
}

const createSupabase = () => {
  const state = { wordLevel: null };
  return {
    state,
    auth: { getUser: async (token) => token === 'valid-token'
      ? { data: { user: { id: 'auth-1' } }, error: null }
      : { data: { user: null }, error: { message: 'invalid' } } },
    from: (table) => new Query(table, state),
    rpc: async (name, params) => {
      assert.strictEqual(name, 'get_student_reading_progress');
      assert.deepStrictEqual(params, { p_student_id: 'student-1' });
      return { data: { effective_level: 'Beginner' }, error: null };
    },
  };
};

const request = (port, path, token) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: '127.0.0.1', port, path,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  });
  req.on('error', reject);
  req.end();
});

(async () => {
  const supabase = createSupabase();
  const app = express();
  app.use('/api/words', createWordsRouter(supabase));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    assert.strictEqual((await request(server.address().port, '/api/words')).status, 401);
    const forged = await request(
      server.address().port,
      '/api/words?level=advanced&limit=10',
      'valid-token',
    );
    assert.strictEqual(forged.status, 200);
    assert.strictEqual(forged.body.effectiveLevel, 'beginner');
    assert.strictEqual(supabase.state.wordLevel, 'beginner');
    assert(forged.body.words.every((word) => word.level === 'beginner'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('words_level_isolation.test.js passed');
})().catch((error) => { console.error(error); process.exit(1); });
