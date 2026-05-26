import { supabase } from '../config/supabase';

export type NotificationItem = {
  id: string;
  user_id?: string | null;
  student_id?: string | null;
  parent_id?: string | null;
  title: string;
  body?: string;
  message?: string;
  read?: boolean;
  is_read?: boolean;
  type?: string | null;
  created_at: string;
};

export type ParentNotificationInput = {
  studentId: string;
  parentId: string;
  title: string;
  message: string;
  type: string;
};

const formatSupabaseError = (error: any) => ({
  code: error?.code,
  message: error?.message,
  details: error?.details,
  hint: error?.hint,
  status: error?.status,
});

const isMissingColumnError = (error: any, column: string) =>
  error?.code === 'PGRST204' &&
  String(error?.message || '').includes(`'${column}'`);

export const fetchNotifications = async (userId: string) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .or(`parent_id.eq.${userId},user_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as NotificationItem[];
};

export const markNotificationRead = async (id: string) => {
  const { error } = await supabase.from('notifications').update({ read: true, is_read: true }).eq('id', id);
  if (!error) return;

  if (isMissingColumnError(error, 'is_read')) {
    console.warn('[Notifications] is_read column missing; retrying read update with legacy read column.');
    const retry = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (retry.error) throw retry.error;
    return;
  }

  throw error;
};

export const subscribeToParentNotifications = (
  parentId: string,
  onChange: () => void,
) => {
  if (!parentId) return () => {};

  const channel = supabase
    .channel(`parent-notifications-${parentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `parent_id=eq.${parentId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

export const createNotification = async (userId: string, title: string, body: string, type: string) => {
  if (!userId) {
    throw new Error('Cannot create notification without an authenticated user id.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.warn('[Notifications] session lookup failed before insert:', formatSupabaseError(sessionError));
    throw sessionError;
  }

  const authUser = sessionData.session?.user;
  const payload = {
    user_id: userId,
    title,
    body,
    type,
  };

  console.debug('[Notifications] insert auth user:', authUser);
  console.debug('[Notifications] insert user_id:', userId);
  console.debug('[Notifications] insert payload:', payload);

  if (!authUser?.id) {
    throw new Error('Cannot create notification without an active Supabase session.');
  }

  const { error } = await supabase.from('notifications').insert(payload);

  if (error) {
    console.warn('[Notifications] insert failed:', formatSupabaseError(error));
    throw error;
  }

  console.debug('[Notifications] insert succeeded:', { user_id: userId, type });
};

export const createParentNotification = async ({
  studentId,
  parentId,
  title,
  message,
  type,
}: ParentNotificationInput) => {
  if (!studentId || !parentId) {
    throw new Error('Cannot create parent notification without studentId and parentId.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.warn('[Notifications] parent notification session lookup failed:', formatSupabaseError(sessionError));
    throw sessionError;
  }

  const authUser = sessionData.session?.user;
  if (!authUser?.id) {
    throw new Error('Cannot create parent notification without an active Supabase session.');
  }

  const payload = {
    student_id: studentId,
    parent_id: parentId,
    user_id: parentId,
    title,
    message,
    body: message,
    type,
    is_read: false,
    read: false,
  };

  console.debug('[Notifications] parent insert auth user:', authUser);
  console.debug('[Notifications] parent insert payload:', payload);

  let { error } = await supabase.from('notifications').insert(payload);

  if (error && isMissingColumnError(error, 'is_read')) {
    console.warn('[Notifications] is_read column missing; retrying parent insert without is_read.');
    const retryPayload = { ...payload };
    delete (retryPayload as any).is_read;
    const retry = await supabase.from('notifications').insert(retryPayload);
    error = retry.error;
  }

  if (error && isMissingColumnError(error, 'message')) {
    console.warn('[Notifications] message column missing; retrying parent insert with legacy body only.');
    const retryPayload = { ...payload };
    delete (retryPayload as any).is_read;
    delete (retryPayload as any).message;
    const retry = await supabase.from('notifications').insert(retryPayload);
    error = retry.error;
  }

  if (error) {
    console.warn('[Notifications] parent insert failed:', formatSupabaseError(error));
    throw error;
  }
};
