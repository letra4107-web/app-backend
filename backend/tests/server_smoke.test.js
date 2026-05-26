const assert = require('assert');
const http = require('http');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.NODE_ENV = 'test';

const { startServer } = require('../server');

const request = ({ port, path, method = 'GET', headers = {} }) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ res, body }));
      },
    );

    req.on('error', reject);
    req.end();
  });

const server = startServer(0);

server.once('listening', async () => {
  const address = server.address();
  assert(address && address.port, 'Server should bind to a port');

  try {
    const health = await request({ port: address.port, path: '/health' });
    assert.strictEqual(health.res.statusCode, 200, 'Health endpoint should return HTTP 200');
    assert.strictEqual(JSON.parse(health.body).status, 'ok');

    const preflight = await request({
      port: address.port,
      path: '/api/notifications',
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    assert.strictEqual(preflight.res.statusCode, 200, 'CORS preflight should return HTTP 200');
    assert.strictEqual(
      preflight.res.headers['access-control-allow-origin'],
      'http://localhost:8081',
    );
    assert.match(preflight.res.headers['access-control-allow-methods'] || '', /GET/);
    assert.match(preflight.res.headers['access-control-allow-headers'] || '', /Content-Type/);

    console.log('server_smoke.test.js passed');
    server.close(() => process.exit(0));
  } catch (error) {
    console.error(error);
    server.close(() => process.exit(1));
  }
});
