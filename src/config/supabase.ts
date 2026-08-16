import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type ExpoExtra = Record<string, any>;

const extra =
  (Constants.expoConfig?.extra as ExpoExtra | undefined) ||
  (Constants as any).manifest?.extra ||
  {};

// Support flat keys, EXPO_PUBLIC_ prefixed keys, AND nested extra.supabase object
const SUPABASE_URL_RAW =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  extra.EXPO_PUBLIC_SUPABASE_URL ||
  extra.SUPABASE_URL ||
  extra.supabase?.url ||
  '';

const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  extra.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  extra.SUPABASE_ANON_KEY ||
  extra.supabase?.anonKey ||
  '';

if (!SUPABASE_URL_RAW || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Set them in .env (see .env.example) or in app.config extra.supabase before starting the app. ' +
    'Refusing to start with no credentials rather than falling back to a baked-in key.'
  );
}

// Strip accidental path suffixes and validate
const stripSupabasePaths = (url: string): string => {
  const stripped = url.trim().replace(/\/(rest|auth|storage|realtime)\/v\d.*$/i, '');
  if (stripped !== url.trim()) {
    console.warn(
      `[Supabase] URL contained a path suffix and was auto-corrected.\n  Was: ${url}\n  Now: ${stripped}`
    );
  }
  return stripped;
};

const SUPABASE_URL = stripSupabasePaths(SUPABASE_URL_RAW);

const maskKey = (key: string) =>
  key.length > 16 ? `${key.slice(0, 8)}...${key.slice(-6)}` : 'configured';

const getSupabaseProjectRef = (url: string) => {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return 'invalid-url';
  }
};

try {
  const parsed = new URL(SUPABASE_URL);
  if (parsed.protocol !== 'https:') {
    console.warn(`[Supabase] SUPABASE_URL should use https://. Got: ${SUPABASE_URL}`);
  }
} catch {
  console.warn(`[Supabase] SUPABASE_URL is not a valid URL: "${SUPABASE_URL}"`);
}

if (SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.length < 100) {
  console.warn(
    `[Supabase] SUPABASE_ANON_KEY looks too short (${SUPABASE_ANON_KEY.length} chars). It may be truncated.`
  );
}

// Only use React Native AsyncStorage on native platforms. On web, let supabase-js use browser storage.
// flowType: 'pkce' is required for the Google OAuth flow (signInWithOAuthProvider in
// supabaseService.ts) — it makes signInWithOAuth return a `code` we exchange manually via
// exchangeCodeForSession after the WebBrowser redirect, instead of implicit-flow tokens in a URL
// fragment (which is awkward to parse on native). Email/password sign-in is unaffected either way.
let clientOptions: any = { auth: { detectSessionInUrl: false, flowType: 'pkce' } };
if (Platform.OS !== 'web') {
  try {
    // Require dynamically so bundlers targeting web don't try to resolve native-only packages.
    // A static `import` would be resolved/bundled eagerly for every platform,
    // including web, defeating the point of this Platform.OS guard.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const storage = AsyncStorage?.default || AsyncStorage;
    clientOptions = {
      auth: {
        storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    };
  } catch (e) {
    console.warn('[Supabase] AsyncStorage not available; falling back to default storage.', (e as any)?.message || e);
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, clientOptions);

export const getSupabaseDebugInfo = () => ({
  url: SUPABASE_URL,
  projectRef: getSupabaseProjectRef(SUPABASE_URL),
  anonKeyMasked: maskKey(SUPABASE_ANON_KEY),
  anonKeyLength: SUPABASE_ANON_KEY.length,
  hasAsyncStorage: true,
});

console.log('[Supabase] client config:', getSupabaseDebugInfo());
