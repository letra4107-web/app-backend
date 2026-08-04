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

function validateEnv() {
  const missing = [];
  const supabaseUrl = process.env[ENV_VARS.SUPABASE_URL]?.trim();
  const serviceRoleKey = process.env[ENV_VARS.SUPABASE_SERVICE_ROLE_KEY]?.trim();
  const anonKey = process.env[ENV_VARS.SUPABASE_ANON_KEY]?.trim();
  const effectiveBrevoKey = (process.env.BREVO_API_KEY || '').trim();

  if (!supabaseUrl) {
    missing.push(ENV_VARS.SUPABASE_URL);
  }

  if (!serviceRoleKey && !anonKey) {
    missing.push(`${ENV_VARS.SUPABASE_SERVICE_ROLE_KEY} or ${ENV_VARS.SUPABASE_ANON_KEY}`);
  }

  const smtpConfigured = Boolean(effectiveBrevoKey);
  if (!smtpConfigured) {
    console.warn(
      '[Env] BREVO_API_KEY is not configured. Email delivery will be disabled. Set BREVO_API_KEY for OTP email support.'
    );
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
    SMTP_CONFIGURED: smtpConfigured,
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
