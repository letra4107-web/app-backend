import { buildApiUrl, getJson, isRetryableNetworkError } from '../config/api';

export type ActivityStatus = 'pending' | 'completed' | 'overdue';

export type StudentActivity = {
  id: string;
  title: string;
  description?: string | null;
  deadline: string;
  subject?: string | null;
  status: ActivityStatus;
  student_id: string;
};

const toStatus = (deadline: string, status?: string | null): ActivityStatus => {
  if (status === 'completed') return 'completed';
  const due = new Date(deadline);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (!Number.isNaN(due.getTime()) && due < endOfToday) return 'overdue';
  return 'pending';
};

export async function fetchStudentActivities(authUid: string, childId?: string) {
  try {
    const query = new URLSearchParams({ authUid });
    if (childId) query.set('childId', childId);

    const response = await getJson<{ success: boolean; activities?: StudentActivity[]; message?: string }>(
      buildApiUrl(`/activities?${query.toString()}`),
      15000,
    );

    if (!response?.success) {
      throw new Error(response?.message || 'Unable to load activities.');
    }

    return (response.activities || []).map((row: any) => ({
      ...row,
      status: toStatus(row.deadline, row.status),
    })) as StudentActivity[];
  } catch (error: any) {
    console.warn('[Activities] fetch failed:', error?.message || error);
    if (isRetryableNetworkError(error)) {
      throw new Error('Hindi ma-load ang activities. Suriin ang internet connection at subukan muli.');
    }
    throw new Error(error?.message || 'Hindi ma-load ang activities. Subukan muli mamaya.');
  }
}
