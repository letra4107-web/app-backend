const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { validateEnv } = require('./env');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
} = validateEnv();

const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const supabaseAdmin = createClient(SUPABASE_URL, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: {
    transport: WebSocket,
  },
  global: {
    headers: {
      'X-Client-Info': 'linawletra-backend',
    },
  },
});

if (!SUPABASE_SERVICE_ROLE_KEY && SUPABASE_ANON_KEY) {
  console.warn('[Supabase] SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to SUPABASE_ANON_KEY. Admin operations may fail if service role credentials are required.');
}

console.log('[Supabase] Admin client initialized successfully with SUPABASE_URL:', SUPABASE_URL);

module.exports = { supabaseAdmin };
