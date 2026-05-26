import { supabase } from '../config/supabase';

const todayKey = () => new Date().toISOString().slice(0, 10);

export type WordOfDayLog = {
  id: string;
  child_id: string;
  word: string;
  date: string;
  correct: boolean | null;
  attempts: number;
};

export const getOrCreateWordOfDay = async (childId: string, gradeLevel: number) => {
  const date = todayKey();
  const existing = await supabase
    .from('word_of_day_log')
    .select('*')
    .eq('child_id', childId)
    .eq('date', date)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as WordOfDayLog;

  const activities = await supabase
    .from('reading_activities')
    .select('words')
    .eq('grade', gradeLevel)
    .maybeSingle();

  if (activities.error) throw activities.error;
  const words = Array.isArray(activities.data?.words) ? activities.data.words : [];
  if (!words.length) throw new Error('Walang available na salita para sa grade level na ito.');

  const index = Math.abs(`${childId}-${date}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % words.length;
  const word = words[index];

  const inserted = await supabase
    .from('word_of_day_log')
    .insert({ child_id: childId, word, date, attempts: 0 })
    .select()
    .single();

  if (inserted.error) throw inserted.error;
  return inserted.data as WordOfDayLog;
};

export const updateWordOfDayLog = async (id: string, attempts: number, correct: boolean) => {
  const { data, error } = await supabase
    .from('word_of_day_log')
    .update({ attempts, correct })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as WordOfDayLog;
};
