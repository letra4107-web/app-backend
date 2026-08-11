const assert = require('assert');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test-key';

const speechRouter = require('../routes/speech');

assert.strictEqual(speechRouter.wordAccuracy('isda', 'isda'), 100);
assert.ok(
  speechRouter.wordAccuracy('idsa', 'isda') < 80,
  'A transposed pronunciation such as idsa must not pass for isda',
);
assert.ok(
  speechRouter.wordAccuracy('ista', 'isda') < 80,
  'A changed consonant in a short word must not pass',
);

console.log('word_of_day_scoring.test.js passed');
