const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.NODE_ENV = 'test';

const { createPersonalizationRouter } = require('../routes/personalization');
const { RANKING_WEIGHTS, STRATEGY_VERSION, rankCurriculum } = require('../services/coldStartRanker');

const studentId = '00000000-0000-4000-8000-000000000001';
const now = new Date();
const isoDaysAgo = (days, minutes = 0) => new Date(now.getTime() - (days * 86400000) + (minutes * 60000)).toISOString();
const sessions = [0, 1, 2, 3, 4].map((index) => ({
  id: `session-${index}`,
  student_id: studentId,
  word_id: `legacy-word-${index}`,
  word: `salita${index}`,
  accuracy_percentage: 90 + index,
  is_correct: true,
  duration_seconds: 8 - index,
  difficulty_level_at_attempt: 'beginner',
  practice_source: 'practice',
  created_at: isoDaysAgo(5 - index),
}));
const confusions = [
  { id: 'confusion-1', student_id: studentId, session_id: 'session-4', confusion_key: 'd-r', target_word: 'dahon', source: 'practice', created_at: isoDaysAgo(0) },
];
const contentAttempts = [];
const curriculum = [
  { id: 'content-beginner-da', word_id: null, content_text: 'da', content_type: 'phonetic', level: 'Beginner', is_assessment: false },
  { id: 'content-beginner-bata', word_id: 'word-bata', content_text: 'bata', content_type: 'word', level: 'Beginner', is_assessment: false },
  { id: 'content-intermediate-radyo', word_id: 'word-radyo', content_text: 'radyo', content_type: 'word', level: 'Intermediate', is_assessment: false },
  { id: 'content-intermediate-phrase', word_id: null, content_text: 'malinaw na radyo', content_type: 'phrase', level: 'Intermediate', is_assessment: false },
  { id: 'content-advanced-paragraph', word_id: null, content_text: 'Tatlong pangungusap.', content_type: 'paragraph', level: 'Advanced', is_assessment: true },
];
const officialProgression = (eligible = false) => ({
  effective_level: 'Beginner',
  official_earned_level: 'Beginner',
  placement_override_level: null,
  official_progression_eligible: eligible,
  program_complete: false,
  requirements: [
    { level: 'Beginner', content_type: 'word', completed_count: eligible ? 200 : 10, required_count: 200 },
    { level: 'Beginner', content_type: 'phonetic', completed_count: eligible ? 200 : 8, required_count: 200 },
  ],
});

const testPureRanking = () => {
  assert(Math.abs(Object.values(RANKING_WEIGHTS).reduce((sum, value) => sum + value, 0) - 1) < Number.EPSILON);

  // Perfect recent accuracy cannot bypass incomplete official requirements.
  const staying = rankCurriculum({
    sessions, confusions, contentAttempts, curriculum,
    officialProgression: officialProgression(false), now, limit: 4,
  });
  assert.strictEqual(staying.strategy, STRATEGY_VERSION);
  assert.strictEqual(staying.predictedProbability, null);
  assert.strictEqual(staying.shouldAdvance, false);
  assert.strictEqual(staying.recommendedDifficulty, 'beginner');
  assert.strictEqual(staying.readiness.official_progression_eligible, false);
  assert(!Object.prototype.hasOwnProperty.call(staying.readiness, 'bootstrap_readiness'));
  assert(staying.items.some((item) => item.contentType === 'phonetic'));
  assert(staying.items.every((item) => ['word', 'phonetic'].includes(item.contentType)));
  assert(staying.items[0].reasonCodes.includes('targets_confusion_pair'));

  const advancing = rankCurriculum({
    sessions, confusions, contentAttempts, curriculum,
    officialProgression: officialProgression(true), now, limit: 4,
  });
  assert.strictEqual(advancing.shouldAdvance, true);
  assert.strictEqual(advancing.recommendedDifficulty, 'intermediate');
  assert(advancing.items.every((item) => ['word', 'phrase'].includes(item.contentType)));
  assert(advancing.items.every((item) => item.level === 'intermediate'));
  assert(!advancing.items.some((item) => item.contentType === 'paragraph'));
  return staying;
};

class FakeQuery {
  constructor(table, state) {
    this.table = table;
    this.state = state;
    this.filters = [];
    this.inserted = null;
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  neq(column, value) { this.filters.push([`${column}:neq`, value]); return this; }
  order() { return this; }
  limit() { return this.execute(); }
  insert(value) { this.inserted = value; this.state.inserts[this.table] = value; return this; }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute(single = false) {
    if (this.table === 'children') return { data: { id: studentId }, error: null };
    if (this.table === 'pronunciation_practice_sessions') {
      this.state.sessionFilter = this.filters.find(([column]) => column === 'student_id')?.[1];
      return { data: sessions, error: null };
    }
    if (this.table === 'phoneme_confusion') {
      this.state.confusionFilter = this.filters.find(([column]) => column === 'student_id')?.[1];
      return { data: confusions, error: null };
    }
    if (this.table === 'student_content_attempts') {
      this.state.attemptFilter = this.filters.find(([column]) => column === 'student_id')?.[1];
      return { data: contentAttempts, error: null };
    }
    if (this.table === 'reading_content') {
      const level = this.filters.find(([column]) => column === 'level')?.[1];
      return { data: curriculum.filter((item) => item.level === level && item.content_type !== 'paragraph'), error: null };
    }
    if (this.table === 'personalization_recommendations') {
      return { data: single ? { id: 'recommendation-1', created_at: now.toISOString() } : null, error: null };
    }
    if (this.table === 'personalization_recommendation_words') return { data: null, error: null };
    throw new Error(`Unexpected table ${this.table}`);
  }
}

const createFakeSupabase = () => {
  const state = { inserts: {}, sessionFilter: null, confusionFilter: null, attemptFilter: null };
  return {
    state,
    auth: {
      async getUser(token) {
        return token === 'valid-token'
          ? { data: { user: { id: 'student-auth-id' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
    from(table) { return new FakeQuery(table, state); },
    async rpc(name, params) {
      assert.strictEqual(name, 'get_student_reading_progress');
      assert.strictEqual(params.p_student_id, studentId);
      return { data: officialProgression(false), error: null };
    },
  };
};

const request = ({ port, headers = {}, body = {} }) => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body);
  const req = http.request({
    hostname: '127.0.0.1', port, path: '/api/personalization/recommend', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
  }, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody) }));
  });
  req.on('error', reject);
  req.end(payload);
});

const testEndpoint = async () => {
  const supabase = createFakeSupabase();
  const app = express();
  app.use(express.json());
  app.use('/api/personalization', createPersonalizationRouter(supabase));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const unauthenticated = await request({ port: server.address().port });
    assert.strictEqual(unauthenticated.status, 401);
    const response = await request({
      port: server.address().port,
      headers: { Authorization: 'Bearer valid-token' },
      body: { limit: 2, studentId: 'forged-victim-id', level: 'Advanced' },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(supabase.state.sessionFilter, studentId);
    assert.strictEqual(supabase.state.confusionFilter, studentId);
    assert.strictEqual(supabase.state.attemptFilter, studentId);
    assert.strictEqual(supabase.state.inserts.personalization_recommendations.student_id, studentId);
    assert.strictEqual(response.body.recommendation.shouldAdvance, false);
    assert.strictEqual(response.body.recommendation.readiness.official_progression_eligible, false);
    assert(response.body.recommendation.items.length > 0);
    const logged = supabase.state.inserts.personalization_recommendation_words[0];
    assert.strictEqual(logged.content_id, response.body.recommendation.items[0].contentId);
    assert.deepStrictEqual(logged.reason_codes.component_scores, response.body.recommendation.items[0].componentScores);
    return response.body.recommendation;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

(async () => {
  testPureRanking();
  const sample = await testEndpoint();
  console.log('personalization.test.js passed');
  console.log('SAMPLE_RANKED_OUTPUT');
  console.log(JSON.stringify({
    strategy: sample.strategy,
    currentDifficulty: sample.currentDifficulty,
    recommendedDifficulty: sample.recommendedDifficulty,
    shouldAdvance: sample.shouldAdvance,
    predictedProbability: sample.predictedProbability,
    officialProgressionEligible: sample.readiness.official_progression_eligible,
    items: sample.items.slice(0, 2),
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
