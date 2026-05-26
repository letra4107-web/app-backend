import { supabase } from '../config/supabase';

export interface StreakData {
  id?: string;
  currentStreak: number;
  longestStreak: number;
  lastPracticeDate: string;
  streakStartDate: string;
  badges: string[]; // e.g., ['3-day', '7-day', '30-day']
  totalXP: number;
  wordOfTheDayCompleted: boolean;
}

export interface WordOfTheDay {
  word: string;
  tagalog: string;
  pronunciation: string;
  bonusXP: number;
  date: string;
}

// Word of the Day pool - updated weekly
const WORD_POOL: WordOfTheDay[] = [
  {
    word: 'Aso',
    tagalog: 'Dog',
    pronunciation: 'ah-so',
    bonusXP: 25,
    date: '2026-05-07',
  },
  {
    word: 'Pusa',
    tagalog: 'Cat',
    pronunciation: 'poo-sah',
    bonusXP: 25,
    date: '2026-05-08',
  },
  {
    word: 'Bahay',
    tagalog: 'House',
    pronunciation: 'bah-high',
    bonusXP: 25,
    date: '2026-05-09',
  },
  {
    word: 'Araw',
    tagalog: 'Day',
    pronunciation: 'ah-rah',
    bonusXP: 25,
    date: '2026-05-10',
  },
  {
    word: 'Tubig',
    tagalog: 'Water',
    pronunciation: 'too-big',
    bonusXP: 25,
    date: '2026-05-11',
  },
  {
    word: 'Pagkain',
    tagalog: 'Food',
    pronunciation: 'pahg-kah-in',
    bonusXP: 25,
    date: '2026-05-12',
  },
  {
    word: 'Mahal',
    tagalog: 'Love',
    pronunciation: 'mah-hahl',
    bonusXP: 25,
    date: '2026-05-13',
  },
];

/**
 * Get today's date in YYYY-MM-DD format
 */
export const getTodayDate = (): string => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

/**
 * Get Word of the Day for a given date
 */
export const getWordOfTheDay = (dateStr?: string): WordOfTheDay => {
  const date = dateStr || getTodayDate();
  const dateObj = new Date(date);
  const dayOfYear = Math.floor((dateObj.getTime() - new Date(dateObj.getFullYear(), 0, 0).getTime()) / 86400000);
  const index = dayOfYear % WORD_POOL.length;
  return WORD_POOL[index];
};

/**
 * Calculate badge based on streak length
 */
export const getBadgesForStreak = (streakLength: number): string[] => {
  const badges = [];
  if (streakLength >= 3) badges.push('3-day-streak');
  if (streakLength >= 7) badges.push('7-day-streak');
  if (streakLength >= 14) badges.push('14-day-streak');
  if (streakLength >= 30) badges.push('30-day-streak');
  if (streakLength >= 100) badges.push('century-champion');
  return badges;
};

/**
 * Get badge display name and emoji
 */
export const getBadgeInfo = (badgeId: string): { name: string; emoji: string; description: string } => {
  const badges: Record<string, { name: string; emoji: string; description: string }> = {
    '3-day-streak': { name: '3-Day Streak', emoji: '🔥', description: 'Practiced for 3 consecutive days' },
    '7-day-streak': { name: 'Week Warrior', emoji: '🏆', description: 'Practiced for 7 consecutive days' },
    '14-day-streak': { name: 'Fortnight Expert', emoji: '⭐', description: 'Practiced for 14 consecutive days' },
    '30-day-streak': { name: 'Month Master', emoji: '👑', description: 'Practiced for 30 consecutive days' },
    'century-champion': { name: 'Century Champion', emoji: '💫', description: 'Achieved 100-day streak!' },
    'word-of-the-day': { name: 'Daily Champion', emoji: '✨', description: 'Completed Word of the Day' },
    'perfect-accuracy': { name: 'Perfect Pitcher', emoji: '🎯', description: '100% accuracy on 5 words' },
  };
  return badges[badgeId] || { name: 'Unknown Badge', emoji: '🏅', description: 'Mystery achievement' };
};

/**
 * Load streak data for a student
 */
export const loadStreakData = async (uid: string): Promise<StreakData> => {
  try {
    const { data, error } = await (supabase as any).from('streaks').select('*').eq('id', uid).single();
    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data) {
      return data;
    }

    const defaultStreakData: StreakData = {
      id: uid,
      currentStreak: 0,
      longestStreak: 0,
      lastPracticeDate: '',
      streakStartDate: getTodayDate(),
      badges: [],
      totalXP: 0,
      wordOfTheDayCompleted: false,
    };

    const insertResult = await (supabase as any).from('streaks').insert(defaultStreakData);
    if (insertResult.error) {
      throw insertResult.error;
    }

    return defaultStreakData;
  } catch (error) {
    console.error('Error loading streak data:', error);
    return {
      id: uid,
      currentStreak: 0,
      longestStreak: 0,
      lastPracticeDate: '',
      streakStartDate: getTodayDate(),
      badges: [],
      totalXP: 0,
      wordOfTheDayCompleted: false,
    };
  }
};

/**
 * Update streak when student practices
 */
export const updateStreakOnPractice = async (uid: string, xpGained: number): Promise<StreakData> => {
  try {
    const streakData = await loadStreakData(uid);
    const today = getTodayDate();
    const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];

    let newStreak = streakData.currentStreak;

    // Check if last practice was today - don't increment
    if (streakData.lastPracticeDate === today) {
      // Already practiced today
    } else if (streakData.lastPracticeDate === yesterday) {
      // Streak continues
      newStreak += 1;
    } else {
      // Streak broken, start new
      newStreak = 1;
    }

    const longestStreak = Math.max(streakData.longestStreak, newStreak);
    const newBadges = getBadgesForStreak(newStreak);
    const updatedBadges = Array.from(new Set([...streakData.badges, ...newBadges]));

    const updatedStreakData: StreakData = {
      currentStreak: newStreak,
      longestStreak,
      lastPracticeDate: today,
      streakStartDate: streakData.streakStartDate || today,
      badges: updatedBadges,
      totalXP: streakData.totalXP + xpGained,
      wordOfTheDayCompleted: streakData.wordOfTheDayCompleted,
    };

    const { error } = await supabase
      .from('streaks')
      .upsert({ id: uid, ...updatedStreakData }, { onConflict: 'id' });

    if (error) {
      throw error;
    }

    return updatedStreakData;
  } catch (error) {
    console.error('Error updating streak:', error);
    throw error;
  }
};

/**
 * Mark Word of the Day as completed
 */
export const completeWordOfTheDay = async (uid: string, bonusXP: number): Promise<void> => {
  try {
    const streakData = await loadStreakData(uid);
    const today = getTodayDate();

    // Only award bonus XP if not already completed today
    if (streakData.wordOfTheDayCompleted && streakData.lastPracticeDate === today) {
      return;
    }

    const updatedBadges = Array.from(new Set([...streakData.badges, 'word-of-the-day']));
    const { error } = await supabase
      .from('streaks')
      .upsert(
        {
          id: uid,
          wordOfTheDayCompleted: true,
          totalXP: streakData.totalXP + bonusXP,
          lastPracticeDate: today,
          badges: updatedBadges,
        },
        { onConflict: 'id' }
      );

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Error completing Word of the Day:', error);
  }
};

/**
 * Reset streak (for testing or when streak is broken)
 */
export const resetStreak = async (uid: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('streaks')
      .upsert(
        {
          id: uid,
          currentStreak: 0,
          lastPracticeDate: '',
          streakStartDate: getTodayDate(),
        },
        { onConflict: 'id' }
      );
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Error resetting streak:', error);
  }
};

/**
 * Get streak milestone message
 */
export const getStreakMilestoneMessage = (streak: number): string | null => {
  if (streak === 3) return '🔥 3-day streak! You\'re on fire!';
  if (streak === 7) return '🏆 Week warrior! Amazing consistency!';
  if (streak === 14) return '⭐ Fortnight expert! You\'re unstoppable!';
  if (streak === 30) return '👑 Month master! Incredible dedication!';
  if (streak === 100) return '💫 Century champion! You\'re a legend!';
  return null;
};

