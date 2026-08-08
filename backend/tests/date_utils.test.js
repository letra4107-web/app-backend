const assert = require('assert');
const { todayKey, yesterdayKey } = require('../services/dateUtils');

const asManilaDate = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const run = async () => {
  const now = new Date('2026-12-31T15:00:00Z');
  const manilaNow = asManilaDate(now);
  assert.strictEqual(todayKey(now), manilaNow, 'todayKey should return the Asia/Manila local date string');

  const midnightManila = new Date('2026-12-31T16:00:00Z');
  assert.strictEqual(todayKey(midnightManila), '2027-01-01');

  const yesterday = yesterdayKey(new Date('2027-01-01T01:00:00Z'));
  assert.strictEqual(yesterday, '2026-12-31');

  console.log('date_utils.test.js passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
