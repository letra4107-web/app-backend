import { supabase } from '../config/supabase';
import { createParentNotification } from './notificationService';
import { speakPhrase } from './ttsService';
import { ChildProgress } from './progressService';

export type PronunciationStats = {
  maxSingleAccuracy: number;
  perfectWordCount: number;
  hasDifficultWordRetried: boolean;
  challengingWordsMastered: number;
};

const EMPTY_STATS: PronunciationStats = {
  maxSingleAccuracy: 0,
  perfectWordCount: 0,
  hasDifficultWordRetried: false,
  challengingWordsMastered: 0,
};

export type AchievementDefinition = {
  id: string;
  title: string;
  image: any;
  isUnlocked: (progress: ChildProgress, stats: PronunciationStats) => boolean;
};

// A word is "difficult" once it's been attempted this many times (right or wrong).
const DIFFICULT_WORD_ATTEMPTS = 5;
// A word counts as "challenging but conquered" once it needed this many
// attempts and was eventually gotten right.
const CHALLENGING_WORD_ATTEMPTS = 3;
const CHALLENGING_WORDS_REQUIRED = 5;
// Floors so "average accuracy" badges can't be won/lost off a single lucky or
// unlucky attempt.
const MIN_ATTEMPTS_FOR_AVERAGE_BADGE = 10;
const MIN_ATTEMPTS_FOR_IMPROVEMENT_BADGE = 5;
const IMPROVEMENT_POINTS_REQUIRED = 20;

const averageAccuracy = (progress: ChildProgress) =>
  (progress.total_attempts || 0) > 0 ? (progress.accuracy_sum || 0) / (progress.total_attempts || 1) : 0;

async function getPronunciationStats(childId?: string): Promise<PronunciationStats> {
  if (!childId) return EMPTY_STATS;

  try {
    const { data, error } = await supabase
      .from('pronunciation_practice_sessions')
      .select('word, accuracy_percentage, is_correct')
      .eq('student_id', childId);

    if (error) throw error;

    const sessions = data || [];
    let maxSingleAccuracy = 0;
    const perfectWords = new Set<string>();
    const attemptsByWord = new Map<string, { count: number; hasCorrect: boolean }>();

    for (const session of sessions) {
      const accuracy = Number(session.accuracy_percentage) || 0;
      if (accuracy > maxSingleAccuracy) maxSingleAccuracy = accuracy;
      if (accuracy === 100 && session.word) perfectWords.add(session.word);

      if (session.word) {
        const entry = attemptsByWord.get(session.word) || { count: 0, hasCorrect: false };
        entry.count += 1;
        if (session.is_correct) entry.hasCorrect = true;
        attemptsByWord.set(session.word, entry);
      }
    }

    let hasDifficultWordRetried = false;
    let challengingWordsMastered = 0;
    for (const { count, hasCorrect } of attemptsByWord.values()) {
      if (count >= DIFFICULT_WORD_ATTEMPTS) hasDifficultWordRetried = true;
      if (count >= CHALLENGING_WORD_ATTEMPTS && hasCorrect) challengingWordsMastered += 1;
    }

    return { maxSingleAccuracy, perfectWordCount: perfectWords.size, hasDifficultWordRetried, challengingWordsMastered };
  } catch (error) {
    console.warn('[Achievements] pronunciation stats query failed:', error);
    return EMPTY_STATS;
  }
}

// The last two badges are cascade/meta badges: their unlock conditions depend
// on the *set* of already-unlocked badges, not on progress/stats alone, so
// their isUnlocked() here is a stub — the real logic lives in
// unlockAchievements() below.
export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: 'unang_hakbang',
    title: 'Unang Hakbang',
    image: require('../../assets/badges/unang_hakbang.png'),
    isUnlocked: (p) => (p.activities_completed || 0) >= 1,
  },
  {
    id: 'batang_mambabasa',
    title: 'Batang Mambabasa',
    image: require('../../assets/badges/batang_mambabasa.png'),
    isUnlocked: (p) => (p.activities_completed || 0) >= 5,
  },
  {
    id: 'masigasig_na_mambabasa',
    title: 'Masigasig na Mambabasa',
    image: require('../../assets/badges/masigasig_na_mambabasa.png'),
    isUnlocked: (p) => (p.activities_completed || 0) >= 10,
  },
  {
    id: 'kampeon_sa_pagbasa',
    title: 'Kampeon sa Pagbasa',
    image: require('../../assets/badges/kampeon_sa_pagbasa.png'),
    isUnlocked: (p) => (p.activities_completed || 0) >= 25,
  },
  {
    id: 'dalubhasa_sa_pagbasa',
    title: 'Dalubhasa sa Pagbasa',
    image: require('../../assets/badges/dalubhasa_sa_pagbasa.png'),
    isUnlocked: (p) => (p.activities_completed || 0) >= 50,
  },
  {
    id: 'unang_bigkas',
    title: 'Unang Bigkas',
    image: require('../../assets/badges/unang_bigkas.png'),
    isUnlocked: (p) => (p.total_attempts || 0) >= 1,
  },
  {
    id: 'malinaw_magsalita',
    title: 'Malinaw Magsalita',
    image: require('../../assets/badges/malinaw_magsalita.png'),
    isUnlocked: (_p, stats) => stats.maxSingleAccuracy >= 90,
  },
  {
    id: 'tamang_bigkas',
    title: 'Tamang Bigkas',
    image: require('../../assets/badges/tamang_bigkas.png'),
    isUnlocked: (_p, stats) => stats.perfectWordCount >= 5,
  },
  {
    id: 'boses_ng_tagumpay',
    title: 'Boses ng Tagumpay',
    image: require('../../assets/badges/boses_ng_tagumpay.png'),
    isUnlocked: (p) => (p.total_attempts || 0) >= 25,
  },
  {
    id: 'bigkas_champion',
    title: 'Bigkas Champion',
    image: require('../../assets/badges/bigkas_champion.png'),
    isUnlocked: (p) => (p.total_attempts || 0) >= MIN_ATTEMPTS_FOR_AVERAGE_BADGE && averageAccuracy(p) >= 90,
  },
  {
    id: 'unang_araw',
    title: 'Unang Araw',
    image: require('../../assets/badges/unang_araw.png'),
    isUnlocked: (p) => !!p.last_practice_date,
  },
  {
    id: 'tuloy_tuloy',
    title: 'Tuloy-Tuloy!',
    image: require('../../assets/badges/tuloy_tuloy.png'),
    isUnlocked: (p) => (p.streak || 0) >= 3,
  },
  {
    id: 'lingguhang_bayani',
    title: 'Lingguhang Bayani',
    image: require('../../assets/badges/lingguhang_bayani.png'),
    isUnlocked: (p) => (p.streak || 0) >= 7,
  },
  {
    id: 'buwan_ng_pagsisikap',
    title: 'Buwan ng Pagsisikap',
    image: require('../../assets/badges/buwan_ng_pagsisikap.png'),
    isUnlocked: (p) => (p.streak || 0) >= 30,
  },
  {
    id: 'hindi_ako_susuko',
    title: 'Hindi Ako Susuko',
    image: require('../../assets/badges/hindi_ako_susuko.png'),
    isUnlocked: (_p, stats) => stats.hasDifficultWordRetried,
  },
  {
    id: 'lakas_ng_loob',
    title: 'Lakas ng Loob',
    image: require('../../assets/badges/lakas_ng_loob.png'),
    isUnlocked: (_p, stats) => stats.challengingWordsMastered >= CHALLENGING_WORDS_REQUIRED,
  },
  {
    id: 'matalinong_mag_aaral',
    title: 'Matalinong Mag-aaral',
    image: require('../../assets/badges/matalinong_mag_aaral.png'),
    isUnlocked: (p) => {
      if ((p.total_attempts || 0) < MIN_ATTEMPTS_FOR_IMPROVEMENT_BADGE) return false;
      if (p.baseline_accuracy == null) return false;
      return averageAccuracy(p) - p.baseline_accuracy >= IMPROVEMENT_POINTS_REQUIRED;
    },
  },
  {
    id: 'patuloy_na_umuunlad',
    title: 'Patuloy na Umuunlad',
    image: require('../../assets/badges/patuloy_na_umuunlad.png'),
    isUnlocked: (p) => p.level !== 'Beginner',
  },
  {
    id: 'aking_unang_tagumpay',
    title: 'Aking Unang Tagumpay',
    image: require('../../assets/badges/aking_unang_tagumpay.png'),
    isUnlocked: () => false,
  },
  {
    id: 'alamat_ng_pagbasa',
    title: 'Alamat ng Pagbasa',
    image: require('../../assets/badges/alamat_ng_pagbasa.png'),
    isUnlocked: () => false,
  },
];

const CASCADE_BADGE_ID = 'aking_unang_tagumpay';
const FINAL_BADGE_ID = 'alamat_ng_pagbasa';
const REGULAR_BADGE_IDS = ACHIEVEMENTS.map((a) => a.id).filter(
  (id) => id !== CASCADE_BADGE_ID && id !== FINAL_BADGE_ID,
);

export const unlockAchievements = async (
  progress: ChildProgress,
  childName: string,
  parentId?: string,
) => {
  const unlockedIds = new Set((progress.achievements || []).map((achievement) => achievement.id));
  const hadZeroBadgesBefore = unlockedIds.size === 0;
  const stats = await getPronunciationStats(progress.child_id);

  const newlyUnlocked: AchievementDefinition[] = [];
  for (const id of REGULAR_BADGE_IDS) {
    if (unlockedIds.has(id)) continue;
    const achievement = ACHIEVEMENTS.find((a) => a.id === id)!;
    if (achievement.isUnlocked(progress, stats)) {
      newlyUnlocked.push(achievement);
    }
  }

  // "Aking Unang Tagumpay" has no condition of its own — it represents the
  // student's very first badge, so it can't require a badge to earn a badge.
  // If anything above just unlocked and the student had none before, it
  // unlocks alongside it in this same pass.
  if (newlyUnlocked.length && hadZeroBadgesBefore) {
    newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === CASCADE_BADGE_ID)!);
  }

  if (!newlyUnlocked.length) {
    return { progress, newlyUnlocked };
  }

  const allUnlockedIds = new Set([...unlockedIds, ...newlyUnlocked.map((a) => a.id)]);
  const allOthersUnlocked =
    REGULAR_BADGE_IDS.every((id) => allUnlockedIds.has(id)) && allUnlockedIds.has(CASCADE_BADGE_ID);
  if (allOthersUnlocked && !allUnlockedIds.has(FINAL_BADGE_ID)) {
    newlyUnlocked.push(ACHIEVEMENTS.find((a) => a.id === FINAL_BADGE_ID)!);
  }

  const unlockedAt = new Date().toISOString();
  const updatedProgress: ChildProgress = {
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
