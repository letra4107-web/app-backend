import { createParentNotification } from './notificationService';
import { speakPhrase } from './ttsService';
import { ChildProgress } from './progressService';

export type AchievementDefinition = {
  id: string;
  title: string;
  emoji: string;
  isUnlocked: (progress: ChildProgress) => boolean;
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: 'first_word', title: 'Unang Salita!', emoji: '🎯', isUnlocked: (p) => p.completed_words.length >= 1 },
  { id: 'five_words', title: 'Limang Salita!', emoji: '⭐', isUnlocked: (p) => p.completed_words.length >= 5 },
  { id: 'ten_words', title: 'Sampung Salita!', emoji: '🏅', isUnlocked: (p) => p.completed_words.length >= 10 },
  { id: 'twenty_five_words', title: "Dalawampu't Lima!", emoji: '🥈', isUnlocked: (p) => p.completed_words.length >= 25 },
  { id: 'fifty_words', title: 'Limampung Salita!', emoji: '🥇', isUnlocked: (p) => p.completed_words.length >= 50 },
  { id: 'streak_3', title: 'Nagliliyab!', emoji: '🔥', isUnlocked: (p) => p.streak >= 3 },
  { id: 'streak_7', title: 'Isang Linggo!', emoji: '🔥🔥', isUnlocked: (p) => p.streak >= 7 },
  { id: 'streak_30', title: 'Isang Buwan!', emoji: '🏆', isUnlocked: (p) => p.streak >= 30 },
  { id: 'level_intermediate', title: 'Papataas na!', emoji: '📈', isUnlocked: (p) => p.level === 'Intermediate' || p.level === 'Advanced' },
  { id: 'level_advanced', title: 'Dalubhasa!', emoji: '🚀', isUnlocked: (p) => p.level === 'Advanced' },
];

export const unlockAchievements = async (
  progress: ChildProgress,
  childName: string,
  parentId?: string,
) => {
  const unlockedIds = new Set((progress.achievements || []).map((achievement) => achievement.id));
  const newlyUnlocked = ACHIEVEMENTS.filter((achievement) => !unlockedIds.has(achievement.id) && achievement.isUnlocked(progress));

  if (!newlyUnlocked.length) {
    return { progress, newlyUnlocked };
  }

  const unlockedAt = new Date().toISOString();
  const updatedProgress = {
    ...progress,
    achievements: [
      ...(progress.achievements || []),
      ...newlyUnlocked.map((achievement) => ({ id: achievement.id, unlockedAt })),
    ],
  };

  const first = newlyUnlocked[0];
  speakPhrase(`Binabati kita! Nakuha mo ang badge na ${first.title}!`);

  if (parentId) {
    try {
      await createParentNotification({
        studentId: progress.child_id,
        parentId,
        title: 'Bagong Badge!',
        message: `${childName} earned ${first.title}!`,
        type: 'achievement',
      });
    } catch (error: any) {
      console.warn('[Achievements] parent notification insert failed:', {
        parentId,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        status: error?.status,
      });
    }
  }

  return { progress: updatedProgress, newlyUnlocked };
};
