const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.NODE_ENV = 'test';

const { createPracticeRouter } = require('../routes/practice');

const request = ({ port, path, headers = {} }) =>
  new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });

const createFakeSupabase = ({ tokenUserId = null, childId = null } = {}) => {
  const state = { sessionStudentFilter: null };
  const sessionRows = [
    { id: 'own-session', student_id: childId, word: 'bata', accuracy_percentage: 90 },
  ];

  const childrenQuery = {
    select() { return this; },
    eq(column, value) {
      assert.strictEqual(column, 'auth_uid');
      assert.strictEqual(value, tokenUserId);
      return this;
    },
    async maybeSingle() { return { data: childId ? { id: childId } : null, error: null }; },
  };

  const sessionsQuery = {
    select() { return this; },
    eq(column, value) {
      assert.strictEqual(column, 'student_id');
      state.sessionStudentFilter = value;
      return this;
    },
    order() { return this; },
    async limit() { return { data: sessionRows, error: null }; },
  };

  return {
    state,
    auth: {
      async getUser(token) {
        if (token !== 'valid-token' || !tokenUserId) {
          return { data: { user: null }, error: { message: 'invalid token' } };
        }
        return { data: { user: { id: tokenUserId } }, error: null };
      },
    },
    from(table) {
      if (table === 'children') return childrenQuery;
      if (table === 'pronunciation_practice_sessions') return sessionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    },
  };
};

const withServer = async (supabase, callback) => {
  const app = express();
  app.use('/api/practice', createPracticeRouter(supabase));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

(async () => {
  await withServer(createFakeSupabase(), async (port) => {
    const missing = await request({ port, path: '/api/practice/sessions' });
    assert.strictEqual(missing.status, 401);

    const invalid = await request({
      port,
      path: '/api/practice/sessions',
      headers: { Authorization: 'Bearer invalid-token' },
    });
    assert.strictEqual(invalid.status, 401);
  });

  await withServer(createFakeSupabase({ tokenUserId: 'parent-auth-id' }), async (port) => {
    const nonStudent = await request({
      port,
      path: '/api/practice/sessions',
      headers: { Authorization: 'Bearer valid-token' },
    });
    assert.strictEqual(nonStudent.status, 403);
  });

  const studentSupabase = createFakeSupabase({ tokenUserId: 'student-auth-id', childId: 'own-child-id' });
  await withServer(studentSupabase, async (port) => {
    const forged = await request({
      port,
      path: '/api/practice/sessions?studentId=victim-id&studentIds=victim-a,victim-b&limit=9999',
      headers: { Authorization: 'Bearer valid-token' },
    });
    assert.strictEqual(forged.status, 200);
    assert.strictEqual(studentSupabase.state.sessionStudentFilter, 'own-child-id');
    assert.deepStrictEqual(forged.body.sessions.map((row) => row.student_id), ['own-child-id']);
  });

  console.log('practice_auth.test.js passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
