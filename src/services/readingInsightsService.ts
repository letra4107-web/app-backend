import { buildApiUrl, getJson } from '../config/api';

export type ReadingProfile = {
  sessionCount: number;
  recentSessionCount: number;
  averageAccuracy: number | null;
  confidenceScore: number;
  confidenceLabel: string;
  consistencyScore: number;
  averageDurationSeconds: number | null;
  accuracyTrendPoints: number;
  weeklyAccuracyTrendPoints: number;
  weeklyPracticeDays: number;
  strongSounds: { unit: string; score: number; attempts: number; errors: number; trendPoints: number }[];
  weakSounds: { unit: string; score: number; attempts: number; errors: number; trendPoints: number }[];
  weakSyllables: { unit: string; score: number; attempts: number; errors: number; trendPoints: number }[];
  weakWords: { word: string; score: number }[];
  mostImprovedSound: { unit: string; score: number; attempts: number; errors: number; trendPoints: number } | null;
  recommendedFocus: string;
  recommendedHomePractice: string;
  insights: string[];
  needsIntervention: boolean;
  completedContentCount: number;
  readingJourney: 'Beginner Reader' | 'Intermediate Reader' | 'Advanced Reader';
  measurementNote: string;
};

export const fetchReadingProfile = async (studentId?: string): Promise<ReadingProfile> => {
  const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  const response = await getJson<{ success: boolean; profile: ReadingProfile; message?: string }>(
    buildApiUrl(`/personalization/profile${query}`),
    15000,
  );
  if (!response.success || !response.profile) throw new Error(response.message || 'Hindi ma-load ang kaalaman sa pagbasa.');
  return response.profile;
};
