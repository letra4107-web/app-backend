import { supabase } from '../config/supabase';

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
  let query = supabase
    .from('lessons')
    .select('id,teacher_id,title,description,subject,grade_level,pdf_url,file_name,is_published,created_at,updated_at')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (gradeLevel) {
    const grade = String(gradeLevel);
    query = query.or(`grade_level.eq.${grade},grade_level.eq.Grade ${grade},grade_level.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || (error as any).status === 404) {
      console.warn('[Lessons] lessons table is missing. Run migration/migrations/006_lessons.sql.');
      return [];
    }
    console.error('[Lessons] fetch failed:', error);
    throw error;
  }

  return (data || []) as Lesson[];
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
