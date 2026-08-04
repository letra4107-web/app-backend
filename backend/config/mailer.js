const stripQuotes = (value = '') => String(value).trim().replace(/^"(.*)"$/, '$1');

const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim();
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_ACCOUNT_URL = 'https://api.brevo.com/v3/account';

const emailFrom = stripQuotes(process.env.SMTP_FROM || process.env.EMAIL_FROM || 'LinawLetra <noreply@linawletra.com>');
const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const smtpConfigured = Boolean(BREVO_API_KEY);
const SEND_TIMEOUT_MS = parseInt(process.env.SMTP_SEND_TIMEOUT_MS || '45000', 10);
const VERIFY_TIMEOUT_MS = parseInt(process.env.SMTP_TIMEOUT_MS || '30000', 10);

const mailerLog = (level, message, meta = {}) => {
  console[level](`[Mailer:Brevo] ${message}`, { timestamp: new Date().toISOString(), ...meta });
};

const parseSender = (raw) => {
  const value = stripQuotes(raw);
  const match = value.match(/^(.*)<(.+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '');
    return { name: name || 'LinawLetra', email: match[2].trim() };
  }
  return { name: 'LinawLetra', email: value };
};

const sender = parseSender(emailFrom);

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

const parseBrevoResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const sendMail = async (mailOptions) => {
  if (!smtpConfigured) {
    throw new Error('BREVO_API_KEY is not configured');
  }

  const toList = (Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to]).filter(Boolean);
  const payload = {
    sender,
    to: toList.map((email) => ({ email: String(email).trim() })),
    subject: mailOptions.subject,
  };
  if (mailOptions.text) payload.textContent = mailOptions.text;
  if (mailOptions.html) payload.htmlContent = mailOptions.html;
  if (mailOptions.replyTo) payload.replyTo = parseSender(String(mailOptions.replyTo));

  mailerLog('log', 'sendTransacEmail attempt started', { to: mailOptions.to, subject: mailOptions.subject });
  const startMs = Date.now();

  const response = await withTimeout(
    fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    SEND_TIMEOUT_MS,
    'Brevo sendTransacEmail',
  );

  const body = await parseBrevoResponse(response);

  if (!response.ok) {
    const error = new Error(body?.message || `Brevo API responded with HTTP ${response.status}`);
    error.code = body?.code || `HTTP_${response.status}`;
    error.responseCode = response.status;
    error.response = JSON.stringify(body);
    throw error;
  }

  mailerLog('log', 'sendTransacEmail attempt succeeded', {
    to: mailOptions.to,
    messageId: body.messageId,
    httpStatus: response.status,
    elapsedMs: Date.now() - startMs,
  });

  return { messageId: body.messageId, response: `Brevo accepted (HTTP ${response.status})` };
};

const verifyMailerConnection = async () => {
  if (!smtpConfigured) {
    console.warn('[Mailer:Brevo] BREVO_API_KEY not set. Skipping verification.');
    return null;
  }

  try {
    mailerLog('log', 'Verifying Brevo API key');
    const startMs = Date.now();
    const response = await withTimeout(
      fetch(BREVO_ACCOUNT_URL, { headers: { 'api-key': BREVO_API_KEY, Accept: 'application/json' } }),
      VERIFY_TIMEOUT_MS,
      'Brevo account verify',
    );
    const body = await parseBrevoResponse(response);

    if (!response.ok) {
      const error = new Error(body?.message || `Brevo account check failed with HTTP ${response.status}`);
      error.responseCode = response.status;
      throw error;
    }

    mailerLog('log', 'Brevo API key verified', {
      account: body?.email,
      plan: Array.isArray(body?.plan) ? body.plan.map((p) => p.type) : undefined,
      verifyTimeMs: Date.now() - startMs,
    });
    return body;
  } catch (error) {
    mailerLog('error', 'Brevo API key verification failed', {
      responseCode: error?.responseCode,
      message: error?.message || String(error),
    });
    throw error;
  }
};

const logMailerStatus = () => {
  if (!smtpConfigured) {
    const msg = 'BREVO_API_KEY is not configured. Email delivery will not work until it is set.';
    if (isProduction) {
      mailerLog('error', msg);
    } else {
      mailerLog('warn', msg);
    }
    return;
  }

  mailerLog('log', 'configured Brevo transactional email API', { from: emailFrom, sender });
};

logMailerStatus();
if (smtpConfigured) {
  setTimeout(() => {
    verifyMailerConnection().catch((error) =>
      mailerLog('warn', 'startup verify failed (non-fatal)', { message: error?.message || String(error) })
    );
  }, 2000);
}

const sendOTPEmail = async (email, otp) => {
  if (!smtpConfigured) {
    const message = 'BREVO_API_KEY is missing. Cannot send OTP email.';
    mailerLog('error', 'sendOTPEmail blocked', { message, email });
    if (isProduction) {
      throw new Error(message);
    }
    return { success: false, message, otp };
  }

  const mailOptions = {
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
  };

  try {
    const info = await sendMail(mailOptions);
    mailerLog('log', 'OTP email sent', { to: email, messageId: info.messageId, response: info.response });
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    mailerLog('error', 'failed to send OTP email', {
      to: email,
      code: error?.code,
      responseCode: error?.responseCode,
      response: error?.response,
      message: error && error.message ? error.message : String(error),
    });
    const wrapped = new Error(`Failed to send OTP email: ${error.message || error}`);
    wrapped.code = error?.code;
    wrapped.responseCode = error?.responseCode;
    wrapped.response = error?.response;
    throw wrapped;
  }
};

// Nodemailer-shaped adapter so existing call sites (server.js /health/smtp,
// routes/auth.js's direct transactional send) don't need to change.
const transporter = {
  sendMail,
  verify: verifyMailerConnection,
};

module.exports = {
  transporter,
  sendOTPEmail,
  smtpConfigured,
  emailFrom,
  verifyMailerConnection,
};
