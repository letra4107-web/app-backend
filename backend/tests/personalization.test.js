const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'testpass';
process.env.NODE_ENV = 'test';

const { createPersonalizationRouter } = require('../routes/personalization');
const { RANKING_WEIGHTS, rankWords } = require('../services/coldStartRanker');

const studentId = '00000000-0000-0000-0000-000000000001';
const now = new Date();
const isoDaysAgo = (days, minutes = 0) => new Date(now.getTime() - (days * 86400000) + (minutes * 60000)).toISOString();
const sessions = [0, 1, 2, 3, 4].map((index) => ({
  id: `session-${index}`,
  student_id: studentId,
  word_id: `beginner-word-${index}`,
  word: `salita${index}`,
  accuracy_percentage: 82 + (index * 3),
  is_correct: true,
  duration_seconds: 8 - index,
  difficulty_level_at_attempt: 'beginner',
  practice_source: 'practice',
  created_at: isoDaysAgo(5 - index),
}));
const confusions = [
  { id: 'confusion-1', student_id: studentId, session_id: 'session-3', confusion_key: 'd-r', target_word: 'radyo', source: 'practice', created_at: isoDaysAgo(1, 1) },
  { id: 'confusion-2', student_id: studentId, session_id: 'session-4', confusion_key: 'd-r', target_word: 'radyo', source: 'practice', created_at: isoDaysAgo(0, -1) },
];
const words = [
  { id: 'word-radyo', word: 'radyo', level: 'intermediate', syllable_count: 3, has_diphthong: false, has_consonant_cluster: false },
  { id: 'word-pluma', word: 'pluma', level: 'intermediate', syllable_count: 5, has_diphthong: false, has_consonant_cluster: true },
  { id: 'word-bata', word: 'bata', level: 'beginner', syllable_count: 2, has_diphthong: false, has_consonant_cluster: false },
];

const testPureRanking = () => {
  assert(Math.abs(Object.values(RANKING_WEIGHTS).reduce((sum, value) => sum + value, 0) - 1) < Number.EPSILON);
  const result = rankWords({ sessions, confusions, words, progressLevel: 'Beginner', now, limit: 2 });
  assert.strictEqual(result.strategy, 'cold-start-ranker-v1');
  assert.strictEqual(result.predictedProbability, null);
  assert.strictEqual(result.shouldAdvance, true);
  assert.strictEqual(result.recommendedDifficulty, 'intermediate');
  assert.strictEqual(result.words[0].id, 'word-radyo');
  assert(result.words[0].reasonCodes.includes('targets_confusion_pair'));
  assert(result.words[0].reasonCodes.includes('unseen_diagnostic_word'));
  assert(result.words[0].reasonCodes.includes('appropriate_structural_load'));

  const insufficient = rankWords({ sessions: sessions.slice(0, 4), confusions, words, progressLevel: 'Beginner', now });
  assert.strictEqual(insufficient.readiness.bootstrap_readiness, null);
  assert.strictEqual(insufficient.shouldAdvance, false);
  assert.strictEqual(insufficient.recommendedDifficulty, 'beginner');
  return result;
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
    if (this.table === 'child_progress') return { data: { level: 'Beginner' }, error: null };
    if (this.table === 'words') return { data: words, error: null };
    if (this.table === 'personalization_recommendations') {
      return { data: single ? { id: 'recommendation-1', created_at: now.toISOString() } : null, error: null };
    }
    if (this.table === 'personalization_recommendation_words') return { data: null, error: null };
    throw new Error(`Unexpected table ${this.table}`);
  }
}

const createFakeSupabase = () => {
  const state = { inserts: {}, sessionFilter: null, confusionFilter: null };
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
      body: { limit: 2, studentId: 'forged-victim-id' },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(supabase.state.sessionFilter, studentId);
    assert.strictEqual(supabase.state.confusionFilter, studentId);
    assert.strictEqual(supabase.state.inserts.personalization_recommendations.student_id, studentId);
    assert.strictEqual(response.body.recommendation.words[0].word, 'radyo');
    assert.deepStrictEqual(
      supabase.state.inserts.personalization_recommendation_words[0].reason_codes.component_scores,
      response.body.recommendation.words[0].componentScores,
    );
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
    words: sample.words.slice(0, 2),
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
