const { scoreTranscript } = require('./speechScoring');
const { scorePronunciation, PRACTICE_PASSING_SCORE } = require('./mobileSpeechScoring');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const onlyKeys = (body, keys) => body && !Array.isArray(body) && typeof body === 'object'
  && Object.keys(body).every(key => keys.includes(key));
function rpcFailure(error) {
  if (['PT409', '40001', '40P01', '23505'].includes(error?.code)) return failure(409, 'PROGRESS_CONFLICT', 'Saved progress changed. Retry the same attempt or refresh.');
  if (error?.code === '42501') return failure(403, 'PROGRESS_FORBIDDEN', 'This learning activity is not available to your account.');
  if (error?.code === 'P0002') return failure(404, 'PROGRESS_NOT_FOUND', 'The learning activity was not found.');
  if (error?.code === '22023') return failure(400, 'INVALID_PROGRESS_EVENT', 'The learning answer is invalid.');
  if (error?.code === 'PT410') return failure(410, 'PROGRESS_EVENT_EXPIRED', 'This attempt expired without being saved. Start a new attempt.');
  return failure(503, 'PROGRESS_DEPENDENCY_UNAVAILABLE', 'Saving rewards is temporarily unavailable. Your saved progress is safe. Retry the same attempt later.');
}
async function rpc(client, name, params) {
  let result;
  try { result = await client.rpc(name, params); } catch { throw rpcFailure(); }
  if (result?.error || !result?.data) throw rpcFailure(result?.error);
  return result.data;
}
async function requireProgressContract(client) {
  const data = await rpc(client, 'progress_contract_version', {});
  if (data.version !== 2) throw rpcFailure();
}
async function startProgressEvent(client, studentId, body, channel = 'mobile') {
  if (!onlyKeys(body, ['contentId', 'source', 'assessmentAttemptId', 'assessmentItemId', 'newAttempt']) || !UUID.test(body.contentId || '')
    || (body.newAttempt !== undefined && typeof body.newAttempt !== 'boolean')
    || !['practice', 'assessment'].includes(body.source)
    || (body.source === 'assessment' && (!UUID.test(body.assessmentAttemptId || '') || !UUID.test(body.assessmentItemId || '')))
    || (body.source === 'practice' && (body.assessmentAttemptId != null || body.assessmentItemId != null))) {
    throw failure(400, 'INVALID_PROGRESS_EVENT', 'A valid learning activity and assessment context are required.');
  }
  await requireProgressContract(client);
  const data = await rpc(client, 'start_student_progress_event', { p_student_id: studentId, p_content_id: body.contentId, p_source: body.source,
    p_assessment_attempt_id: body.assessmentAttemptId || null, p_assessment_item_id: body.assessmentItemId || null, p_channel: channel, p_new_attempt: body.newAttempt === true });
  if (!UUID.test(data.eventId || '') || !Number.isFinite(Date.parse(data.expiresAt))) throw rpcFailure();
  return data;
}
function validProgress(progress) {
  return progress && typeof progress.child_id === 'string' && Number.isSafeInteger(progress.xp) && progress.xp >= 0
    && Number.isSafeInteger(progress.total_attempts) && progress.total_attempts >= 0 && Array.isArray(progress.achievements);
}
function validBaseReward(reward, contentId, xpAwarded, replayed) {
  return reward && reward.rewardType === 'content_practice' && reward.contentId === contentId
    && ['awarded','already_rewarded','not_eligible','not_applicable','legacy_review_required'].includes(reward.status)
    && reward.xpAwarded === xpAwarded && [0,50].includes(xpAwarded)
    && (reward.status === 'awarded' ? xpAwarded === 50 && !replayed : xpAwarded === 0);
}
async function recordProgressEvent(client, studentId, eventId, body) {
  if (!UUID.test(eventId || '') || !onlyKeys(body, ['transcript', 'durationSeconds']) || typeof body.transcript !== 'string'
    || body.transcript.trim().length < 1 || body.transcript.length > 2000
    || (body.durationSeconds != null && (!Number.isInteger(body.durationSeconds) || body.durationSeconds < 0 || body.durationSeconds > 3600))) {
    throw failure(400, 'INVALID_PROGRESS_EVENT', 'A valid attempt, answer and duration are required.');
  }
  await requireProgressContract(client);
  let lookup;
  try { lookup = await client.from('student_progress_events').select('id,student_id,content_id,expected_text,channel,source').eq('id', eventId).eq('student_id', studentId).maybeSingle(); }
  catch { throw rpcFailure(); }
  if (!lookup || lookup.error) throw rpcFailure(lookup?.error);
  const event = lookup.data;
  if (!event || event.student_id !== studentId) throw failure(404, 'PROGRESS_NOT_FOUND', 'The learning attempt was not found.');
  if (typeof event.expected_text !== 'string' || !event.expected_text.trim()) throw rpcFailure();
  if (!['mobile','web'].includes(event.channel) || !['practice','assessment'].includes(event.source)) throw rpcFailure();
  const score = event.channel === 'mobile'
    ? event.source === 'assessment'
      ? { accuracy: body.transcript === event.expected_text ? 100 : 0, correct: body.transcript === event.expected_text }
      : { accuracy: scorePronunciation(event.expected_text,body.transcript) }
    : scoreTranscript(event.expected_text, body.transcript);
  const correct = typeof score.correct === 'boolean' ? score.correct : score.accuracy >= PRACTICE_PASSING_SCORE;
  const data = await rpc(client, 'record_student_progress_event', { p_student_id: studentId, p_event_id: eventId,
    p_expected_text: event.expected_text, p_transcript: body.transcript, p_accuracy: score.accuracy, p_duration_seconds: body.durationSeconds ?? null, p_is_correct: correct });
  if (data.success !== true || !validProgress(data.progress) || data.progress.child_id !== studentId
    || typeof data.replayed !== 'boolean' || ![0,50].includes(data.xpAwarded)
    || !UUID.test(data.result?.attempt_id || '') || !Number.isInteger(data.result?.accuracy)
    || data.result.accuracy < 0 || data.result.accuracy > 100 || !Array.isArray(data.newlyPersistedAchievementIds)
    || !validBaseReward(data.baseReward,event.content_id,data.xpAwarded,data.replayed)
    || (data.xpAwarded>0 && (event.channel!=='mobile' || event.source!=='practice' || score.accuracy<PRACTICE_PASSING_SCORE))
    || (data.replayed && data.xpAwarded !== 0)) throw rpcFailure();
  return data;
}
module.exports = { UUID, onlyKeys, failure, rpcFailure, requireProgressContract, startProgressEvent, recordProgressEvent, validProgress, validBaseReward };
