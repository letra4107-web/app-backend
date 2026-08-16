import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
// Not re-exported from the main expo-auth-session entrypoint, but this exact
// subpath is what Supabase's own Expo integration guide uses to pull the
// `code`/`error` query params out of a PKCE redirect URL — exchangeCodeForSession
// wants just the code string, not the whole URL.
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { getSupabaseDebugInfo, supabase } from '../config/supabase';
import { buildApiUrl, getJson, postJson } from '../config/api';
import { ensureParentProfile } from './profileService';

// Recommended by Expo's docs so a pending native auth session (from
// WebBrowser.openAuthSessionAsync) properly resolves instead of hanging —
// a no-op on native, relevant mainly to the web OAuth redirect path.
WebBrowser.maybeCompleteAuthSession();

const SIGNUP_TIMEOUT_MS = 20000;

const extra =
  (Constants.expoConfig?.extra as Record<string, string> | undefined) ||
  ((Constants as any).manifest?.extra as Record<string, string> | undefined) ||
  {};

const SUPABASE_EMAIL_REDIRECT_TO =
  process.env.EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO ||
  extra.EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO ||
  extra.FRONTEND_URL ||
  'https://linawletra-130cb.web.app/login';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[Supabase] ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const sanitizeAuthEmail = (email: string) => email.trim().toLowerCase();

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
};

const describePasswordForDebug = (password: string) => ({
  length: password.length,
  trimmedLength: password.trim().length,
  hasLeadingOrTrailingWhitespace: password !== password.trim(),
  hasNonAscii: /[^\x20-\x7E]/.test(password),
  hasZeroWidth: /[\u200B-\u200D\uFEFF]/.test(password),
});

const describeEmailForDebug = (rawEmail: string, normalizedEmail: string) => ({
  rawLength: rawEmail.length,
  normalized: normalizedEmail,
  normalizedLength: normalizedEmail.length,
  changedByNormalization: rawEmail !== normalizedEmail,
  hasLeadingOrTrailingWhitespace: rawEmail !== rawEmail.trim(),
  hasUppercase: /[A-Z]/.test(rawEmail),
});

const toPlainSupabaseError = (error: any) => {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    __isAuthError: error.__isAuthError,
  };
};

export const mapSupabaseAuthErrorCode = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  if (message.includes('email not confirmed') || code.includes('email_not_confirmed')) {
    return 'auth/email-not-confirmed';
  }
  if (message.includes('invalid login credentials') || code.includes('invalid_credentials')) {
    return 'auth/invalid-credential';
  }
  if (message.includes('too many') || error?.status === 429) {
    return 'auth/too-many-requests';
  }
  if (message.includes('invalid email')) {
    return 'auth/invalid-email';
  }
  return error?.code || 'auth/unknown';
};

export interface UserProfile {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  gradeLevel?: string;
  email_verified?: boolean;
  lastLoginAt?: string;
  parent_id?: string;
}

export interface ChildRecord {
  id: string;
  parent_id: string;
  parent_email: string;
  name: string;
  grade_level: string;
  username: string;
  auth_uid: string;
  auth_email: string;
}

export interface ProgressRecord {
  id: string;
  xp?: number;
  streak?: number;
  accuracy?: number;
  level?: string;
  progress?: number;
  completedWords?: string[];
  achievements?: any[];
  totalAttempts?: number;
  practiceLevel?: string;
  lastPractice?: string;
  lastUpdated?: string;
}

export interface AssignmentRecord {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  status: string;
}

export const signUpUser = async (
  email: string,
  password: string,
  metadata: Record<string, any> = {},
) => {
  const startedAt = Date.now();
  console.log('[Supabase] signUpUser start:', {
    email: maskEmail(email),
    hasMetaKeys: metadata ? Object.keys(metadata).slice(0, 10) : [],
  });

  try {
    const startRequestAt = Date.now();

    const attempt = async (attemptNo: number) => {
      console.log('[Supabase] signUp attempt:', { attemptNo, msSinceStart: Date.now() - startedAt });
      const signUpOptions: Record<string, any> = { data: metadata };
      if (SUPABASE_EMAIL_REDIRECT_TO) {
        signUpOptions.emailRedirectTo = SUPABASE_EMAIL_REDIRECT_TO;
      }
      return withTimeout(
        supabase.auth.signUp({ email, password, options: signUpOptions }),
        SIGNUP_TIMEOUT_MS,
        `supabase.auth.signUp(attempt ${attemptNo})`,
      );
    };

    let res = await attempt(1);

    // Retry once on timeout/network errors (not on auth errors like 400/422)
    if (res.error && (res.error as any).message?.toLowerCase().includes('timed out')) {
      console.warn('[Supabase] signUp attempt 1 timed out, retrying...');
      res = await attempt(2);
    }

    console.log('[Supabase] signUp completed:', {
      ms: Date.now() - startRequestAt,
      msTotal: Date.now() - startedAt,
      hasUser: !!res?.data?.user,
      error: res?.error ? { status: res.error.status, message: res.error.message } : null,
    });

    return res;
  } catch (err: any) {
    console.error('[Supabase] signUpUser threw:', {
      ms: Date.now() - startedAt,
      message: err?.message,
      status: err?.status,
      name: err?.name,
    });
    throw err;
  }
};

/** Compensates for a failed post-signup profile write. */
export const rollbackIncompleteSignup = async (email: string, userId: string, cleanupToken: string) =>
  postJson<{ success: boolean; message?: string }>(
    buildApiUrl('/auth/rollback-incomplete-signup'),
    { email, userId, cleanupToken },
    15000,
  );



export const signInUser = async (email: string, password: string) => {
  const normalizedEmail = sanitizeAuthEmail(email);
  const startedAt = Date.now();

  console.log('[Supabase] signInWithPassword request:', {
    supabase: getSupabaseDebugInfo(),
    email: describeEmailForDebug(email, normalizedEmail),
    password: describePasswordForDebug(password),
    method: 'email/password',
  });

  const response = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  console.log('[Supabase] signInWithPassword response:', {
    ms: Date.now() - startedAt,
    hasUser: !!response.data?.user,
    hasSession: !!response.data?.session,
    userId: response.data?.user?.id,
    userEmail: response.data?.user?.email,
    emailConfirmedAt: response.data?.user?.email_confirmed_at,
    error: toPlainSupabaseError(response.error),
  });

  return response;
};

// One-tap re-login (panel item 1): exchanges a saved refresh token for a
// fresh session. Supabase rotates refresh tokens on every use (the old one
// is invalidated the moment this succeeds), so the caller MUST persist
// `data.session.refresh_token` from the response back into the saved-profile
// store (see authProfileStore.updateSavedProfileToken) or the saved profile
// will only ever work once.
export const relogin = async (refreshToken: string) => {
  const response = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  console.log('[Supabase] refreshSession (one-tap relogin) response:', {
    hasUser: !!response.data?.user,
    hasSession: !!response.data?.session,
    userId: response.data?.user?.id,
    error: toPlainSupabaseError(response.error),
  });
  return response;
};

const clearPersistedSupabaseSession = async () => {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => localStorage.removeItem(key));
    return;
  }

  // A remote sign-out can fail while the phone is offline. Removing only the
  // app's Supabase auth token still guarantees that logout works locally.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorageModule = require('@react-native-async-storage/async-storage');
  const storage = AsyncStorageModule?.default || AsyncStorageModule;
  const keys: string[] = await storage.getAllKeys();
  const authKeys = keys.filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
  if (authKeys.length) await storage.multiRemove(authKeys);
};

// "Switch profile" logout (panel item 1, approved trade-off): the everyday
// "Mag-log out" button in every dashboard calls THIS, not a network-revoking
// sign-out. It clears only the local session, deliberately leaving the
// refresh token saved in authProfileStore (see the one-tap re-login flow in
// LoginScreen.tsx) valid server-side, so tapping the saved profile later can
// exchange it for a fresh session.
//
// Why this is safe enough to ship: Supabase's public signOut() has no
// "local-only, don't revoke" mode - even `{ scope: 'local' }` still calls the
// server admin.signOut endpoint and revokes the current session's refresh
// token (see @supabase/auth-js GoTrueClient.ts _signOut; `scope` there only
// controls WHICH sessions get revoked, never whether). So this reaches into
// the client's private _removeSession() to clear stored tokens and fire the
// SIGNED_OUT event without any network call, with a full-revoke fallback if
// that private method is ever renamed/removed by a future SDK upgrade.
//
// The security boundary this trades away (immediate server-side revocation
// on every logout) is compensated by: a mandatory biometric/PIN gate on every
// one-tap relogin attempt (see localAuthService.ts - it's skipped only if no
// lock is enrolled, and in that case LoginScreen refuses to offer one-tap
// login at all, not silently bypass the gate), a short saved-profile TTL
// (7 days for students, 30 for parents/teachers - see authProfileStore.ts),
// and a separate, clearly-labeled "Mag-sign out nang tuluyan" action (see
// signOutUserFully below) that DOES revoke immediately, for whenever someone
// actually wants a real sign-out - e.g. handing a shared device to a
// different child.
export const signOutUser = async () => {
  try {
    await (supabase.auth as any)._removeSession();
  } catch (error) {
    console.warn('[Auth] local-only sign-out unavailable, falling back to a full sign-out:', error);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (fallbackError) {
      console.warn('[Auth] fallback sign-out also failed:', fallbackError);
    }
  }
  await clearPersistedSupabaseSession();
  return { error: null };
};

// A REAL sign-out: revokes the current session's refresh token server-side,
// so it can no longer be used for one-tap re-login even if the device is
// shared or lost. Pair this with authProfileStore.removeSavedProfile(userId)
// at the call site so the now-dead saved profile also disappears from the
// picker - see the "Mag-sign out nang tuluyan" action in the dashboard
// sidebars and the visible remove option in LoginScreen's profile picker.
export const signOutUserFully = async () => {
  let remoteError: any = null;
  try {
    const result = await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise<{ error: Error }>((resolve) => {
        setTimeout(() => resolve({ error: new Error('Naabot ang time limit ng logout request.') }), 8000);
      }),
    ]);
    remoteError = result.error;
  } catch (error) {
    remoteError = error;
  }

  // Always clear the persisted token locally too, even if the remote revoke
  // failed (e.g. offline) - users must still be able to leave the account.
  await clearPersistedSupabaseSession();
  if (remoteError) console.warn('[Auth] remote sign-out failed; local session was cleared:', remoteError?.message || remoteError);
  return { error: null };
};

export type OAuthProvider = 'google';

// Google login: Supabase does the actual OAuth dance with the
// provider server-side — this just opens that URL in a native browser tab
// (WebBrowser.openAuthSessionAsync) and waits for it to redirect back into
// the app via the custom "linawletra://" scheme (registered in app.json),
// then exchanges the returned PKCE code for a real session.
export const signInWithOAuthProvider = async (provider: OAuthProvider) => {
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'linawletra', path: 'auth-callback' });

  console.log('[Supabase] signInWithOAuth start:', { provider, redirectTo, platform: Platform.OS });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    console.error('[Supabase] signInWithOAuth failed to get provider URL:', { provider, error: toPlainSupabaseError(error) });
    return { data: null, error: error || new Error(`Hindi masimulan ang pag-log in gamit ang ${provider}`) };
  }

  if (Platform.OS === 'web') {
    // Supabase's normal web pattern is a full-page redirect to the provider,
    // then back to this same page — skipBrowserRedirect just lets us log the
    // URL first; the redirect itself still has to happen via the browser.
    window.location.href = data.url;
    return { data: null, error: null };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log('[Supabase] WebBrowser.openAuthSessionAsync result:', { provider, type: result.type });

  if (result.type === 'cancel' || result.type === 'dismiss') {
    const cancelError: any = new Error(`Kinansela ang pag-log in gamit ang ${provider}`);
    cancelError.code = 'auth/oauth-cancelled';
    return { data: null, error: cancelError };
  }

  if (result.type !== 'success' || !result.url) {
    return { data: null, error: new Error(`Hindi natapos ang pag-log in gamit ang ${provider}`) };
  }

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode || !params.code) {
    console.error('[Supabase] OAuth redirect had no code:', { provider, errorCode, url: result.url });
    return { data: null, error: new Error(errorCode || `Walang natanggap na code mula sa ${provider}`) };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(params.code);
  if (sessionError || !sessionData?.session?.user) {
    console.error('[Supabase] exchangeCodeForSession failed:', { provider, error: toPlainSupabaseError(sessionError) });
    return { data: null, error: sessionError || new Error('Hindi natapos ang sign-in session') };
  }

  console.log('[Supabase] OAuth sign-in successful:', { provider, userId: sessionData.session.user.id });
  return { data: { user: sessionData.session.user }, error: null };
};

// New Google sign-ins never went through SignUpScreen, so there's no `users`
// row yet. Mirrors SignUpScreen's exact profile shape (role: 'parent' — the
// only self-serve signup path this app has) so an OAuth user reaches the
// dashboard the same way an email/password signup would. Idempotent: a
// returning OAuth user already has both rows, so both calls are no-ops.
export const ensureUserProfileForOAuthUser = async (user: any) => {
  const existing = await getUserProfileById(user.id);
  if (existing.data) return;

  const fullName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Parent';
  console.log('[Supabase] First-time OAuth login — creating user profile row:', { userId: user.id });

  const { error: userProfileError } = await upsertUserProfile({
    id: user.id,
    name: fullName,
    email: user.email,
    role: 'parent',
    // Google already verified this address on their end.
    email_verified: true,
  });
  if (userProfileError) throw userProfileError;

  try {
    await ensureParentProfile({
      id: user.id,
      auth_uid: user.id,
      full_name: fullName,
      name: fullName,
      email: user.email,
    });
  } catch (parentProfileError) {
    console.error('[Supabase] Failed to create parent profile row for OAuth user:', parentProfileError);
  }
};

const normalizeRole = (role?: string) => (typeof role === 'string' ? role.trim().toLowerCase() : '');

const determineUserRole = (loginIsUsername: boolean, profileRole?: string, email?: string) => {
  // Username login is always a student
  if (loginIsUsername) return 'student';

  const normalizedRole = normalizeRole(profileRole);
  if (normalizedRole === 'student') return 'student';
  if (normalizedRole === 'teacher') return 'teacher';
  if (normalizedRole === 'parent') return 'parent';

  // Email pattern fallback
  if (email?.toLowerCase().endsWith('@student.linawletra.app') || email?.toLowerCase().includes('@student.')) {
    return 'student';
  }

  // No role set yet — return null to trigger child lookup
  return null;
};

// Shared by every login entry point — email/password (LoginScreen), student
// username (LoginScreen), and Google (LoginScreen + SignUpScreen) —
// so role resolution and dashboard routing behave identically no matter how
// the user authenticated. `navigation` is a React Navigation prop passed in
// by whichever screen calls this.
export const completeAuthSession = async (
  user: any,
  isEmail: boolean,
  navigation: any,
  onUnknownRole?: (message: string) => void,
  // One-tap re-login (panel item 1): fired right before each successful
  // dashboard navigation, once the role/display-name/avatar are fully
  // resolved - lets LoginScreen save/refresh a SecureStore profile ticket
  // without duplicating this function's role-resolution logic. Never fires
  // on the unverified-email or unknown-role branches, since those aren't a
  // "successfully logged in" state worth offering one-tap relogin for.
  onResolved?: (info: { role: string; displayName: string; avatarUrl: string | null }) => void,
) => {
  const loginIsUsername = !isEmail;
  let profileData: any = null;
  let profileRole = '';

  console.log('[Auth] Session established for user:', user.email);
  let emailVerified = !!user.email_confirmed_at;

  if (isEmail) {
    const profileResult = await getUserProfileById(user.id);
    console.log('[Auth] Profile lookup after auth:', {
      userId: user.id,
      hasProfile: !!profileResult.data,
      profileRole: profileResult.data?.role,
      profileEmail: profileResult.data?.email,
      profileError: profileResult.error
        ? { message: profileResult.error.message, code: profileResult.error.code, details: profileResult.error.details }
        : null,
    });
    profileData = profileResult.data;

    const determinedRole = determineUserRole(loginIsUsername, profileData?.role, user.email || undefined);

    if (!determinedRole || determinedRole === null) {
      const childLookup = await getChildByAuthUid(user.id);
      if (childLookup.data) {
        console.log('[Auth] Found child record — setting role to student');
        profileRole = 'student';
        profileData = { ...(profileData || {}), name: childLookup.data.name };
      } else {
        profileRole = '';
      }
    } else {
      profileRole = determinedRole;

      // Even if profile says parent/teacher, double-check children table
      // (web enrollments sometimes create users with wrong role)
      if (profileRole !== 'student') {
        const childLookup = await getChildByAuthUid(user.id);
        if (childLookup.data) {
          console.log('[Auth] Profile role was', profileRole, 'but found child record — overriding to student');
          profileRole = 'student';
          profileData = { ...(profileData || {}), name: childLookup.data.name };
        }
      }
    }

    if (!emailVerified && profileData?.email_verified) {
      emailVerified = true;
    }
  } else {
    profileRole = 'student';
    profileData = { name: user.user_metadata?.full_name || user.email };
  }

  if (isEmail && !emailVerified) {
    console.log('[Auth] Email not verified, redirecting to verification screen');
    navigation.replace('EmailVerification', {
      email: user.email,
      userId: user.id,
      message: 'Your email is not verified. Enter the 6-digit code sent to your email to continue.',
    });
    return;
  }

  await upsertUserProfile({ id: user.id, lastLoginAt: new Date().toISOString() });

  if (profileRole === 'parent') {
    console.log('[Auth] → ParentDashboard');
    onResolved?.({ role: profileRole, displayName: profileData?.name || profileData?.full_name || user.email || 'Parent', avatarUrl: profileData?.avatar_url || null });
    navigation.replace('ParentDashboard');
  } else if (profileRole === 'student') {
    console.log('[Auth] → StudentDashboard');
    onResolved?.({ role: profileRole, displayName: profileData?.name || 'Mag-aaral', avatarUrl: profileData?.avatar_url || null });
    navigation.replace('StudentDashboard');
  } else if (profileRole === 'teacher') {
    console.log('[Auth] → ParentDashboard (teacher placeholder)');
    onResolved?.({ role: profileRole, displayName: profileData?.name || profileData?.full_name || user.email || 'Guro', avatarUrl: profileData?.avatar_url || null });
    navigation.replace('ParentDashboard');
  } else if (isEmail) {
    // Reaching here means: real Supabase Auth user, no `users` row, and no
    // matching `children` row either - i.e. exactly the state a signup can
    // be left in if the profile-row write failed right after the auth user
    // was created (see SignUpScreen's retry+error-message for that case).
    // Self-heal by creating the same parent profile signup would have, so
    // the user isn't stuck at a dead-end "contact admin" message just
    // because of a transient failure moments earlier. Not attempted for
    // non-email (username/student) logins, where an unrecognized role is a
    // different, unrelated problem this shouldn't guess an answer for.
    console.warn('[Auth] No profile/child found for authenticated user - attempting to self-heal a parent profile:', user.id);
    try {
      const displayName = user.user_metadata?.display_name || user.user_metadata?.full_name || user.email || 'Parent';
      await upsertUserProfile({ id: user.id, name: displayName, email: user.email, role: 'parent', email_verified: emailVerified });
      await ensureParentProfile({ id: user.id, auth_uid: user.id, full_name: displayName, name: displayName, email: user.email });
      console.log('[Auth] Self-heal succeeded → ParentDashboard');
      onResolved?.({ role: 'parent', displayName, avatarUrl: null });
      navigation.replace('ParentDashboard');
    } catch (healError: any) {
      console.error('[Auth] Self-heal failed:', healError?.message || healError);
      onUnknownRole?.('Hindi kilala ang account type. Makipag-ugnayan sa admin.');
    }
  } else {
    console.error('[Auth] Could not determine role for user:', user.id);
    onUnknownRole?.('Hindi kilala ang account type. Makipag-ugnayan sa admin.');
  }
};

// Password resets use the backend's six-digit OTP flow. Keeping this request
// behind the backend lets the API return the same response for known and
// unknown addresses, which prevents account enumeration.
export const resetPassword = async (email: string) => {
  try {
    const data = await postJson(buildApiUrl('/auth/request-password-reset'), { email }, 30000);
    return { data, error: null };
  } catch (error: any) {
    const message = error?.data?.message || error?.message || 'Hindi naipadala ang reset email.';
    return {
      data: null,
      error: { message, status: error?.status, data: error?.data },
    };
  }
};

export const completePasswordReset = async (email: string, code: string, password: string) => {
  return postJson(buildApiUrl('/auth/complete-password-reset'), { email, code, password }, 30000);
};

export const getCurrentSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
};

export const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  return data.user;
};

export const onAuthStateChanged = (callback: (event: string, session: any) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
};

export const getUserProfileById = async (id: string) => {
  const { data, error } = await (supabase as any)
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return { data, error };
};

export const getUserProfileByEmail = async (email: string) => {
  const { data, error } = await (supabase as any)
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  return { data, error };
};

export const upsertUserProfile = async (profile: Partial<UserProfile>) => {
  const { data, error } = await (supabase as any).from('users').upsert(profile);
  return { data, error };
};

export const getChildByUsername = async (username: string) => {
  const { data, error } = await (supabase as any)
    .from('children')
    .select('*')
    .eq('username', username)
    .single();
  return { data, error };
};

export const getChildByAuthUid = async (authUid: string) => {
  const { data, error } = await (supabase as any)
    .from('children')
    .select('*')
    .eq('auth_uid', authUid)
    .maybeSingle();
  return { data, error };
};

export const getChildrenByParentId = async (parentId: string) => {
  const { data, error } = await (supabase as any)
    .from('children')
    .select('*')
    .eq('parent_id', parentId);
  return { data, error };
};

export const getProgress = async (id: string) => {
  const { data, error } = await (supabase as any)
    .from('progress')
    .select('*')
    .eq('id', id)
    .single();
  return { data, error };
};

export const upsertProgress = async (progress: Partial<ProgressRecord>) => {
  const { data, error } = await (supabase as any).from('progress').upsert(progress);
  return { data, error };
};

export const getAssignments = async (studentId: string) => {
  const { data, error } = await (supabase as any)
    .from('assignments')
    .select('*')
    .eq('studentId', studentId);
  return { data, error };
};



export const getReadingActivitiesByGrade = async (grade: number) => {
  return getJson<{ success: boolean; grade: number; gradeLabel: string; words: string[] }>(
    buildApiUrl(`/reading/activities/${grade}`),
  );
};

export const getChildrenProgress = async (parentId: string) => {
  const childrenRes = await getChildrenByParentId(parentId);
  if (childrenRes.error) {
    return { data: null, error: childrenRes.error };
  }
  const children = childrenRes.data || [];
  const progressPromises = (children as any[]).map(async (child: any) => {
    const { data: progress, error } = await getProgress(child.auth_uid);
    return {
      child,
      progress: progress || null,
      progressError: error || null,
    };
  });
  return { data: await Promise.all(progressPromises), error: null };
};
