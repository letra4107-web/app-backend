import { buildApiUrl, getJson, postJson, patchJson, deleteJson, isRetryableNetworkError } from '../config/api';
import { supabase } from '../config/supabase';

export type ScheduledActivityType = 'reading_lesson' | 'practice' | 'reminder' | 'appointment';
export type ScheduledActivityStatus = 'scheduled' | 'in_progress' | 'completed' | 'missed';

export type ScheduledActivity = {
  id: string;
  child_id: string;
  created_by: 'parent' | 'teacher' | 'system';
  created_by_auth_uid?: string | null;
  activity_type: ScheduledActivityType;
  title: string;
  description: string | null;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  status: ScheduledActivityStatus;
  created_at: string;
  updated_at: string;
};

export type CreateScheduledActivityInput = {
  childId: string;
  activityType: ScheduledActivityType;
  title: string;
  description?: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  status?: ScheduledActivityStatus;
  createdBy?: 'parent' | 'teacher' | 'system';
};

export type UpdateScheduledActivityInput = Partial<{
  title: string;
  description: string | null;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  activityType: ScheduledActivityType;
  status: ScheduledActivityStatus;
}>;

const wrapError = (error: any, fallback: string): Error => {
  if (isRetryableNetworkError(error)) {
    return new Error('Hindi ma-load ang calendar. Suriin ang internet connection.');
  }
  return new Error(error?.message || fallback);
};

export const fetchScheduledActivities = async (
  childId: string,
  range?: { startDate?: string; endDate?: string },
): Promise<ScheduledActivity[]> => {
  if (!childId) return [];
  try {
    const query = new URLSearchParams({ childId });
    if (range?.startDate) query.set('startDate', range.startDate);
    if (range?.endDate) query.set('endDate', range.endDate);

    const response = await getJson<{ success: boolean; activities?: ScheduledActivity[]; message?: string }>(
      buildApiUrl(`/scheduled-activities?${query.toString()}`),
      15000,
    );
    if (!response?.success) {
      throw new Error(response?.message || 'Unable to load scheduled activities.');
    }
    return response.activities || [];
  } catch (error: any) {
    console.warn('[ScheduledActivities] fetch failed:', error?.message || error);
    throw wrapError(error, 'Hindi ma-load ang calendar.');
  }
};

export const createScheduledActivity = async (input: CreateScheduledActivityInput): Promise<ScheduledActivity> => {
  try {
    const response = await postJson<{ success: boolean; activity?: ScheduledActivity; message?: string }>(
      buildApiUrl('/scheduled-activities'),
      input,
      15000,
    );
    if (!response?.success || !response.activity) {
      throw new Error(response?.message || 'Unable to create the activity.');
    }
    return response.activity;
  } catch (error: any) {
    console.warn('[ScheduledActivities] create failed:', error?.message || error);
    throw wrapError(error, 'Hindi ma-idagdag ang activity.');
  }
};

export const updateScheduledActivity = async (
  id: string,
  updates: UpdateScheduledActivityInput,
): Promise<ScheduledActivity> => {
  try {
    const response = await patchJson<{ success: boolean; activity?: ScheduledActivity; message?: string }>(
      buildApiUrl(`/scheduled-activities/${encodeURIComponent(id)}`),
      updates,
      15000,
    );
    if (!response?.success || !response.activity) {
      throw new Error(response?.message || 'Unable to update the activity.');
    }
    return response.activity;
  } catch (error: any) {
    console.warn('[ScheduledActivities] update failed:', error?.message || error);
    throw wrapError(error, 'Hindi ma-update ang activity.');
  }
};

export const completeScheduledActivity = async (id: string): Promise<ScheduledActivity> => {
  try {
    const response = await postJson<{ success: boolean; activity?: ScheduledActivity; message?: string }>(
      buildApiUrl(`/scheduled-activities/${encodeURIComponent(id)}/complete`),
      {},
      15000,
    );
    if (!response?.success || !response.activity) {
      throw new Error(response?.message || 'Unable to mark the activity complete.');
    }
    return response.activity;
  } catch (error: any) {
    console.warn('[ScheduledActivities] complete failed:', error?.message || error);
    throw wrapError(error, 'Hindi ma-mark as complete ang activity.');
  }
};

export const deleteScheduledActivity = async (id: string): Promise<void> => {
  try {
    const response = await deleteJson<{ success: boolean; message?: string }>(
      buildApiUrl(`/scheduled-activities/${encodeURIComponent(id)}`),
      15000,
    );
    if (!response?.success) {
      throw new Error(response?.message || 'Unable to delete the activity.');
    }
  } catch (error: any) {
    console.warn('[ScheduledActivities] delete failed:', error?.message || error);
    throw wrapError(error, 'Hindi ma-delete ang activity.');
  }
};

export const subscribeToScheduledActivities = (
  childIds: string[],
  onChange: () => void,
) => {
  const ids = [...new Set(childIds.filter(Boolean))].sort();
  if (!ids.length) return () => undefined;

  const channel = supabase
    .channel(`scheduled-activities-${ids.join('-')}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scheduled_activities' },
      (payload) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { child_id?: string };
        if (row?.child_id && ids.includes(row.child_id)) onChange();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};
