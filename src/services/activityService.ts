import { buildApiUrl, getJson } from '../config/api';

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
}
