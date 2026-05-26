import { supabase } from '../config/supabase';

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
  const filters = [`student_id.eq.${authUid}`];
  if (childId && childId !== authUid) filters.push(`student_id.eq.${childId}`);

  const { data, error } = await supabase
    .from('activities')
    .select('id,title,description,deadline,subject,status,student_id')
    .or(filters.join(','))
    .order('deadline', { ascending: true });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || (error as any).status === 404) {
      console.warn('[Activities] activities table is missing. Run migration/migrations/005_activities.sql.');
      return [];
    }
    throw error;
  }

  return (data || []).map((row: any) => ({
    ...row,
    status: toStatus(row.deadline, row.status),
  })) as StudentActivity[];
}
