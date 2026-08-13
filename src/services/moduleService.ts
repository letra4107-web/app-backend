import { buildApiUrl, getJson, postJson } from '../config/api';
import type { ReadingContentType } from './readingContentService';

export type ModuleState = 'locked' | 'unlocked' | 'completed';

export type ReadingModuleSummary = {
  id: string;
  curriculum_version: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  module_number: number;
  title: string;
  description: string | null;
  instructional_content_type: ReadingContentType;
  assessment_pass_percentage: number;
  assessment_id: string | null;
  state: ModuleState;
  completed_at: string | null;
  content_item_count: number;
  completed_content_item_count: number;
};

export type StudentModulePath = {
  configured: boolean;
  effective_level: 'Beginner' | 'Intermediate' | 'Advanced';
  progression_authority: string;
  modules: ReadingModuleSummary[];
  current_module: ReadingModuleSummary | null;
};

export type ModuleContentItem = {
  module_item_id: string;
  content_id: string;
  content_text: string;
  content_type: ReadingContentType;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  item_order: number;
  role: string;
  word_id: string | null;
  pattern_note: string | null;
  syllable_hyphenation: string | null;
  definition: string | null;
  completed: boolean;
};

export type ReadingModuleContent = {
  module: ReadingModuleSummary;
  items: ModuleContentItem[];
};

export type ModuleAssessmentItem = {
  assessment_item_id: string;
  content_id: string;
  content_text: string;
  content_type: ReadingContentType;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  syllable_hyphenation: string | null;
  item_order: number;
};

export type ModuleAssessmentAttempt = {
  attempt_id: string;
  assessment_id: string;
  module_id: string;
  module_level: 'Beginner' | 'Intermediate' | 'Advanced';
  pass_percentage: number;
  status: 'in_progress';
  items: ModuleAssessmentItem[];
};

export type ModuleAssessmentResult = {
  attempt_id: string;
  module_id: string;
  score: number;
  pass_percentage: number;
  passed: boolean;
  completion_awarded: boolean;
};

export const fetchStudentModulePath = async () => {
  const response = await getJson<{ success: boolean; path: StudentModulePath }>(buildApiUrl('/modules/path'));
  return response.path;
};

export const fetchModuleContent = async (moduleId: string) => {
  const response = await getJson<{ success: boolean; content: ReadingModuleContent }>(
    buildApiUrl(`/modules/${encodeURIComponent(moduleId)}`),
  );
  return response.content;
};

export const startModuleAssessment = async (assessmentId: string) => {
  const response = await postJson<{ success: boolean; assessment: ModuleAssessmentAttempt }>(
    buildApiUrl(`/modules/assessments/${encodeURIComponent(assessmentId)}/start`),
    {},
  );
  return response.assessment;
};

export const submitModuleAssessment = async (
  attemptId: string,
  responses: { assessmentItemId: string; contentAttemptId: string }[],
) => {
  const response = await postJson<{ success: boolean; result: ModuleAssessmentResult }>(
    buildApiUrl(`/modules/attempts/${encodeURIComponent(attemptId)}/submit`),
    { responses },
  );
  return response.result;
};
