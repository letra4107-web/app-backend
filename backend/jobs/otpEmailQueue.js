const { sendOTPEmail, smtpConfigured } = require('../config/mailer');

const queue = [];
let processing = false;
let sequence = 0;
const MAX_ATTEMPTS = Number(process.env.OTP_EMAIL_MAX_ATTEMPTS || 4);
const BASE_BACKOFF_MS = Number(process.env.OTP_EMAIL_RETRY_BASE_MS || 2000);
const MAX_BACKOFF_MS = Number(process.env.OTP_EMAIL_RETRY_MAX_MS || 60000);

const log = (level, message, meta = {}) => {
  console[level](`[otp-email-queue] ${message}`, { timestamp: new Date().toISOString(), ...meta });
};

const processQueue = async () => {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const job = queue.shift();
    job.attempt += 1;
    const startedAt = Date.now();

    log('log', 'send attempt started', {
      jobId: job.id,
      label: job.label,
      email: job.email,
      userId: job.userId,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      queueDepth: queue.length,
    });

    try {
      if (!smtpConfigured) {
        const error = new Error('SMTP credentials are missing. Configure EMAIL_USER/EMAIL_PASS or SMTP_USER/SMTP_PASS.');
        error.code = 'SMTP_NOT_CONFIGURED';
        throw error;
      }

      const info = await sendOTPEmail(job.email, job.otp);
      log('log', 'send attempt completed', {
        jobId: job.id,
        label: job.label,
        email: job.email,
        userId: job.userId,
        attempt: job.attempt,
        messageId: info.messageId,
        response: info.response,
        elapsedMs: Date.now() - startedAt,
        status: 'sent',
      });
    } catch (error) {
      const willRetry = job.attempt < job.maxAttempts;
      log(willRetry ? 'warn' : 'error', 'send attempt failed', {
        jobId: job.id,
        label: job.label,
        email: job.email,
        userId: job.userId,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        willRetry,
        code: error?.code,
        command: error?.command,
        responseCode: error?.responseCode,
        response: error?.response,
        message: error?.message || String(error),
        elapsedMs: Date.now() - startedAt,
        status: 'failed',
      });

      if (willRetry) {
        const delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, job.attempt - 1));
        log('warn', 'retry scheduled', {
          jobId: job.id,
          label: job.label,
          email: job.email,
          userId: job.userId,
          nextAttempt: job.attempt + 1,
          delayMs,
        });
        setTimeout(() => {
          queue.push(job);
          setImmediate(processQueue);
        }, delayMs);
      }
    }
  }

  processing = false;
};

const enqueueOtpEmail = ({ label, userId, email, otp }) => {
  const job = {
    id: `otp-email-${Date.now()}-${sequence += 1}`,
    label,
    userId,
    email,
    otp,
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
    maxAttempts: MAX_ATTEMPTS,
  };

  queue.push(job);
  log('log', 'job enqueued', {
    jobId: job.id,
    label,
    email,
    userId,
    smtpConfigured,
    maxAttempts: job.maxAttempts,
    queueDepth: queue.length,
  });

  setImmediate(processQueue);
  return { queued: true, jobId: job.id, queueDepth: queue.length };
};

module.exports = {
  enqueueOtpEmail,
};
