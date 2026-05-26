const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');

const result = spawnSync(
  process.execPath,
  [
    '-e',
    `try {
      require('./config/env').validateEnv();
      process.exit(1);
    } catch (err) {
      console.error(err.message);
      process.exit(0);
    }
    `,
  ],
  {
    cwd: backendRoot,
    env: {
      ...process.env,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_ANON_KEY: '',
      NODE_ENV: 'test',
    },
    encoding: 'utf8',
  }
);

assert.strictEqual(result.status, 0, 'Process should succeed in the test harness when the thrown error is caught');
assert.strictEqual(
  result.stderr.trim(),
  'Missing required environment variable(s): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY. Set them in your environment or create a .env file from .env.example.',
  `Expected exact validation error message, got: ${result.stderr.trim()}`
);

console.log('env_validation.test.js passed');
