import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
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
import { ACHIEVEMENTS, unlockAchievements } from '../services/achievementService';
import { fetchStudentActivities, StudentActivity } from '../services/activityService';
import { speakPhrase, speakWord, stopSpeaking } from '../services/ttsService';
import { fetchPublishedLessons, Lesson, subscribeToPublishedLessons } from '../services/lessonService';
import { createParentNotification, fetchNotifications, markNotificationRead, NotificationItem } from '../services/notificationService';
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
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';
const XP_CORRECT = 50;
const XP_WRONG = 30;
const DAILY_GOAL = 5;
const PRACTICE_PASSING_SCORE = 70;

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
  const base = Math.max(0, 100 - Math.round((distance / Math.max(normalizedExpected.length, normalizedSpoken.length)) * 100));
  const startsRight = normalizedSpoken[0] === normalizedExpected[0] ? 8 : 0;
  const lengthClose = Math.abs(normalizedExpected.length - normalizedSpoken.length) <= 1 ? 6 : 0;
  return Math.min(99, base + startsRight + lengthClose);
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
  const [recentSessions, setRecentSessions] = useState<{ word: string; accuracy_percentage: number; created_at: string }[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
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
  const [achievement, setAchievement] = useState<{ image: any; title: string } | null>(null);
  const [expandedBadgeId, setExpandedBadgeId] = useState<string | null>(null);
  const [practiceResult, setPracticeResult] = useState<PracticeResult | null>(null);
  const [practiceTranscript, setPracticeTranscript] = useState('');
  const [practiceListening, setPracticeListening] = useState(false);
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

  const UPLOADS_BUCKET = 'teacher-uploads'; // Update if your Supabase bucket name differs

  useSpeechRecognitionEvent('start', () => {
    setPracticeListening(true);
    setPracticeStatus('Nakikinig ako. Sabihin ang salita!');
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
        .limit(10);
      if (error) throw error;
      const rows = (data || []).slice().reverse();
      setRecentSessions(rows);
      return rows;
    } catch (error: any) {
      console.warn('[StudentDashboard] recent sessions load failed:', error?.message || error);
      setRecentSessions([]);
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

    const [wordLog, readingActivities, uploads, lessonRows, assignedActivities] = await Promise.all([
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
    ]);

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
    } catch (err: any) {
      console.error('[Lessons] openLesson failed:', err?.message || err);
      Alert.alert('Error', 'Hindi ma-open ang lesson. Siguraduhing may internet connection.');
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
        setAchievement({ image: newlyUnlocked[0].image, title: newlyUnlocked[0].title });
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

  const savePronunciationSession = async (result: PracticeResult, word: string) => {
    if (!child?.id) return false;
    const payload = {
      student_id: child.id,
      word,
      spoken_text: result.transcript,
      accuracy_percentage: result.score,
      is_correct: result.correct,
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

      const sessionSaved = await savePronunciationSession(result, selectedWord);
      if (!sessionSaved) {
        console.warn('[Practice] progress skipped because pronunciation session was not saved.');
        return;
      }

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
        setAchievement({ image: newlyUnlocked[0].image, title: newlyUnlocked[0].title });
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
    const words = practiceWords.length ? practiceWords : DEFAULT_PHONETIC_WORDS;
    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const goalPct = Math.round((goalDone / DAILY_GOAL) * 100);

    const continueLearningDone = words.filter((w) => progress?.completed_words?.includes(w)).length;
    const continueLearningPct = words.length ? Math.round((continueLearningDone / words.length) * 100) : 0;

    const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;

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

          {/* Header row: avatar + greeting + notification bell */}
          <View style={styles.homeHeaderRow}>
            <View style={styles.homeHeaderAvatar}>
              <Text style={styles.homeHeaderAvatarText}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.homeGreetingHello}>Kumusta, {getFirstName(child?.name || '')}! 👋</Text>
              <Text style={styles.homeGreetingSub}>Handa ka na bang matuto ngayon?</Text>
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

          {/* 2x2 stat grid — same color mapping used on Progress tab
              (streak=sun, xp=coral, words=sage, badges=lavender) */}
          <View style={styles.homeStatGrid}>
            <View style={[styles.homeGridCard, { backgroundColor: '#FBE7DF' }]}>
              <Ionicons name="star" size={22} color={HOME_CORAL} />
              <Text style={[styles.homeGridValue, { color: HOME_CORAL }]}>{stats.xp}</Text>
              <Text style={styles.homeGridLabel}>XP Earned</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#E9F1E2' }]}>
              <Ionicons name="book" size={22} color={HOME_SAGE} />
              <Text style={[styles.homeGridValue, { color: HOME_SAGE }]}>{stats.completed}</Text>
              <Text style={styles.homeGridLabel}>Words Practiced</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#FFF3DC' }]}>
              <Ionicons name="flame" size={22} color={HOME_SUN} />
              <Text style={[styles.homeGridValue, { color: HOME_SUN }]}>{stats.streak} {stats.streak === 1 ? 'Day' : 'Days'}</Text>
              <Text style={styles.homeGridLabel}>Reading Streak</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#EFECFB' }]}>
              <Ionicons name="ribbon" size={22} color={HOME_LAVENDER_DARK} />
              <Text style={[styles.homeGridValue, { color: HOME_LAVENDER_DARK }]}>{progress?.achievements?.length || 0}</Text>
              <Text style={styles.homeGridLabel}>Badges Earned</Text>
            </View>
          </View>

          {/* Continue Learning — real substitute: % of this grade's practice
              word list completed so far (Lesson has no sequence/progress
              field, so there's no real "next lesson" concept to show here) */}
          <View style={styles.homeContinueCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.homeContinueTitle}>Continue Learning</Text>
              <Text style={styles.homeContinueSubtitle}>Tagalog Reading Practice</Text>
              <View style={styles.homeContinueTrackRow}>
                <View style={styles.homeContinueTrack}>
                  <View style={[styles.homeContinueFill, { width: `${Math.max(4, continueLearningPct)}%` }]} />
                </View>
                <Text style={styles.homeContinuePct}>{continueLearningPct}%</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.homeContinueButton} onPress={() => setSection('practice')}>
              <Text style={styles.homeContinueButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>

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
              <StudentWordOfDay log={wordOfDay} onResult={handleWordOfDayResult} />
            </View>
          ) : (
            <View style={styles.homeHeroCard}>
              <Text style={styles.homeHeroEmptyEmoji}>📅</Text>
              <Text style={styles.homeHeroEmptyText}>Wala pang salita ngayon. Subukan muli mamaya.</Text>
            </View>
          )}

          {/* Practice Your Reading — both tiles point to real features */}
          <Text style={styles.homePracticeSectionTitle}>Practice Your Reading</Text>
          <TouchableOpacity style={styles.homePracticeRow} onPress={() => setSection('practice')}>
            <View style={[styles.homePracticeIconWrap, { backgroundColor: '#EFECFB' }]}>
              <Ionicons name="mic" size={20} color={HOME_LAVENDER_DARK} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.homePracticeRowTitle}>Say the Word</Text>
              <Text style={styles.homePracticeRowSubtitle}>Practice pronunciation</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={HOME_INK_SOFT} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.homePracticeRow} onPress={() => setSection('practice')}>
            <View style={[styles.homePracticeIconWrap, { backgroundColor: '#FBE7DF' }]}>
              <Ionicons name="volume-high" size={20} color={HOME_CORAL} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.homePracticeRowTitle}>Listen & Read</Text>
              <Text style={styles.homePracticeRowSubtitle}>Listen to the word and follow along</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={HOME_INK_SOFT} />
          </TouchableOpacity>

          {/* Motivational quote */}
          <View style={styles.homeQuoteBanner}>
            <Text style={styles.homeQuoteText}>"Bawat salitang nababasa mo, lumalakas ka!"</Text>
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
    const words = practiceWords.length ? practiceWords : DEFAULT_PHONETIC_WORDS;

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
              <Ionicons name="arrow-back" size={20} color={PRIMARY} />
              <Text style={styles.backText}>Bumalik</Text>
            </TouchableOpacity>

            <View style={styles.practiceHero}>
              <Animated.Text style={[styles.practiceMascot, { transform: [{ scale: mascotPulse }] }]}>
                {practiceResult?.correct ? '🌟' : practiceListening ? '🎧' : '😊'}
              </Animated.Text>
              <Text style={styles.practicePrompt}>Say the Word</Text>
              <Text style={styles.practiceWordDisplay}>{selectedWord}</Text>
              <Text style={styles.practiceSyllables}>{selectedWord.split('-').join('  •  ')}</Text>

              <TouchableOpacity style={styles.listenCoachButton} onPress={() => speakPracticeWord(selectedWord)}>
                <Ionicons name="volume-high-outline" size={18} color={PRIMARY} />
                <Text style={styles.listenCoachText}>Pakinggan muna</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.sayWordButton, practiceListening && styles.sayWordButtonListening]}
                onPress={practiceListening ? stopPracticeListening : startPracticeListening}
              >
                <Ionicons name={practiceListening ? 'stop-circle-outline' : 'mic-outline'} size={28} color="#fff" />
                <Text style={styles.sayWordButtonText}>{practiceListening ? 'Tapos na' : 'Say the Word'}</Text>
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
                onReplay={() => speakPracticeWord(selectedWord)}
                onRetry={() => {
                  setPracticeResult(null);
                  setPracticeTranscript('');
                  setPracticeStatus('Kaya mo yan. Subukan ulit!');
                }}
                onNext={() => {
                  const currentIndex = words.indexOf(selectedWord);
                  const nextWord = words[(currentIndex + 1) % words.length];
                  setSelectedWord(nextWord);
                  setPracticeResult(null);
                  setPracticeAttempts(0);
                  setPracticeTranscript('');
                  setPracticeStatus('Pindutin ang mikropono kapag handa ka na.');
                  speakPracticeWord(nextWord);
                }}
              />
            )}
          </ScrollView>
        </View>
      );
    }

    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const nextWord = words.find((word) => !progress?.completed_words?.includes(word));

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.practiceHeroBanner}>
          <View style={styles.practiceHeroGlowOuter}>
            <View style={styles.practiceHeroGlowInner}>
              <Ionicons name="mic" size={30} color={HOME_LAVENDER_DARK} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.practiceHeroTitle}>Handa ka na ba?</Text>
            <Text style={styles.practiceHeroSub}>Piliin ang salita at simulan ang laro! 🎉</Text>
          </View>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalTopRow}>
            <Text style={styles.goalTitle}>Daily Goal</Text>
            {goalDone > 0 ? (
              <Text style={styles.goalCount}>{goalDone}/{DAILY_GOAL}</Text>
            ) : (
              <Text style={styles.goalCountEmpty}>Bagong simula!</Text>
            )}
          </View>
          <View style={styles.goalDotsRow}>
            {Array.from({ length: DAILY_GOAL }).map((_, i) => (
              <View key={i} style={[styles.goalDot, i < goalDone && styles.goalDotFilled]}>
                {i < goalDone && <Ionicons name="star" size={14} color="#fff" />}
              </View>
            ))}
          </View>
          {goalDone === 0 && (
            <Text style={styles.goalEmptyNote}>Simulan ang unang pagsasanay ngayon! 🌱</Text>
          )}
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

        <View style={styles.wordGrid}>
          {words.map((word) => {
            const done = progress?.completed_words?.includes(word);
            const isNext = !done && word === nextWord;
            return (
              <TouchableOpacity
                key={word}
                style={[styles.wordCard, done && styles.wordCardDone, isNext && styles.wordCardNext]}
                onPress={() => {
                  setSelectedWord(word);
                  setPracticeResult(null);
                  setPracticeAttempts(0);
                  setPracticeTranscript('');
                  setPracticeStatus('Pindutin ang mikropono kapag handa ka na.');
                  speakPracticeWord(word);
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
                <Text style={[styles.wordText, done && { color: SUCCESS }]}>{word}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderActivities = () => (
    <ScrollView contentContainerStyle={styles.content}>
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

      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#E9F1E2' }]}>
          <Ionicons name="book" size={16} color={HOME_SAGE} />
          <Text style={[styles.learnBadgeText, { color: HOME_SAGE }]}>PDF LESSONS</Text>
        </View>
        <Text style={styles.learnSectionSubtitle}>Mga babasahin at aralin para sa iyo</Text>
      </View>

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
      {!lessonsLoading && !lessonsError && lessons.length ? (
        <View style={styles.learnCardList}>
          {lessons.map((lesson) => (
            <View key={lesson.id} style={styles.learnLessonCard}>
              <View style={[styles.learnIconWrap, { backgroundColor: '#E9F1E2' }]}>
                <Ionicons name="document-text" size={22} color={HOME_SAGE} />
              </View>
              <View style={styles.uploadBody}>
                <Text style={styles.learnItemTitle}>{lesson.title}</Text>
                <Text style={styles.learnItemMeta}>
                  {lesson.subject || 'Lesson'} • {lesson.grade_level || 'All grades'} • {new Date(lesson.created_at).toLocaleDateString()}
                </Text>
                {!!lesson.description && <Text style={styles.learnItemDescription}>{lesson.description}</Text>}
              </View>
              <TouchableOpacity style={[styles.learnActionButton, { backgroundColor: HOME_SAGE }]} onPress={() => openLesson(lesson)}>
                <Text style={styles.learnActionButtonText}>Open</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      {!lessonsLoading && !lessonsError && !lessons.length && (
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
    </ScrollView>
  );

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
    const avgAccuracy = (progress?.total_attempts || 0) > 0
      ? Math.round((progress?.accuracy_sum || 0) / (progress!.total_attempts || 1))
      : null;
    const tierColor = (pct: number) => (pct >= 80 ? SUCCESS : pct >= 60 ? WARNING : DANGER);
    const maxBarHeight = 90;
    const completedWords = progress?.completed_words || [];

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.progressSectionHeader}>
          <View style={styles.progressBadgePill}>
            <Ionicons name="trending-up" size={16} color={SUCCESS} />
            <Text style={styles.progressBadgeText}>PROSESO</Text>
          </View>
          <Text style={styles.progressSectionSubtitle}>Panoorin ang paglago mo sa paglipas ng panahon</Text>
        </View>

        <View style={styles.progressStatsGrid}>
          <View style={[styles.progressStatCard, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="flame" size={22} color={HOME_SUN} />
            <Text style={[styles.progressStatValue, { color: HOME_SUN }]}>{stats.streak}</Text>
            <Text style={styles.progressStatLabel}>Streak</Text>
          </View>
          <View style={[styles.progressStatCard, { backgroundColor: '#FBE7DF' }]}>
            <Ionicons name="star" size={22} color={HOME_CORAL} />
            <Text style={[styles.progressStatValue, { color: HOME_CORAL }]}>{stats.xp}</Text>
            <Text style={styles.progressStatLabel}>XP</Text>
          </View>
          <View style={[styles.progressStatCard, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="book" size={22} color={HOME_SAGE} />
            <Text style={[styles.progressStatValue, { color: HOME_SAGE }]}>{stats.completed}</Text>
            <Text style={styles.progressStatLabel}>Salita</Text>
          </View>
          <View style={[styles.progressStatCard, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="school" size={22} color={HOME_LAVENDER_DARK} />
            <Text style={[styles.progressStatValue, { color: HOME_LAVENDER_DARK }]}>{stats.level}</Text>
            <Text style={styles.progressStatLabel}>Level</Text>
          </View>
        </View>

        {/* Accuracy trend — real data from pronunciation_practice_sessions */}
        <View style={styles.progressChartCard}>
          <View style={styles.progressChartHeader}>
            <Text style={styles.progressChartTitle}>Accuracy Trend</Text>
            {avgAccuracy !== null && (
              <Text style={styles.progressChartHeadline}>
                {avgAccuracy}% <Text style={styles.progressChartHeadlineSub}>avg</Text>
              </Text>
            )}
          </View>
          {recentSessions.length >= 3 ? (
            <>
              <View style={styles.progressChartBars}>
                {recentSessions.map((session, i) => {
                  const pct = Math.max(0, Math.min(100, Math.round(Number(session.accuracy_percentage) || 0)));
                  const isLast = i === recentSessions.length - 1;
                  const color = tierColor(pct);
                  return (
                    <View key={`${session.created_at}-${i}`} style={styles.progressChartBarCol}>
                      {isLast && <Text style={[styles.progressChartBarValue, { color }]}>{pct}%</Text>}
                      <View
                        style={[
                          styles.progressChartBar,
                          { height: Math.max(6, Math.round((pct / 100) * maxBarHeight)), backgroundColor: color },
                        ]}
                        accessible
                        accessibilityLabel={`${session.word}: ${pct}% accuracy`}
                      />
                    </View>
                  );
                })}
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

        {/* Completed words */}
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
    const unlockedCount = progress?.achievements?.length || 0;
    const totalCount = ACHIEVEMENTS.length;
    const unlockPct = Math.round((unlockedCount / totalCount) * 100);

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badgesSectionHeader}>
          <View style={styles.badgesBadgePill}>
            <Ionicons name="ribbon" size={16} color={HOME_LAVENDER_DARK} />
            <Text style={styles.badgesBadgeText}>MGA BADGE</Text>
          </View>
          <Text style={styles.badgesSectionSubtitle}>Tapikin ang isang badge para makita ang detalye</Text>
        </View>

        <View style={styles.badgesSummaryCard}>
          <View style={styles.badgesSummaryTopRow}>
            <Text style={styles.badgesSummaryLabel}>Progress</Text>
            <Text style={styles.badgesSummaryCount}>{unlockedCount}/{totalCount}</Text>
          </View>
          <View style={styles.badgesSummaryTrack}>
            <View style={[styles.badgesSummaryFill, { width: `${Math.max(4, unlockPct)}%` }]} />
          </View>
        </View>

        <View style={styles.badgesGrid}>
          {ACHIEVEMENTS.map((badge) => {
            const record = progress?.achievements?.find((a) => a.id === badge.id);
            const unlocked = !!record;
            const expanded = expandedBadgeId === badge.id;
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
                {unlocked ? (
                  <View style={styles.badgeUnlockedPill}>
                    <Ionicons name="checkmark" size={11} color="#fff" />
                    <Text style={styles.badgeUnlockedPillText}>Nakuha na!</Text>
                  </View>
                ) : (
                  <View style={styles.badgeLockedPill}>
                    <Text style={styles.badgeLockedPillText}>{expanded ? 'Itago' : 'Tingnan'}</Text>
                  </View>
                )}
                {expanded && (
                  <Text style={styles.badgeCondition}>
                    {unlocked && record
                      ? `Nakuha noong ${new Date(record.unlockedAt).toLocaleDateString()}`
                      : badge.description}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
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
    <DashboardSettingsScreen role="student" navigation={navigation} embedded />
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
        <View style={styles.homeBg}>
          {topHeaderNode}
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
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} pointerEvents={sidebarOpen ? 'auto' : 'none'}>
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
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
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
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
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
}: {
  result: PracticeResult;
  word: string;
  onReplay: () => void;
  onRetry: () => void;
  onNext: () => void;
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

        <View style={[styles.accuracyRing, { borderColor: ringColor }]}>
          <Text style={styles.accuracyPercent}>{score}%</Text>
          <Text style={styles.accuracyLabel}>accuracy</Text>
        </View>
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

      <View style={[styles.accuracyRing, { borderColor: ringColor }]}>
        <Text style={[styles.accuracyPercent, { color: ringColor }]}>{score}%</Text>
        <Text style={styles.accuracyLabel}>accuracy</Text>
      </View>
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
  progressSectionHeader: { marginBottom: 14 },
  progressBadgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#E9F7F1', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 8,
  },
  progressBadgeText: { color: SUCCESS, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  progressSectionSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  progressStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  progressStatCard: {
    width: '48%', borderRadius: 20, padding: 14, alignItems: 'flex-start', minHeight: 84, justifyContent: 'center',
  },
  progressStatValue: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 20, marginTop: 8 },
  progressStatLabel: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '700', marginTop: 2 },
  progressChartCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16 },
  progressChartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  progressChartTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 16 },
  progressChartHeadline: { color: SUCCESS, fontWeight: '900', fontSize: 20 },
  progressChartHeadlineSub: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12 },
  progressChartBars: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 130, gap: 6, paddingHorizontal: 4,
  },
  progressChartBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  progressChartBarValue: { fontSize: 10, fontWeight: '900', marginBottom: 4 },
  progressChartBar: { width: '100%', borderRadius: 4, minWidth: 10 },
  progressChartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  progressLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressLegendDot: { width: 8, height: 8, borderRadius: 4 },
  progressLegendText: { color: HOME_INK_SOFT, fontSize: 11, fontWeight: '700' },
  progressChartEmpty: { alignItems: 'center', paddingVertical: 24 },
  progressChartEmptyText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 18 },
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
  badgesSectionHeader: { marginBottom: 14 },
  badgesBadgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: '#EFECFB', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 8,
  },
  badgesBadgeText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  badgesSectionSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  badgesSummaryCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16 },
  badgesSummaryTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  badgesSummaryLabel: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 15 },
  badgesSummaryCount: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 15 },
  badgesSummaryTrack: { backgroundColor: 'rgba(124,111,207,0.15)', height: 14, borderRadius: 999, overflow: 'hidden' },
  badgesSummaryFill: { backgroundColor: HOME_LAVENDER, height: 14, borderRadius: 999 },
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
  badgeLockedPill: {
    backgroundColor: 'rgba(59,50,44,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8,
  },
  badgeLockedPillText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 11 },
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
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wordCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, minWidth: '30%', minHeight: 64,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#EEE9F9',
  },
  wordCardNext: { borderColor: HOME_LAVENDER, borderWidth: 2, backgroundColor: '#F5F3FC' },
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
  homeTodayCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, padding: 18, marginBottom: 16,
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
  homeGridValue: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 20, marginTop: 8 },
  homeGridLabel: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12, marginTop: 2 },
  homeContinueCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFECFB', borderRadius: 20, padding: 16, marginBottom: 16, gap: 12,
  },
  homeContinueTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 15 },
  homeContinueSubtitle: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 2, marginBottom: 10 },
  homeContinueTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeContinueTrack: { flex: 1, backgroundColor: 'rgba(124,111,207,0.2)', height: 8, borderRadius: 999, overflow: 'hidden' },
  homeContinueFill: { backgroundColor: HOME_LAVENDER, height: 8, borderRadius: 999 },
  homeContinuePct: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 12 },
  homeContinueButton: { backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 16 },
  homeContinueButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
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
    backgroundColor: '#FFF3DC', borderRadius: 20, padding: 18, marginTop: 4, marginBottom: 16,
  },
  homeQuoteText: { color: '#8A6416', fontWeight: '800', fontSize: 14, textAlign: 'center', lineHeight: 20, fontStyle: 'italic' },
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
  practiceHeroBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: HOME_LAVENDER,
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
  },
  practiceHeroGlowOuter: {
    width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  practiceHeroGlowInner: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  practiceHeroTitle: { color: '#fff', fontWeight: '900', fontSize: 22 },
  practiceHeroSub: { color: 'rgba(255,255,255,0.9)', fontWeight: '700', marginTop: 4 },
  goalCard: {
    backgroundColor: HOME_CREAM,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  goalTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalTitle: { color: HOME_INK, fontWeight: '900' },
  goalCount: { color: HOME_LAVENDER_DARK, fontWeight: '900' },
  goalCountEmpty: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 12 },
  goalDotsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  goalDot: {
    flex: 1, height: 32, borderRadius: 16, backgroundColor: 'rgba(124,111,207,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  goalDotFilled: { backgroundColor: HOME_LAVENDER },
  goalEmptyNote: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 10 },
  rewardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  rewardPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, paddingRight: 12 },
  rewardIconWrap: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rewardText: { fontWeight: '900', fontSize: 12 },
  practiceHero: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  practiceMascot: { fontSize: 58, marginBottom: 6 },
  practicePrompt: { color: TEXT_SECONDARY, fontWeight: '900', textTransform: 'uppercase', fontSize: 12, marginBottom: 4 },
  practiceCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  practiceWordDisplay: {
    fontSize: 56, fontWeight: '900', color: PRIMARY,
    letterSpacing: 0, textAlign: 'center', marginBottom: 6,
    fontFamily: 'System',
  },
  practiceSyllables: { color: '#7c3aed', fontSize: 16, fontWeight: '900', marginBottom: 14 },
  practiceWordLevel: {
    textAlign: 'center', color: TEXT_SECONDARY, fontSize: 13,
    marginBottom: 20,
  },
  listenCoachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PRIMARY_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 14,
  },
  listenCoachText: { color: PRIMARY, fontWeight: '900' },
  sayWordButton: {
    width: '100%',
    minHeight: 68,
    borderRadius: 8,
    backgroundColor: PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: PRIMARY,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  sayWordButtonListening: { backgroundColor: '#dc2626' },
  sayWordButtonText: { color: '#fff', fontWeight: '900', fontSize: 20 },
  practiceStatus: { color: TEXT_PRIMARY, textAlign: 'center', fontWeight: '800', marginTop: 14 },
  practiceTranscript: { color: TEXT_SECONDARY, textAlign: 'center', marginTop: 8, fontWeight: '700' },
  
  backButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8,
  },
  backText: { color: PRIMARY, fontWeight: '700', fontSize: 15 },

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
