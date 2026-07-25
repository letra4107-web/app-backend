import { supabase } from '../config/supabase';
import { buildApiUrl, getJson, postJson, fetchJson } from '../config/api';

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

export const fetchNotifications = async (userId: string) => {
  if (!userId) return [];

  const response = await getJson<{ success: boolean; notifications?: NotificationItem[]; message?: string }>(
    buildApiUrl(`/notifications?userId=${encodeURIComponent(userId)}`),
    15000,
  );
  if (!response?.success) {
    throw new Error(response?.message || 'Unable to load notifications.');
  }
  return Array.isArray(response.notifications) ? response.notifications : [];
};

export const markNotificationRead = async (id: string) => {
  if (!id) return;

  await fetchJson(buildApiUrl(`/notifications/${encodeURIComponent(id)}/read`), {
    method: 'PATCH',
    headers: { Accept: 'application/json' },
  }, 15000);
};

let notificationSubscriptionSeq = 0;

export const subscribeToParentNotifications = (
  parentId: string,
  onChange: () => void,
) => {
  if (!parentId) return () => {};

  // Unique per call, not per parentId: two independent subscribers (e.g. the
  // dashboard's own listener and the Notifications view opened on top of it)
  // can legitimately be alive at the same time. supabase.channel() returns
  // the SAME instance for a topic that already exists in its registry, and
  // calling .on() on an already-subscribed channel throws - so every call
  // here must get its own channel, never a name any other caller could share.
  notificationSubscriptionSeq += 1;
  const topic = `parent-notifications-${parentId}-${notificationSubscriptionSeq}-${Date.now()}`;

  const channel = supabase
    .channel(topic)
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

  await postJson(buildApiUrl('/notifications'), {
    user_id: userId,
    title,
    body,
    type,
  }, 15000);
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

  await postJson(buildApiUrl('/notifications'), {
    student_id: studentId,
    parent_id: parentId,
    user_id: parentId,
    title,
    message,
    body: message,
    type,
    is_read: false,
    read: false,
  }, 15000);
};
