const path = require('path');
const dotenv = require('dotenv');

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
}

const ENV_VARS = {
  SUPABASE_URL: 'SUPABASE_URL',
  SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
  SUPABASE_ANON_KEY: 'SUPABASE_ANON_KEY',
};

const SMTP_VARS = {
  EMAIL_USER: 'EMAIL_USER or SMTP_USER',
  EMAIL_PASS: 'EMAIL_PASS or SMTP_PASS',
  EMAIL_FROM: 'EMAIL_FROM or SMTP_FROM',
};

function validateEnv() {
  const missing = [];
  const supabaseUrl = process.env[ENV_VARS.SUPABASE_URL]?.trim();
  const serviceRoleKey = process.env[ENV_VARS.SUPABASE_SERVICE_ROLE_KEY]?.trim();
  const anonKey = process.env[ENV_VARS.SUPABASE_ANON_KEY]?.trim();
  const effectiveSmtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const effectiveSmtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim().replace(/\s/g, '');
  const effectiveSmtpFrom = (process.env.SMTP_FROM || process.env.EMAIL_FROM || '')
    .trim()
    .replace(/^"(.*)"$/, '$1');

  if (!supabaseUrl) {
    missing.push(ENV_VARS.SUPABASE_URL);
  }

  if (!serviceRoleKey && !anonKey) {
    missing.push(`${ENV_VARS.SUPABASE_SERVICE_ROLE_KEY} or ${ENV_VARS.SUPABASE_ANON_KEY}`);
  }

  if ((process.env.NODE_ENV || 'development') === 'production') {
    if (!effectiveSmtpUser) {
      missing.push(SMTP_VARS.EMAIL_USER);
    }
    if (!effectiveSmtpPass) {
      missing.push(SMTP_VARS.EMAIL_PASS);
    }
    if (!effectiveSmtpFrom) {
      missing.push(SMTP_VARS.EMAIL_FROM);
    }
  }

  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Set them in your environment or create a .env file from .env.example.`
    );
  }

  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey || null,
    SUPABASE_ANON_KEY: anonKey || null,
    SUPABASE_KEY: serviceRoleKey || anonKey,
  };
}

function exitIfInvalid() {
  try {
    return validateEnv();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  ENV_VARS,
  validateEnv,
  exitIfInvalid,
};
