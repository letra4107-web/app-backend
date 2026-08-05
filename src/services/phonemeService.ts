import { supabase } from '../config/supabase';
import { analyzePhonology } from '../utils/tagalogPhonemes';

/**
 * Fire-and-forget text-based phoneme confusion logging, shared by every
 * single-word practice flow (Practice tab, Word of Day). See
 * tagalogPhonemes.ts for the acoustic-vs-text-based scope caveat - this is a
 * supplementary diagnostic side channel, never part of pass/fail scoring,
 * and never throws into the caller.
 */
export const logPhonemeConfusion = (
  childId: string | undefined | null,
  targetWord: string,
  transcript: string,
  source: string = 'practice',
  sessionId: string | undefined | null = null,
): void => {
  if (!childId || !transcript) return;
  try {
    const { confusionKeys } = analyzePhonology(targetWord, transcript);
    if (!confusionKeys.length) return;
    const rows = confusionKeys.map((confusion_key) => ({
      student_id: childId,
      confusion_key,
      target_word: targetWord,
      transcript_word: transcript,
      source,
      session_id: sessionId,
    }));
    supabase.from('phoneme_confusion').insert(rows).then(({ error }) => {
      if (error) console.warn('[Phoneme] confusion log failed:', error.message || error);
    });
  } catch (e) {
    console.warn('[Phoneme] analysis failed:', e);
  }
};
