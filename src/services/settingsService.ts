import { supabase } from '../config/supabase';

export type SettingsRole = 'parent' | 'student';
export type FontSize = 'small' | 'medium' | 'large';
export type ReadingTheme = 'light' | 'dark' | 'sepia' | 'system';
export type SpeechRate = 'slow' | 'normal' | 'fast';

export type DashboardSettings = {
  auth_uid: string;
  notifications_enabled: boolean;
  assignment_notifications: boolean;
  lesson_notifications: boolean;
  deadline_notifications: boolean;
  progress_notifications: boolean;
  dark_mode: boolean;
  font_size: FontSize;
  dyslexia_font: boolean;
  tts_enabled: boolean;
  stt_enabled: boolean;
  high_contrast: boolean;
  push_notifications?: boolean;
  reading_theme?: ReadingTheme;
  reading_guide: boolean;
  two_factor_enabled: boolean;
  weekly_progress_reports?: boolean;
  daily_activity_summary?: boolean;
  teacher_updates?: boolean;
  milestone_alerts?: boolean;
  speech_rate?: SpeechRate;
  show_accuracy_score?: boolean;
  auto_read_words?: boolean;
};

const tableForRole = (role: SettingsRole) => (role === 'parent' ? 'parents_settings' : 'student_settings');

const isMissingTableError = (error: any) =>
  error?.code === 'PGRST205' ||
  error?.code === '42P01' ||
  error?.status === 404 ||
  String(error?.message || '').toLowerCase().includes('could not find the table');

const isSchemaMismatchError = (error: any) =>
  error?.code === 'PGRST204' ||
  error?.code === '42703' ||
  error?.status === 400 ||
  String(error?.message || '').toLowerCase().includes('column');

const normalizeSettingsError = (error: any, table: string) => {
  if (isMissingTableError(error)) {
    return new Error(`${table} table is missing in Supabase. Run migration/migrations/004_user_settings.sql.`);
  }
  return error;
};

const getMissingColumnName = (error: any) => {
  const message = String(error?.message || '');
  const details = String(error?.details || '');
  return (
    message.match(/\.([a-zA-Z0-9_]+) does not exist/)?.[1] ||
    message.match(/'([a-zA-Z0-9_]+)' column/)?.[1] ||
    details.match(/'([a-zA-Z0-9_]+)' column/)?.[1] ||
    null
  );
};

const CORE_SETTINGS_COLUMNS = [
  'auth_uid',
  'dark_mode',
  'font_size',
  'dyslexia_font',
  'notifications_enabled',
  'assignment_notifications',
  'lesson_notifications',
  'deadline_notifications',
  'progress_notifications',
  'tts_enabled',
  'stt_enabled',
  'high_contrast',
] as const;

const STUDENT_SETTINGS_COLUMNS = [
  'auth_uid',
  'dark_mode',
  'font_size',
  'dyslexia_font',
  'notifications_enabled',
  'assignment_notifications',
  'lesson_notifications',
  'deadline_notifications',
  'tts_enabled',
  'stt_enabled',
  'high_contrast',
] as const;

const STUDENT_OPTIONAL_SETTINGS_COLUMNS = [
  'reading_theme',
  'reading_guide',
  'two_factor_enabled',
  'speech_rate',
  'show_accuracy_score',
  'auto_read_words',
] as const;

const OPTIONAL_SETTINGS_COLUMNS = [
  'push_notifications',
  'reading_theme',
  'reading_guide',
  'two_factor_enabled',
  'weekly_progress_reports',
  'daily_activity_summary',
  'teacher_updates',
  'milestone_alerts',
  'speech_rate',
  'show_accuracy_score',
  'auto_read_words',
] as const;

const sanitizePayload = (
  payload: Partial<DashboardSettings>,
  mode: 'core' | 'full' = 'full',
  role: SettingsRole = 'parent',
): Partial<DashboardSettings> => {
  const allowed = role === 'student'
    ? mode === 'core'
      ? STUDENT_SETTINGS_COLUMNS
      : [...STUDENT_SETTINGS_COLUMNS, ...STUDENT_OPTIONAL_SETTINGS_COLUMNS]
    : mode === 'core'
    ? CORE_SETTINGS_COLUMNS
    : [...CORE_SETTINGS_COLUMNS, ...OPTIONAL_SETTINGS_COLUMNS];

  return allowed.reduce((acc, key) => {
    const value = payload[key];
    if (value !== undefined && value !== null) {
      (acc as any)[key] = value;
    }
    return acc;
  }, {} as Partial<DashboardSettings>);
};

const requireAuthenticatedUser = async (authUid: string) => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('You must be signed in before saving settings.');
  if (data.user.id !== authUid) throw new Error('Settings auth_uid does not match the signed-in user.');
  return data.user;
};

const insertSettingsWithSchemaRetry = async (
  table: string,
  payload: Partial<DashboardSettings>,
  missingColumns: string[] = [],
): Promise<any> => {
  const safePayload = { ...payload };
  missingColumns.forEach((column) => delete (safePayload as any)[column]);

  const result = await supabase.from(table).insert(safePayload).select('*').single();
  if (!result.error) return result.data;
  console.error('[Settings] insert error:', {
    table,
    payload: safePayload,
    error: result.error,
  });

  const missingColumn = getMissingColumnName(result.error);
  if (isSchemaMismatchError(result.error) && missingColumn && missingColumn !== 'auth_uid' && !missingColumns.includes(missingColumn)) {
    return insertSettingsWithSchemaRetry(table, payload, [...missingColumns, missingColumn]);
  }

  throw normalizeSettingsError(result.error, table);
};

const upsertSettingsWithSchemaRetry = async (
  table: string,
  payload: Partial<DashboardSettings>,
  missingColumns: string[] = [],
): Promise<any> => {
  const safePayload = { ...payload };
  missingColumns.forEach((column) => delete (safePayload as any)[column]);

  const result = await supabase
    .from(table)
    .upsert(safePayload, { onConflict: 'auth_uid' })
    .select('*')
    .single();
  if (!result.error) return result.data;
  console.error('[Settings] upsert error:', {
    table,
    payload: safePayload,
    error: result.error,
  });

  const missingColumn = getMissingColumnName(result.error);
  if (isSchemaMismatchError(result.error) && missingColumn && missingColumn !== 'auth_uid' && !missingColumns.includes(missingColumn)) {
    return upsertSettingsWithSchemaRetry(table, payload, [...missingColumns, missingColumn]);
  }

  throw normalizeSettingsError(result.error, table);
};

export const defaultSettings = (authUid: string, role: SettingsRole): DashboardSettings => ({
  auth_uid: authUid,
  notifications_enabled: true,
  assignment_notifications: true,
  lesson_notifications: true,
  deadline_notifications: true,
  progress_notifications: true,
  dark_mode: false,
  font_size: 'medium',
  dyslexia_font: true,
  tts_enabled: true,
  stt_enabled: false,
  high_contrast: false,
  push_notifications: true,
  reading_theme: 'light',
  reading_guide: false,
  two_factor_enabled: false,
  speech_rate: 'normal',
  show_accuracy_score: true,
  auto_read_words: true,
  ...(role === 'parent'
    ? {
        weekly_progress_reports: true,
        daily_activity_summary: true,
        teacher_updates: true,
        milestone_alerts: true,
      }
    : {}),
});

const normalizeSettingsRow = (row: any, authUid: string, role: SettingsRole): DashboardSettings => {
  const defaults = defaultSettings(authUid, role);
  return {
    ...defaults,
    ...row,
    notifications_enabled: row.notifications_enabled ?? defaults.notifications_enabled,
    lesson_notifications: row.lesson_notifications ?? row.lesson_updates ?? defaults.lesson_notifications,
    progress_notifications: row.progress_notifications ?? row.progress_reports ?? defaults.progress_notifications,
    deadline_notifications: row.deadline_notifications ?? defaults.deadline_notifications,
  };
};

export async function fetchDashboardSettings(authUid: string, role: SettingsRole) {
  await requireAuthenticatedUser(authUid);
  const table = tableForRole(role);
  const { data, error } = await supabase.from(table).select('*').eq('auth_uid', authUid).maybeSingle();
  if (error) throw normalizeSettingsError(error, table);
  if (data) return normalizeSettingsRow(data, authUid, role);

  const defaults = defaultSettings(authUid, role);
  const insertPayload = sanitizePayload(defaults, 'core', role);
  console.log('[Settings] insert payload:', { table, role, authUid, payload: insertPayload });
  const inserted = await insertSettingsWithSchemaRetry(table, insertPayload);
  return normalizeSettingsRow(inserted, authUid, role);
}

export async function updateDashboardSettings(
  authUid: string,
  role: SettingsRole,
  patch: Partial<DashboardSettings>,
) {
  await requireAuthenticatedUser(authUid);
  const table = tableForRole(role);
  const payload = sanitizePayload({ auth_uid: authUid, ...patch }, 'full', role);
  console.log('[Settings] upsert payload:', { table, role, authUid, payload });
  const data = await upsertSettingsWithSchemaRetry(table, payload);
  return normalizeSettingsRow(data, authUid, role);
}

export async function changePassword(password: string) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function changeEmail(email: string) {
  const { data, error } = await supabase.auth.updateUser({ email });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
