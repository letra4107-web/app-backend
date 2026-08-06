const assert = require('assert');
const { buildAttemptFeedback, buildReadingProfile } = require('../services/readingInsights');

const now = new Date('2026-08-07T08:00:00.000Z');
const sessions = [
  { word: 'bahay', accuracy_percentage: 60, duration_seconds: 18, created_at: '2026-08-01T08:00:00.000Z' },
  { word: 'bata', accuracy_percentage: 68, duration_seconds: 14, created_at: '2026-08-03T08:00:00.000Z' },
  { word: 'bahay', accuracy_percentage: 82, duration_seconds: 10, created_at: '2026-08-06T08:00:00.000Z' },
];
const profile = buildReadingProfile({
  sessions,
  confusions: [{ confusion_key: 'b-p', target_word: 'bahay', created_at: sessions[2].created_at }],
  completions: [{ content_id: 'one' }],
  now,
});

assert.strictEqual(profile.sessionCount, 3);
assert(profile.confidenceScore >= 0 && profile.confidenceScore <= 100);
assert(profile.weakSounds.some((entry) => entry.unit === 'b'));
assert.strictEqual(profile.completedContentCount, 1);
assert(profile.insights.every(Boolean));
assert(buildAttemptFeedback({ target: 'bahay', accuracy: 82, previousAccuracy: 60 }).includes('22'));
assert(buildAttemptFeedback({ target: 'bata', accuracy: 60, confusions: [{ confusion_key: 'b-p' }] }).includes("'b'"));

console.log('reading_insights.test.js passed');
