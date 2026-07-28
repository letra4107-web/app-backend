import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { buildApiUrl, getJson } from '../config/api';
import { onAuthStateChanged, signOutUser } from '../services/supabaseService';
import StudentWordOfDay from './StudentWordOfDay';
import ConfettiOverlay from '../components/ConfettiOverlay';
import AchievementModal from './AchievementModal';
import { getOrCreateWordOfDay, WordOfDayLog } from '../services/wordOfDayService';
import { buildNextProgress, ChildProgress, saveProgress } from '../services/progressService';
import {
  ACHIEVEMENTS, unlockAchievements, getPronunciationStats, PronunciationStats, AchievementCategory, AchievementDefinition,
  MIN_ATTEMPTS_FOR_AVERAGE_BADGE, CHALLENGING_WORDS_REQUIRED, IMPROVEMENT_POINTS_REQUIRED, averageAccuracy,
} from '../services/achievementService';
import { fetchStudentActivities, StudentActivity } from '../services/activityService';
import { speakPhrase, speakWord, stopSpeaking, setTtsEnabled, setSpeechRateSetting } from '../services/ttsService';
import { fetchDashboardSettings, DashboardSettings } from '../services/settingsService';
import { fetchPublishedLessons, Lesson, subscribeToPublishedLessons } from '../services/lessonService';
import { fetchLessonProgress, markLessonCompleted, markLessonOpened, LessonProgressRow } from '../services/lessonProgressService';
import { createParentNotification, fetchNotifications, markNotificationRead, NotificationItem } from '../services/notificationService';
import { loadWordDefinitions, normalizeWordKey, WordDefinition } from '../services/wordDefinitionsService';
import DashboardSettingsScreen from './DashboardSettingsScreen';

type ChildProfile = {
  id: string;
  parent_id: string;
  name: string;
  grade_level: number;
  username: string;
  auth_uid: string;
  child_progress?: ChildProgress[];
};

type Upload = {
  id: string;
  path: string;
  content_type: string;
  created_at: string;
  metadata?: { title?: string; subject?: string; completed?: boolean } | null;
};

const PRIMARY = '#4f46e5';
const PRIMARY_DARK = '#4338ca';
const PRIMARY_LIGHT = '#eef2ff';
const SURFACE = '#ffffff';
const BACKGROUND = '#f5f3ff';
const BORDER = '#e5e7eb';
const TEXT_PRIMARY = '#111827';
const TEXT_SECONDARY = '#6b7280';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';
const DANGER = '#ef4444';
const XP_GOLD = '#f59e0b';

// Home tab tokens — a warm, "reading journey" pastel palette
// (cream/lavender/coral/sage/sun). Scoped to Home; other tabs keep PRIMARY etc.
const HOME_CREAM = '#FBF3E2';
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#8A7B6C';
const HOME_SUN = '#E3971A';
const HOME_CORAL = '#E06B4C';
const HOME_SAGE = '#5C8047';
const HOME_LAVENDER = '#7C6FCF';
const HOME_LAVENDER_DARK = '#5F52B0';
// Hero banner brand gradient only - not part of the general HOME_* palette
// used elsewhere on the page.
const HERO_GRADIENT_START = '#6D28D9';
const HERO_GRADIENT_MID = '#A855F7';
const HERO_GRADIENT_END = '#9D174D';
// Quick Stats icon-circle fills only - deliberately more saturated than the
// shared HOME_SAGE/HOME_CORAL/HOME_LAVENDER_DARK/HOME_SUN tokens (which stay
// unchanged everywhere else, e.g. Progress/Achievements), since those were
// reported as reading like faded tints rather than bold solid colors here.
const VIVID_GREEN = '#16A34A';
const VIVID_ORANGE = '#EA580C';
const VIVID_VIOLET = '#7C3AED';
const VIVID_AMBER = '#F59E0B';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';
const XP_CORRECT = 50;
const XP_WRONG = 30;
const DAILY_GOAL = 5;
// Raised from 70 alongside the scorePronunciation rewrite — see that
// function's comment. 70 was passable by genuinely wrong words (e.g.
// "balikaka" scored 73% against "kalikasan"); 75 keeps real STT-noise near
// misses (dropped vowels, clipped final letters) passing while rejecting
// mismatched words.
const PRACTICE_PASSING_SCORE = 75;

type PracticeResult = {
  correct: boolean;
  score: number;
  transcript: string;
  feedback: string;
  xpAward: number;
};

const DEFAULT_PHONETIC_WORDS = [
  'Ba-ba', 'Ka-ma', 'A-so', 'Ma-no', 'La-pis',
  'A-ma', 'A-te', 'A-raw', 'U-po',
  'Bu-kid', 'Da-hon', 'Di-la', 'Ga-bi', 'Ha-pon',
  'Ku-ya', 'Lu-ma', 'Na-na', 'Ni-yog', 'Pa-la',
  'Pu-sa', 'Sa-ya', 'Su-si', 'Ta-ma', 'Tu-bo',
  'Wa-la', 'Ya-ya',
];

// Extra content added to give the Progress tab's "My Reading Skills"
// breakdown real, distinct categories to score — before this, every
// practice word was the same 2-syllable shape, so there was no honest
// way to tell "letter recognition" apart from "word reading."
const SKILL_LETTERS = ['A', 'E', 'I', 'O', 'U', 'B', 'K', 'D', 'G', 'H', 'L', 'M', 'N', 'P', 'S', 'T'];
const SKILL_LONG_WORDS = [
  'Ka-ba-yo', 'Ta-la-ba', 'Ma-ta-mis', 'Bu-la-klak',
  'Ka-ra-bao', 'Sam-pa-gui-ta', 'Ba-la-hi-bo', 'Pa-la-ka-san',
];

type SkillCategory = 'letters' | 'syllables' | 'words';

const categorizeWord = (word: string): SkillCategory => {
  const clean = word.replace(/-/g, '');
  if (clean.length <= 1) return 'letters';
  const syllables = word.split('-').filter(Boolean);
  if (syllables.length <= 2) return 'syllables';
  return 'words';
};
const PRAISE_FEEDBACK = ['Magaling!', 'Napakahusay!', 'Ayos!', 'Ang galing mo!', 'Perfect!'];
const SUPPORT_FEEDBACK = [
  'Magaling! Ulitin natin.',
  'Okay lang yan, subukan ulit!',
  'Malapit na!',
  'Kaya mo yan!',
];

const randomFrom = (items: string[]) => items[Math.floor(Math.random() * items.length)];

const normalizePronunciation = (value = '') =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zñ]/g, '')
    .replace(/ñ/g, 'n');

const levenshteinDistance = (a: string, b: string) => {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_unused, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return rows[a.length][b.length];
};

const scorePronunciation = (expected: string, spoken: string) => {
  const normalizedExpected = normalizePronunciation(expected);
  const normalizedSpoken = normalizePronunciation(spoken);
  if (!normalizedExpected || !normalizedSpoken) return 0;
  if (normalizedExpected === normalizedSpoken) return 100;

  const distance = levenshteinDistance(normalizedExpected, normalizedSpoken);
  const maxLen = Math.max(normalizedExpected.length, normalizedSpoken.length);
  const ratio = distance / maxLen;
  // Quadratic-ish falloff (exponent 1.6) instead of a linear ratio, and no
  // "starts with the same letter" / "similar length" bonuses — those bonuses
  // used to inflate scores for words that only coincidentally share letters
  // (e.g. "balikaka" vs "kalikasan" scored 73% and was accepted as correct).
  // Length mismatch is already captured by `ratio` itself; it doesn't need a
  // separate reward on top.
  return Math.min(99, Math.round(100 * Math.max(0, 1 - ratio) ** 1.6));
};

const scoreMessage = (score: number) => {
  if (score >= 95) return `${score}% Tama!`;
  if (score >= 80) return `${score}% Napakalapit!`;
  if (score >= 60) return `${score}% Magaling! Konting practice pa!`;
  return `${score}% Ulitin natin!`;
};

const emptyProgress = (childId: string): ChildProgress => ({
  child_id: childId,
  xp: 0,
  level: 'Beginner',
  streak: 0,
  last_practice_date: null,
  completed_words: [],
  total_attempts: 0,
  achievements: [],
  badges: [],
  baseline_accuracy: null,
  accuracy_sum: 0,
  activities_completed: 0,
});

const todayKey = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StudentDashboard({ navigation }: any) {
  const [child, setChild] = useState<ChildProfile | null>(null);
  const [progress, setProgress] = useState<ChildProgress | null>(null);
  const [wordOfDay, setWordOfDay] = useState<WordOfDayLog | null>(null);
  const [practiceWords, setPracticeWords] = useState<string[]>([]);
  const [wordDefinitions, setWordDefinitions] = useState<Map<string, WordDefinition>>(new Map());
  const getWordDefinition = (word: string) => wordDefinitions.get(normalizeWordKey(word));
  const [recentSessions, setRecentSessions] = useState<{ word: string; accuracy_percentage: number; created_at: string }[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonProgress, setLessonProgress] = useState<LessonProgressRow[]>([]);
  const [lessonFilter, setLessonFilter] = useState<string>('Lahat');
  const [activities, setActivities] = useState<StudentActivity[]>([]);
  const [uploadsError, setUploadsError] = useState<string>('');
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState<string>('');
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [practiceAttempts, setPracticeAttempts] = useState(0);
  type Section = 'home' | 'learn' | 'practice' | 'progress' | 'achievements' | 'notifications' | 'settings';
  const [section, setSection] = useState<Section>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [achievement, setAchievement] = useState<{ image: any; title: string; category?: AchievementCategory; xp?: number } | null>(null);
  const [expandedBadgeId, setExpandedBadgeId] = useState<string | null>(null);
  const [pronunciationStats, setPronunciationStats] = useState<PronunciationStats | null>(null);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings | null>(null);
  const [badgeFilter, setBadgeFilter] = useState<'all' | AchievementCategory>('all');
  const [practiceResult, setPracticeResult] = useState<PracticeResult | null>(null);
  const [practiceTranscript, setPracticeTranscript] = useState('');
  const [practiceListening, setPracticeListening] = useState(false);
  const [practiceMode, setPracticeMode] = useState<'say' | 'listen'>('say');
  const [todaySessions, setTodaySessions] = useState<{ word: string; accuracy_percentage: number; is_correct: boolean; duration_seconds: number | null; created_at: string }[]>([]);
  const [practiceStatus, setPracticeStatus] = useState('Pindutin ang mikropono kapag handa ka na.');
  const [confettiVisible, setConfettiVisible] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(todayKey());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const sidebarAnim = useRef(new Animated.Value(-260)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const mascotPulse = useRef(new Animated.Value(1)).current;
  const handledTranscriptRef = useRef('');
  const practiceStartRef = useRef<number | null>(null);

  const UPLOADS_BUCKET = 'teacher-uploads'; // Update if your Supabase bucket name differs

  useSpeechRecognitionEvent('start', () => {
    setPracticeListening(true);
    setPracticeStatus('Nakikinig ako. Sabihin ang salita!');
    practiceStartRef.current = Date.now();
  });

  useSpeechRecognitionEvent('end', () => {
    setPracticeListening(false);
    setPracticeStatus('Tapos na ang pakikinig.');
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript || '';
    if (!transcript) return;
    setPracticeTranscript(transcript);
    setPracticeStatus(event.isFinal ? 'Narinig ko!' : 'Naririnig kita...');

    if (event.isFinal) {
      ExpoSpeechRecognitionModule.stop();
      if (handledTranscriptRef.current === transcript) return;
      handledTranscriptRef.current = transcript;
      handlePracticeResult(transcript);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setPracticeListening(false);
    setPracticeStatus(
      event.error === 'no-speech'
        ? 'Hindi ko narinig. Subukan natin ulit.'
        : 'May problema sa mikropono. Pakinggan muna ang salita, tapos ulit.'
    );
  });

  const fetchTeacherUploads = async (gradeLevel: number): Promise<Upload[]> => {
    setUploadsError('');

    const { data, error } = await supabase
      .from('teacher_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      console.log('[Uploads] Supabase direct: got', data.length, 'uploads for grade', gradeLevel);
      return data as Upload[];
    }

    console.warn('[Uploads] Supabase direct failed, trying backend fallback:', error?.message || error);

    try {
      const res = await getJson<{ success: boolean; uploads: Upload[] }>(
        buildApiUrl('/reading/uploads'),
        15000,
      );

      if (res?.success && Array.isArray(res.uploads)) {
        console.log('[Uploads] Backend fallback: got', res.uploads.length, 'uploads');
        return res.uploads;
      }

      console.warn('[Uploads] Backend fallback returned no uploads or failed', res);
      setUploadsError('Hindi ma-load ang mga leksyon. Subukan muli mamaya.');
      return [];
    } catch (backendErr: any) {
      console.error('[Uploads] Both Supabase and backend failed:', backendErr?.message || backendErr);
      setUploadsError('Hindi ma-load ang mga leksyon. Check internet o Supabase RLS.');
      return [];
    }
  };

  const loadPublishedLessons = async (gradeLevel?: number | string | null) => {
    setLessonsLoading(true);
    setLessonsError('');
    try {
      const rows = await fetchPublishedLessons(gradeLevel);
      setLessons(rows);
      return rows;
    } catch (error: any) {
      console.error('[StudentDashboard] lessons load failed:', error);
      setLessonsError(error?.message || 'Hindi ma-load ang lessons. Subukan muli mamaya.');
      return [];
    } finally {
      setLessonsLoading(false);
    }
  };

  const loadStudentActivities = async (authUid: string, childId?: string) => {
    setActivitiesLoading(true);
    setActivitiesError('');
    try {
      const rows = await fetchStudentActivities(authUid, childId);
      setActivities(rows);
      return rows;
    } catch (error: any) {
      console.error('[StudentDashboard] activities load failed:', error);
      setActivitiesError(error?.message || 'Hindi ma-load ang activities. Subukan muli mamaya.');
      return [] as StudentActivity[];
    } finally {
      setActivitiesLoading(false);
    }
  };

  const loadRecentSessions = async (childId?: string) => {
    if (!childId) return [];
    try {
      const { data, error } = await supabase
        .from('pronunciation_practice_sessions')
        .select('word, accuracy_percentage, created_at')
        .eq('student_id', childId)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      const rows = data || [];
      setRecentSessions(rows);
      return rows;
    } catch (error: any) {
      console.warn('[StudentDashboard] recent sessions load failed:', error?.message || error);
      setRecentSessions([]);
      return [];
    }
  };

  const loadTodaySessions = async (childId?: string) => {
    if (!childId) return [];
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('pronunciation_practice_sessions')
        .select('word, accuracy_percentage, is_correct, duration_seconds, created_at')
        .eq('student_id', childId)
        .gte('created_at', startOfDay.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      setTodaySessions(rows);
      return rows;
    } catch (error: any) {
      console.warn('[StudentDashboard] today sessions load failed:', error?.message || error);
      setTodaySessions([]);
      return [];
    }
  };

  const loadNotifications = async (authUid?: string) => {
    if (!authUid) return [];
    try {
      const rows = await fetchNotifications(authUid);
      setNotifications(rows);
      return rows;
    } catch (error: any) {
      console.warn('[StudentDashboard] notifications load failed:', error?.message || error);
      setNotifications([]);
      return [];
    }
  };

  const loadDashboardSettings = async (authUid?: string) => {
    if (!authUid) return null;
    try {
      const result = await fetchDashboardSettings(authUid, 'student');
      setDashboardSettings(result);
      setTtsEnabled(result.tts_enabled);
      setSpeechRateSetting(result.speech_rate || 'normal');
      return result;
    } catch (error: any) {
      console.warn('[StudentDashboard] settings load failed:', error?.message || error);
      return null;
    }
  };

  const loadPronunciationStats = async (childId?: string) => {
    if (!childId) return null;
    try {
      const result = await getPronunciationStats(childId);
      setPronunciationStats(result);
      return result;
    } catch (error: any) {
      console.warn('[StudentDashboard] pronunciation stats load failed:', error?.message || error);
      setPronunciationStats(null);
      return null;
    }
  };

  const loadLessonProgress = async (childId?: string) => {
    if (!childId) return [];
    try {
      const rows = await fetchLessonProgress(childId);
      setLessonProgress(rows);
      return rows;
    } catch (error: any) {
      console.warn('[StudentDashboard] lesson progress load failed:', error?.message || error);
      setLessonProgress([]);
      return [];
    }
  };

  const retryLessons = () => {
    if (child) void loadPublishedLessons(child.grade_level);
  };

  const retryActivities = () => {
    if (child) void loadStudentActivities(child.auth_uid, child.id);
  };

  const fetchChildProfile = async (authUid: string) => {
    const url = buildApiUrl(`/auth/child-profile/${authUid}`);

    let response: { success: boolean; child?: ChildProfile; message?: string; details?: any; code?: string; hint?: string };
    try {
      response = await getJson(url, 30000);
    } catch (fetchErr: any) {
      console.warn('[StudentDashboard] child-profile fetch failed, falling back to Supabase:', {
        url,
        authUid,
        message: fetchErr?.message,
        status: fetchErr?.status,
      });

      try {
        const { data: child, error: supabaseError } = await supabase
          .from('children')
          .select('id,parent_id,name,grade_level,username,auth_uid,child_progress(*)')
          .eq('auth_uid', authUid)
          .single();

        if (supabaseError) throw supabaseError;
        if (!child) throw new Error('Child not found in Supabase');

        console.log('[StudentDashboard] Supabase fallback succeeded for authUid:', authUid);
        return child as ChildProfile;
      } catch (supabaseErr: any) {
        console.error('[StudentDashboard] Supabase fallback also failed:', {
          authUid,
          message: supabaseErr?.message,
        });
        throw new Error(
          'Hindi ma-load ang iyong profile. Siguraduhing tumatakbo ang backend at may internet connection.'
        );
      }
    }

    if (!response.success || !response.child) {
      console.error('[StudentDashboard] child-profile not found or error:', {
        authUid,
        message: response.message,
        details: response.details,
        code: response.code,
        hint: response.hint,
      });
      throw new Error(
        response.message || 'Hindi nahanap ang profile ng estudyante. Makipag-ugnayan sa guro.'
      );
    }

    return response.child;
  };

  const loadStudent = async (authUid: string) => {
    const MAX_RETRIES = 3;
    let profile: ChildProfile | null = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        profile = await fetchChildProfile(authUid);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === MAX_RETRIES - 1) {
          throw error;
        }
        await sleep(1500 * (attempt + 1));
      }
    }

    if (!profile) {
      throw lastError || new Error('Hindi ma-load ang profile ng student.');
    }

    setChild(profile);
    setUploadsError('');
    const currentProgress = profile.child_progress?.[0] || emptyProgress(profile.id);
    setProgress(currentProgress);

    const readingActivitiesPromise = (async () => {
      try {
        return await supabase
          .from('reading_activities')
          .select('words')
          .eq('grade', Number(profile.grade_level || 1));
      } catch (err: any) {
        console.warn('[StudentDashboard] reading activities load failed:', err?.message || err);
        return { data: [], error: null };
      }
    })();

    const [wordLog, readingActivities, uploads, lessonRows, assignedActivities, , , , , , , definitions] = await Promise.all([
      getOrCreateWordOfDay(profile.id, Number(profile.grade_level || 1)).catch((err) => {
        console.warn('[StudentDashboard] word-of-day load failed:', err?.message || err);
        return null;
      }),
      readingActivitiesPromise,
      fetchTeacherUploads(Number(profile.grade_level || 1)),
      loadPublishedLessons(Number(profile.grade_level || 1)),
      loadStudentActivities(profile.auth_uid, profile.id),
      loadRecentSessions(profile.id),
      loadNotifications(profile.auth_uid),
      loadLessonProgress(profile.id),
      loadTodaySessions(profile.id),
      loadPronunciationStats(profile.id),
      loadDashboardSettings(profile.auth_uid),
      loadWordDefinitions().catch((err) => {
        // Supporting content only (subtitle text) - never block the dashboard
        // over it, and an empty map just means no definition subtitle shows.
        console.warn('[StudentDashboard] word definitions load failed:', err?.message || err);
        return new Map<string, WordDefinition>();
      }),
    ]);
    setWordDefinitions(definitions);

    if (wordLog) {
      setWordOfDay(wordLog);
    }

    if (readingActivities.error) {
      console.warn('[StudentDashboard] reading activities query failed:', readingActivities.error?.message || readingActivities.error);
    }
    const practiceWordsList = (readingActivities.data || []).flatMap((row: any) =>
      Array.isArray(row.words) ? row.words : []
    );
    setPracticeWords([...new Set(practiceWordsList.map(String))]);
    setUploads(uploads);
    setLessons(lessonRows);
    setActivities(assignedActivities);
  };

  useEffect(() => {
    let active = true;
    let subscription: any;

    const loadDashboard = async () => {
      if (!active) return;
      setLoading(true);
      setError('');

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        const user = sessionData?.session?.user;
        if (!user) {
          console.warn('[StudentDashboard] no auth session found', { path: 'StudentDashboard', retryKey });
          setAuthUserId(null);
          navigation.replace('Login');
          return;
        }

        console.debug('[StudentDashboard] auth user loaded:', user);
        setAuthUserId(user.id);
        await loadStudent(user.id);
      } catch (error: any) {
        if (!active) return;
        const message = error?.message || 'Hindi ma-load ang student dashboard.';
        setError(message.includes('not found') ? 'Hindi ma-load ang student dashboard. Profile not found.' : message);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDashboard();

    const authListener = onAuthStateChanged((_event, session) => {
      if (!active) return;
      const user = session?.user;
      if (!user) {
        setAuthUserId(null);
        navigation.replace('Login');
        return;
      }
      console.debug('[StudentDashboard] auth state user:', user);
      setAuthUserId(user.id);
      setLoading(true);
      setError('');
      loadStudent(user.id)
        .catch((error) => {
          setError(error?.message || 'Hindi ma-load ang student dashboard.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    subscription = authListener.data?.subscription;

    return () => {
      active = false;
      if (subscription?.unsubscribe) {
        subscription.unsubscribe();
      }
    };
  }, [navigation, retryKey]);

  useEffect(() => {
    if (!child) return undefined;
    return subscribeToPublishedLessons(() => {
      loadPublishedLessons(Number(child.grade_level || 1));
    });
  }, [child?.id, child?.grade_level]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(mascotPulse, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(mascotPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [mascotPulse]);

  const initials = useMemo(() => (child?.name || 'U').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(), [child]);

  const stats = useMemo(() => ({
    streak: progress?.streak || 0,
    xp: progress?.xp || 0,
    level: progress?.level || 'Beginner',
    completed: progress?.completed_words?.length || 0,
  }), [progress]);

  // Sidebar animation helpers
  const openSidebar = () => {
    setSidebarOpen(true);
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0.5, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeSidebar = () => {
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: -260, duration: 240, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => setSidebarOpen(false));
  };

  const navigateTo = (s: any) => {
    setSection(s);
    closeSidebar();
  };

  const getFirstName = (full = '') => (full ? String(full).split(' ')[0] : 'Ka');

  const relativeBadgeDate = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Kahapon';
    if (days < 7) return `${days} araw na ang nakalipas`;
    return new Date(iso).toLocaleDateString();
  };

  const getNextLevelInfo = (xp: number, level: string) => {
    if (level === 'Beginner') return { next: 'Intermediate', need: 100, current: xp, max: 100 };
    if (level === 'Intermediate') return { next: 'Advanced', need: 250, current: xp, max: 250 };
    return { next: null, need: 0, current: xp, max: xp };
  };

  const getActivityDateKey = (activity: StudentActivity) => new Date(activity.deadline).toISOString().slice(0, 10);

  const getActivitiesForDate = (dateKey: string) =>
    activities.filter((activity) => getActivityDateKey(activity) === dateKey);

  const getCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ key: string; date?: Date; inMonth: boolean }> = [];

    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `blank-${i}`, inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      cells.push({ key: date.toISOString(), date, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `trail-${cells.length}`, inMonth: false });
    }
    return cells;
  };

  const shiftCalendarMonth = (delta: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const getStatusColor = (status: string) => {
    if (status === 'completed') return SUCCESS;
    if (status === 'completed_late') return WARNING;
    if (status === 'overdue') return DANGER;
    return WARNING;
  };

  const getStatusLabel = (status: string) => {
    if (status === 'completed') return 'Naisumite';
    if (status === 'completed_late') return 'Naisumite (Huli)';
    if (status === 'overdue') return 'Overdue';
    return 'Pending';
  };

  const iconForUpload = (contentType = '') => {
    if (String(contentType).includes('pdf')) return 'document-text-outline';
    if (String(contentType).includes('image')) return 'image-outline';
    if (String(contentType).includes('audio')) return 'musical-notes-outline';
    return 'document-outline';
  };

  const openUpload = async (upload: Upload) => {
    console.log('[Uploads] Opening upload:', upload.path);

    try {
      const { data: signedData, error: signedError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .createSignedUrl(upload.path, 300);

      if (!signedError && signedData?.signedUrl) {
        console.log('[Uploads] Using signed URL');
        await Linking.openURL(signedData.signedUrl);
        await notifyParent('Lesson Opened', `${child?.name || 'Student'} opened "${upload.metadata?.title || upload.path.split('/').pop() || 'learning material'}".`, 'lesson');
        return;
      }

      console.warn('[Uploads] Signed URL failed, trying public URL:', signedError?.message || signedError);
      const { data: publicData } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(upload.path);
      if (publicData?.publicUrl) {
        console.log('[Uploads] Using public URL');
        await Linking.openURL(publicData.publicUrl);
        await notifyParent('Lesson Opened', `${child?.name || 'Student'} opened "${upload.metadata?.title || upload.path.split('/').pop() || 'learning material'}".`, 'lesson');
        return;
      }

      if (upload.path.startsWith('https://')) {
        console.log('[Uploads] Using direct https path');
        await Linking.openURL(upload.path);
        await notifyParent('Lesson Opened', `${child?.name || 'Student'} opened "${upload.metadata?.title || upload.path.split('/').pop() || 'learning material'}".`, 'lesson');
        return;
      }

      console.warn('[Uploads] Could not resolve URL for upload:', upload.path);
      Alert.alert('Hindi Mabuksan', 'Hindi ma-open ang file. Subukan muli mamaya.');
    } catch (err: any) {
      console.error('[Uploads] openUpload failed:', err?.message || err);
      Alert.alert('Error', 'Hindi ma-open ang file. Siguraduhing may internet connection.');
    }
  };

  const openLesson = async (lesson: Lesson) => {
    if (!lesson.pdf_url) {
      Alert.alert('Hindi Mabuksan', 'Walang PDF URL ang lesson na ito.');
      return;
    }

    try {
      const supported = await Linking.canOpenURL(lesson.pdf_url);
      if (!supported) {
        Alert.alert('Hindi Mabuksan', 'Hindi supported ang PDF link sa device na ito.');
        return;
      }
      await Linking.openURL(lesson.pdf_url);
      await notifyParent('Lesson Opened', `${child?.name || 'Student'} opened "${lesson.title}".`, 'lesson');
      if (child?.id) {
        await markLessonOpened(child.id, lesson.id);
        void loadLessonProgress(child.id);
      }
    } catch (err: any) {
      console.error('[Lessons] openLesson failed:', err?.message || err);
      Alert.alert('Error', 'Hindi ma-open ang lesson. Siguraduhing may internet connection.');
    }
  };

  const getLessonState = (lessonId: string): 'not_started' | 'in_progress' | 'completed' => {
    const row = lessonProgress.find((p) => p.lesson_id === lessonId);
    return row?.status || 'not_started';
  };

  const finishLesson = async (lesson: Lesson) => {
    if (!child?.id) return;
    try {
      await markLessonCompleted(child.id, lesson.id);
      void loadLessonProgress(child.id);
      await notifyParent('Lesson Completed', `${child?.name || 'Student'} completed "${lesson.title}".`, 'lesson');
    } catch {
      Alert.alert('Error', 'Hindi na-save ang progress. Subukan muli.');
    }
  };

  const completeActivity = async (activity: StudentActivity) => {
    const isLate = new Date() > new Date(activity.deadline);
    const finalStatus = isLate ? 'completed_late' : 'completed';

    const { error } = await supabase
      .from('activities')
      .update({ status: finalStatus, updated_at: new Date().toISOString() })
      .eq('id', activity.id);

    if (error) {
      console.warn('[Activities] complete failed:', error.message || error);
      Alert.alert('Hindi na-save', 'Hindi ma-complete ang activity. Subukan muli.');
      return;
    }

    setActivities((prev) =>
      prev.map((item) => (item.id === activity.id ? { ...item, status: finalStatus } : item)),
    );
    await notifyParent(
      isLate ? 'Assignment Turned In Late' : 'Assignment Turned In',
      `${child?.name || 'Student'} turned in "${activity.title}"${isLate ? ' late' : ''}.`,
      'assignment',
    );

    if (!progress) return;
    const next = { ...progress, activities_completed: (progress.activities_completed || 0) + 1 };
    await saveProgress(next);
    setProgress(next);

    const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next, child?.name || '', child?.parent_id);
    if (newlyUnlocked?.length) {
      await saveProgress(updatedProgress);
      setProgress(updatedProgress);
      setAchievement({ image: newlyUnlocked[0].image, title: newlyUnlocked[0].title });
    }
  };

  const handleWordOfDayResult = async (correct: boolean, attempts: number, score?: number, transcript?: string) => {
    try {
      if (!progress) return;
      const addXp = correct ? XP_CORRECT : XP_WRONG;
      const next = buildNextProgress(progress, wordOfDay?.word || '', addXp, {
        countsAsPracticeSession: false,
        accuracy: score,
      });
      await saveProgress(next);
      setProgress(next);
      await notifyParent(
        'Word of the Day',
        `${child?.name || 'Student'} ${correct ? 'completed' : 'tried'} the word "${wordOfDay?.word || ''}" and earned ${addXp} XP.`,
        'word',
      );
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next, child?.name || '', child?.parent_id);
      if (newlyUnlocked?.length) {
        await saveProgress(updatedProgress);
        setProgress(updatedProgress);
        setAchievement({
          image: newlyUnlocked[0].image,
          title: newlyUnlocked[0].title,
          category: newlyUnlocked[0].category,
          xp: newlyUnlocked[0].xpReward,
        });
      }
    } catch (e) {
      console.warn('wordOfDay result handling failed', e);
    }
  };

  const speakPracticeWord = (word = selectedWord || '') => {
    if (!word) return;
    stopSpeaking();
    speakWord(word.replace(/-/g, ' '), { onError: (message) => setPracticeStatus(message) });
  };

  const savePronunciationSession = async (result: PracticeResult, word: string, durationSeconds: number | null) => {
    if (!child?.id) return false;
    const payload = {
      student_id: child.id,
      word,
      spoken_text: result.transcript,
      accuracy_percentage: result.score,
      is_correct: result.correct,
      duration_seconds: durationSeconds,
      created_at: new Date().toISOString(),
    };

    console.debug('[Practice] pronunciation insert payload:', payload);
    const { data, error } = await supabase.from('pronunciation_practice_sessions').insert(payload).select().maybeSingle();

    if (error) {
      console.warn('[Practice] pronunciation session save failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return false;
    }

    console.debug('[Practice] pronunciation session saved:', data);
    return true;
  };

  const savePracticeFeedbackNotification = async (result: PracticeResult, word: string) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('[Practice] notification auth session lookup failed:', {
        code: sessionError.code,
        message: sessionError.message,
        status: sessionError.status,
      });
      return;
    }

    const user = sessionData.session?.user;
    const userId = user?.id || authUserId;
    const message = `${result.feedback} ${scoreMessage(result.score)} Salita: ${word.replace(/-/g, ' ')}`;

    console.debug('[Practice] notification auth user:', user);
    console.debug('[Practice] notification user.id before insert:', userId);
    console.debug('[Practice] notification payload preview:', {
      student_id: child?.id,
      parent_id: child?.parent_id,
      title: 'Practice Result',
      message,
      type: 'practice',
    });

    if (!userId || !child?.id || !child?.parent_id) {
      console.warn('[Practice] notification skipped: missing authenticated user, student id, or parent id.');
      return;
    }

    try {
      await createParentNotification({
        studentId: child.id,
        parentId: child.parent_id,
        title: 'Practice Result',
        message,
        type: 'practice',
      });
    } catch (error: any) {
      console.warn('[Practice] notification insert failed:', {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        status: error?.status,
      });
    }
  };

  const notifyParent = async (title: string, message: string, type: string) => {
    if (!child?.id || !child?.parent_id) return;
    try {
      await createParentNotification({
        studentId: child.id,
        parentId: child.parent_id,
        title,
        message,
        type,
      });
    } catch (error: any) {
      console.warn('[StudentDashboard] parent notification failed:', {
        title,
        type,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        status: error?.status,
      });
    }
  };

  const handlePracticeResult = async (transcript: string) => {
    try {
      if (!selectedWord) return;
      const score = scorePronunciation(selectedWord, transcript);
      const correct = score >= PRACTICE_PASSING_SCORE;
      const feedback = randomFrom(correct ? PRAISE_FEEDBACK : SUPPORT_FEEDBACK);
      const xpAward = correct ? XP_CORRECT : XP_WRONG;
      const result = { correct, score, transcript, feedback, xpAward };
      const newAttempts = (practiceAttempts || 0) + 1;

      console.debug('[Practice] speech-to-text output:', transcript);
      console.debug('[Practice] accuracy percentage:', score);
      console.debug('[Practice] is_correct evaluation:', {
        threshold: PRACTICE_PASSING_SCORE,
        is_correct: correct,
      });

      setPracticeAttempts(newAttempts);
      setPracticeResult(result);
      setPracticeStatus(scoreMessage(score));
      setConfettiVisible(true);
      setTimeout(() => setConfettiVisible(false), 2400);

      stopSpeaking();
      speakPhrase(correct ? feedback : `${feedback} Pakinggan mo. ${selectedWord.replace(/-/g, ' ')}`, {
        onError: (message) => setPracticeStatus(message),
        onDone: () => {
          if (!correct) speakPracticeWord(selectedWord);
        },
      });

      const durationSeconds = practiceStartRef.current
        ? Math.max(1, Math.round((Date.now() - practiceStartRef.current) / 1000))
        : null;
      practiceStartRef.current = null;

      const sessionSaved = await savePronunciationSession(result, selectedWord, durationSeconds);
      if (!sessionSaved) {
        console.warn('[Practice] progress skipped because pronunciation session was not saved.');
        return;
      }
      void loadTodaySessions(child?.id);
      void loadPronunciationStats(child?.id);

      if (!correct) {
        console.debug('[Practice] invalid pronunciation; skipping progress, XP, streak, achievements, and notifications.', {
          score,
          threshold: PRACTICE_PASSING_SCORE,
          selectedWord,
        });
        return;
      }

      await savePracticeFeedbackNotification(result, selectedWord);
      if (!progress) return;
      const beforeStreak = progress.streak || 0;
      const next = buildNextProgress(progress, selectedWord, xpAward, {
        countsAsPracticeSession: true,
        accuracy: score,
      });
      console.debug('[Practice] streak update decision:', {
        previousStreak: beforeStreak,
        nextStreak: next.streak,
        previousLastPracticeDate: progress.last_practice_date,
        nextLastPracticeDate: next.last_practice_date,
        incrementsToday: (next.streak || 0) > beforeStreak,
      });
      await saveProgress(next);
      setProgress(next);
      await notifyParent('XP Update', `${child?.name || 'Student'} earned ${xpAward} XP from speech practice.`, 'xp');
      if ((next.streak || 0) > beforeStreak && [3, 7, 14, 30, 60, 100].includes(next.streak || 0)) {
        await notifyParent('Streak Milestone', `${child?.name || 'Student'} reached a ${next.streak}-day practice streak.`, 'streak');
      }
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next, child?.name || '', child?.parent_id);
      if (newlyUnlocked?.length) {
        await saveProgress(updatedProgress);
        setProgress(updatedProgress);
        setAchievement({
          image: newlyUnlocked[0].image,
          title: newlyUnlocked[0].title,
          category: newlyUnlocked[0].category,
          xp: newlyUnlocked[0].xpReward,
        });
      }
    } catch (e) {
      console.warn('practice result handler failed', e);
    }
  };

  const startPracticeListening = async () => {
    if (!selectedWord) return;
    try {
      setPracticeResult(null);
      setPracticeTranscript('');
      setPracticeStatus(
        Platform.OS === 'web' ? 'Ihanda ang microphone para makinig...' : 'Humihingi ng microphone permission...'
      );
      handledTranscriptRef.current = '';

      const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        setPracticeStatus('Hindi available ang speech recognition sa device na ito.');
        Alert.alert(
          'Speech Recognition',
          'Kailangan ng Google Speech Recognition sa Android o supported browser sa web.'
        );
        return;
      }

      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setPracticeStatus('Kailangan natin ng microphone permission para makinig.');
          return;
        }
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'fil-PH',
        interimResults: true,
        continuous: false,
        maxAlternatives: 3,
        contextualStrings: [selectedWord, selectedWord.replace(/-/g, ''), ...DEFAULT_PHONETIC_WORDS],
        ...(Platform.OS === 'android' ? {
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800,
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 700,
            EXTRA_MASK_OFFENSIVE_WORDS: false,
          },
        } : {}),
      });
    } catch (e: any) {
      setPracticeListening(false);
      setPracticeStatus('Hindi nagsimula ang pakikinig. Subukan muli.');
      console.warn('[Practice] speech recognition start failed:', e?.message || e);
    }
  };

  const stopPracticeListening = () => {
    ExpoSpeechRecognitionModule.stop();
    setPracticeStatus('Sinusuri ang bigkas mo...');
  };

  if (loading) return (
    <View style={styles.center}>
      <View style={styles.skeletonCard} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonLineShort} />
      <View style={styles.skeletonGrid}>
        <View style={styles.skeletonBlock} />
        <View style={styles.skeletonBlock} />
      </View>
    </View>
  );

  const levelInfo = getNextLevelInfo(stats.xp, stats.level);

  const renderWordOfDay = () => {
    // Resets every 5 attempts, not at actual midnight - there's no calendar-
    // day boundary tracked yet. A true calendar-day version (reset at real
    // midnight, independent of attempt count) is a separate future task -
    // this is the existing, real mechanic, not a placeholder to fix now.
    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const goalPct = Math.round((goalDone / DAILY_GOAL) * 100);

    // Same all-time-average formula the Progress tab's accuracy ring uses.
    const avgAccuracy = (progress?.total_attempts || 0) > 0
      ? Math.round((progress?.accuracy_sum || 0) / (progress!.total_attempts || 1))
      : null;

    const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;

    // Continue Learning: the same real in-progress-lesson lookup the Learn
    // tab uses - most-recently-opened lesson still marked in_progress.
    const inProgressRows = lessonProgress
      .filter((p) => p.status === 'in_progress')
      .slice()
      .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
    const continueReadingLesson = inProgressRows.length
      ? lessons.find((l) => l.id === inProgressRows[0].lesson_id) || null
      : null;
    // Lessons have no authored sequence/order field, only created_at - this
    // numbers them by creation date (oldest = Lesson 1) as the closest
    // honest proxy for "Lesson X of Y". It's an inferred ordering, not an
    // authored curriculum sequence, so numbering can shift if a teacher
    // later backfills an older lesson.
    const lessonsAscending = lessons.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const continueLessonIndex = continueReadingLesson ? lessonsAscending.findIndex((l) => l.id === continueReadingLesson.id) : -1;
    const continueLessonTotal = lessonsAscending.length;
    const continueLessonPct = continueLessonTotal > 0 && continueLessonIndex >= 0
      ? Math.round(((continueLessonIndex + 1) / continueLessonTotal) * 100)
      : 0;

    // Recent Activity: merges the only two real event types that exist -
    // completed lessons and pronunciation practice sessions. A separate
    // "Reading Practice" aggregate event doesn't exist in the data model
    // (Listen & Read mode saves nothing), so it's deliberately not forced
    // in as a fabricated third category.
    type RecentActivityItem = { key: string; kind: 'lesson' | 'pronunciation'; title: string; detail: string; timestamp: string };
    const lessonActivityItems: RecentActivityItem[] = lessonProgress
      .filter((p) => p.status === 'completed' && !!p.completed_at)
      .map((p) => ({
        key: `lesson-${p.id}`,
        kind: 'lesson' as const,
        title: lessons.find((l) => l.id === p.lesson_id)?.title || 'Aralin',
        detail: 'Nakumpleto na',
        timestamp: p.completed_at as string,
      }));
    const pronunciationActivityItems: RecentActivityItem[] = recentSessions.slice(0, 10).map((s, idx) => ({
      key: `pron-${s.created_at}-${idx}`,
      kind: 'pronunciation' as const,
      title: s.word,
      detail: `${Math.round(s.accuracy_percentage || 0)}% accuracy`,
      timestamp: s.created_at,
    }));
    const recentActivityItems = [...lessonActivityItems, ...pronunciationActivityItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 3);
    const formatActivityTime = (iso: string) => {
      const date = new Date(iso);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return isToday ? `Today ${time}` : `${date.toLocaleDateString()} ${time}`;
    };

    return (
      <>
        <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
          {!!error && (
            <View style={styles.homeErrorBanner}>
              <Text style={styles.homeBannerEmoji}>💛</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.homeErrorText}>{error}</Text>
                <TouchableOpacity style={styles.homeBannerButton} onPress={() => setRetryKey((prev) => prev + 1)}>
                  <Text style={styles.homeBannerButtonText}>Subukan muli</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Hero banner: brand gradient (deep purple -> magenta-purple ->
              deep pink), diagonal top-left to bottom-right, via
              expo-linear-gradient (already installed, not a new library) */}
          <LinearGradient
            colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroBanner}
          >
            <View style={styles.heroTopRow}>
              <TouchableOpacity style={styles.heroLogoRow} onPress={openSidebar}>
                <Ionicons name="menu-outline" size={20} color="#fff" />
                <Ionicons name="book" size={16} color="#fff" />
                <Text style={styles.heroLogoText}>LinawLetra</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.heroBell} onPress={() => setSection('notifications')}>
                <Ionicons name="notifications" size={20} color="#fff" />
                {unreadNotifCount > 0 && (
                  <View style={styles.homeBellBadge}>
                    <Text style={styles.homeBellBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.heroGreeting}>Kumusta,{'\n'}{getFirstName(child?.name || '')}! 👋</Text>
            <Text style={styles.heroSubtitle}>Handa ka na bang matuto ngayon?</Text>
            <Image source={require('../../assets/waving.png')} style={styles.heroImage} resizeMode="contain" />
          </LinearGradient>

          {/* Today's Reading Progress — real daily-goal data (same mechanic as
              the Practice tab's step-dots; resets every 5 attempts, not at
              midnight, since there's no calendar-day tracking yet) */}
          <View style={styles.homeTodayCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.homeTodayTitle}>Today's Reading{'\n'}Progress</Text>
              <Text style={styles.homeTodayStatLine}>{goalDone} of {DAILY_GOAL} pagsasanay ngayon</Text>
              <TouchableOpacity style={styles.homeTodayButton} onPress={() => setSection('practice')}>
                <Text style={styles.homeTodayButtonText}>Continue Practice</Text>
              </TouchableOpacity>
            </View>
            <ProgressRing percent={goalPct} color={HOME_LAVENDER} trackColor="rgba(124,111,207,0.15)">
              <Text style={styles.homeTodayRingPct}>{goalPct}%</Text>
              <Text style={styles.homeTodayRingLabel}>Complete</Text>
            </ProgressRing>
          </View>

          {/* Quick Stats 2x2 grid — Words Practiced, Reading Accuracy,
              Practice Sessions, Current Streak, all real fields */}
          <Text style={styles.practiceSectionTitle}>Quick Stats</Text>
          <View style={styles.homeStatGrid}>
            <View style={[styles.homeGridCard, { backgroundColor: '#E9F1E2' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_GREEN }]}>
                <Ionicons name="book" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_GREEN }]}>{stats.completed}</Text>
              <Text style={styles.homeGridLabel}>Words Practiced</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#FBE7DF' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_ORANGE }]}>
                <Ionicons name="locate" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_ORANGE }]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
              <Text style={styles.homeGridLabel}>Reading Accuracy</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#EFECFB' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_VIOLET }]}>
                <Ionicons name="bar-chart" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_VIOLET }]}>{progress?.total_attempts || 0}</Text>
              <Text style={styles.homeGridLabel}>Practice Sessions</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#FFF3DC' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_AMBER }]}>
                <Ionicons name="flame" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_AMBER }]}>{stats.streak} {stats.streak === 1 ? 'Day' : 'Days'}</Text>
              <Text style={styles.homeGridLabel}>Current Streak</Text>
            </View>
          </View>

          {/* Continue Learning — real in-progress lesson + inferred
              Lesson X of Y (see comment above on continueLessonIndex) */}
          {continueReadingLesson ? (
            <View style={styles.homeContinueCard}>
              <View style={styles.homeContinueImageWrap}>
                <Image source={require('../../assets/reading.png')} style={styles.homeContinueImage} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.homeContinueTitle}>Continue Learning</Text>
                <Text style={styles.homeContinueSubtitle}>{continueReadingLesson.title}</Text>
                <Text style={styles.homeContinueLessonCount}>Lesson {continueLessonIndex + 1} of {continueLessonTotal}</Text>
                <View style={styles.homeContinueTrackRow}>
                  <View style={styles.homeContinueTrack}>
                    <View style={[styles.homeContinueFill, { width: `${Math.max(4, continueLessonPct)}%` }]} />
                  </View>
                  <Text style={styles.homeContinuePct}>{continueLessonPct}%</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.homeContinueButton} onPress={() => setSection('learn')}>
                <Text style={styles.homeContinueButtonText}>Continue</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.homeContinueCard}>
              <View style={styles.homeContinueImageWrap}>
                <Image source={require('../../assets/reading.png')} style={styles.homeContinueImage} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.homeContinueTitle}>Continue Learning</Text>
                <Text style={styles.homeContinueSubtitle}>Wala pang binabasang aralin — simulan ang isa!</Text>
              </View>
              <TouchableOpacity style={styles.homeContinueButton} onPress={() => setSection('learn')}>
                <Text style={styles.homeContinueButtonText}>Simulan</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Word of the Day — kept intact, a real distinct feature the new
              reference layout has no equivalent slot for */}
          {wordOfDay ? (
            <View style={styles.homeHeroCard}>
              <View style={styles.homeHeroTopRow}>
                <View style={styles.homeHeroBadge}>
                  <Text style={styles.homeHeroBadgeText}>📅 SALITA NGAYON</Text>
                </View>
                <View style={styles.homeHeroStreakPill}>
                  <Ionicons name="flame" size={13} color="#fff" />
                  <Text style={styles.homeHeroStreakText}>{stats.streak} {stats.streak === 1 ? 'DAY' : 'DAYS'}</Text>
                </View>
              </View>
              <Text style={styles.homeHeroSub}>Bigkasin ang salitang ito nang tama!</Text>
              <StudentWordOfDay log={wordOfDay} onResult={handleWordOfDayResult} definition={getWordDefinition(wordOfDay.word)} />
            </View>
          ) : (
            <View style={styles.homeHeroCard}>
              <Text style={styles.homeHeroEmptyEmoji}>📅</Text>
              <Text style={styles.homeHeroEmptyText}>Wala pang salita ngayon. Subukan muli mamaya.</Text>
            </View>
          )}

          {/* Ready to Practice? — single consolidated card per reference
              layout, replacing the old two-row Say/Listen mode list */}
          <View style={styles.readyPracticeCard}>
            <View style={styles.readyPracticeIconWrap}>
              <Ionicons name="mic" size={24} color={HOME_LAVENDER_DARK} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.readyPracticeTitle}>Ready to Practice?</Text>
              <Text style={styles.readyPracticeSub}>Magsanay bumasa ng mga salita at mapabuti ang iyong bigkas gamit ang AI feedback.</Text>
            </View>
            <TouchableOpacity style={styles.readyPracticeButton} onPress={() => setSection('practice')}>
              <Text style={styles.readyPracticeButtonText}>Start Practice</Text>
            </TouchableOpacity>
          </View>

          {/* Recent Activity — merged real feed (see recentActivityItems
              comment above): whatever mix of completed lessons and
              pronunciation sessions actually happened, not a fixed layout */}
          <Text style={styles.practiceSectionTitle}>Recent Activity</Text>
          {recentActivityItems.length ? (
            recentActivityItems.map((item) => (
              <View key={item.key} style={styles.homeRecentActivityCard}>
                <View style={[styles.homeRecentActivityIconWrap, { backgroundColor: item.kind === 'lesson' ? '#E9F1E2' : '#EFECFB' }]}>
                  <Ionicons
                    name={item.kind === 'lesson' ? 'checkmark-circle' : 'mic'}
                    size={20}
                    color={item.kind === 'lesson' ? HOME_SAGE : HOME_LAVENDER_DARK}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.homeRecentActivityTitle}>{item.kind === 'lesson' ? 'Lesson Completed' : 'Pronunciation Practice'}</Text>
                  <Text style={styles.homeRecentActivityDetail}>{item.title} • {item.detail}</Text>
                </View>
                <Text style={styles.homeRecentActivityTime}>{formatActivityTime(item.timestamp)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.homeRecentActivityEmpty}>
              <Text style={styles.homeRecentActivityEmptyText}>Wala ka pang aktibidad. Magsimula ng pagsasanay ngayon!</Text>
            </View>
          )}

          {/* Bottom encouragement banner */}
          <View style={styles.homeQuoteBanner}>
            <Text style={styles.homeQuoteText}>"Bawat salitang nababasa mo, lumalakas ka!"</Text>
            <Image source={require('../../assets/thumbsup.png')} style={styles.homeQuoteImage} resizeMode="contain" />
          </View>

          {/* Quick actions */}
          <View style={styles.homeQuickRow}>
            <TouchableOpacity style={[styles.homeQuickCard, { backgroundColor: '#EFECFB' }]} onPress={() => setSection('learn')}>
              <View style={[styles.homeQuickIconWrap, { backgroundColor: HOME_LAVENDER }]}>
                <Ionicons name="library-outline" size={20} color="#fff" />
              </View>
              <Text style={styles.homeQuickLabel}>Learn</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.homeQuickCard, { backgroundColor: '#FBE7DF' }]} onPress={() => setSection('practice')}>
              <View style={[styles.homeQuickIconWrap, { backgroundColor: HOME_CORAL }]}>
                <Ionicons name="mic-outline" size={20} color="#fff" />
              </View>
              <Text style={styles.homeQuickLabel}>Practice</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.homeQuickCard, { backgroundColor: '#E9F1E2' }]} onPress={() => setSection('progress')}>
              <View style={[styles.homeQuickIconWrap, { backgroundColor: HOME_SAGE }]}>
                <Ionicons name="analytics-outline" size={20} color="#fff" />
              </View>
              <Text style={styles.homeQuickLabel}>Progress</Text>
            </TouchableOpacity>
          </View>

          {/* Deadlines widget */}
          <View style={styles.homeDeadlinesCard}>
            <View style={styles.homeDeadlinesHeader}>
              <Text style={styles.homeDeadlinesTitle}>📅 Upcoming Deadlines</Text>
              <TouchableOpacity onPress={() => setSection('learn')}>
                <Text style={styles.homeDeadlinesLink}>View lessons</Text>
              </TouchableOpacity>
            </View>
            {activities.length ? (
              activities.slice(0, 3).map((activity) => (
                <TouchableOpacity
                  key={activity.id}
                  style={styles.homeActivityRow}
                  onPress={() => {
                    setSelectedCalendarDate(getActivityDateKey(activity));
                    setSection('learn');
                  }}
                >
                  <View style={[styles.homeStatusDot, { backgroundColor: getStatusColor(activity.status) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.homeActivityTitle}>{activity.title}</Text>
                    <Text style={styles.homeActivityMeta}>
                      {activity.subject || 'Activity'} • {new Date(activity.deadline).toLocaleDateString()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={HOME_INK_SOFT} />
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.homeDeadlinesEmpty}>
                <Text style={styles.homeDeadlinesEmptyEmoji}>🌱</Text>
                <Text style={styles.homeDeadlinesEmptyText}>
                  Malinis ang schedule mo ngayon. Magpatuloy sa pagsasanay!
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </>
    );
  };

  const renderPractice = () => {
    // Letters (single-character phonics tiles) and words (teacher-uploaded
    // reading_activities content, or the hardcoded starter list, plus the
    // harder SKILL_LONG_WORDS continuation) are two unrelated content types -
    // kept as separate lists so neither's sequential-unlock progress can
    // gate the other (previously concatenated into one array, which made a
    // civics vocabulary word lock every single letter tile behind it).
    const letterWords = SKILL_LETTERS;
    const wordListWords = [
      ...(practiceWords.length ? practiceWords : DEFAULT_PHONETIC_WORDS),
      ...SKILL_LONG_WORDS,
    ];
    const cycleList = (word: string | null) => (word && letterWords.includes(word) ? letterWords : wordListWords);
    const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;

    const startWord = (word: string, mode: 'say' | 'listen') => {
      setPracticeMode(mode);
      setSelectedWord(word);
      setPracticeResult(null);
      setPracticeAttempts(0);
      setPracticeTranscript('');
      setPracticeStatus('Pindutin ang mikropono kapag handa ka na.');
      // "Listen & Read" always speaks - that's the mode's whole purpose.
      // "Say the Word" only auto-speaks on select if Auto Read Words is on.
      if (mode === 'listen' || dashboardSettings?.auto_read_words !== false) {
        speakPracticeWord(word);
      }
    };

    if (selectedWord && child && practiceMode === 'listen') {
      return (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.content}>
            <TouchableOpacity
              onPress={() => {
                stopSpeaking();
                setSelectedWord(null);
              }}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={20} color={HOME_LAVENDER_DARK} />
              <Text style={styles.backText}>Bumalik</Text>
            </TouchableOpacity>

            <View style={styles.practiceHero}>
              <Text style={styles.practicePrompt}>Pakinggan at Basahin</Text>
              <Text style={styles.practiceWordDisplay}>{selectedWord}</Text>
              <Text style={styles.practiceSyllables}>{selectedWord.split('-').join('  •  ')}</Text>
              {!!getWordDefinition(selectedWord) && (
                <View style={styles.wordMeaningBox}>
                  {getWordDefinition(selectedWord)!.is_ambiguous && !!getWordDefinition(selectedWord)!.display_word && (
                    <Text style={styles.wordMeaningAccented}>{getWordDefinition(selectedWord)!.display_word}</Text>
                  )}
                  <Text style={styles.wordMeaningText}>{getWordDefinition(selectedWord)!.meaning_fil}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.sayWordButton, { backgroundColor: HOME_SAGE, shadowColor: HOME_SAGE }]}
                onPress={() => speakPracticeWord(selectedWord)}
              >
                <Ionicons name="volume-high" size={26} color="#fff" />
                <Text style={styles.sayWordButtonText}>Pakinggan</Text>
              </TouchableOpacity>

              <Text style={styles.practiceStatus}>Pakinggan ang salita habang sinusundan mo ito sa mata.</Text>
            </View>

            <TouchableOpacity
              style={styles.listenNextButton}
              onPress={() => {
                const list = cycleList(selectedWord);
                const currentIndex = list.indexOf(selectedWord);
                const next = list[(currentIndex + 1) % list.length];
                startWord(next, 'listen');
              }}
            >
              <Text style={styles.listenNextButtonText}>Susunod na Salita</Text>
              <Ionicons name="arrow-forward" size={16} color={HOME_SAGE} />
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    if (selectedWord && child) {
      return (
        <View style={{ flex: 1 }}>
          <ConfettiOverlay visible={confettiVisible} />
          <ScrollView contentContainerStyle={styles.content}>
            <TouchableOpacity
              onPress={() => {
                ExpoSpeechRecognitionModule.abort();
                setSelectedWord(null);
                setPracticeResult(null);
                setPracticeAttempts(0);
                setPracticeTranscript('');
              }}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={20} color={HOME_LAVENDER_DARK} />
              <Text style={styles.backText}>Bumalik</Text>
            </TouchableOpacity>

            <View style={styles.practiceHero}>
              <Animated.Text style={[styles.practiceMascot, { transform: [{ scale: mascotPulse }] }]}>
                {practiceResult?.correct ? '🌟' : practiceListening ? '🎧' : '😊'}
              </Animated.Text>
              <Text style={styles.practicePrompt}>Sabihin ang Salita</Text>
              <Text style={styles.practiceWordDisplay}>{selectedWord}</Text>
              <Text style={styles.practiceSyllables}>{selectedWord.split('-').join('  •  ')}</Text>
              {!!getWordDefinition(selectedWord) && (
                <View style={styles.wordMeaningBox}>
                  {getWordDefinition(selectedWord)!.is_ambiguous && !!getWordDefinition(selectedWord)!.display_word && (
                    <Text style={styles.wordMeaningAccented}>{getWordDefinition(selectedWord)!.display_word}</Text>
                  )}
                  <Text style={styles.wordMeaningText}>{getWordDefinition(selectedWord)!.meaning_fil}</Text>
                </View>
              )}

              <TouchableOpacity style={styles.listenCoachButton} onPress={() => speakPracticeWord(selectedWord)}>
                <Ionicons name="volume-high-outline" size={18} color={HOME_LAVENDER_DARK} />
                <Text style={styles.listenCoachText}>Pakinggan muna</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sayWordButton, practiceListening && styles.sayWordButtonListening]}
                onPress={practiceListening ? stopPracticeListening : startPracticeListening}
              >
                <Ionicons name={practiceListening ? 'stop-circle-outline' : 'mic-outline'} size={28} color="#fff" />
                <Text style={styles.sayWordButtonText}>{practiceListening ? 'Tapos na' : 'Sabihin ang Salita'}</Text>
              </TouchableOpacity>

              <Text style={styles.practiceStatus}>{practiceStatus}</Text>
              {!!practiceTranscript && (
                <Text style={styles.practiceTranscript}>Narinig ko: "{practiceTranscript}"</Text>
              )}
            </View>

            {practiceResult && (
              <PracticeResultCard
                result={practiceResult}
                word={selectedWord}
                showScore={dashboardSettings?.show_accuracy_score !== false}
                onReplay={() => speakPracticeWord(selectedWord)}
                onRetry={() => {
                  setPracticeResult(null);
                  setPracticeTranscript('');
                  setPracticeStatus('Kaya mo yan. Subukan ulit!');
                }}
                onNext={() => {
                  const list = cycleList(selectedWord);
                  const currentIndex = list.indexOf(selectedWord);
                  const nextWord = list[(currentIndex + 1) % list.length];
                  startWord(nextWord, 'say');
                }}
              />
            )}
          </ScrollView>
        </View>
      );
    }

    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const goalPct = Math.round((goalDone / DAILY_GOAL) * 100);
    const nextWord = wordListWords.find((word) => !progress?.completed_words?.includes(word)) || wordListWords[0];

    const wordsPracticedToday = todaySessions.length;
    const correctToday = todaySessions.filter((s) => s.is_correct).length;
    const accuracyToday = todaySessions.length
      ? Math.round(todaySessions.reduce((sum, s) => sum + (s.accuracy_percentage || 0), 0) / todaySessions.length)
      : 0;
    const practiceSecondsToday = todaySessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    const practiceTimeLabel = practiceSecondsToday < 60
      ? `${practiceSecondsToday}s`
      : `${Math.round(practiceSecondsToday / 60)} min`;

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.homeHeaderRow}>
          <View style={styles.homeHeaderAvatar}>
            <Text style={styles.homeHeaderAvatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.homeGreetingHello}>Practice</Text>
            <Text style={styles.homeGreetingSub}>Magsanay tayong magbasa nang magkasama!</Text>
          </View>
          <TouchableOpacity style={styles.homeBellButton} onPress={() => setSection('notifications')}>
            <Ionicons name="notifications" size={20} color={HOME_LAVENDER_DARK} />
            {unreadNotifCount > 0 && (
              <View style={styles.homeBellBadge}>
                <Text style={styles.homeBellBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalTopRow}>
            <Text style={styles.goalTitle}>Today's Practice</Text>
            {goalDone > 0 ? (
              <Text style={styles.goalCount}>{goalDone}/{DAILY_GOAL}</Text>
            ) : (
              <Text style={styles.goalCountEmpty}>Bagong simula!</Text>
            )}
          </View>
          <View style={styles.goalTrack}>
            <View style={[styles.goalTrackFill, { width: `${Math.max(4, goalPct)}%` }]} />
          </View>
          <Text style={styles.goalEmptyNote}>
            {goalDone === 0 ? 'Simulan ang unang pagsasanay ngayon! 🌱' : '✨ Ang galing! Ipagpatuloy mo!'}
          </Text>
          <View style={styles.rewardRow}>
            <View style={[styles.rewardPill, { backgroundColor: '#FBE7DF' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="star" size={13} color={HOME_CORAL} />
              </View>
              <Text style={[styles.rewardText, { color: HOME_CORAL }]}>
                {stats.xp > 0 ? `${stats.xp} XP` : 'Simulan ang XP mo!'}
              </Text>
            </View>
            <View style={[styles.rewardPill, { backgroundColor: '#FFF3DC' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="flame" size={13} color={HOME_SUN} />
              </View>
              <Text style={[styles.rewardText, { color: HOME_SUN }]}>
                {stats.streak > 0 ? `${stats.streak} streak` : 'Simulan ang streak!'}
              </Text>
            </View>
            <View style={[styles.rewardPill, { backgroundColor: '#EFECFB' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="ribbon" size={13} color={HOME_LAVENDER_DARK} />
              </View>
              <Text style={[styles.rewardText, { color: HOME_LAVENDER_DARK }]}>
                {(progress?.achievements?.length || 0) > 0 ? `${progress?.achievements?.length} badges` : 'Kumuha ng unang badge!'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.practiceSectionTitle}>Piliin ang Iyong Pagsasanay</Text>

        <TouchableOpacity style={styles.practiceModeCard} onPress={() => startWord(nextWord, 'say')}>
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="mic" size={24} color={HOME_LAVENDER_DARK} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.practiceModeTitle}>Sabihin ang Salita</Text>
            <Text style={styles.practiceModeSub}>Pakinggan ang salita, pagkatapos sabihin ito nang malakas.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#EFECFB' }]}>
              <Text style={[styles.practiceModeTagText, { color: HOME_LAVENDER_DARK }]}>AI Pronunciation Practice</Text>
            </View>
          </View>
          <View style={styles.practiceModeStartPill}>
            <Text style={styles.practiceModeStartText}>Simulan</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.practiceModeCard} onPress={() => startWord(nextWord, 'listen')}>
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="volume-high" size={24} color={HOME_SAGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.practiceModeTitle}>Pakinggan at Basahin</Text>
            <Text style={styles.practiceModeSub}>Pakinggan ang salita at sundan ito habang binabasa.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#E9F1E2' }]}>
              <Text style={[styles.practiceModeTagText, { color: HOME_SAGE }]}>Text-to-Speech Support</Text>
            </View>
          </View>
          <View style={[styles.practiceModeStartPill, { backgroundColor: HOME_SAGE }]}>
            <Text style={styles.practiceModeStartText}>Simulan</Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.practiceModeCard, styles.practiceModeCardDisabled]}>
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="book" size={24} color={HOME_SUN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.practiceModeTitle}>Basahin nang Malakas</Text>
            <Text style={styles.practiceModeSub}>Magsanay bumasa ng mga pangungusap nang malakas.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#FFF3DC' }]}>
              <Text style={[styles.practiceModeTagText, { color: HOME_SUN }]}>Sa Madaling Panahon</Text>
            </View>
          </View>
        </View>

        <Text style={styles.practiceSectionTitle}>O Pumili ng Partikular na Salita</Text>

        <View style={styles.wordGrid}>
          {wordListWords.map((word, wordIndex) => {
            const done = progress?.completed_words?.includes(word);
            const isNext = !done && word === nextWord;
            const locked = !done && !isNext && wordIndex > wordListWords.indexOf(nextWord);
            return (
              <TouchableOpacity
                key={word}
                style={[styles.wordCard, done && styles.wordCardDone, isNext && styles.wordCardNext, locked && styles.wordCardLocked]}
                onPress={() => {
                  if (locked) {
                    Alert.alert('Tapusin muna', 'Tapusin muna ang kasalukuyang salita bago pumunta sa susunod na salita.');
                    return;
                  }
                  startWord(word, 'say');
                }}
              >
                {done && (
                  <View style={styles.wordCardCheckBadge}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                )}
                {isNext && (
                  <View style={styles.wordCardNextBadge}>
                    <Text style={styles.wordCardNextBadgeText}>SUSUNOD</Text>
                  </View>
                )}
                {locked && (
                  <View style={styles.wordCardLockIcon}>
                    <Ionicons name="lock-closed" size={12} color={HOME_INK_SOFT} />
                  </View>
                )}
                <Text style={[styles.wordText, done && { color: SUCCESS }, locked && { color: HOME_INK_SOFT }]}>{word}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Letters are a separate, non-linear practice bank - freely
            tappable in any order, no sequential lock (unlike the words
            grid above, which intentionally gates ahead-of-progress words). */}
        <Text style={styles.practiceSectionTitle}>Mga Titik</Text>

        <View style={styles.wordGrid}>
          {letterWords.map((letter) => {
            const done = progress?.completed_words?.includes(letter);
            return (
              <TouchableOpacity
                key={letter}
                style={[styles.wordCard, done && styles.wordCardDone]}
                onPress={() => startWord(letter, 'say')}
              >
                {done && (
                  <View style={styles.wordCardCheckBadge}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                )}
                <Text style={[styles.wordText, done && { color: SUCCESS }]}>{letter}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.practiceStatsCard}>
          <Text style={styles.practiceSectionTitle}>Practice Session</Text>
          <View style={styles.practiceStatsRow}>
            <View style={styles.practiceStatsCol}>
              <Ionicons name="bar-chart" size={20} color={HOME_LAVENDER_DARK} />
              <Text style={styles.practiceStatsValue}>{wordsPracticedToday}</Text>
              <Text style={styles.practiceStatsLabel}>Words Practiced</Text>
            </View>
            <View style={styles.practiceStatsCol}>
              <Ionicons name="checkmark-circle" size={20} color={SUCCESS} />
              <Text style={styles.practiceStatsValue}>{correctToday}</Text>
              <Text style={styles.practiceStatsLabel}>Correct</Text>
            </View>
            <View style={styles.practiceStatsCol}>
              <Ionicons name="locate" size={20} color={HOME_CORAL} />
              <Text style={styles.practiceStatsValue}>{accuracyToday}%</Text>
              <Text style={styles.practiceStatsLabel}>Accuracy</Text>
            </View>
            <View style={styles.practiceStatsCol}>
              <Ionicons name="time" size={20} color={HOME_SUN} />
              <Text style={styles.practiceStatsValue}>{practiceTimeLabel}</Text>
              <Text style={styles.practiceStatsLabel}>Practice Time</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderActivities = () => {
    const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;

    const lessonSubjects = Array.from(new Set(lessons.map((l) => l.subject).filter(Boolean))) as string[];

    const filteredLessons = lessonFilter === 'Lahat' ? lessons : lessons.filter((l) => l.subject === lessonFilter);

    const inProgressRows = lessonProgress
      .filter((p) => p.status === 'in_progress')
      .slice()
      .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
    const continueReadingLesson = inProgressRows.length
      ? lessons.find((l) => l.id === inProgressRows[0].lesson_id) || null
      : null;

    const lessonStateColor = (state: 'not_started' | 'in_progress' | 'completed') =>
      state === 'completed' ? SUCCESS : state === 'in_progress' ? WARNING : HOME_INK_SOFT;
    const lessonStateLabel = (state: 'not_started' | 'in_progress' | 'completed') =>
      state === 'completed' ? 'Nabasa na' : state === 'in_progress' ? 'Binabasa' : 'Hindi pa binuksan';

    const levelNextThreshold = progress?.level === 'Advanced' ? null : progress?.level === 'Intermediate' ? 250 : 100;
    const journeyPct = levelNextThreshold
      ? Math.min(100, Math.round(((progress?.xp || 0) / levelNextThreshold) * 100))
      : 100;

    return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.homeHeaderRow}>
        <View style={styles.homeHeaderAvatar}>
          <Text style={styles.homeHeaderAvatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.homeGreetingHello}>Learn</Text>
          <Text style={styles.homeGreetingSub}>Galugarin ang iyong mga aralin at pagsasanay</Text>
        </View>
        <TouchableOpacity style={styles.homeBellButton} onPress={() => setSection('notifications')}>
          <Ionicons name="notifications" size={20} color={HOME_LAVENDER_DARK} />
          {unreadNotifCount > 0 && (
            <View style={styles.homeBellBadge}>
              <Text style={styles.homeBellBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#EFECFB' }]}>
          <Ionicons name="library" size={16} color={HOME_LAVENDER_DARK} />
          <Text style={[styles.learnBadgeText, { color: HOME_LAVENDER_DARK }]}>LEARN</Text>
        </View>
        <Text style={styles.learnSectionSubtitle}>Mga takdang-aralin mula sa iyong guro</Text>
      </View>

      {activitiesLoading ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="small" color={HOME_LAVENDER} />
          <Text style={styles.empty}>Loading activities...</Text>
        </View>
      ) : activitiesError ? (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{activitiesError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={retryActivities}>
            <Text style={styles.retryButtonText}>Subukan muli</Text>
          </TouchableOpacity>
        </View>
      ) : activities.length ? (
        <View style={styles.learnCardList}>
          {activities.map((activity) => (
            <View key={activity.id} style={styles.learnActivityCard}>
              <View style={[styles.learnIconWrap, { backgroundColor: '#EFECFB' }]}>
                <Ionicons name="clipboard" size={22} color={HOME_LAVENDER_DARK} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.learnItemTitle}>{activity.title}</Text>
                <View style={styles.learnItemMetaRow}>
                  <View style={[styles.learnStatusDot, { backgroundColor: getStatusColor(activity.status) }]} />
                  <Text style={styles.learnItemMeta}>
                    {activity.subject || 'Activity'} • Due {new Date(activity.deadline).toLocaleDateString()}
                  </Text>
                </View>
                {!!activity.description && <Text style={styles.learnItemDescription}>{activity.description}</Text>}
              </View>
              {activity.status === 'completed' || activity.status === 'completed_late' ? (
                <Text style={[styles.learnStatusBadge, { color: getStatusColor(activity.status) }]}>{getStatusLabel(activity.status)}</Text>
              ) : (
                <TouchableOpacity style={styles.learnActionButton} onPress={() => void completeActivity(activity)}>
                  <Text style={styles.learnActionButtonText}>Turn In</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC' }]}>
          <View style={[styles.learnEmptyIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="clipboard-outline" size={40} color={HOME_LAVENDER_DARK} />
          </View>
          <Text style={styles.learnEmptyTitle}>Wala ka pang assignment ngayon</Text>
          <Text style={styles.learnEmptySubtext}>Hihintayin natin ang unang takdang-aralin mula sa guro mo! 📝</Text>
        </View>
      )}

      {continueReadingLesson && (
        <View style={styles.learnContinueCard}>
          <View style={styles.learnContinuePill}>
            <Text style={styles.learnContinuePillText}>IPAGPATULOY ANG PAGBASA</Text>
          </View>
          <Text style={styles.learnContinueTitle}>{continueReadingLesson.title}</Text>
          {!!continueReadingLesson.description && (
            <Text style={styles.learnContinueSub}>{continueReadingLesson.description}</Text>
          )}
          <TouchableOpacity style={styles.learnContinueButton} onPress={() => openLesson(continueReadingLesson)}>
            <Text style={styles.learnContinueButtonText}>Ipagpatuloy ang Pagbasa</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#E9F1E2' }]}>
          <Ionicons name="book" size={16} color={HOME_SAGE} />
          <Text style={[styles.learnBadgeText, { color: HOME_SAGE }]}>PDF LESSONS</Text>
        </View>
        <Text style={styles.learnSectionSubtitle}>Mga babasahin at aralin para sa iyo</Text>
      </View>

      {lessonSubjects.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.learnFilterRow}
          contentContainerStyle={{ gap: 8 }}
        >
          {['Lahat', ...lessonSubjects].map((subj) => (
            <TouchableOpacity
              key={subj}
              style={[styles.learnFilterChip, lessonFilter === subj && styles.learnFilterChipActive]}
              onPress={() => setLessonFilter(subj)}
            >
              <Text style={[styles.learnFilterChipText, lessonFilter === subj && styles.learnFilterChipTextActive]}>
                {subj}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {lessonsLoading && (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="small" color={HOME_SAGE} />
          <Text style={styles.empty}>Loading lessons...</Text>
        </View>
      )}
      {!lessonsLoading && !!lessonsError && (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{lessonsError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={retryLessons}>
            <Text style={styles.retryButtonText}>Subukan muli</Text>
          </TouchableOpacity>
        </View>
      )}
      {!lessonsLoading && !lessonsError && filteredLessons.length ? (
        <View style={styles.learnCardList}>
          {filteredLessons.map((lesson) => {
            const state = getLessonState(lesson.id);
            return (
              <View key={lesson.id} style={styles.learnLessonCard}>
                <View style={[styles.learnIconWrap, { backgroundColor: '#E9F1E2' }]}>
                  <Ionicons name="document-text" size={22} color={HOME_SAGE} />
                </View>
                <View style={styles.uploadBody}>
                  <Text style={styles.learnItemTitle}>{lesson.title}</Text>
                  <View style={styles.learnItemMetaRow}>
                    <View style={[styles.learnStatusDot, { backgroundColor: lessonStateColor(state) }]} />
                    <Text style={styles.learnItemMeta}>
                      {lesson.subject || 'Lesson'} • {lessonStateLabel(state)}
                    </Text>
                  </View>
                  {!!lesson.description && <Text style={styles.learnItemDescription}>{lesson.description}</Text>}
                </View>
                {state === 'completed' ? (
                  <Text style={[styles.learnStatusBadge, { color: SUCCESS }]}>Tapos na ✓</Text>
                ) : state === 'in_progress' ? (
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <TouchableOpacity style={[styles.learnActionButton, { backgroundColor: HOME_SAGE }]} onPress={() => openLesson(lesson)}>
                      <Text style={styles.learnActionButtonText}>Ipagpatuloy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => void finishLesson(lesson)}>
                      <Text style={styles.learnMarkDoneText}>Tapos na</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={[styles.learnActionButton, { backgroundColor: HOME_SAGE }]} onPress={() => openLesson(lesson)}>
                    <Text style={styles.learnActionButtonText}>Buksan</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      {!lessonsLoading && !lessonsError && !filteredLessons.length && (
        <View style={[styles.learnEmptyCard, { backgroundColor: '#F1F6ED' }]}>
          <View style={[styles.learnEmptyIconWrap, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="book-outline" size={40} color={HOME_SAGE} />
          </View>
          <Text style={styles.learnEmptyTitle}>Wala pang lessons dito</Text>
          <Text style={styles.learnEmptySubtext}>Kapag nag-upload na ang guro mo, makikita mo agad ito rito! 📚</Text>
        </View>
      )}

      {!!uploadsError && (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{uploadsError}</Text>
        </View>
      )}
      {!lessons.length && uploads.length > 0 && (
        <View style={styles.learnCardList}>
          {uploads.map((upload) => {
            const name = upload.metadata?.title || upload.path.split('/').pop() || 'Aralin';
            return (
              <View key={upload.id} style={styles.learnLessonCard}>
                <View style={[styles.learnIconWrap, { backgroundColor: '#E9F1E2' }]}>
                  <Ionicons name={iconForUpload(upload.content_type)} size={22} color={HOME_SAGE} />
                </View>
                <View style={styles.uploadBody}>
                  <Text style={styles.learnItemTitle}>{name}</Text>
                  <Text style={styles.learnItemMeta}>{new Date(upload.created_at).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity style={[styles.learnActionButton, { backgroundColor: HOME_SAGE }]} onPress={() => openUpload(upload)}>
                  <Text style={styles.learnActionButtonText}>Buksan</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.learnJourneyCard}>
        <Text style={styles.learnJourneyTitle}>Iyong Paglalakbay sa Pagbasa</Text>
        <Text style={styles.learnJourneyLevel}>{progress?.level || 'Beginner'}</Text>
        <View style={styles.learnJourneyTrack}>
          <View style={[styles.learnJourneyFill, { width: `${Math.max(4, journeyPct)}%` }]} />
        </View>
        <Text style={styles.learnJourneyMsg}>
          {levelNextThreshold
            ? `${Math.max(0, levelNextThreshold - (progress?.xp || 0))} XP na lang papunta sa susunod na level!`
            : 'Dalubhasa ka na sa pagbasa! 🎉'}
        </Text>
      </View>
    </ScrollView>
    );
  };

  const renderCalendar = () => {
    const selectedActivities = getActivitiesForDate(selectedCalendarDate);
    const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const upcomingCount = activities.filter((activity) => activity.status === 'pending').length;
    const overdueCount = activities.filter((activity) => activity.status === 'overdue').length;

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.calendarHeader}>
          <View>
            <Text style={styles.sectionTitle}>Activity Calendar</Text>
            <Text style={styles.sectionSubtitle}>{upcomingCount} pending • {overdueCount} overdue</Text>
          </View>
          <View style={styles.calendarHeaderActions}>
            <TouchableOpacity style={styles.monthButton} onPress={() => shiftCalendarMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color={PRIMARY} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.monthButton} onPress={() => shiftCalendarMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color={PRIMARY} />
            </TouchableOpacity>
          </View>
        </View>

        {!!activitiesError && (
          <View style={styles.errorBlock}>
            <Text style={styles.error}>{activitiesError}</Text>
          </View>
        )}

        <View style={styles.calendarCard}>
          <Text style={styles.calendarMonth}>{monthLabel}</Text>
          <View style={styles.weekHeader}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <Text key={day} style={styles.weekHeaderText}>{day}</Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {getCalendarDays().map((cell) => {
              if (!cell.date) return <View key={cell.key} style={styles.dayCell} />;
              const key = cell.date.toISOString().slice(0, 10);
              const dayActivities = getActivitiesForDate(key);
              const selected = key === selectedCalendarDate;
              const hasOverdue = dayActivities.some((activity) => activity.status === 'overdue');
              const hasCompleted = dayActivities.some((activity) => activity.status === 'completed' || activity.status === 'completed_late');
              return (
                <TouchableOpacity
                  key={cell.key}
                  style={[styles.dayCell, selected && styles.dayCellSelected]}
                  onPress={() => setSelectedCalendarDate(key)}
                >
                  <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{cell.date.getDate()}</Text>
                  {!!dayActivities.length && (
                    <View style={styles.dayDots}>
                      <View style={[styles.dayDot, { backgroundColor: hasOverdue ? DANGER : hasCompleted ? SUCCESS : WARNING }]} />
                      {dayActivities.length > 1 && <Text style={styles.dayCount}>{dayActivities.length}</Text>}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.selectedTasksCard}>
          <Text style={styles.selectedTasksTitle}>
            {new Date(selectedCalendarDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
          </Text>
          {selectedActivities.length ? (
            selectedActivities.map((activity) => (
              <View key={activity.id} style={styles.activityTaskRow}>
                <View style={[styles.statusStrip, { backgroundColor: getStatusColor(activity.status) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTaskTitle}>{activity.title}</Text>
                  <Text style={styles.activityTaskMeta}>
                    {activity.subject || 'Activity'} • {new Date(activity.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {!!activity.description && <Text style={styles.activityTaskDescription}>{activity.description}</Text>}
                </View>
                <Text style={[styles.statusBadge, { color: getStatusColor(activity.status) }]}>{getStatusLabel(activity.status)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.empty}>Walang activity sa araw na ito.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderProgress = () => {
    const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;
    const avgAccuracy = (progress?.total_attempts || 0) > 0
      ? Math.round((progress?.accuracy_sum || 0) / (progress!.total_attempts || 1))
      : null;
    const tierColor = (pct: number) => (pct >= 80 ? SUCCESS : pct >= 60 ? WARNING : DANGER);
    const tierMessage = (pct: number) =>
      pct >= 80 ? "You're making great progress!" : pct >= 60 ? 'Sige lang, umaangat ka!' : 'Ipagpatuloy ang pagsasanay!';
    const maxBarHeight = 90;
    const completedWords = progress?.completed_words || [];
    const lessonsCompletedCount = lessonProgress.filter((p) => p.status === 'completed').length;

    // Weekly accuracy trend — real sessions grouped by calendar day (last 7 days)
    const dayLabels = ['Lin', 'Lun', 'Mar', 'Miy', 'Huw', 'Biy', 'Sab'];
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      return d;
    });
    const weeklyTrend = last7Days.map((day) => {
      const dayKey = day.toISOString().slice(0, 10);
      const daySessions = recentSessions.filter((s) => (s.created_at || '').slice(0, 10) === dayKey);
      const avg = daySessions.length
        ? Math.round(daySessions.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / daySessions.length)
        : null;
      return { label: dayLabels[day.getDay()], pct: avg };
    });
    const daysWithData = weeklyTrend.filter((d) => d.pct !== null);
    const trendImproving = daysWithData.length >= 2 && (daysWithData[daysWithData.length - 1].pct || 0) >= (daysWithData[0].pct || 0);

    // My Reading Skills — real categories derived from actual word shape
    // (see categorizeWord), scored from actual pronunciation session rows
    const skillGroups: Record<SkillCategory, { count: number; sum: number }> = {
      letters: { count: 0, sum: 0 },
      syllables: { count: 0, sum: 0 },
      words: { count: 0, sum: 0 },
    };
    recentSessions.forEach((s) => {
      const cat = categorizeWord(s.word);
      skillGroups[cat].count += 1;
      skillGroups[cat].sum += Number(s.accuracy_percentage) || 0;
    });
    const skillMeta: { key: SkillCategory; label: string; icon: string }[] = [
      { key: 'letters', label: 'Letter Recognition', icon: 'text' },
      { key: 'syllables', label: 'Syllable Reading', icon: 'reader' },
      { key: 'words', label: 'Word Reading', icon: 'book' },
    ];
    const skillTag = (avg: number | null) =>
      avg === null
        ? { label: 'Wala Pang Sinubukan', color: HOME_INK_SOFT }
        : avg >= 80
        ? { label: 'Strong', color: SUCCESS }
        : avg >= 60
        ? { label: 'Improving', color: WARNING }
        : { label: 'Keep Practicing', color: DANGER };

    // Days practiced this month — real, from distinct session dates
    const monthKey = new Date().toISOString().slice(0, 7);
    const daysPracticedThisMonth = new Set(
      recentSessions.filter((s) => (s.created_at || '').slice(0, 7) === monthKey).map((s) => s.created_at.slice(0, 10))
    ).size;

    const recentActivity = recentSessions.slice(0, 2);
    const relativeDay = (iso: string) => {
      const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      if (days <= 0) return 'Ngayon';
      if (days === 1) return 'Kahapon';
      return `${days} araw na ang nakalipas`;
    };

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.homeHeaderRow}>
          <View style={styles.homeHeaderAvatar}>
            <Text style={styles.homeHeaderAvatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.homeGreetingHello}>My Progress</Text>
            <Text style={styles.homeGreetingSub}>Tingnan kung gaano ka na umunlad!</Text>
          </View>
          <TouchableOpacity style={styles.homeBellButton} onPress={() => setSection('notifications')}>
            <Ionicons name="notifications" size={20} color={HOME_LAVENDER_DARK} />
            {unreadNotifCount > 0 && (
              <View style={styles.homeBellBadge}>
                <Text style={styles.homeBellBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.progressHeroCard}>
          <Text style={styles.progressHeroTitle}>Kabuuang Progreso sa Pagbasa</Text>
          <View style={{ alignItems: 'center', marginVertical: 14 }}>
            <ProgressRing percent={avgAccuracy ?? 0} color={HOME_LAVENDER_DARK} trackColor="rgba(124,111,207,0.15)">
              <Text style={styles.progressHeroRingPct}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
            </ProgressRing>
          </View>
          <Text style={styles.progressHeroLabel}>Average Reading Accuracy</Text>
          {avgAccuracy !== null ? (
            <View style={styles.progressHeroStatusPill}>
              <Ionicons name="checkmark-circle" size={14} color={tierColor(avgAccuracy)} />
              <Text style={[styles.progressHeroStatusText, { color: tierColor(avgAccuracy) }]}>{tierMessage(avgAccuracy)}</Text>
            </View>
          ) : (
            <Text style={styles.progressHeroEmptyText}>Magsanay para makita ang iyong progress dito!</Text>
          )}
        </View>

        <Text style={styles.practiceSectionTitle}>Quick Progress Stats</Text>
        <View style={styles.progressStatsGrid}>
          <View style={[styles.progressStatCard, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="book" size={22} color={HOME_SAGE} />
            <Text style={[styles.progressStatValue, { color: HOME_SAGE }]}>{stats.completed}</Text>
            <Text style={styles.progressStatLabel}>Words Practiced</Text>
          </View>
          <View style={[styles.progressStatCard, { backgroundColor: '#FBE7DF' }]}>
            <Ionicons name="locate" size={22} color={HOME_CORAL} />
            <Text style={[styles.progressStatValue, { color: HOME_CORAL }]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
            <Text style={styles.progressStatLabel}>Reading Accuracy</Text>
          </View>
          <View style={[styles.progressStatCard, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="school" size={22} color={HOME_LAVENDER_DARK} />
            <Text style={[styles.progressStatValue, { color: HOME_LAVENDER_DARK }]}>{lessonsCompletedCount}</Text>
            <Text style={styles.progressStatLabel}>Lessons Completed</Text>
          </View>
          <View style={[styles.progressStatCard, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="mic" size={22} color={HOME_SUN} />
            <Text style={[styles.progressStatValue, { color: HOME_SUN }]}>{progress?.total_attempts || 0}</Text>
            <Text style={styles.progressStatLabel}>Practice Sessions</Text>
          </View>
        </View>

        {/* Weekly accuracy trend — real sessions grouped by day */}
        <View style={styles.progressChartCard}>
          <View style={styles.progressChartHeader}>
            <Text style={styles.progressChartTitle}>Reading Accuracy</Text>
          </View>
          {daysWithData.length >= 2 ? (
            <>
              <View style={styles.progressChartBars}>
                {weeklyTrend.map((day, i) => {
                  const color = day.pct !== null ? tierColor(day.pct) : 'rgba(124,111,207,0.12)';
                  return (
                    <View key={i} style={styles.progressChartBarCol}>
                      {day.pct !== null && <Text style={[styles.progressChartBarValue, { color }]}>{day.pct}%</Text>}
                      <View
                        style={[
                          styles.progressChartBar,
                          { height: day.pct !== null ? Math.max(6, Math.round((day.pct / 100) * maxBarHeight)) : 6, backgroundColor: color },
                        ]}
                        accessible
                        accessibilityLabel={day.pct !== null ? `${day.label}: ${day.pct}%` : `${day.label}: walang datos`}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.progressChartDayRow}>
                {weeklyTrend.map((day, i) => (
                  <Text key={i} style={styles.progressChartDayLabel}>{day.label}</Text>
                ))}
              </View>
              <View style={styles.progressChartLegend}>
                <View style={styles.progressLegendItem}>
                  <View style={[styles.progressLegendDot, { backgroundColor: SUCCESS }]} />
                  <Text style={styles.progressLegendText}>Magaling (80%+)</Text>
                </View>
                <View style={styles.progressLegendItem}>
                  <View style={[styles.progressLegendDot, { backgroundColor: WARNING }]} />
                  <Text style={styles.progressLegendText}>Sige lang (60-79%)</Text>
                </View>
                <View style={styles.progressLegendItem}>
                  <View style={[styles.progressLegendDot, { backgroundColor: DANGER }]} />
                  <Text style={styles.progressLegendText}>Mas mababa sa 60%</Text>
                </View>
              </View>
              <View style={styles.progressTrendMsgRow}>
                <Ionicons name="checkmark-circle" size={14} color={SUCCESS} />
                <Text style={styles.progressTrendMsgText}>
                  {trendImproving ? 'Your accuracy is improving!' : 'Magpatuloy sa pagsasanay!'}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.progressChartEmpty}>
              <Ionicons name="analytics-outline" size={32} color={HOME_LAVENDER} />
              <Text style={styles.progressChartEmptyText}>
                Magsanay pa ng ilang beses para makita ang iyong progress chart dito!
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.practiceSectionTitle}>My Reading Skills</Text>
        <View style={styles.skillsCard}>
          {skillMeta.map(({ key, label, icon }, idx) => {
            const group = skillGroups[key];
            const avg = group.count > 0 ? Math.round(group.sum / group.count) : null;
            const tag = skillTag(avg);
            return (
              <View key={key} style={[styles.skillRow, idx === skillMeta.length - 1 && { marginBottom: 0 }]}>
                <View style={[styles.skillIconWrap, { backgroundColor: `${tag.color}22` }]}>
                  <Ionicons name={icon as any} size={18} color={tag.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.skillTopRow}>
                    <Text style={styles.skillLabel}>{label}</Text>
                    <View style={[styles.skillTagPill, { backgroundColor: `${tag.color}22` }]}>
                      <Text style={[styles.skillTagText, { color: tag.color }]}>{tag.label}</Text>
                    </View>
                  </View>
                  <View style={styles.skillTrackRow}>
                    <View style={styles.skillTrack}>
                      <View style={[styles.skillTrackFill, { width: `${avg ? Math.max(4, avg) : 0}%`, backgroundColor: tag.color }]} />
                    </View>
                    <Text style={styles.skillPct}>{avg !== null ? `${avg}%` : '—'}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.practiceSectionTitle}>Recent Activity</Text>
        {recentActivity.length ? (
          <View style={styles.learnCardList}>
            {recentActivity.map((session, i) => (
              <View key={`${session.created_at}-${i}`} style={styles.recentActivityCard}>
                <View style={[styles.learnIconWrap, { backgroundColor: '#EFECFB' }]}>
                  <Ionicons name="mic" size={20} color={HOME_LAVENDER_DARK} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.learnItemTitle}>Tagalog Word Practice</Text>
                  <Text style={styles.learnItemMeta}>{session.word} • {relativeDay(session.created_at)}</Text>
                </View>
                <Text style={[styles.recentActivityScore, { color: tierColor(Math.round(Number(session.accuracy_percentage) || 0)) }]}>
                  {Math.round(Number(session.accuracy_percentage) || 0)}%
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC', marginBottom: 20 }]}>
            <Text style={styles.learnEmptySubtext}>Wala ka pang practice session. Simulan na sa Practice tab!</Text>
          </View>
        )}

        <View style={styles.progressMonthBanner}>
          <Ionicons name="calendar" size={22} color={HOME_LAVENDER_DARK} />
          <View style={{ flex: 1 }}>
            <Text style={styles.progressMonthTitle}>
              {daysPracticedThisMonth > 0 ? "You're Improving!" : 'Simulan ang Buwan na Ito!'}
            </Text>
            <Text style={styles.progressMonthSub}>
              {daysPracticedThisMonth > 0
                ? `You've practiced ${daysPracticedThisMonth} day${daysPracticedThisMonth === 1 ? '' : 's'} this month. Keep reading and growing!`
                : 'Simulan ang iyong unang pagsasanay ngayong buwan!'}
            </Text>
          </View>
        </View>

        <View style={styles.progressWordsCard}>
          <Text style={styles.progressWordsTitle}>Mga Salitang Natapos</Text>
          {completedWords.length ? (
            <View style={styles.progressWordsWrap}>
              {completedWords.slice(0, 8).map((w) => (
                <View key={w} style={styles.progressWordChip}>
                  <Text style={styles.progressWordChipText}>{w}</Text>
                </View>
              ))}
              {completedWords.length > 8 && (
                <Text style={styles.progressWordsMore}>+{completedWords.length - 8} pa</Text>
              )}
            </View>
          ) : (
            <Text style={styles.progressWordsEmpty}>Wala ka pang natatapos na salita. Simulan na sa Practice tab!</Text>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderAchievements = () => {
    const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;
    const unlockedIds = new Set((progress?.achievements || []).map((a) => a.id));
    const unlockedCount = unlockedIds.size;
    const totalCount = ACHIEVEMENTS.length;
    const unlockPct = Math.round((unlockedCount / totalCount) * 100);
    const avgAcc = progress ? averageAccuracy(progress) : 0;

    type BadgeProgress = { hasFraction: boolean; current?: number; target?: number; pct?: number };
    const frac = (current: number, target: number): BadgeProgress => ({
      hasFraction: true,
      current: Math.max(0, Math.min(current, target)),
      target,
      pct: Math.max(0, Math.min(100, Math.round((current / target) * 100))),
    });
    const noFraction: BadgeProgress = { hasFraction: false };

    const getBadgeProgress = (badge: AchievementDefinition): BadgeProgress => {
      switch (badge.id) {
        case 'unang_hakbang': return frac(progress?.activities_completed || 0, 1);
        case 'batang_mambabasa': return frac(progress?.activities_completed || 0, 5);
        case 'masigasig_na_mambabasa': return frac(progress?.activities_completed || 0, 10);
        case 'kampeon_sa_pagbasa': return frac(progress?.activities_completed || 0, 25);
        case 'dalubhasa_sa_pagbasa': return frac(progress?.activities_completed || 0, 50);
        case 'unang_bigkas': return frac(progress?.total_attempts || 0, 1);
        case 'boses_ng_tagumpay': return frac(progress?.total_attempts || 0, 25);
        case 'bigkas_champion': {
          const attempts = progress?.total_attempts || 0;
          if (attempts < MIN_ATTEMPTS_FOR_AVERAGE_BADGE) return frac(attempts, MIN_ATTEMPTS_FOR_AVERAGE_BADGE);
          return frac(Math.round(avgAcc), 90);
        }
        case 'malinaw_magsalita': return pronunciationStats ? frac(Math.round(pronunciationStats.maxSingleAccuracy), 90) : noFraction;
        case 'tamang_bigkas': return pronunciationStats ? frac(pronunciationStats.perfectWordCount, 5) : noFraction;
        case 'lakas_ng_loob': return pronunciationStats ? frac(pronunciationStats.challengingWordsMastered, CHALLENGING_WORDS_REQUIRED) : noFraction;
        case 'tuloy_tuloy': return frac(progress?.streak || 0, 3);
        case 'lingguhang_bayani': return frac(progress?.streak || 0, 7);
        case 'buwan_ng_pagsisikap': return frac(progress?.streak || 0, 30);
        case 'matalinong_mag_aaral':
          if (progress?.baseline_accuracy == null) return noFraction;
          return frac(Math.max(0, Math.round(avgAcc - progress.baseline_accuracy)), IMPROVEMENT_POINTS_REQUIRED);
        case 'alamat_ng_pagbasa': return frac(unlockedIds.size, totalCount - 1);
        default: return noFraction;
      }
    };

    const metaBadges = ACHIEVEMENTS.filter((b) => b.category === 'meta');
    const filteredBadges = ACHIEVEMENTS.filter((b) => b.category !== 'meta' && (badgeFilter === 'all' || b.category === badgeFilter));
    const unlockedBadges = filteredBadges.filter((b) => unlockedIds.has(b.id));
    const lockedBadges = filteredBadges.filter((b) => !unlockedIds.has(b.id));

    const spotlightCandidates = ACHIEVEMENTS.filter((b) => !unlockedIds.has(b.id))
      .map((b) => ({ badge: b, progress: getBadgeProgress(b) }))
      .filter((c) => c.progress.hasFraction && (c.progress.pct || 0) < 100)
      .sort((a, b) => (b.progress.pct || 0) - (a.progress.pct || 0));
    const spotlight = spotlightCandidates[0];

    const filterTabs: { key: 'all' | AchievementCategory; label: string }[] = [
      { key: 'all', label: 'All' },
      { key: 'reading', label: 'Reading' },
      { key: 'practice', label: 'Practice' },
      { key: 'progress', label: 'Progress' },
      { key: 'consistency', label: 'Consistency' },
    ];

    const renderBadgeCard = (badge: AchievementDefinition) => {
      const record = progress?.achievements?.find((a) => a.id === badge.id);
      const unlocked = !!record;
      const expanded = expandedBadgeId === badge.id;
      const bp = !unlocked ? getBadgeProgress(badge) : null;
      return (
        <TouchableOpacity
          key={badge.id}
          style={[styles.badgeCard, !unlocked && styles.badgeCardLocked]}
          activeOpacity={0.8}
          onPress={() => setExpandedBadgeId((prev) => (prev === badge.id ? null : badge.id))}
        >
          {!unlocked && (
            <View style={styles.badgeLockIcon}>
              <Ionicons name="lock-closed" size={12} color="#fff" />
            </View>
          )}
          <Image
            source={badge.image}
            style={[styles.badgeImage, !unlocked && styles.badgeImageLocked]}
            resizeMode="contain"
          />
          <Text style={styles.badgeTitle} numberOfLines={2}>{badge.title}</Text>
          {unlocked && record ? (
            <>
              <View style={styles.badgeUnlockedPill}>
                <Ionicons name="checkmark" size={11} color="#fff" />
                <Text style={styles.badgeUnlockedPillText}>Nakuha na!</Text>
              </View>
              <Text style={styles.badgeEarnedDate}>{relativeBadgeDate(record.unlockedAt)}</Text>
            </>
          ) : (
            <>
              {bp?.hasFraction ? (
                <View style={styles.badgeProgressWrap}>
                  <View style={styles.badgeProgressTrack}>
                    <View style={[styles.badgeProgressFill, { width: `${Math.max(4, bp.pct || 0)}%` }]} />
                  </View>
                  <Text style={styles.badgeProgressText}>{bp.current}/{bp.target}</Text>
                </View>
              ) : (
                <View style={styles.badgeLockedPill}>
                  <Text style={styles.badgeLockedPillText}>{expanded ? 'Itago' : 'Tingnan'}</Text>
                </View>
              )}
            </>
          )}
          {expanded && !unlocked && (
            <Text style={styles.badgeCondition}>{badge.description}</Text>
          )}
        </TouchableOpacity>
      );
    };

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.homeHeaderRow}>
          <View style={styles.homeHeaderAvatar}>
            <Text style={styles.homeHeaderAvatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.homeGreetingHello}>My Badges</Text>
            <Text style={styles.homeGreetingSub}>Ipagdiwang ang tagumpay mo sa pagbasa!</Text>
          </View>
          <TouchableOpacity style={styles.homeBellButton} onPress={() => setSection('notifications')}>
            <Ionicons name="notifications" size={20} color={HOME_LAVENDER_DARK} />
            {unreadNotifCount > 0 && (
              <View style={styles.homeBellBadge}>
                <Text style={styles.homeBellBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.badgesHeroCard}>
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <SvgLinearGradient id="badgesHeroGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={HOME_LAVENDER_DARK} />
                <Stop offset="1" stopColor={HOME_LAVENDER} />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#badgesHeroGrad)" rx={24} />
          </Svg>
          <View style={styles.badgesHeroTrophyWrap}>
            <Ionicons name="trophy" size={30} color={XP_GOLD} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.badgesHeroTitle}>My Achievements</Text>
            <Text style={styles.badgesHeroCount}>{unlockedCount} of {totalCount} Badges Unlocked</Text>
            <View style={styles.badgesHeroTrack}>
              <View style={[styles.badgesHeroFill, { width: `${Math.max(4, unlockPct)}%` }]} />
            </View>
            <Text style={styles.badgesHeroMsg}>
              {unlockedCount === 0 ? 'Simulan ang pagsasanay para makakuha ng unang badge!' : 'Keep practicing to unlock more achievements!'}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgesFilterRow} contentContainerStyle={{ gap: 8 }}>
          {filterTabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.badgesFilterChip, badgeFilter === tab.key && styles.badgesFilterChipActive]}
              onPress={() => setBadgeFilter(tab.key)}
            >
              <Text style={[styles.badgesFilterChipText, badgeFilter === tab.key && styles.badgesFilterChipTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.practiceSectionTitle}>Natatanging Tagumpay</Text>
        <View style={styles.metaBadgeRow}>
          {metaBadges.map((badge) => {
            const record = progress?.achievements?.find((a) => a.id === badge.id);
            const unlocked = !!record;
            const bp = !unlocked ? getBadgeProgress(badge) : null;
            return (
              <View key={badge.id} style={[styles.metaBadgeCard, !unlocked && styles.metaBadgeCardLocked]}>
                <Image source={badge.image} style={[styles.metaBadgeImage, !unlocked && styles.badgeImageLocked]} resizeMode="contain" />
                <Text style={styles.metaBadgeTitle}>{badge.title}</Text>
                {unlocked && record ? (
                  <>
                    <View style={styles.badgeUnlockedPill}>
                      <Ionicons name="checkmark" size={11} color="#fff" />
                      <Text style={styles.badgeUnlockedPillText}>Nakuha na!</Text>
                    </View>
                    <Text style={styles.badgeEarnedDate}>{relativeBadgeDate(record.unlockedAt)}</Text>
                  </>
                ) : badge.id === 'aking_unang_tagumpay' ? (
                  <Text style={styles.metaBadgeCondition}>Awtomatikong makukuha sa una mong badge</Text>
                ) : bp?.hasFraction ? (
                  <View style={styles.badgeProgressWrap}>
                    <View style={styles.badgeProgressTrack}>
                      <View style={[styles.badgeProgressFill, { width: `${Math.max(4, bp.pct || 0)}%`, backgroundColor: HOME_LAVENDER_DARK }]} />
                    </View>
                    <Text style={styles.badgeProgressText}>{bp.current}/{bp.target} na badge</Text>
                  </View>
                ) : (
                  <Text style={styles.metaBadgeCondition}>{badge.description}</Text>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.practiceSectionTitle}>Unlocked Badges</Text>
        {unlockedBadges.length ? (
          <View style={styles.badgesGrid}>{unlockedBadges.map(renderBadgeCard)}</View>
        ) : (
          <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC', marginBottom: 20 }]}>
            <Text style={styles.learnEmptySubtext}>Wala ka pang nakukuhang badge sa kategoryang ito.</Text>
          </View>
        )}

        <Text style={styles.practiceSectionTitle}>Badges to Unlock</Text>
        {lockedBadges.length ? (
          <View style={styles.badgesGrid}>{lockedBadges.map(renderBadgeCard)}</View>
        ) : (
          <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC', marginBottom: 20 }]}>
            <Text style={styles.learnEmptySubtext}>Nakuha mo na ang lahat ng badge sa kategoryang ito! 🎉</Text>
          </View>
        )}

        {spotlight && (
          <View style={styles.spotlightCard}>
            <Text style={styles.spotlightTitle}>Your Next Achievement</Text>
            <View style={styles.spotlightRow}>
              <Image source={spotlight.badge.image} style={styles.spotlightImage} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={styles.spotlightBadgeTitle}>{spotlight.badge.title}</Text>
                <Text style={styles.spotlightProgressText}>{spotlight.progress.current}/{spotlight.progress.target}</Text>
                <View style={styles.spotlightTrack}>
                  <View style={[styles.spotlightFill, { width: `${Math.max(4, spotlight.progress.pct || 0)}%` }]} />
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.spotlightButton} onPress={() => setSection('practice')}>
              <Text style={styles.spotlightButtonText}>Practice Now</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  };

  const renderNotifications = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.notifSectionHeader}>
        <View style={styles.notifBadgePill}>
          <Ionicons name="notifications" size={16} color={HOME_LAVENDER_DARK} />
          <Text style={styles.notifBadgeText}>MENSAHE</Text>
        </View>
        <Text style={styles.notifSectionSubtitle}>Mga update at paalala para sa iyo</Text>
      </View>

      {notifications.length ? (
        <View style={{ gap: 10 }}>
          {notifications.map((item) => {
            const unread = !(item.is_read ?? item.read);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.notifCard, unread && styles.notifCardUnread]}
                onPress={async () => {
                  if (!unread) return;
                  await markNotificationRead(item.id).catch(() => {});
                  setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true, read: true } : n)));
                }}
              >
                {unread && <View style={styles.notifDot} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifTitle}>{item.title}</Text>
                  {!!(item.message || item.body) && <Text style={styles.notifBody}>{item.message || item.body}</Text>}
                  <Text style={styles.notifDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.notifEmptyCard}>
          <Ionicons name="notifications-outline" size={40} color={HOME_LAVENDER} />
          <Text style={styles.notifEmptyText}>Wala ka pang mensahe. Dito lalabas ang mga update at paalala.</Text>
        </View>
      )}
    </ScrollView>
  );

  const renderProfile = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Student Profile</Text>
      <View style={styles.profileHero}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{initials}</Text>
        </View>
        <Text style={styles.profileName}>{child?.name || 'Estudyante'}</Text>
        <Text style={styles.profileUsername}>{child?.username || 'student account'}</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.profileRow}>
          <Ionicons name="school-outline" size={22} color={PRIMARY} />
          <View>
            <Text style={styles.profileLabel}>Grade Level</Text>
            <Text style={styles.profileValue}>Grade {child?.grade_level || '-'}</Text>
          </View>
        </View>
        <View style={styles.profileRow}>
          <Ionicons name="flame-outline" size={22} color={PRIMARY} />
          <View>
            <Text style={styles.profileLabel}>Current Streak</Text>
            <Text style={styles.profileValue}>{stats.streak} days</Text>
          </View>
        </View>
        <View style={styles.profileRow}>
          <Ionicons name="star-outline" size={22} color={PRIMARY} />
          <View>
            <Text style={styles.profileLabel}>Learning XP</Text>
            <Text style={styles.profileValue}>{stats.xp} XP</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );

  const renderSettings = () => (
    <DashboardSettingsScreen
      role="student"
      navigation={navigation}
      embedded
      gradeLevel={child?.grade_level}
      readingLevel={progress?.level}
    />
  );

  const navPendingCount = activities.filter((a) => a.status === 'pending' || a.status === 'overdue').length;
  const navBadgeFraction = `${progress?.achievements?.length || 0}/${ACHIEVEMENTS.length}`;

  const topHeaderNode = (
    <View style={styles.topHeader}>
      <TouchableOpacity onPress={openSidebar} style={{ padding: 8 }}><Ionicons name="menu-outline" size={28} color={PRIMARY} /></TouchableOpacity>
      <Text style={styles.appTitle}>LinawLetra</Text>
      <View style={styles.streakPill}>
        <Ionicons name="flame" size={14} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '900', marginLeft: 4 }}>{stats.streak}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {section === 'home' ? (
        // No topHeaderNode here - the hero banner inside renderWordOfDay()
        // already covers branding (logo lockup) and a notification bell;
        // stacking the old hamburger/title bar on top of it duplicated that
        // chrome and pushed the rest of the tab down unnecessarily.
        <View style={styles.homeBg}>
          {renderWordOfDay()}
        </View>
      ) : (
        <>
          {topHeaderNode}
          {section === 'learn' && renderActivities()}
          {section === 'practice' && renderPractice()}
          {section === 'progress' && renderProgress()}
          {section === 'achievements' && renderAchievements()}
          {section === 'notifications' && renderNotifications()}
          {section === 'settings' && renderSettings()}
        </>
      )}

      {/* Sidebar overlay + animated sidebar */}
      {sidebarOpen && (
        <Animated.View style={[styles.overlay, { opacity: overlayAnim, pointerEvents: sidebarOpen ? 'auto' : 'none' }]}>
          <TouchableOpacity style={{ flex: 1 }} onPress={closeSidebar} />
        </Animated.View>
      )}
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}>
        <View style={styles.sidebarProfile}>
          <View style={styles.sidebarAvatarGlowOuter}>
            <View style={styles.sidebarAvatarGlowInner}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.sidebarName}>{child?.name || 'Estudyante'}</Text>
          <Text style={styles.sidebarEmail}>{child?.username || 'student account'}</Text>
        </View>
        <ScrollView style={styles.sidebarNav} showsVerticalScrollIndicator={false}>
          {[
            { k: 'home', l: 'Home', i: 'home-outline' },
            { k: 'learn', l: 'Learn', i: 'library-outline', count: navPendingCount },
            { k: 'practice', l: 'Practice', i: 'mic-outline' },
            { k: 'progress', l: 'Progress', i: 'analytics-outline' },
            { k: 'achievements', l: 'Badges', i: 'ribbon-outline', fraction: navBadgeFraction },
            { k: 'settings', l: 'Settings', i: 'settings-outline' },
          ].map((it: any) => {
            const active = section === it.k;
            return (
              <TouchableOpacity
                key={it.k}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => navigateTo(it.k)}
              >
                <View style={[styles.navIconWrap, active && styles.navIconWrapActive]}>
                  <Ionicons name={it.i as any} size={17} color={active ? HOME_LAVENDER_DARK : 'rgba(255,255,255,0.85)'} />
                </View>
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{it.l}</Text>
                {!!it.count && (
                  <View style={styles.navCountBadge}>
                    <Text style={styles.navCountBadgeText}>{it.count}</Text>
                  </View>
                )}
                {!!it.fraction && (
                  <View style={styles.navFractionPill}>
                    <Text style={styles.navFractionPillText}>{it.fraction}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={styles.sidebarLogout} onPress={async () => { await signOutUser(); navigation.replace('Login'); }}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.sidebarLogoutText}>Mag-log out</Text>
        </TouchableOpacity>
      </Animated.View>

      <AchievementModal
        visible={!!achievement}
        image={achievement?.image}
        title={achievement?.title || ''}
        category={achievement?.category}
        xp={achievement?.xp || 0}
        onClose={() => setAchievement(null)}
      />
    </View>
  );
}

function ProgressRing({
  percent,
  size = 92,
  strokeWidth = 10,
  color,
  trackColor,
  children,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </Svg>
      {children}
    </View>
  );
}

function PracticeResultCard({
  result,
  word,
  onReplay,
  onRetry,
  onNext,
  showScore = true,
}: {
  result: PracticeResult;
  word: string;
  onReplay: () => void;
  onRetry: () => void;
  onNext: () => void;
  showScore?: boolean;
}) {
  const scaleAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, []);

  const { correct, score, transcript, feedback, xpAward } = result;
  const ringColor = score >= 85 ? SUCCESS : score >= 60 ? WARNING : '#fb7185';
  const stars = score >= 95 ? 3 : score >= 80 ? 2 : 1;

  if (correct) {
    return (
      <Animated.View style={[styles.resultCard, styles.correctCard, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={styles.resultBigEmoji}>🎉</Text>
        <Text style={styles.resultTitle}>{feedback}</Text>
        <Text style={styles.resultSubtitle}>Tama ang bigkas mo!</Text>

        {showScore && (
          <View style={[styles.accuracyRing, { borderColor: ringColor }]}>
            <Text style={styles.accuracyPercent}>{score}%</Text>
            <Text style={styles.accuracyLabel}>accuracy</Text>
          </View>
        )}
        <View style={styles.starRow}>
          {Array.from({ length: 3 }).map((_unused, index) => (
            <Text key={index} style={[styles.pronunciationStar, index >= stars && styles.pronunciationStarDim]}>★</Text>
          ))}
        </View>

        <View style={styles.transcriptRow}>
          <Text style={styles.transcriptLabel}>Sinabi mo: </Text>
          <Text style={styles.transcriptValue}>&quot;{transcript}&quot;</Text>
        </View>

        <View style={styles.xpPill}><Text style={styles.xpPillText}>+{xpAward} XP 🌟</Text></View>

        <TouchableOpacity style={styles.nextButton} onPress={onNext}>
          <Text style={styles.nextButtonText}>Susunod na Salita →</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.resultCard, styles.wrongCard, { transform: [{ scale: scaleAnim }] }]}> 
      <Text style={styles.resultBigEmoji}>💪</Text>
      <Text style={styles.resultTitle}>{feedback}</Text>
      <Text style={styles.resultSubtitle}>Pakinggan ang tamang bigkas ng AI.</Text>

      {showScore && (
        <View style={[styles.accuracyRing, { borderColor: ringColor }]}>
          <Text style={[styles.accuracyPercent, { color: ringColor }]}>{score}%</Text>
          <Text style={styles.accuracyLabel}>accuracy</Text>
        </View>
      )}
      <Text style={styles.scoreCoachText}>{scoreMessage(score)}</Text>

      <View style={styles.comparisonBox}>
        <View style={styles.comparisonRow}>
          <Text style={styles.comparisonIcon}>🎤</Text>
          <Text style={styles.comparisonLabel}>Sinabi mo:</Text>
          <Text style={[styles.comparisonWord, { color: '#ef4444' }]}>&quot;{transcript || '—'}&quot;</Text>
        </View>
        <View style={styles.comparisonDivider} />
        <View style={styles.comparisonRow}>
          <Text style={styles.comparisonIcon}>✅</Text>
          <Text style={styles.comparisonLabel}>Tamang bigkas:</Text>
          <Text style={[styles.comparisonWord, { color: '#10b981', fontWeight: '900' }]}>{word.toUpperCase()}</Text>
        </View>
      </View>

      <View style={[styles.xpPill, { backgroundColor: '#f59e0b' }]}>
        <Text style={styles.xpPillText}>+{xpAward} XP 💛 (para sa pagsisikap!)</Text>
      </View>

      <View style={styles.resultButtons}>
        <TouchableOpacity style={styles.listenAgainButton} onPress={onReplay}>
          <Ionicons name="volume-high-outline" size={18} color={PRIMARY} />
          <Text style={styles.listenAgainText}>Pakinggan muli</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.retryMicButton} onPress={onRetry}>
          <Ionicons name="mic-outline" size={18} color="#fff" />
          <Text style={styles.retryMicText}>Subukan muli</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
  header: { paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 24, fontWeight: '900', color: '#111827' },
  subtitle: { color: '#6B7280', marginTop: 4 },
  logout: { backgroundColor: '#E74C3C', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 48 },
  // --- Progress tab (accent: SUCCESS green — "growth over time") ---
  progressStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  progressStatCard: {
    width: '48%', borderRadius: 20, padding: 14, alignItems: 'flex-start', minHeight: 84, justifyContent: 'center',
  },
  progressStatValue: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 20, marginTop: 8 },
  progressStatLabel: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '700', marginTop: 2 },
  progressHeroCard: {
    backgroundColor: '#EFECFB', borderRadius: 24, padding: 20, alignItems: 'center', marginBottom: 20,
  },
  progressHeroTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 18, textAlign: 'center' },
  progressHeroRingPct: { fontFamily: FONT_DISPLAY, color: HOME_LAVENDER_DARK, fontSize: 28 },
  progressHeroLabel: { color: HOME_INK, fontWeight: '800', fontSize: 14, marginBottom: 8 },
  progressHeroStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
  },
  progressHeroStatusText: { fontWeight: '800', fontSize: 13 },
  progressHeroEmptyText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  progressChartCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 20 },
  progressChartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  progressChartTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 16 },
  progressChartBars: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 130, gap: 6, paddingHorizontal: 4,
  },
  progressChartBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  progressChartBarValue: { fontSize: 10, fontWeight: '900', marginBottom: 4 },
  progressChartBar: { width: '100%', borderRadius: 4, minWidth: 10 },
  progressChartDayRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 6 },
  progressChartDayLabel: { flex: 1, textAlign: 'center', color: HOME_INK_SOFT, fontSize: 10, fontWeight: '700' },
  progressChartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  progressLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressLegendDot: { width: 8, height: 8, borderRadius: 4 },
  progressLegendText: { color: HOME_INK_SOFT, fontSize: 11, fontWeight: '700' },
  progressTrendMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  progressTrendMsgText: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12 },
  progressChartEmpty: { alignItems: 'center', paddingVertical: 24 },
  progressChartEmptyText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  skillsCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 20 },
  skillRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  skillIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  skillTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  skillLabel: { color: HOME_INK, fontWeight: '800', fontSize: 14 },
  skillTagPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  skillTagText: { fontWeight: '800', fontSize: 11 },
  skillTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden' },
  skillTrackFill: { height: '100%', borderRadius: 4 },
  skillPct: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 12, minWidth: 34, textAlign: 'right' },
  recentActivityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F5F3FC', borderRadius: 20, padding: 14, marginBottom: 12,
  },
  recentActivityScore: { fontWeight: '900', fontSize: 15 },
  progressMonthBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF3DC', borderRadius: 20, padding: 16, marginBottom: 20,
  },
  progressMonthTitle: { color: HOME_INK, fontWeight: '900', fontSize: 14, marginBottom: 3 },
  progressMonthSub: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, lineHeight: 17 },
  progressWordsCard: { backgroundColor: 'rgba(124,111,207,0.08)', borderRadius: 20, padding: 16 },
  progressWordsTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 15, marginBottom: 10 },
  progressWordsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  progressWordChip: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  progressWordChipText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 13 },
  progressWordsMore: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12, marginLeft: 2 },
  progressWordsEmpty: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#111827', marginTop: 18, marginBottom: 10 },
  badgeRow: { gap: 10, paddingBottom: 4 },
  // --- Badges tab (accent: lavender, ties into Home's achievement showcase) ---
  badgesHeroCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 24, padding: 18, marginBottom: 20, overflow: 'hidden',
  },
  badgesHeroTrophyWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  badgesHeroTitle: { fontFamily: FONT_DISPLAY, color: '#fff', fontSize: 18, marginBottom: 6 },
  badgesHeroCount: { color: '#fff', fontWeight: '800', fontSize: 14, marginBottom: 8 },
  badgesHeroTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', marginBottom: 8 },
  badgesHeroFill: { height: '100%', borderRadius: 4, backgroundColor: '#fff' },
  badgesHeroMsg: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 12 },
  badgesFilterRow: { marginBottom: 16 },
  badgesFilterChip: {
    backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginRight: 8,
  },
  badgesFilterChipActive: { backgroundColor: HOME_LAVENDER },
  badgesFilterChipText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 13 },
  badgesFilterChipTextActive: { color: '#fff' },
  metaBadgeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  metaBadgeCard: {
    flex: 1, backgroundColor: '#FFF3DC', borderRadius: 20, padding: 14, alignItems: 'center',
    borderWidth: 2, borderColor: XP_GOLD,
  },
  metaBadgeCardLocked: { backgroundColor: '#F3F4F6', borderColor: 'rgba(59,50,44,0.15)' },
  metaBadgeImage: { width: 64, height: 64, marginBottom: 6 },
  metaBadgeTitle: { textAlign: 'center', fontWeight: '900', color: HOME_INK, fontSize: 13, marginBottom: 6 },
  metaBadgeCondition: { textAlign: 'center', color: HOME_INK_SOFT, fontSize: 11, lineHeight: 15 },
  badgesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  badgeCard: {
    width: '48%', backgroundColor: '#F5F3FC', borderRadius: 20, padding: 14,
    alignItems: 'center', marginBottom: 14,
  },
  badgeCardLocked: { backgroundColor: '#F3F4F6' },
  badgeLockIcon: {
    position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(59,50,44,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  badgeImage: { width: 72, height: 72 },
  badgeImageLocked: { opacity: 0.45 },
  badgeTitle: { textAlign: 'center', fontWeight: '800', color: HOME_INK, marginTop: 8, fontSize: 13 },
  badgeCondition: { textAlign: 'center', color: HOME_INK_SOFT, fontSize: 12, marginTop: 8, lineHeight: 16 },
  badgeUnlockedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: SUCCESS,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8,
  },
  badgeUnlockedPillText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  badgeEarnedDate: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 11, marginTop: 5 },
  badgeLockedPill: {
    backgroundColor: 'rgba(59,50,44,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8,
  },
  badgeLockedPillText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 11 },
  badgeProgressWrap: { width: '100%', marginTop: 8, alignItems: 'center' },
  badgeProgressTrack: {
    width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(59,50,44,0.12)', overflow: 'hidden', marginBottom: 4,
  },
  badgeProgressFill: { height: '100%', borderRadius: 3, backgroundColor: HOME_SAGE },
  badgeProgressText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 11 },
  spotlightCard: { backgroundColor: '#fff', borderRadius: 24, padding: 18, marginBottom: 20 },
  spotlightTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 16, marginBottom: 12 },
  spotlightRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  spotlightImage: { width: 56, height: 56 },
  spotlightBadgeTitle: { color: HOME_INK, fontWeight: '900', fontSize: 15, marginBottom: 4 },
  spotlightProgressText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 12, marginBottom: 6 },
  spotlightTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden' },
  spotlightFill: { height: '100%', borderRadius: 4, backgroundColor: HOME_LAVENDER },
  spotlightButton: { backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  spotlightButtonText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  uploadBody: { flex: 1 },
  // --- Learn tab (assignments = lavender family, PDF lessons = sage family) ---
  learnSectionHeader: { marginTop: 8, marginBottom: 14 },
  learnBadgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 8,
  },
  learnBadgeText: { fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  learnSectionSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  learnCardList: { gap: 12, marginBottom: 8 },
  learnActivityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F5F3FC', borderRadius: 20, padding: 14, marginBottom: 12,
  },
  learnLessonCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F1F6ED', borderRadius: 20, padding: 14, marginBottom: 12,
  },
  learnIconWrap: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
  },
  learnItemTitle: { color: HOME_INK, fontWeight: '900', fontSize: 15 },
  learnItemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  learnStatusDot: { width: 8, height: 8, borderRadius: 4 },
  learnItemMeta: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '600' },
  learnItemDescription: { color: HOME_INK_SOFT, fontSize: 13, marginTop: 6 },
  learnStatusBadge: { fontWeight: '900', fontSize: 12 },
  learnActionButton: { backgroundColor: HOME_LAVENDER, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  learnActionButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  learnEmptyCard: { alignItems: 'center', borderRadius: 24, paddingVertical: 32, paddingHorizontal: 20, marginBottom: 8 },
  learnEmptyIconWrap: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  learnEmptyTitle: { color: HOME_INK, fontWeight: '900', fontSize: 16, marginBottom: 6, textAlign: 'center' },
  learnEmptySubtext: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  learnMarkDoneText: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12, textDecorationLine: 'underline' },
  learnContinueCard: {
    backgroundColor: HOME_SAGE, borderRadius: 24, padding: 18, marginBottom: 20,
    shadowColor: HOME_SAGE, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  learnContinuePill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10,
  },
  learnContinuePillText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 },
  learnContinueTitle: { fontFamily: FONT_DISPLAY, color: '#fff', fontSize: 19, marginBottom: 4 },
  learnContinueSub: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 13, marginBottom: 14, lineHeight: 18 },
  learnContinueButton: {
    alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11,
  },
  learnContinueButtonText: { color: HOME_SAGE, fontWeight: '900', fontSize: 14 },
  learnFilterRow: { marginBottom: 14 },
  learnFilterChip: {
    backgroundColor: '#F1F6ED', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginRight: 8,
  },
  learnFilterChipActive: { backgroundColor: HOME_SAGE },
  learnFilterChipText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 13 },
  learnFilterChipTextActive: { color: '#fff' },
  learnJourneyCard: {
    backgroundColor: '#F5F3FC', borderRadius: 24, padding: 18, marginTop: 8, marginBottom: 8,
  },
  learnJourneyTitle: { color: HOME_INK, fontWeight: '900', fontSize: 15, marginBottom: 6 },
  learnJourneyLevel: { fontFamily: FONT_DISPLAY, color: HOME_LAVENDER_DARK, fontSize: 20, marginBottom: 10 },
  learnJourneyTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden', marginBottom: 8 },
  learnJourneyFill: { height: '100%', borderRadius: 5, backgroundColor: HOME_LAVENDER },
  learnJourneyMsg: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wordCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, minWidth: '30%', minHeight: 64,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#EEE9F9',
  },
  wordCardNext: { borderColor: HOME_LAVENDER, borderWidth: 2, backgroundColor: '#F5F3FC' },
  wordCardLocked: { backgroundColor: '#F3F4F6', opacity: 0.6 },
  wordCardLockIcon: { position: 'absolute', top: 8, right: 8 },
  wordCardCheckBadge: {
    position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 10,
    backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center',
  },
  wordCardNextBadge: {
    position: 'absolute', top: -8, alignSelf: 'center', backgroundColor: HOME_LAVENDER,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
  },
  wordCardNextBadgeText: { color: '#fff', fontWeight: '900', fontSize: 9, letterSpacing: 0.5 },
  wordText: { color: PRIMARY, fontWeight: '900', fontSize: 16 },
  empty: { color: '#6B7280', marginBottom: 8 },
  errorBlock: { backgroundColor: '#fff1f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  error: { color: '#b91c1c', marginBottom: 10, fontWeight: '700' },
  retryButton: { paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#dc2626', borderRadius: 8, alignSelf: 'flex-start' },
  retryButtonText: { color: '#fff', fontWeight: '700' },
  skeletonCard: { width: '92%', height: 180, borderRadius: 18, backgroundColor: '#E5E7EB', marginBottom: 16 },
  skeletonLine: { width: '82%', height: 16, borderRadius: 8, backgroundColor: '#E5E7EB', marginBottom: 10 },
  skeletonLineShort: { width: '45%', height: 16, borderRadius: 8, backgroundColor: '#E5E7EB', marginBottom: 22 },
  skeletonGrid: { width: '92%', flexDirection: 'row', justifyContent: 'space-between' },
  skeletonBlock: { width: '48%', height: 100, borderRadius: 14, backgroundColor: '#E5E7EB' },
  practicePanel: { marginTop: 18, padding: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  practiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  practiceTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  practiceClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  practiceCloseText: { color: '#6B7280', fontWeight: '800' },
  practiceSubtitle: { color: '#6B7280', marginBottom: 12 },
  resultCard: { marginTop: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', padding: 14, alignItems: 'center' },
  correctCard: { backgroundColor: '#ecfdf5', borderColor: '#d1fae5' },
  wrongCard: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  resultEmoji: { fontSize: 28, textAlign: 'center', marginBottom: 8 },
  resultTitle: { fontSize: 16, fontWeight: '900', textAlign: 'center', color: '#111827' },
  resultTranscript: { color: '#6B7280', fontSize: 13, marginTop: 10, textAlign: 'center' },
  resultScore: { marginTop: 8, color: PRIMARY, fontWeight: '700', textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 18 },
  modalCard: { backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  close: { alignSelf: 'flex-end', padding: 8 },
  topHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 48, paddingBottom: 12 },
  appTitle: { fontSize: 20, fontWeight: '900', color: PRIMARY },
  streakPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  // Tinted indigo scrim (matches the drawer's own palette) instead of flat black
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(30,23,66,0.6)' },
  sidebar: {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: 270,
    backgroundColor: HOME_LAVENDER_DARK, paddingTop: 48, zIndex: 100,
    shadowColor: '#000', shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 20,
  },
  sidebarProfile: {
    alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  sidebarAvatarGlowOuter: {
    width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 12,
  },
  sidebarAvatarGlowInner: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: HOME_LAVENDER,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 26, fontWeight: '900', color: '#fff' },
  sidebarName: { fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'center' },
  sidebarEmail: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4, textAlign: 'center' },
  sidebarNav: { flex: 1, paddingHorizontal: 14, paddingTop: 16 },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
    marginBottom: 4,
  },
  navItemActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  navIconWrap: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  navIconWrapActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  navLabel: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.85)', flex: 1 },
  navLabelActive: { color: '#fff', fontWeight: '900' },
  navCountBadge: {
    backgroundColor: DANGER, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  navCountBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  navFractionPill: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  navFractionPillText: { color: '#fff', fontWeight: '800', fontSize: 10.5 },
  sidebarLogout: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 20, padding: 16, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  sidebarLogoutText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  // --- Home tab ---
  homeBg: { flex: 1, width: '100%', backgroundColor: '#EEF0FA' },
  homeContent: { padding: 18, paddingBottom: 48 },
  homeErrorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(240,150,125,0.16)', borderWidth: 1.5, borderColor: HOME_CORAL,
    borderRadius: 20, padding: 14, marginBottom: 16,
  },
  homeBannerEmoji: { fontSize: 20 },
  homeErrorText: { color: HOME_INK, fontWeight: '700', marginBottom: 8 },
  homeBannerButton: {
    alignSelf: 'flex-start', backgroundColor: HOME_CORAL,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
  },
  homeBannerButtonText: { color: '#fff', fontWeight: '800' },
  homeGreetingHello: {
    fontFamily: FONT_DISPLAY, fontSize: 20, color: HOME_INK,
  },
  homeGreetingSub: { color: HOME_INK_SOFT, fontWeight: '600', marginTop: 2, fontSize: 13 },
  homeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  homeHeaderAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: HOME_LAVENDER,
    alignItems: 'center', justifyContent: 'center',
  },
  homeHeaderAvatarText: { color: '#fff', fontWeight: '900', fontSize: 18 },
  homeBellButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  homeBellBadge: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: DANGER, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  homeBellBadgeText: { color: '#fff', fontWeight: '900', fontSize: 9 },
  heroBanner: { borderRadius: 28, padding: 22, marginBottom: 20, overflow: 'hidden', position: 'relative', minHeight: 200 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  heroLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLogoText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  heroBell: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroGreeting: { color: '#fff', fontSize: 26, fontFamily: FONT_DISPLAY, lineHeight: 32, maxWidth: '68%' },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600', marginTop: 8, maxWidth: '62%' },
  // 1:2 aspect ratio in the source art (1120x2240) - sized as a tall
  // rectangle so the full character shows with no cropping, anchored to
  // bleed slightly past the card's bottom-right corner (heroBanner's
  // overflow:hidden clips it cleanly, matching the reference).
  heroImage: { position: 'absolute', right: 0, bottom: -12, width: 112, height: 224 },
  readyPracticeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FBE7DF', borderRadius: 24, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(224,107,76,0.15)',
  },
  readyPracticeIconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#EFECFB',
    alignItems: 'center', justifyContent: 'center',
  },
  readyPracticeTitle: { fontFamily: FONT_DISPLAY, color: HOME_INK, fontSize: 16, marginBottom: 4 },
  readyPracticeSub: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  readyPracticeButton: {
    backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingHorizontal: 16,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  readyPracticeButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  homeRecentActivityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#EEE9F9',
  },
  homeRecentActivityIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  homeRecentActivityTitle: { fontWeight: '800', color: HOME_INK, fontSize: 14 },
  homeRecentActivityDetail: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '600', marginTop: 2 },
  homeRecentActivityTime: { color: HOME_INK_SOFT, fontSize: 11, fontWeight: '600' },
  homeRecentActivityEmpty: { alignItems: 'center', paddingVertical: 20, marginBottom: 8 },
  homeRecentActivityEmptyText: { color: HOME_INK_SOFT, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  homeTodayCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3DC', borderRadius: 24, padding: 18, marginBottom: 16,
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  homeTodayTitle: { fontFamily: FONT_DISPLAY, color: HOME_INK, fontSize: 19, lineHeight: 24 },
  homeTodayStatLine: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, marginTop: 8, marginBottom: 14 },
  homeTodayButton: {
    backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignSelf: 'flex-start',
  },
  homeTodayButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  homeTodayRingPct: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_LAVENDER_DARK, fontSize: 18 },
  homeTodayRingLabel: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 10 },
  homeStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  homeGridCard: {
    width: '48%', borderRadius: 20, padding: 14, minHeight: 92, justifyContent: 'center',
  },
  homeGridIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  homeGridValue: { fontFamily: FONT_DISPLAY, fontSize: 20, marginTop: 8 },
  homeGridLabel: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12, marginTop: 2 },
  homeContinueCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFECFB', borderRadius: 20, padding: 16, marginBottom: 16, gap: 12,
  },
  homeContinueTitle: { fontFamily: FONT_DISPLAY, color: HOME_INK, fontSize: 15 },
  homeContinueSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 2, marginBottom: 10 },
  homeContinueTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeContinueTrack: { flex: 1, backgroundColor: 'rgba(124,111,207,0.2)', height: 8, borderRadius: 999, overflow: 'hidden' },
  homeContinueFill: { backgroundColor: HOME_LAVENDER, height: 8, borderRadius: 999 },
  homeContinuePct: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 12 },
  homeContinueButton: { backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  homeContinueButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  // Source art is a tall 1:2 character illustration (1120x2240), not a
  // square headshot - a plain "cover" crop centers vertically and risks
  // cutting off the character's head/face. Instead the wrap clips a fixed
  // square, and the image inside is pinned to the top at its natural
  // width-scaled height (2x the box width, matching the real ratio), so it
  // crops the bottom off instead of the middle and keeps the head visible.
  homeContinueImageWrap: { width: 52, height: 52, borderRadius: 14, overflow: 'hidden', backgroundColor: '#fff' },
  homeContinueImage: { width: 52, height: 104, position: 'absolute', top: 0, left: 0 },
  homeContinueLessonCount: { color: HOME_LAVENDER_DARK, fontWeight: '700', fontSize: 11, marginBottom: 8 },
  homeHeroCard: {
    backgroundColor: HOME_CREAM, borderRadius: 24, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(124,111,207,0.18)',
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  homeHeroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  homeHeroBadge: {
    backgroundColor: HOME_LAVENDER, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  homeHeroBadgeText: { color: '#fff', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  homeHeroStreakPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: HOME_SUN,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  homeHeroStreakText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.3 },
  homeHeroSub: { color: HOME_INK_SOFT, fontWeight: '600', textAlign: 'center', marginBottom: 4, fontSize: 13 },
  homeHeroEmptyEmoji: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  homeHeroEmptyText: { color: HOME_INK_SOFT, textAlign: 'center', fontWeight: '600' },
  homePracticeSectionTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 16, marginBottom: 10 },
  homePracticeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 18, padding: 14, marginBottom: 10, minHeight: 60,
  },
  homePracticeIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  homePracticeRowTitle: { fontWeight: '800', color: HOME_INK, fontSize: 14 },
  homePracticeRowSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 2 },
  homeQuoteBanner: {
    position: 'relative', overflow: 'hidden',
    backgroundColor: '#FFF3DC', borderRadius: 20, paddingVertical: 18, paddingLeft: 18, paddingRight: 84,
    marginTop: 4, marginBottom: 16, minHeight: 90, justifyContent: 'center',
  },
  homeQuoteText: { color: '#8A6416', fontWeight: '800', fontSize: 14, textAlign: 'left', lineHeight: 20, fontStyle: 'italic' },
  // Same full-character, no-crop treatment as the hero's waving.png (1:2
  // source ratio), just smaller - bleeds past the banner's bottom-right
  // corner, clipped by the banner's own overflow:hidden.
  homeQuoteImage: { position: 'absolute', right: -4, bottom: -10, width: 68, height: 136 },
  homeQuickRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  homeQuickCard: {
    flex: 1, borderRadius: 20, paddingVertical: 16, alignItems: 'center', minHeight: 88, justifyContent: 'center',
  },
  homeQuickIconWrap: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  homeQuickLabel: { fontWeight: '800', color: HOME_INK, fontSize: 13 },
  homeDeadlinesCard: {
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 20, padding: 16,
  },
  homeDeadlinesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  homeDeadlinesTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 16 },
  homeDeadlinesLink: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 13 },
  homeDeadlinesEmpty: { alignItems: 'center', paddingVertical: 14 },
  homeDeadlinesEmptyEmoji: { fontSize: 28, marginBottom: 6 },
  homeDeadlinesEmptyText: { color: HOME_INK_SOFT, textAlign: 'center', fontWeight: '600', fontSize: 13 },
  // --- Notifications (reachable via the Home tab bell) ---
  notifSectionHeader: { marginBottom: 14 },
  notifBadgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#EFECFB', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 8,
  },
  notifBadgeText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  notifSectionSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fff', borderRadius: 16, padding: 14,
  },
  notifCardUnread: { backgroundColor: '#F5F3FC' },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HOME_LAVENDER, marginTop: 6 },
  notifTitle: { color: HOME_INK, fontWeight: '800', fontSize: 14 },
  notifBody: { color: HOME_INK_SOFT, fontSize: 13, marginTop: 4, lineHeight: 18 },
  notifDate: { color: HOME_INK_SOFT, fontSize: 11, fontWeight: '600', marginTop: 6 },
  notifEmptyCard: { alignItems: 'center', paddingVertical: 40 },
  notifEmptyText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  bigWord: { fontSize: 48, fontWeight: '900', color: PRIMARY, marginVertical: 10 },
  listenButton: { marginTop: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: PRIMARY },
  // Practice feedback styles
  goalCard: {
    backgroundColor: HOME_CREAM,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
  },
  goalTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 17 },
  goalCount: { color: HOME_LAVENDER_DARK, fontWeight: '900' },
  goalCountEmpty: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 12 },
  goalTrack: { height: 12, borderRadius: 6, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden', marginTop: 14 },
  goalTrackFill: { height: '100%', borderRadius: 6, backgroundColor: HOME_LAVENDER },
  goalEmptyNote: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 10 },
  practiceSectionTitle: { fontFamily: FONT_DISPLAY, color: HOME_INK, fontSize: 16, marginBottom: 12, marginTop: 4 },
  practiceModeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 20, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  practiceModeCardDisabled: { opacity: 0.6 },
  practiceModeIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  practiceModeTitle: { color: HOME_INK, fontWeight: '900', fontSize: 15 },
  practiceModeSub: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 3, lineHeight: 17 },
  practiceModeTag: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8 },
  practiceModeTagText: { fontWeight: '800', fontSize: 11 },
  practiceModeStartPill: { backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 },
  practiceModeStartText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  listenNextButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'center', backgroundColor: '#E9F1E2', borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 12, marginTop: 16,
  },
  listenNextButtonText: { color: HOME_SAGE, fontWeight: '900', fontSize: 14 },
  practiceStatsCard: { backgroundColor: '#F5F3FC', borderRadius: 24, padding: 18, marginTop: 8, marginBottom: 8 },
  practiceStatsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  practiceStatsCol: { alignItems: 'center', flex: 1, gap: 4 },
  practiceStatsValue: { color: HOME_INK, fontWeight: '900', fontSize: 16 },
  practiceStatsLabel: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 11, textAlign: 'center' },
  rewardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  rewardPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, paddingRight: 12 },
  rewardIconWrap: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rewardText: { fontWeight: '900', fontSize: 12 },
  practiceHero: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  practiceMascot: { fontSize: 58, marginBottom: 6 },
  practicePrompt: { color: HOME_INK_SOFT, fontWeight: '900', textTransform: 'uppercase', fontSize: 12, marginBottom: 4 },
  practiceCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  practiceWordDisplay: {
    fontSize: 56, fontWeight: '900', color: HOME_LAVENDER_DARK,
    letterSpacing: 0, textAlign: 'center', marginBottom: 6,
    fontFamily: 'System',
  },
  practiceSyllables: { color: HOME_LAVENDER_DARK, fontSize: 16, fontWeight: '900', marginBottom: 14 },
  wordMeaningBox: { alignItems: 'center', marginBottom: 14, paddingHorizontal: 12 },
  wordMeaningAccented: { color: HOME_CORAL, fontSize: 14, fontWeight: '800', marginBottom: 2, textAlign: 'center' },
  wordMeaningText: { color: HOME_INK_SOFT, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  practiceWordLevel: {
    textAlign: 'center', color: HOME_INK_SOFT, fontSize: 13,
    marginBottom: 20,
  },
  listenCoachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFECFB',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 14,
  },
  listenCoachText: { color: HOME_LAVENDER_DARK, fontWeight: '900' },
  sayWordButton: {
    width: '100%',
    minHeight: 68,
    borderRadius: 20,
    backgroundColor: HOME_LAVENDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: HOME_LAVENDER,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  sayWordButtonListening: { backgroundColor: DANGER },
  sayWordButtonText: { color: '#fff', fontWeight: '900', fontSize: 20 },
  practiceStatus: { color: HOME_INK, textAlign: 'center', fontWeight: '800', marginTop: 14 },
  practiceTranscript: { color: HOME_INK_SOFT, textAlign: 'center', marginTop: 8, fontWeight: '700' },

  backButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8,
  },
  backText: { color: HOME_LAVENDER_DARK, fontWeight: '700', fontSize: 15 },

  resultBigEmoji: { fontSize: 72, marginBottom: 8 },
  resultSubtitle: { fontSize: 15, color: TEXT_SECONDARY, marginBottom: 20, textAlign: 'center' },
  scoreCoachText: { color: TEXT_PRIMARY, fontWeight: '900', marginTop: -10, marginBottom: 12 },
  starRow: { flexDirection: 'row', gap: 6, marginTop: -10, marginBottom: 14 },
  pronunciationStar: { color: XP_GOLD, fontSize: 28 },
  pronunciationStarDim: { color: '#d1d5db' },

  // Accuracy ring (simulated with a card)
  accuracyRing: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 8, borderColor: '#10b981',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, backgroundColor: '#fff',
  },
  accuracyRingWrong: { borderColor: '#f59e0b' },
  accuracyPercent: {
    fontSize: 28, fontWeight: '900', color: '#10b981',
  },
  accuracyLabel: { fontSize: 11, color: TEXT_SECONDARY },

  // Transcript row
  transcriptRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 16,
  },
  transcriptLabel: { color: TEXT_SECONDARY, fontSize: 13 },
  transcriptValue: { color: TEXT_PRIMARY, fontWeight: '700', fontSize: 13 },

  // Comparison box (wrong result)
  comparisonBox: {
    width: '100%', backgroundColor: '#fff', borderRadius: 16,
    padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  comparisonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
  },
  comparisonDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 4 },
  comparisonIcon: { fontSize: 18, width: 28 },
  comparisonLabel: { color: TEXT_SECONDARY, fontSize: 13, flex: 1 },
  comparisonWord: { fontSize: 15, fontWeight: '800' },

  // XP pill
  xpPill: {
    backgroundColor: '#4f46e5', borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 10, marginBottom: 20,
  },
  xpPillText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  // Buttons in result card
  nextButton: {
    backgroundColor: PRIMARY, borderRadius: 16,
    paddingHorizontal: 28, paddingVertical: 14,
    width: '100%', alignItems: 'center',
  },
  nextButtonText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  resultButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  listenAgainButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderColor: PRIMARY, borderRadius: 14,
    paddingVertical: 12,
  },
  listenAgainText: { color: PRIMARY, fontWeight: '700' },
  retryMicButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: PRIMARY, borderRadius: 14, paddingVertical: 12,
  },
  retryMicText: { color: '#fff', fontWeight: '700' },

  // Word grid updates
  wordCardDone: { backgroundColor: '#f0fdf4', borderColor: '#86efac' },
  sectionSubtitle: { color: TEXT_SECONDARY, fontSize: 13, marginBottom: 16 },
  emptyState: { alignItems: 'center', paddingTop: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  openSettingsButton: {
    marginTop: 16,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  openSettingsText: { color: '#fff', fontWeight: '900' },
  homeActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(59,50,44,0.08)',
  },
  homeStatusDot: { width: 10, height: 10, borderRadius: 5 },
  homeActivityTitle: { color: HOME_INK, fontWeight: '900' },
  homeActivityMeta: { color: HOME_INK_SOFT, fontSize: 12, marginTop: 2 },
  profileHero: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 14,
  },
  profileAvatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileAvatarText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  profileName: { color: TEXT_PRIMARY, fontSize: 20, fontWeight: '900' },
  profileUsername: { color: TEXT_SECONDARY, marginTop: 4 },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  profileLabel: { color: TEXT_SECONDARY, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  profileValue: { color: TEXT_PRIMARY, fontWeight: '800', marginTop: 3 },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  calendarHeaderActions: { flexDirection: 'row', gap: 8 },
  monthButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  calendarMonth: { fontSize: 16, fontWeight: '900', color: TEXT_PRIMARY, marginBottom: 12 },
  weekHeader: { flexDirection: 'row', marginBottom: 8 },
  weekHeaderText: { flex: 1, textAlign: 'center', color: TEXT_SECONDARY, fontSize: 11, fontWeight: '800' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginBottom: 4,
  },
  dayCellSelected: { backgroundColor: PRIMARY },
  dayText: { color: TEXT_PRIMARY, fontWeight: '800' },
  dayTextSelected: { color: '#fff' },
  dayDots: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  dayCount: { fontSize: 9, color: TEXT_SECONDARY, fontWeight: '800' },
  selectedTasksCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 14,
  },
  selectedTasksTitle: { color: TEXT_PRIMARY, fontWeight: '900', fontSize: 16, marginBottom: 10 },
  activityTaskRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  statusStrip: { width: 4, borderRadius: 999 },
  activityTaskTitle: { color: TEXT_PRIMARY, fontWeight: '900' },
  activityTaskMeta: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 3 },
  activityTaskDescription: { color: '#374151', fontSize: 12, marginTop: 6, lineHeight: 18 },
  statusBadge: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
});
