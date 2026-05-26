import { supabase } from '../config/supabase';

export type Level = 'Beginner' | 'Intermediate' | 'Advanced';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt?: Date;
}

export interface LevelingData {
  currentLevel: Level;
  xp: number;
  streak: number;
  achievements: Achievement[];
  totalCorrect: number;
  totalAttempts: number;
}

// XP thresholds for level progression
const LEVEL_THRESHOLDS = {
  Beginner: 0,
  Intermediate: 100,
  Advanced: 250,
};

// Achievements definition
const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_word',
    title: '🎉 First Word',
    description: 'Successfully practiced your first word!',
    icon: '🎯',
  },
  {
    id: 'five_correct',
    title: '⭐ Five Star',
    description: 'Completed 5 words with 80%+ accuracy',
    icon: '⭐',
  },
  {
    id: 'perfect_ten',
    title: '💯 Perfect Ten',
    description: 'Got 10 words perfect (100% accuracy)',
    icon: '💯',
  },
  {
    id: 'three_day_streak',
    title: '🔥 On Fire',
    description: 'Maintained a 3-day practice streak',
    icon: '🔥',
  },
  {
    id: 'level_up_intermediate',
    title: '📈 Rising Star',
    description: 'Reached Intermediate level!',
    icon: '📈',
  },
  {
    id: 'level_up_advanced',
    title: '🚀 Advanced Master',
    description: 'Reached Advanced level!',
    icon: '🚀',
  },
  {
    id: 'fifty_attempts',
    title: '💪 Persistent',
    description: 'Completed 50 practice attempts',
    icon: '💪',
  },
  {
    id: 'hundred_attempts',
    title: '🏆 Champion',
    description: 'Completed 100 practice attempts',
    icon: '🏆',
  },
];

/**
 * Calculate new level based on XP
 */
export function calculateLevel(xp: number): Level {
  if (xp >= LEVEL_THRESHOLDS.Advanced) return 'Advanced';
  if (xp >= LEVEL_THRESHOLDS.Intermediate) return 'Intermediate';
  return 'Beginner';
}

/**
 * Calculate XP earned from a single practice run
 */
export function calculateXpEarned(accuracy: number, isCorrect: boolean): number {
  if (accuracy === 100) return 10;
  if (accuracy >= 80) return 5;
  if (isCorrect) return 3;
  return 1;
}

/**
 * Update streak based on practice result
 */
export function updateStreak(currentStreak: number, isCorrect: boolean): number {
  return isCorrect ? currentStreak + 1 : 0;
}

/**
 * Check and unlock achievements
 */
export function checkAchievements(
  totalCorrect: number,
  totalAttempts: number,
  currentLevel: Level,
  streak: number,
  perfectRuns: number,
  unlockedAchievements: string[]
): Achievement[] {
  const newAchievements: Achievement[] = [];

  // First word achievement
  if (totalAttempts === 1 && !unlockedAchievements.includes('first_word')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'first_word');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // Five correct words
  if (totalCorrect >= 5 && !unlockedAchievements.includes('five_correct')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'five_correct');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // Perfect ten
  if (perfectRuns >= 10 && !unlockedAchievements.includes('perfect_ten')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'perfect_ten');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // 3-day streak
  if (streak >= 3 && !unlockedAchievements.includes('three_day_streak')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'three_day_streak');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // Level up intermediate
  if (currentLevel === 'Intermediate' && !unlockedAchievements.includes('level_up_intermediate')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'level_up_intermediate');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // Level up advanced
  if (currentLevel === 'Advanced' && !unlockedAchievements.includes('level_up_advanced')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'level_up_advanced');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // 50 attempts
  if (totalAttempts >= 50 && !unlockedAchievements.includes('fifty_attempts')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'fifty_attempts');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  // 100 attempts
  if (totalAttempts >= 100 && !unlockedAchievements.includes('hundred_attempts')) {
    const achievement = ACHIEVEMENTS.find(a => a.id === 'hundred_attempts');
    if (achievement) {
      newAchievements.push({ ...achievement, unlockedAt: new Date() });
    }
  }

  return newAchievements;
}

/**
 * Update Firestore with new leveling data
 */
export async function updateLevelingData(
  userId: string,
  accuracy: number,
  xpEarned: number,
  isCorrect: boolean,
  perfectRuns: number
): Promise<LevelingData | null> {
  try {
    let currentData: LevelingData = {
      currentLevel: 'Beginner',
      xp: 0,
      streak: 0,
      achievements: [],
      totalCorrect: 0,
      totalAttempts: 0,
    };

    const { data, error } = await supabase.from('progress').select('*').eq('id', userId).single();
    if (data) {
      currentData = {
        currentLevel: (data.level || 'Beginner') as Level,
        xp: data.xp || 0,
        streak: data.streak || 0,
        achievements: data.achievements || [],
        totalCorrect: data.totalCorrect || 0,
        totalAttempts: data.totalAttempts || 0,
      };
    } else if (error && error.code !== 'PGRST116') {
      throw error;
    }

    const newXp = currentData.xp + xpEarned;
    const newStreak = updateStreak(currentData.streak, isCorrect);
    const newLevel = calculateLevel(newXp);
    const newTotalCorrect = currentData.totalCorrect + (isCorrect ? 1 : 0);
    const newTotalAttempts = currentData.totalAttempts + 1;

    const unlockedIds = currentData.achievements.map((a) => a.id);
    const newAchievements = checkAchievements(
      newTotalCorrect,
      newTotalAttempts,
      newLevel,
      newStreak,
      perfectRuns,
      unlockedIds
    );

    const allAchievements = [...currentData.achievements, ...newAchievements];

    const { error: upsertError } = await supabase
      .from('progress')
      .upsert(
        {
          id: userId,
          xp: newXp,
          streak: newStreak,
          level: newLevel,
          achievements: allAchievements,
          totalCorrect: newTotalCorrect,
          totalAttempts: newTotalAttempts,
          accuracy: Math.round(((newTotalCorrect / newTotalAttempts) * 100) || 0),
          lastUpdated: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (upsertError) {
      throw upsertError;
    }

    return {
      currentLevel: newLevel,
      xp: newXp,
      streak: newStreak,
      achievements: allAchievements,
      totalCorrect: newTotalCorrect,
      totalAttempts: newTotalAttempts,
    };
  } catch (error) {
    console.error('Error updating leveling data:', error);
    return null;
  }
}

/**
 * Get all available achievements
 */
export function getAllAchievements(): Achievement[] {
  return ACHIEVEMENTS;
}

/**
 * Format XP for display
 */
export function formatXp(xp: number): string {
  if (xp >= 1000) {
    return `${(xp / 1000).toFixed(1)}k`;
  }
  return xp.toString();
}

