const { createClient } = require('@supabase/supabase-js');
const { validateEnv } = require('./env');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
} = validateEnv();

const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, key, {
  auth: { persistSession: false },
});

if (!SUPABASE_SERVICE_ROLE_KEY && SUPABASE_ANON_KEY) {
  console.warn('[Supabase] SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to SUPABASE_ANON_KEY. Admin operations may fail if service role credentials are required.');
}

console.log('[Supabase] Admin client initialized successfully with SUPABASE_URL:', SUPABASE_URL);

module.exports = { supabaseAdmin };
