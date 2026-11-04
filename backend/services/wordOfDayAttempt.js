const { scoreTranscript } = require('./speechScoring');
const { isUuid, isBoundedString } = require('./progressValidation');
const checkAndAwardBadges = async (client, studentId) => { const {data,error}=await client.rpc('reconcile_verified_student_badges',{p_student_id:studentId}); if(error) throw error; return data?.awarded_badge_ids || []; };

const MAX_ATTEMPTS = 3;
const REWARD_XP = 25;

function failure(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}
function rpcFailure(error) {
  if (['PT409', '40001', '40P01'].includes(error?.code)) return failure(409, 'Saved progress changed. Refresh and retry the same attempt.');
  if (error?.code === '42501') return failure(403, 'You do not have permission to complete this activity.');
  if (error?.code === 'P0002') return failure(404, 'Word of the day entry not found for this student.');
  // No compatibility fallback: separate HTTP writes cannot emulate a transaction.
  return failure(503, 'The daily reward service is unavailable. Please retry the same attempt later.');
}
function validResult(data) {
  return data?.success === true && typeof data.isFinal === 'boolean'
    && (data.isFinal ? typeof data.correct === 'boolean' : data.correct === null)
    && [0, REWARD_XP].includes(data.xpAwarded)
    && Number.isInteger(data.accuracy) && data.accuracy >= 0 && data.accuracy <= 100
    && (data.newXp === null || Number.isInteger(data.newXp) && data.newXp >= 0)
    && (data.newStreak === null || Number.isInteger(data.newStreak) && data.newStreak >= 0)
    && typeof data.replayed === 'boolean'
    && (data.xpAwarded === 0 || data.isFinal && data.correct && !data.replayed)
    && (!data.correct || data.newXp !== null && data.newStreak !== null);
}

async function recordWordOfDayAttempt(client, { studentId, logId, attempts, transcript }, { awardBadges = checkAndAwardBadges } = {}) {
  if (!isUuid(logId)) throw failure(400, 'A valid logId is required.');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) throw failure(400, 'Attempts must be an integer from 1 to 3.');
  if (!isBoundedString(transcript, 2000, { allowEmpty: false })) throw failure(400, 'A spoken response is required.');

  let lookup;
  try {
    lookup = await client.from('word_of_day_log').select('id, child_id, word').eq('id', logId).eq('child_id', studentId).maybeSingle();
  } catch { throw rpcFailure(); }
  if (!lookup || lookup.error) throw rpcFailure(lookup?.error);
  const log = lookup.data;
  if (!log || log.child_id !== studentId) throw failure(404, 'Word of the day entry not found for this student.');
  if (typeof log.word !== 'string' || !log.word.trim()) throw rpcFailure();
  const score = scoreTranscript(log.word, transcript);

  let result;
  try {
    result = await client.rpc('record_web_word_of_day_attempt', {
      p_student_id: studentId, p_log_id: logId, p_expected_word: log.word,
      p_attempt_number: attempts, p_accuracy: score.accuracy, p_is_correct: score.correct,
    });
  } catch { throw rpcFailure(); }
  if (result?.error) throw rpcFailure(result.error);
  if (!validResult(result?.data)) throw rpcFailure();

  // The core completion/reward/streak transaction has already committed.
  // A badge outage must not turn that success into a failed activity. Replays
  // retry the separately idempotent badge award without repeating the 25 XP.
  let newlyUnlockedBadges = [], badgesPending = false;
  if (result.data.isFinal && result.data.correct) {
    try { newlyUnlockedBadges = await awardBadges(client, studentId); }
    catch { badgesPending = true; }
  }
  return { ...result.data, newlyUnlockedBadges, badgesPending };
}

module.exports = { recordWordOfDayAttempt, MAX_ATTEMPTS, REWARD_XP };
