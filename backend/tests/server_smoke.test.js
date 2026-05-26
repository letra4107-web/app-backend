const assert = require('assert');
const http = require('http');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.NODE_ENV = 'test';

const { startServer } = require('../server');

const server = startServer(0);

server.once('listening', () => {
  const address = server.address();
  assert(address && address.port, 'Server should bind to a port');

  const port = address.port;
  const url = `http://127.0.0.1:${port}/health`;

  http.get(url, (res) => {
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    try {
      assert.strictEqual(res.statusCode, 200, 'Health endpoint should return HTTP 200');
      const json = JSON.parse(body);
      assert.strictEqual(json.status, 'ok');
      console.log('server_smoke.test.js passed');
    } catch (error) {
      console.error(error);
      process.exit(1);
    } finally {
      server.close(() => process.exit(0));
    }
  });
}).on('error', (error) => {
  console.error('Failed to reach /health endpoint:', error);
  server.close(() => process.exit(1));
});
});
