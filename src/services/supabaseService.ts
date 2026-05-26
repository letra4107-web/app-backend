import Constants from 'expo-constants';
import { getSupabaseDebugInfo, supabase } from '../config/supabase';
import { buildApiUrl, getJson } from '../config/api';

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
    const MAX_ATTEMPTS = 2;

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

export const signOutUser = async () => {
  return supabase.auth.signOut();
};

export const resetPassword = async (email: string) => {
  return supabase.auth.resetPasswordForEmail(email);
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
    .single();
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
