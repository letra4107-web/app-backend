import { supabase } from '../config/supabase';
import { fetchPersonalizedWordOfDay } from './wordsService';
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

  let word = '';
  let contentId: string | null = null;
  let recommendationId: string | null = null;
  let recommendationReason: string | null = null;
  try {
    const recommended = await fetchPersonalizedWordOfDay();
    word = recommended.contentText;
    contentId = recommended.contentId;
    recommendationId = recommended.recommendationId || null;
    recommendationReason = recommended.recommendationReason || 'Current unlocked curriculum frontier.';
  } catch (personalizationError: any) {
    // Keep Word of the Day usable during a backend rollout, but the fallback
    // must stay inside the student's own official level - it must never show
    // words outside where they're officially placed just because the
    // personalization call happened to fail. Queries the same canonical
    // reading_content curriculum as the primary path, filtered by the
    // server-owned effective_level (not the raw client-supplied gradeLevel
    // the old reading_activities fallback used).
    console.warn('[WordOfDay] personalization unavailable; using level-filtered curriculum fallback:', personalizationError?.message || personalizationError);
    let fallbackLevel = 'Beginner';
    try {
      const officialProgression = await fetchOfficialReadingProgress();
      fallbackLevel = officialProgression.effective_level;
    } catch (progressionError: any) {
      console.warn('[WordOfDay] official level lookup failed during fallback; defaulting to Beginner:', progressionError?.message || progressionError);
    }

    const candidates = await supabase
      .from('reading_content')
      .select('id,content_text')
      .eq('level', fallbackLevel)
      .eq('content_type', 'word')
      .eq('is_active', true)
      .order('sequence_no', { ascending: true })
      .limit(500);
    if (candidates.error) throw candidates.error;
    const words = candidates.data || [];
    if (!words.length) {
      if (!warnedMissingGrades.has(gradeLevel)) {
        console.warn(`[WordOfDay] No canonical words configured for level ${fallbackLevel}; showing the empty state.`);
        warnedMissingGrades.add(gradeLevel);
      }
      return null;
    }
    const index = Math.abs(`${childId}-${date}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % words.length;
    word = words[index].content_text;
    contentId = words[index].id;
    recommendationReason = 'Level-appropriate fallback while personalized recommendations are unavailable.';
  }

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
