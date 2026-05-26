import { supabase } from '../config/supabase';
import { buildApiUrl, getJson } from '../config/api';

export type Lesson = {
  id: string;
  teacher_id: string | null;
  title: string;
  description: string | null;
  subject: string | null;
  grade_level: string | null;
  pdf_url: string;
  file_name: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export const fetchPublishedLessons = async (gradeLevel?: number | string | null): Promise<Lesson[]> => {
  const query = gradeLevel ? `?gradeLevel=${encodeURIComponent(String(gradeLevel))}` : '';
  const response = await getJson<{ success: boolean; lessons?: Lesson[]; message?: string }>(
    buildApiUrl(`/lessons${query}`),
    15000,
  );

  if (!response?.success) {
    throw new Error(response?.message || 'Unable to load lessons.');
  }

  return response.lessons || [];
};

export const subscribeToPublishedLessons = (
  onChange: () => void,
) => {
  const channel = supabase
    .channel('student-lessons-feed')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lessons' },
      (payload) => {
        const row = (payload.new || payload.old || {}) as Partial<Lesson>;
        if (payload.eventType === 'DELETE' || row.is_published !== false) {
          onChange();
        }
      },
    )
    .subscribe((status) => {
      console.log('[Lessons] realtime subscription status:', status);
    });

  return () => {
    supabase.removeChannel(channel);
  };
};
