import { supabase } from '../config/supabase';
import { buildApiUrl, getJson, isRetryableNetworkError } from '../config/api';

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
  try {
    const query = gradeLevel ? `?gradeLevel=${encodeURIComponent(String(gradeLevel))}` : '';
    const response = await getJson<{ success: boolean; lessons?: Lesson[]; message?: string }>(
      buildApiUrl(`/lessons${query}`),
      15000,
    );

    if (!response?.success) {
      throw new Error(response?.message || 'Unable to load lessons.');
    }

    return response.lessons || [];
  } catch (error: any) {
    console.warn('[Lessons] fetch failed:', error?.message || error);
    if (isRetryableNetworkError(error)) {
      throw new Error('Hindi ma-load ang lessons. Suriin ang internet connection at subukan muli.');
    }
    throw new Error(error?.message || 'Hindi ma-load ang lessons. Subukan muli mamaya.');
  }
};

let lessonSubscriptionSeq = 0;

export const subscribeToPublishedLessons = (
  onChange: () => void,
) => {
  // Unique per call so a fast remount (React Strict Mode double-invoke, or
  // navigating away and back before cleanup finishes) can never collide with
  // a channel of the same name that's still registered on the client.
  lessonSubscriptionSeq += 1;
  const topic = `student-lessons-feed-${lessonSubscriptionSeq}-${Date.now()}`;

  const channel = supabase
    .channel(topic)
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
