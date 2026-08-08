import { supabase } from '../config/supabase';

export type PronunciationSessionRow = {
  word: string;
  accuracy_percentage: number;
  created_at: string;
  is_correct?: boolean | null;
  duration_seconds?: number | null;
  attempts?: number | null;
};

export const fetchPronunciationSessions = async (
  studentId: string,
  limit = 2000,
): Promise<PronunciationSessionRow[]> => {
  if (!studentId) return [];

  const { data, error } = await supabase
    .from('pronunciation_practice_sessions')
    .select('word, accuracy_percentage, created_at, is_correct, duration_seconds, attempts')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as PronunciationSessionRow[];
};
