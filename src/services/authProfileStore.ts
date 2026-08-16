import * as SecureStore from 'expo-secure-store';

// One-tap re-login (capstone panel item 1). Stores a small list of "saved
// profile" tickets in the OS keychain/keystore (SecureStore, not
// AsyncStorage) - never the password, only a Supabase refresh token. This is
// deliberately a *separate* storage key from Supabase's own session token
// (see clearPersistedSupabaseSession in supabaseService.ts), so a normal
// logout - which only wipes the live session - does not touch this list.
// Profiles expire after PROFILE_TTL_DAYS of disuse regardless of whether the
// refresh token itself is still technically valid, bounding how long a lost
// device stays "tap to log back in" ready. Student profiles get a shorter
// window than parent/teacher ones (7 vs 30 days) - this is a shared-device,
// child-safety app, and a student account left logged-in-adjacent on a
// family tablet is a bigger exposure than a parent's own phone. See the
// "switch profile" logout trade-off note in supabaseService.ts for the full
// write-up of the compensating controls (this TTL, plus the mandatory
// biometric/PIN gate in localAuthService.ts and LoginScreen.tsx).

export type SavedAuthProfile = {
  userId: string;
  role: 'parent' | 'student' | 'teacher';
  isEmail: boolean; // mirrors completeAuthSession's isEmail flag for this account
  displayName: string;
  avatarUrl?: string | null;
  refreshToken: string;
  savedAt: string; // ISO timestamp, refreshed on every successful login/relogin
};

const STORE_KEY = 'linawletra.savedProfiles.v1';
const MAX_PROFILES = 5;
const STUDENT_PROFILE_TTL_DAYS = 7;
const DEFAULT_PROFILE_TTL_DAYS = 30;
const ttlDaysFor = (role: SavedAuthProfile['role']) =>
  role === 'student' ? STUDENT_PROFILE_TTL_DAYS : DEFAULT_PROFILE_TTL_DAYS;

const readAll = async (): Promise<SavedAuthProfile[]> => {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[AuthProfileStore] failed to read saved profiles:', error);
    return [];
  }
};

const writeAll = async (profiles: SavedAuthProfile[]): Promise<void> => {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(profiles));
};

/** Returns saved profiles, pruning (and persisting the prune of) any past their role's TTL of disuse. */
export const getSavedProfiles = async (): Promise<SavedAuthProfile[]> => {
  const all = await readAll();
  const now = Date.now();
  const fresh = all.filter((p) => now - new Date(p.savedAt).getTime() < ttlDaysFor(p.role) * 24 * 60 * 60 * 1000);
  if (fresh.length !== all.length) await writeAll(fresh);
  return fresh;
};

/** Upserts by userId (moves it to the front) and evicts the oldest past MAX_PROFILES. */
export const saveAuthProfile = async (profile: Omit<SavedAuthProfile, 'savedAt'>): Promise<void> => {
  const all = await readAll();
  const filtered = all.filter((p) => p.userId !== profile.userId);
  const next = [{ ...profile, savedAt: new Date().toISOString() }, ...filtered].slice(0, MAX_PROFILES);
  await writeAll(next);
};

export const removeSavedProfile = async (userId: string): Promise<void> => {
  const all = await readAll();
  await writeAll(all.filter((p) => p.userId !== userId));
};

/** Called after a saved profile is successfully used to relogin - Supabase rotates refresh tokens on
 * use, so the new one must replace the old or the saved profile would only ever work once. */
export const updateSavedProfileToken = async (userId: string, refreshToken: string): Promise<void> => {
  const all = await readAll();
  const next = all.map((p) => (p.userId === userId ? { ...p, refreshToken, savedAt: new Date().toISOString() } : p));
  await writeAll(next);
};
