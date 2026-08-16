import { supabase } from '../config/supabase';
import { fetchOfficialReadingProgress } from './readingContentService';

export const getAsiaManilaDate = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const todayKey = () => getAsiaManilaDate();
const warnedMissingGrades = new Set<number>();

export type WordOfDayLog = {
  id: string;
  child_id: string;
  word: string;
  date: string;
  correct: boolean | null;
  attempts: number;
  content_id?: string | null;
  recommendation_id?: string | null;
  recommendation_reason?: string | null;
};

export interface WordOfTheDay {
  word: string;
  tagalog: string;
  pronunciation: string;
  bonusXP: number;
  date: string;
}

const WORD_POOL: WordOfTheDay[] = [
  { word: 'Aso', tagalog: 'Dog', pronunciation: 'ah-so', bonusXP: 25, date: '2026-05-07' },
  { word: 'Pusa', tagalog: 'Cat', pronunciation: 'poo-sah', bonusXP: 25, date: '2026-05-08' },
  { word: 'Bahay', tagalog: 'House', pronunciation: 'bah-high', bonusXP: 25, date: '2026-05-09' },
  { word: 'Araw', tagalog: 'Day', pronunciation: 'ah-rah', bonusXP: 25, date: '2026-05-10' },
  { word: 'Tubig', tagalog: 'Water', pronunciation: 'too-big', bonusXP: 25, date: '2026-05-11' },
  { word: 'Pagkain', tagalog: 'Food', pronunciation: 'pahg-kah-in', bonusXP: 25, date: '2026-05-12' },
  { word: 'Mahal', tagalog: 'Love', pronunciation: 'mah-hahl', bonusXP: 25, date: '2026-05-13' },
];

export const getWordOfTheDay = (dateStr?: string): WordOfTheDay => {
  const date = dateStr || getAsiaManilaDate();
  const [year, month, day] = date.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayOfYear = Math.floor((dateObj.getTime() - new Date(Date.UTC(dateObj.getFullYear(), 0, 0)).getTime()) / 86400000);
  const index = dayOfYear % WORD_POOL.length;
  return WORD_POOL[index];
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

  // Panel item 2 (content-sourcing reconciliation): Word of the Day now
  // picks a genuinely random word from the student's level-filtered word
  // bank (the `words` table) instead of the sequence-frontier personalization
  // ranker. The pick is still stable for the whole day (hashed from
  // childId+date, not Math.random on every load) so "today's word" stays the
  // same word if the screen reloads - level-gating stays intact, only the
  // *within-level* selection changed from ranked to random.
  let level = 'Beginner';
  try {
    const officialProgression = await fetchOfficialReadingProgress();
    level = officialProgression.effective_level;
  } catch (progressionError: any) {
    console.warn('[WordOfDay] official level lookup failed; defaulting to Beginner:', progressionError?.message || progressionError);
  }

  const candidates = await supabase
    .from('words')
    .select('id,word')
    .eq('level', level.toLowerCase())
    .limit(500);
  if (candidates.error) throw candidates.error;
  const words = candidates.data || [];
  if (!words.length) {
    if (!warnedMissingGrades.has(gradeLevel)) {
      console.warn(`[WordOfDay] No words configured for level ${level}; showing the empty state.`);
      warnedMissingGrades.add(gradeLevel);
    }
    return null;
  }
  const index = Math.abs(`${childId}-${date}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % words.length;
  const word = words[index].word;
  const contentId: string | null = words[index].id;
  const recommendationId: string | null = null;
  const recommendationReason: string | null = 'Random na salita mula sa iyong antas.';

  // Upsert with ignoreDuplicates instead of a plain insert: if a concurrent
  // call (e.g. the auth-state-change listener firing alongside the initial
  // load) already created today's row between our SELECT and this write,
  // Postgres resolves it server-side as ON CONFLICT DO NOTHING - no 409 is
  // ever raised, unlike a raw insert racing against the unique constraint.
  const upserted = await supabase
    .from('word_of_day_log')
    .upsert({
      child_id: childId,
      word,
      date,
      attempts: 0,
      content_id: contentId,
      recommendation_id: recommendationId,
      recommendation_reason: recommendationReason,
    }, { onConflict: 'child_id,date', ignoreDuplicates: true })
    .select()
    .maybeSingle();

  if (upserted.error) throw upserted.error;
  if (upserted.data) return upserted.data as WordOfDayLog;

  // ignoreDuplicates means a concurrent call already won the race and our
  // write was a no-op - the row exists, just fetch it.
  const row = await fetchWordOfDayRow(childId, date);
  if (row) return row;
  throw new Error('Hindi ma-load o magawa ang salita ngayong araw.');
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
