const assert = require('assert');
const controller = require('../controllers/pronunciationController');

function makeBase64OfLength(n) {
  // simple base64 string of repeated 'A' to simulate payload size
  return Buffer.alloc(n, 0x61).toString('base64');
}

(async () => {
  console.log('Running pronunciation controller tests...');

  // Test 1: clearly correct sample using mock case 1
  const res1 = await controller.processRequest({ user_id: 'u1', word: 'pa-pa', audio_base64: makeBase64OfLength(16000) }, { 'x-mock-case': '1' });
  assert.strictEqual(res1.word, 'pa-pa');
  assert.strictEqual(typeof res1.score, 'number');
  assert.strictEqual(Array.isArray(res1.phoneme_scores), true);
  assert.strictEqual(res1.is_correct, true);
  assert.strictEqual(typeof res1.positive_message, 'string');

  // Test 2: clearly incorrect sample using mock case 2 and retries_used=0
  const res2 = await controller.processRequest({ user_id: 'u2', word: 'pa-pa', audio_base64: makeBase64OfLength(800), retries_used: 0 }, { 'x-mock-case': '2' });
  assert.strictEqual(res2.is_correct, false);
  assert.strictEqual(res2.action, 'repeat_word');
  assert.strictEqual(res2.retry_allowed, 2);

  // Test 3: retry decrement behavior (retries_used=1)
  const res3 = await controller.processRequest({ user_id: 'u3', word: 'pa-pa', audio_base64: makeBase64OfLength(800), retries_used: 1 }, { 'x-mock-case': '2' });
  assert.strictEqual(res3.retry_allowed, 1);

  // Test 4: synthetic generation (no mock header) produces phoneme_scores length matching split
  const res4 = await controller.processRequest({ user_id: 'u4', word: 'ako', audio_base64: makeBase64OfLength(2000) }, {});
  assert.ok(Array.isArray(res4.phoneme_scores));
  assert.strictEqual(res4.phoneme_scores.length >= 1, true);
  assert.strictEqual(typeof res4.positive_message, 'string');

  // Test 5: noisy classroom simulated by small payload (should still return object)
  const res5 = await controller.processRequest({ user_id: 'u5', word: 'bayani', audio_base64: makeBase64OfLength(100) }, {});
  assert.strictEqual(typeof res5.score, 'number');

  // Test 6: missing fields -> throws
  let threw = false;
  try {
    await controller.processRequest({ user_id: 'u6', word: 'x', audio_base64: '' }, {});
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 400);
  }
  assert.strictEqual(threw, true);

  console.log('All tests passed.');
})();
