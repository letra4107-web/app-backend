const nodemailer = require('nodemailer');

const stripQuotes = (value = '') => String(value).trim().replace(/^"(.*)"$/, '$1');

const emailUser = process.env.SMTP_USER || process.env.EMAIL_USER;
const emailPass = stripQuotes(process.env.SMTP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');
const emailHost = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
const emailPort = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '465', 10);
const emailFrom = stripQuotes(process.env.SMTP_FROM || process.env.EMAIL_FROM || 'LinawLetra <noreply@linawletra.com>');
const emailService = process.env.EMAIL_SERVICE || '';
const rejectUnauthorized = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const smtpConfigured = Boolean(emailUser && emailPass);
const SMTP_TIMEOUT_MS = parseInt(process.env.SMTP_TIMEOUT_MS || '15000', 10);
const SMTP_SEND_TIMEOUT_MS = parseInt(process.env.SMTP_SEND_TIMEOUT_MS || '20000', 10);
const smtpSecure = String(process.env.SMTP_SECURE || '').trim()
  ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
  : emailPort === 465;

let transporter = null;

const mailerLog = (level, message, meta = {}) => {
  console[level](`[Mailer] ${message}`, { timestamp: new Date().toISOString(), ...meta });
};

const buildTransportOptions = () => {
  if (emailService) {
    return {
      service: emailService,
      auth: { user: emailUser, pass: emailPass },
      pool: false,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: 5000,
      socketTimeout: SMTP_SEND_TIMEOUT_MS,
      tls: { rejectUnauthorized },
    };
  }

  return {
    host: emailHost,
    port: emailPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure,
    auth: { user: emailUser, pass: emailPass },
    pool: false,
    tls: { rejectUnauthorized },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: 5000,
    socketTimeout: SMTP_SEND_TIMEOUT_MS,
  };
};

const logMailerStatus = () => {
  if (!smtpConfigured) {
    const msg = 'SMTP is not configured. Email delivery will not work until EMAIL_USER and EMAIL_PASS are provided.';
    if (isProduction) {
      mailerLog('error', msg);
    } else {
      mailerLog('warn', msg);
    }
    return;
  }

  const transportSummary = emailService
    ? `service=${emailService}`
    : `host=${emailHost} port=${emailPort} secure=${smtpSecure}`;

  mailerLog('log', 'configuring SMTP', {
    transport: transportSummary,
    user: emailUser,
    from: emailFrom,
    timeoutMs: SMTP_TIMEOUT_MS,
    sendTimeoutMs: SMTP_SEND_TIMEOUT_MS,
  });
  transporter = nodemailer.createTransport(buildTransportOptions());
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, timeoutMs, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const sendWithRetry = async (mailOptions, maxAttempts = 2) => {
  if (!transporter) {
    throw new Error('SMTP transporter is not initialized');
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      mailerLog('log', 'sendMail attempt started', {
        attempt,
        maxAttempts,
        email: mailOptions.to,
        host: emailHost,
        port: emailPort,
        service: emailService || 'direct',
      });
      const info = await withTimeout(transporter.sendMail(mailOptions), SMTP_SEND_TIMEOUT_MS, 'SMTP sendMail');
      return info;
    } catch (error) {
      lastError = error;
      const message = error && error.message ? error.message : String(error);
      mailerLog('warn', 'sendMail attempt failed', {
        attempt,
        maxAttempts,
        email: mailOptions.to,
        host: emailHost,
        port: emailPort,
        service: emailService || 'direct',
        code: error?.code,
        response: error?.response,
        message,
      });

      if (attempt < maxAttempts) {
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        mailerLog('warn', 'retrying sendMail after backoff', { delayMs, nextAttempt: attempt + 1, maxAttempts });
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
};

const verifyMailerConnection = async () => {
  if (!transporter) {
    console.warn('[Mailer] Transporter not initialized. Skipping verification.');
    return;
  }

  try {
    mailerLog('log', 'Verifying SMTP connection');
    const startMs = Date.now();
    await withTimeout(transporter.verify(), SMTP_TIMEOUT_MS, 'SMTP verify');
    mailerLog('log', 'SMTP connection verified', {
      service: emailService || 'direct',
      host: emailHost,
      port: emailPort,
      secure: smtpSecure,
      verifyTimeMs: Date.now() - startMs,
    });
  } catch (error) {
    mailerLog('error', 'SMTP connection verification failed', {
      service: emailService || 'direct',
      host: emailHost,
      port: emailPort,
      secure: smtpSecure,
      code: error?.code,
      message: error?.message || String(error),
      possibleCauses: {
        'ENOTFOUND': 'DNS resolution failed. Check SMTP_HOST and network connectivity.',
        'ECONNREFUSED': 'Connection refused. Verify SMTP_HOST:SMTP_PORT are correct.',
        'ETIMEDOUT': 'Connection timed out. Check firewall or SMTP service availability.',
        'AUTHFAILED': 'Authentication failed. Check EMAIL_USER and EMAIL_PASS.',
      },
    });
  }
};

logMailerStatus();
setTimeout(() => {
  verifyMailerConnection().catch((error) =>
    console.warn('[Mailer] startup verify failed (non-fatal):', error?.message || String(error))
  );
}, 2000);

const sendOTPEmail = async (email, otp) => {
  if (!smtpConfigured) {
    const message = 'SMTP credentials are missing. Cannot send OTP email.';
    mailerLog('error', 'sendOTPEmail blocked', { message, email });
    if (isProduction) {
      throw new Error(message);
    }
    return { success: false, message, otp };
  }

  const mailOptions = {
    from: emailFrom,
    to: email,
    replyTo: emailFrom,
    subject: 'LinawLetra Email Verification',
    text: `Your verification code is ${otp}. It expires in 5 minutes. Do not share this code with anyone.`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Identity Verification</title>
        </head>
        <body style="margin:0;padding:0;background:#edf2f8;font-family:Arial, 'Helvetica Neue', Helvetica, sans-serif;color:#1f2937;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td align="center" style="padding:24px 16px;">
                <table width="100%" max-width="600" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:24px;box-shadow:0 24px 60px rgba(15,23,42,0.08);overflow:hidden;">
                  <tr>
                    <td style="padding:32px 32px 16px;text-align:center;background:#f0f7ff;">
                      <div style="display:inline-flex;align-items:center;justify-content:center;padding:16px 24px;border-radius:16px;background:#ffffff;margin-bottom:16px;">
                        <span style="display:inline-block;width:32px;height:32px;background:#1d4ed8;border-radius:10px;margin-right:12px;"></span>
                        <span style="font-size:14px;font-weight:700;color:#1d4ed8;letter-spacing:1px;text-transform:uppercase;">Identity Verification</span>
                      </div>
                      <h1 style="font-size:24px;line-height:32px;margin:0;color:#0f172a;font-weight:800;">Your verification code</h1>
                      <p style="font-size:16px;line-height:26px;color:#475569;margin:12px 0 0;max-width:440px;margin-left:auto;margin-right:auto;">
                        Enter this single-use code to confirm your email and continue. It was issued only for your account.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px 32px 20px;text-align:center;">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:auto;max-width:420px;border-radius:20px;background:#f8fbff;border:1px solid #e2e8f0;padding:24px;">
                        <tr>
                          <td>
                            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                              ${otp
                                .split('')
                                .map((digit) =>
                                  `<div style="flex:1;min-width:50px;background:#ffffff;border:1px solid #cbd5e1;border-radius:18px;box-shadow:0 8px 20px rgba(15,23,42,0.06);padding:16px 0;font-size:24px;font-weight:800;color:#0f172a;line-height:1;text-align:center;letter-spacing:0.16em;">${digit}</div>`
                                )
                                .join('')}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-top:20px;text-align:center;">
                            <p style="margin:0;font-size:14px;color:#475569;line-height:22px;">Valid for <strong>5 minutes</strong></p>
                            <p style="margin:10px 0 0;font-size:14px;color:#475569;line-height:22px;">Do not share this code with anyone.</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 32px 32px;text-align:center;">
                      <p style="margin:0;font-size:14px;color:#64748b;line-height:22px;">If you did not request this code, please ignore this message.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px 32px;text-align:center;">
                      <p style="margin:0;font-size:13px;color:#64748b;line-height:20px;">© 2026 LinawLetra</p>
                      <p style="margin:12px 0 0;">
                        <a href="https://linawletra.com/contact" style="color:#1d4ed8;text-decoration:none;margin:0 10px;">Contact us</a>
                        <span style="color:#94a3b8;">|</span>
                        <a href="https://linawletra.com/help" style="color:#1d4ed8;text-decoration:none;margin:0 10px;">Help</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    headers: {
      'X-Priority': '1',
      'X-Mailer': 'LinawLetra OTP Service',
    },
  };

  try {
    const info = await sendWithRetry(mailOptions, 2);
    mailerLog('log', 'OTP email sent', { to: email, messageId: info.messageId, response: info.response });
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    mailerLog('error', 'failed to send OTP email', {
      to: email,
      code: error?.code,
      command: error?.command,
      responseCode: error?.responseCode,
      response: error?.response,
      message: error && error.message ? error.message : String(error),
    });
    const wrapped = new Error(`Failed to send OTP email: ${error.message || error}`);
    wrapped.code = error?.code;
    wrapped.command = error?.command;
    wrapped.responseCode = error?.responseCode;
    wrapped.response = error?.response;
    throw wrapped;
  }
};

module.exports = {
  get transporter() {
    return transporter;
  },
  sendOTPEmail,
  smtpConfigured,
  emailFrom,
  emailHost,
  emailPort,
  emailService,
  smtpSecure,
  verifyMailerConnection,
};
