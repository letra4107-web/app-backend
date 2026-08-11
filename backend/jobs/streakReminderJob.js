const cron = require('node-cron');
const { dateKeyManila } = require('../services/dateUtils');

// In-process scheduling via node-cron - runs inside the same single Railway
// web service as the API, so it depends on that service staying up through
// 8PM Manila every day. If Railway restarts/redeploys at exactly that
// moment, that day's run is skipped - acceptable for a nice-to-have
// engagement reminder, not acceptable for anything that must guarantee
// delivery. FUTURE RELIABILITY UPGRADE: move this to Railway's separate
// Cron Jobs infrastructure (a dedicated scheduled service Railway triggers
// itself, independent of the web dyno's uptime) once that matters more than
// the setup cost - this in-process version is a deliberate first cut, not
// the final design.
const SCHEDULE_MANILA_8PM = '0 20 * * *';
const CRON_TIMEZONE = 'Asia/Manila';

const log = (level, message, meta = {}) => {
  console[level](`[streak-reminder-job] ${message}`, { timestamp: new Date().toISOString(), ...meta });
};

// Encouraging, not guilt-tripping - a dyslexia-support app's reminders
// should read as an invitation back in, not a scolding for missing a day.
// No "you failed", no exclamation-heavy pressure - just a warm nudge with
// the concrete stakes (the streak number) stated plainly.
const buildReminderCopy = (streak) => ({
  title: 'Huwag kalimutan ang streak mo!',
  message: `${streak} araw ka nang sunod-sunod na nagbabasa - isang maikling pagsasanay pa lang ngayon para ma-ipagpatuloy ito. Kaya mo yan!`,
});

const findStudentsAtRisk = async (supabaseAdmin, todayKey) => {
  const { data, error } = await supabaseAdmin
    .from('child_progress')
    .select('child_id, streak, last_practice_date, children!inner(auth_uid, parent_id)')
    .gt('streak', 0)
    .neq('last_practice_date', todayKey);

  if (error) throw error;
  return (data || []).filter((row) => row.children?.auth_uid);
};

// Idempotency guard: skip a student who already got today's reminder, so a
// process restart or manual re-trigger can never double-send it.
const alreadyRemindedToday = async (supabaseAdmin, userId, todayKey) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'streak')
    .gte('created_at', `${todayKey}T00:00:00`)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
};

const runStreakReminderCheck = async (supabaseAdmin) => {
  const todayKey = dateKeyManila();
  log('log', 'run started', { todayKey });

  let atRisk;
  try {
    atRisk = await findStudentsAtRisk(supabaseAdmin, todayKey);
  } catch (error) {
    log('error', 'failed to query at-risk students', { message: error?.message || error });
    return { sent: 0, skipped: 0, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of atRisk) {
    const userId = row.children.auth_uid;
    try {
      if (await alreadyRemindedToday(supabaseAdmin, userId, todayKey)) {
        skipped += 1;
        continue;
      }

      const { title, message } = buildReminderCopy(row.streak);
      const { error: insertError } = await supabaseAdmin.from('notifications').insert({
        user_id: userId,
        student_id: row.child_id,
        parent_id: row.children.parent_id,
        title,
        body: message,
        message,
        type: 'streak',
        is_read: false,
        read: false,
      });
      if (insertError) throw insertError;

      sent += 1;
    } catch (error) {
      failed += 1;
      log('error', 'reminder failed for student', {
        childId: row.child_id,
        message: error?.message || error,
      });
    }
  }

  log('log', 'run finished', { todayKey, candidates: atRisk.length, sent, skipped, failed });
  return { sent, skipped, failed };
};

const startStreakReminderJob = (supabaseAdmin) => {
  cron.schedule(
    SCHEDULE_MANILA_8PM,
    () => {
      runStreakReminderCheck(supabaseAdmin).catch((error) => {
        log('error', 'unhandled run failure', { message: error?.message || error });
      });
    },
    { timezone: CRON_TIMEZONE },
  );
  log('log', 'scheduled', { schedule: SCHEDULE_MANILA_8PM, timezone: CRON_TIMEZONE });
};

module.exports = {
  startStreakReminderJob,
  runStreakReminderCheck,
  buildReminderCopy,
};
