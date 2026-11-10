// Isolated Express/model integration. No .env, network provider or real database.
const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const http = require('node:http');
const express = require('express');
const tables = {}; let mailCount = 0; let failWrite = false; let failConfirmation = false;
const users = { 'user-a': { id: 'user-a', email: 'parent@example.test' }, 'user-b': { id: 'user-b', email: 'other@example.test' } };
class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.singleRow = false; }
  select() { return this; } limit(n) { this.max = n; return this; } order() { return this; }
  eq(k, v) { this.filters.push(row => row[k] === v); return this; }
  in(k, values) { this.filters.push(row => values.includes(row[k])); return this; }
  or(value) { const pairs = value.split(',').map(part => part.split('.eq.')); this.filters.push(row => pairs.some(([k, v]) => row[k] === v)); return this; }
  single() { this.singleRow = true; return this; }
  ilike(k, v) { return this.eq(k, v); }
  maybeSingle() { this.singleRow = true; return this; }
  update(payload) { this.op = 'update'; this.payload = payload; return this; }
  upsert(payload) { this.op = 'upsert'; this.payload = payload; return this; }
  insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
  delete() { this.op = 'delete'; return this; }
  then(resolve, reject) {
    try {
      if(this.table==='otp_sessions'&&this.payload&&'verified_at' in this.payload)return Promise.resolve({data:null,error:{code:'PGRST204',message:'verified_at does not exist'}}).then(resolve,reject);
      const rows = tables[this.table] ||= [];
      const matching = rows.filter(row => this.filters.every(filter => filter(row))).slice(0, this.max);
      if (failWrite && this.op !== 'select') return Promise.resolve({ data: null, error: { message: 'simulated write failure' } }).then(resolve, reject);
      let data = matching;
      if (this.op === 'update') matching.forEach(row => Object.assign(row, this.payload));
      if (this.op === 'delete') tables[this.table] = rows.filter(row => !matching.includes(row));
      if (this.op === 'upsert') {
        const existing = rows.find(row => (this.payload.user_id && row.user_id === this.payload.user_id) || (this.payload.id && row.id === this.payload.id));
        if (existing) Object.assign(existing, this.payload); else rows.push({ ...this.payload });
        data = [existing || rows.at(-1)];
      }
      if (this.op === 'insert') { rows.push({ ...this.payload }); data = [rows.at(-1)]; }
      return Promise.resolve({ data: this.singleRow ? data[0] || null : data, error: null }).then(resolve, reject);
    } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
}
const admin = {
  from: table => new Query(table),
  auth: {
    getUser: async token => ({ data: { user: token === 'parent-token' ? { ...users['user-a'], email_confirmed_at: '2026-01-01' } : null }, error: null }),
    admin: {
      getUserById: async id => ({ data: { user: users[id] }, error: users[id] ? null : { message: 'not found' } }),
      updateUserById: async (id, data) => ({ data: { user: { ...users[id], ...data } }, error: failConfirmation ? { message: 'simulated provider failure' } : null }),
      createUser: async data => ({ data: { user: { id: 'new-student', ...data } }, error: null }),
    },
  },
};
const stub = (modulePath, exports) => { const filename = require.resolve(modulePath); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
stub('../config/supabase', { supabaseAdmin: admin });
stub('../config/mailer', { transporter: { sendMail: async () => { mailCount++; } }, sendPasswordResetCodeEmail: async () => { mailCount++; } });
stub('../jobs/otpEmailQueue', { enqueueOtpEmail: () => { mailCount++; return { jobId: 'mock-job' }; } });
global.fetch = async () => { throw new Error('External network forbidden in isolated auth audit'); };
const model = require('../models/otp');
const router = require('../routes/auth');
const app = express(); app.use(express.json()); app.use('/auth', router);
const loadDataRouter = name => {
  if (process.env.MOBILE_AUDIT_BASELINE_DATA !== '1') return require('../routes/' + name);
  const { execFileSync } = require('child_process'); const Module = require('module'); const filename = require.resolve('../routes/' + name);
  const source = execFileSync('git', ['show', 'HEAD:backend/routes/' + name + '.js'], { cwd: require('path').resolve(__dirname, '../..'), encoding: 'utf8', windowsHide: true });
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  mod._compile(source, filename); return mod.exports;
};
app.use('/api/notifications', loadDataRouter('notifications'));
app.use('/api/activities', loadDataRouter('activities'));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.once('listening', resolve));
const request = async (route, body = {}, token, method = 'POST') => {
  await ready;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route.startsWith('/api/') ? route : '/auth' + route, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end(method === 'GET' ? undefined : JSON.stringify(body));
  });
};
const session = (overrides = {}) => ({ user_id: 'user-a', email: 'parent@example.test', otp: '123456', expires_at: new Date(Date.now() + 600000).toISOString(), attempts: 0, verified: false, resend_count: 0, last_resend_at: new Date(Date.now() - 61000).toISOString(), ...overrides });
beforeEach(() => { Object.keys(tables).forEach(k => delete tables[k]); tables.users = [{ id: 'user-a', email: 'parent@example.test', role: 'parent' }, { id: 'user-b', email: 'other@example.test', role: 'parent' }]; mailCount = 0; failWrite = false; failConfirmation = false; });
after(() => server.close());
test('AUTH-20: initial send is queued once and network replay reuses the same session', async () => {
  const body = { userId: 'user-a', email: 'parent@example.test', clientRequestId: 'audit-unique-initial' };
  const first = await request('/send-otp', body); const replay = await request('/send-otp', body);
  assert.equal(first.status, 200); assert.equal(first.body.emailStatus, 'queued'); assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true); assert.equal(mailCount, 1); assert.ok(replay.body.expiresInSeconds <= first.body.expiresInSeconds);
});
test('AUTH-01: OTP randomness does not use Math.random', () => {
  const original = Math.random; Math.random = () => 0;
  try { assert.ok(new Set(Array.from({ length: 20 }, model.generateOTP)).size > 1); } finally { Math.random = original; }
});
test('AUTH-02: OTP rejects mismatched recipient pairing', async () => { tables.otp_sessions = [session()]; await assert.rejects(model.verifyOTP('user-a', '123456', 'other@example.test')); });
test('AUTH-03: OTP rejects expired codes', async () => { tables.otp_sessions = [session({ expires_at: new Date(Date.now() - 1000).toISOString() })]; await assert.rejects(model.verifyOTP('user-a', '123456', 'parent@example.test')); });
test('AUTH-04: OTP rejects exhausted guesses', async () => { tables.otp_sessions = [session({ attempts: 5 })]; await assert.rejects(model.verifyOTP('user-a', '123456', 'parent@example.test')); });
test('AUTH-05: OTP rejects reuse after successful consumption', async () => { tables.otp_sessions = [session()]; await model.verifyOTP('user-a', '123456', 'parent@example.test'); await assert.rejects(model.verifyOTP('user-a', '123456', 'parent@example.test')); });
test('AUTH-06: OTP database write failure never reports success', async () => { tables.otp_sessions = [session()]; failWrite = true; await assert.rejects(model.verifyOTP('user-a', '123456', 'parent@example.test')); });
test('AUTH-07: expired resend cap allows a fresh verification window', async () => { tables.otp_sessions = [session({ resend_count: 3, expires_at: new Date(Date.now() - 1000).toISOString() })]; assert.equal((await model.canResendOTP('user-a')).allowed, true); });
test('AUTH-08: send rejects user ID and email mismatch without queuing mail', async () => { const res = await request('/send-otp', { userId: 'user-b', email: 'parent@example.test' }); assert.ok(res.status >= 400); assert.equal(mailCount, 0); });
test('AUTH-09: initial send cannot bypass resend cooldown', async () => { tables.otp_sessions = [session({ last_resend_at: new Date().toISOString() })]; const res = await request('/send-otp', { userId: 'user-a', email: 'parent@example.test' }); assert.equal(res.status, 429); assert.equal(mailCount, 0); });
test('AUTH-10: failed Auth confirmation never reports successful verification', async () => { tables.otp_sessions = [session()]; failConfirmation = true; const res = await request('/verify-otp', { userId: 'user-a', email: 'parent@example.test', code: '123456' }); assert.ok(res.status >= 400); assert.equal(res.body.success, false); });
test('AUTH-11: unprivileged role changes are rejected', async () => { const res = await request('/set-role', { uid: 'user-a', role: 'admin' }); assert.equal(res.status, 401); assert.equal(tables.users[0].role, 'parent'); });
test('AUTH-12: public student-account creation is rejected', async () => { assert.equal((await request('/create-student-account', { username: 'test', password: 'StrongPass1' })).status, 401); });
test('AUTH-13: unauthorized enrollment is rejected before mutation', async () => { assert.equal((await request('/enroll-child', { childName: 'Ana', gradeLevel: 1 })).status, 401); assert.equal(tables.children, undefined); });
test('AUTH-14: authorized enrollment validation rejects invalid grade', async () => { assert.equal((await request('/enroll-child', { childName: 'Ana', gradeLevel: 7 }, 'parent-token')).status, 400); });
test('AUTH-15: malformed verification code rejected', async () => { tables.otp_sessions = [session()]; assert.equal((await request('/verify-otp', { email: 'parent@example.test', code: '12' })).status, 400); });
test('AUTH-16: successful verification confirms exact Auth identity', async () => { tables.otp_sessions = [session()]; const res = await request('/verify-otp', { userId: 'user-a', email: 'parent@example.test', code: '123456' }); assert.equal(res.status, 200); assert.equal(res.body.userId, 'user-a'); assert.equal(tables.users[0].email_verified, true); });
test('AUTH-21: interrupted signup receives a verified parent profile only after the code is checked',async()=>{tables.users=[];tables.otp_sessions=[session()];const result=await request('/verify-otp',{userId:'user-a',email:'parent@example.test',code:'123456'});assert.equal(result.status,200);assert.equal(tables.users[0].role,'parent');assert.equal(tables.users[0].email_verified,true);});
test('AUTH-22: verification recovery gives a fresh code instead of resending an already used code',async()=>{tables.otp_sessions=[session({verified:true})];const result=await request('/resend-otp',{userId:'user-a',email:'parent@example.test'});assert.equal(result.status,200);assert.equal(tables.otp_sessions[0].verified,false);assert.equal(mailCount,1);});
test('AUTH-17: a parent cannot use the administrative role route', async () => { assert.equal((await request('/set-role', { uid: 'user-a', role: 'admin' }, 'parent-token')).status, 403); });
test('AUTH-18: resend reports the actual remaining cooldown', async () => { tables.otp_sessions = [session({ last_resend_at: new Date().toISOString() })]; const res = await request('/resend-otp', { email: 'parent@example.test', userId: 'user-a' }); assert.equal(res.status, 429); assert.ok(res.body.retryAfterSeconds > 0 && res.body.retryAfterSeconds <= 60); assert.equal(mailCount, 0); });
test('AUTH-19: unauthenticated cancellation cannot delete another verification', async () => { tables.otp_sessions = [session()]; const res = await new Promise(async (resolve, reject) => { await ready; const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/auth/cancel-verification', method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify({ email: 'parent@example.test', userId: 'user-a' })) } }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); }); req.on('error', reject); req.end(JSON.stringify({ email: 'parent@example.test', userId: 'user-a' })); }); assert.equal(res, 401); assert.equal(tables.otp_sessions.length, 1); });
test('DATA-01: notification inbox requires authentication', async () => { assert.equal((await request('/api/notifications?userId=user-a', {}, undefined, 'GET')).status, 401); });
test('DATA-02: another parent inbox is forbidden', async () => { assert.equal((await request('/api/notifications?userId=user-b', {}, 'parent-token', 'GET')).status, 403); });
test('DATA-03: own empty inbox is a successful empty result', async () => { const result = await request('/api/notifications?userId=user-a', {}, 'parent-token', 'GET'); assert.equal(result.status, 200); assert.deepEqual(result.body.notifications, []); });
test('DATA-04: notification read mutation requires authentication', async () => { assert.equal((await request('/api/notifications/other/read', {}, undefined, 'PATCH')).status, 401); });
test('DATA-05: another parent notification cannot be marked read', async () => { tables.notifications = [{ id: 'other', user_id: 'user-b', read: false }]; assert.equal((await request('/api/notifications/other/read', {}, 'parent-token', 'PATCH')).status, 403); assert.equal(tables.notifications[0].read, false); });
test('DATA-06: forged notification recipients are forbidden', async () => { assert.equal((await request('/api/notifications', { user_id: 'user-b', title: 'forged' }, 'parent-token')).status, 403); });
test('DATA-07: activities require authentication', async () => { assert.equal((await request('/api/activities?parentId=user-b', {}, undefined, 'GET')).status, 401); });
test('DATA-08: another parent activities cannot be read', async () => { assert.equal((await request('/api/activities?parentId=user-b', {}, 'parent-token', 'GET')).status, 403); });
test('DATA-09: own child activities can be read', async () => { tables.children = [{ id: 'child-a', parent_id: 'user-a', auth_uid: 'student-a' }]; tables.activities = [{ id: 'activity-a', student_id: 'child-a' }, { id: 'activity-b', student_id: 'other-child' }]; const result = await request('/api/activities?parentId=user-a', {}, 'parent-token', 'GET'); assert.equal(result.status, 200); assert.equal(result.body.activities.length, 1); assert.equal(result.body.activities[0].id, 'activity-a'); });
