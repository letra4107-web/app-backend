import { supabase } from '../config/supabase';

const todayKey = () => new Date().toISOString().slice(0, 10);
const warnedMissingGrades = new Set<number>();

export type WordOfDayLog = {
  id: string;
  child_id: string;
  word: string;
  date: string;
  correct: boolean | null;
  attempts: number;
};

const fetchWordOfDayRow = async (childId: string, date: string) => {
  const existing = await supabase
    .from('word_of_day_log')
    .select('*')
    .eq('child_id', childId)
    .eq('date', date)
    .maybeSingle();

  if (existing.error) throw existing.error;
  return existing.data as WordOfDayLog | null;
};

export const getOrCreateWordOfDay = async (childId: string, gradeLevel: number) => {
  const date = todayKey();
  const existingRow = await fetchWordOfDayRow(childId, date);
  if (existingRow) return existingRow;

  const activities = await supabase
    .from('reading_activities')
    .select('words')
    .eq('grade', gradeLevel)
    .maybeSingle();

  if (activities.error) throw activities.error;
  const words = Array.isArray(activities.data?.words) ? activities.data.words : [];
  if (!words.length) {
    if (!warnedMissingGrades.has(gradeLevel)) {
      console.warn(`[WordOfDay] No words configured for grade ${gradeLevel}; showing the empty state.`);
      warnedMissingGrades.add(gradeLevel);
    }
    return null;
  }

  const index = Math.abs(`${childId}-${date}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % words.length;
  const word = words[index];

  const inserted = await supabase
    .from('word_of_day_log')
    .insert({ child_id: childId, word, date, attempts: 0 })
    .select()
    .single();

  if (inserted.error) {
    // 23505 = unique_violation. A concurrent call (e.g. the auth-state-change
    // listener firing alongside the initial load) already created today's row
    // between our SELECT and this INSERT — fetch and use that row instead.
    if (inserted.error.code === '23505') {
      const row = await fetchWordOfDayRow(childId, date);
      if (row) return row;
    }
    throw inserted.error;
  }
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
