import { buildApiUrl, getJson, postJson, isRetryableNetworkError } from '../config/api';

export type LessonProgressStatus = 'in_progress' | 'completed';

export type LessonProgressRow = {
  id: string;
  lesson_id: string;
  status: LessonProgressStatus;
  opened_at: string;
  completed_at: string | null;
};

export const fetchLessonProgress = async (childId: string): Promise<LessonProgressRow[]> => {
  if (!childId) return [];
  try {
    const response = await getJson<{ success: boolean; progress?: LessonProgressRow[]; message?: string }>(
      buildApiUrl(`/lesson-progress?childId=${encodeURIComponent(childId)}`),
      15000,
    );
    if (!response?.success) {
      throw new Error(response?.message || 'Unable to load lesson progress.');
    }
    return response.progress || [];
  } catch (error: any) {
    console.warn('[LessonProgress] fetch failed:', error?.message || error);
    if (isRetryableNetworkError(error)) {
      throw new Error('Hindi ma-load ang lesson progress. Suriin ang internet connection.');
    }
    throw new Error(error?.message || 'Hindi ma-load ang lesson progress.');
  }
};

export const markLessonOpened = async (childId: string, lessonId: string): Promise<void> => {
  try {
    await postJson(buildApiUrl('/lesson-progress/open'), { childId, lessonId }, 15000);
  } catch (error: any) {
    console.warn('[LessonProgress] mark opened failed:', error?.message || error);
  }
};

export const markLessonCompleted = async (childId: string, lessonId: string): Promise<void> => {
  try {
    await postJson(buildApiUrl('/lesson-progress/complete'), { childId, lessonId }, 15000);
  } catch (error: any) {
    console.warn('[LessonProgress] mark completed failed:', error?.message || error);
    throw error;
  }
};
