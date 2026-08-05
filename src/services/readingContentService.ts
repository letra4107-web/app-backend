import { buildApiUrl, getJson, postJson } from '../config/api';
import { supabase } from '../config/supabase';
import type { ReadingLevel } from './progressService';

export type ReadingContentType = 'word' | 'phonetic' | 'phrase' | 'sentence' | 'paragraph';

export type ReadingContentItem = {
  id: string;
  word_id: string | null;
  content_text: string;
  content_type: ReadingContentType;
  level: ReadingLevel;
  sequence_no: number;
  pattern_note: string | null;
  backend_category: string | null;
  is_assessment: boolean;
};

export type ReadingRequirementProgress = {
  level: ReadingLevel;
  content_type: ReadingContentType;
  required_count: number;
  completed_count: number;
  remaining_count: number;
  completion_policy: 'minimum_accuracy_75' | 'full_scored_submission';
  requirement_met: boolean;
};

export type OfficialReadingProgress = {
  official_earned_level: ReadingLevel;
  placement_override_level: ReadingLevel | null;
  effective_level: ReadingLevel;
  official_progression_eligible: boolean;
  program_complete: boolean;
  requirements: ReadingRequirementProgress[];
};

const PAGE_SIZE = 500;

// Page explicitly: the canonical curriculum has 1,220 rows and Supabase's
// project response cap is 1,000, so a single select would silently omit the
// final sentences and all paragraph assessments.
export const fetchReadingContent = async (): Promise<ReadingContentItem[]> => {
  const rows: ReadingContentItem[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('reading_content')
      .select('id,word_id,content_text,content_type,level,sequence_no,pattern_note,backend_category,is_assessment')
      .eq('is_active', true)
      .order('level')
      .order('content_type')
      .order('sequence_no')
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as ReadingContentItem[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
};

export const fetchCompletedContentIds = async (studentId: string): Promise<Set<string>> => {
  const ids = new Set<string>();
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('student_content_completions')
      .select('content_id')
      .eq('student_id', studentId)
      .order('completed_at')
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    page.forEach((row) => ids.add(String(row.content_id)));
    if (page.length < PAGE_SIZE) break;
  }
  return ids;
};

export const fetchOfficialReadingProgress = async (): Promise<OfficialReadingProgress> => {
  const response = await getJson<{ success: boolean; progression: OfficialReadingProgress }>(
    buildApiUrl('/progress/reading-status'),
  );
  return response.progression;
};

export const recordReadingContentAttempt = async (input: {
  contentId: string;
  accuracy: number;
  transcript?: string | null;
  durationSeconds?: number | null;
  isFullSubmission?: boolean;
  source?: 'practice' | 'assessment' | 'diagnostic' | 'lesson' | 'recommendation';
}) => postJson<{
  success: boolean;
  result: {
    attempt_id: string;
    content_id: string;
    content_type: ReadingContentType;
    content_level: ReadingLevel;
    completion_qualified: boolean;
    completion_awarded: boolean;
    progression: OfficialReadingProgress;
  };
}>(buildApiUrl('/progress/content-attempt'), input);
