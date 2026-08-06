import { supabase } from '../config/supabase';
import { fetchPersonalizedWordOfDay } from './wordsService';

const todayKey = () => new Date().toISOString().slice(0, 10);
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
    // Keep Word of the Day usable during a backend rollout, but use a stable
    // curriculum-configured fallback rather than a random selection.
    console.warn('[WordOfDay] personalization unavailable; using configured grade fallback:', personalizationError?.message || personalizationError);
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
    word = words[index];
    recommendationReason = 'Grade-appropriate fallback while personalized recommendations are unavailable.';

    const fallbackContentResult = await supabase
      .from('reading_content')
      .select('id')
      .eq('content_text', word)
      .limit(1)
      .maybeSingle();
    if (!fallbackContentResult.error && fallbackContentResult.data) {
      contentId = fallbackContentResult.data.id;
    }
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
  throw new Error("Unable to load or create today's word.");
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
