'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const express = require('express');

// Isolate routing from credentials, real learner records and scheduled jobs.
require.cache[require.resolve('../config/supabase')] = {
  exports: { supabaseAdmin: {} },
};
const { createModulesRouter } = require('../routes/modules');
const childId = '11111111-1111-4111-8111-111111111111';

test('Parent path bypasses student-only middleware while Student path stays available', async () => {
  const reads = [];
  const client = {
    auth: { getUser: async token => ({ data: { user: { id: token } }, error: null }) },
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        async maybeSingle() {
          reads.push({ table, filters });
          return { data: table === 'users' ? { role: 'parent' } : { id: childId }, error: null };
        },
      };
      return query;
    },
    rpc: async (_name, args) => ({ data: { effective_level: 'Beginner', modules: [], child: args.p_student_id }, error: null }),
  };
  const app = express();
  app.use('/api/modules', createModulesRouter(client));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = path => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path, headers: { Authorization: 'Bearer test-account' } }, response => {
      let body = '';
      response.on('data', part => { body += part; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
  try {
    const parent = await request(`/api/modules/parent-path/${childId}`);
    assert.equal(parent.status, 200);
    assert.equal(parent.body.path.child, childId);
    assert.deepEqual(reads.find(read => read.table === 'children').filters, [['id', childId], ['parent_id', 'test-account']]);
    reads.length = 0;
    const student = await request('/api/modules/path');
    assert.equal(student.status, 200);
    assert.equal(student.body.path.child, childId);
    assert.deepEqual(reads.find(read => read.table === 'children').filters, [['auth_uid', 'test-account']]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
