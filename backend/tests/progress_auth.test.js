const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.NODE_ENV = 'test';

const { createProgressRouter } = require('../routes/progress');

const request = ({ port, method = 'GET', path, token, body }) => new Promise((resolve, reject) => {
  const encoded = body == null ? null : JSON.stringify(body);
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    method,
    path,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}),
    },
  }, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody) }));
  });
  req.on('error', reject);
  if (encoded) req.write(encoded);
  req.end();
});

class ChildQuery {
  constructor(state) { this.state = state; }
  select() { return this; }
  eq(column, value) {
    assert.strictEqual(column, 'auth_uid');
    assert.strictEqual(value, this.state.authUserId);
    return this;
  }
  async maybeSingle() {
    return { data: this.state.studentId ? { id: this.state.studentId } : null, error: null };
  }
}

class ProgressQuery {
  constructor(state) { this.state = state; this.payload = null; }
  select() { return this; }
  eq(column, value) {
    assert.strictEqual(column, 'child_id');
    assert.strictEqual(value, this.state.studentId);
    return this;
  }
  async maybeSingle() {
    return { data: { achievements: [], level: 'Intermediate' }, error: null };
  }
  upsert(payload) {
    this.payload = payload;
    this.state.progressPayload = payload;
    return this;
  }
  async single() { return { data: this.payload, error: null }; }
}

const createFakeSupabase = ({ studentId = null } = {}) => {
  const state = {
    authUserId: 'student-auth-id',
    studentId,
    progressPayload: null,
    rpcCalls: [],
  };
  return {
    state,
    auth: {
      async getUser(token) {
        return token === 'valid-token'
          ? { data: { user: { id: state.authUserId } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
    from(table) {
      if (table === 'children') return new ChildQuery(state);
      if (table === 'child_progress') return new ProgressQuery(state);
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, params) {
      state.rpcCalls.push({ name, params });
      if (name === 'record_student_content_attempt') {
        return { data: { attempt_id: 'attempt-1', progression: { effective_level: 'Intermediate' } }, error: null };
      }
      if (name === 'get_student_reading_progress') {
        return { data: { effective_level: 'Intermediate', requirements: [] }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
};

const withServer = async (supabase, callback) => {
  const app = express();
  app.use(express.json());
  app.use('/api/progress', createProgressRouter(supabase));
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
    const missing = await request({ port, method: 'POST', path: '/api/progress/update', body: {} });
    assert.strictEqual(missing.status, 401);
    const invalid = await request({ port, method: 'POST', path: '/api/progress/update', token: 'bad', body: {} });
    assert.strictEqual(invalid.status, 401);
    const nonStudent = await request({ port, method: 'POST', path: '/api/progress/update', token: 'valid-token', body: {} });
    assert.strictEqual(nonStudent.status, 403);
  });

  const supabase = createFakeSupabase({ studentId: '00000000-0000-4000-8000-000000000001' });
  await withServer(supabase, async (port) => {
    const update = await request({
      port,
      method: 'POST',
      path: '/api/progress/update',
      token: 'valid-token',
      body: {
        childId: '00000000-0000-4000-8000-000000000099',
        student_id: '00000000-0000-4000-8000-000000000098',
        level: 'Advanced',
        xp: 99999,
      },
    });
    assert.strictEqual(update.status, 200);
    assert.strictEqual(supabase.state.progressPayload.child_id, supabase.state.studentId);
    assert.strictEqual(supabase.state.progressPayload.level, 'Intermediate');

    const contentAttempt = await request({
      port,
      method: 'POST',
      path: '/api/progress/content-attempt',
      token: 'valid-token',
      body: {
        student_id: '00000000-0000-4000-8000-000000000099',
        contentId: '10000000-0000-4000-8000-000000000001',
        accuracy: 75,
        source: 'practice',
      },
    });
    assert.strictEqual(contentAttempt.status, 200);
    const attemptCall = supabase.state.rpcCalls.find((call) => call.name === 'record_student_content_attempt');
    assert.strictEqual(attemptCall.params.p_student_id, supabase.state.studentId);
    assert.strictEqual(attemptCall.params.p_accuracy, 75);

    const status = await request({
      port,
      path: '/api/progress/reading-status?studentId=00000000-0000-4000-8000-000000000099',
      token: 'valid-token',
    });
    assert.strictEqual(status.status, 200);
    const statusCall = supabase.state.rpcCalls.find((call) => call.name === 'get_student_reading_progress');
    assert.strictEqual(statusCall.params.p_student_id, supabase.state.studentId);
  });

  console.log('progress_auth.test.js passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
