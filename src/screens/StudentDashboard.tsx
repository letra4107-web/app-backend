import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { API_BASE_URL, getJson } from '../config/api';
import { onAuthStateChanged, signOutUser } from '../services/supabaseService';
import StudentWordOfDay from './StudentWordOfDay';
import ConfettiOverlay from '../components/ConfettiOverlay';
import AchievementModal from './AchievementModal';
import { getOrCreateWordOfDay, WordOfDayLog } from '../services/wordOfDayService';
import { buildNextProgress, ChildProgress, saveProgress } from '../services/progressService';
import { ACHIEVEMENTS, unlockAchievements } from '../services/achievementService';
import { fetchStudentActivities, StudentActivity } from '../services/activityService';
import { fetchPublishedLessons, Lesson, subscribeToPublishedLessons } from '../services/lessonService';
import { createParentNotification } from '../services/notificationService';
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
const PRIMARY_TEXT = '#3730a3';
const SURFACE = '#ffffff';
const BACKGROUND = '#f5f3ff';
const BORDER = '#e5e7eb';
const TEXT_PRIMARY = '#111827';
const TEXT_SECONDARY = '#6b7280';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';
const DANGER = '#ef4444';
const XP_GOLD = '#f59e0b';
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

const DEFAULT_PHONETIC_WORDS = ['Ba-ba', 'Ka-ma', 'A-so', 'Ma-no', 'La-pis'];
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
});

const todayKey = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StudentDashboard({ navigation }: any) {
  const [child, setChild] = useState<ChildProfile | null>(null);
  const [progress, setProgress] = useState<ChildProgress | null>(null);
  const [wordOfDay, setWordOfDay] = useState<WordOfDayLog | null>(null);
  const [practiceWords, setPracticeWords] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activities, setActivities] = useState<StudentActivity[]>([]);
  const [uploadsError, setUploadsError] = useState<string>('');
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState<string>('');
  const [activitiesError, setActivitiesError] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [practiceAttempts, setPracticeAttempts] = useState(0);
  type Section = 'home' | 'learn' | 'practice' | 'progress' | 'settings';
  const [section, setSection] = useState<Section>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [achievement, setAchievement] = useState<{ emoji: string; title: string } | null>(null);
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
        `${API_BASE_URL}/reading/uploads`,
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

  const fetchChildProfile = async (authUid: string) => {
    const url = `${API_BASE_URL}/auth/child-profile/${authUid}`;

    let response: { success: boolean; child?: ChildProfile; message?: string; details?: any; code?: string; hint?: string };
    try {
      response = await getJson(url, 30000);
    } catch (fetchErr: any) {
      console.error('[StudentDashboard] child-profile fetch failed:', {
        url,
        authUid,
        message: fetchErr?.message,
        status: fetchErr?.status,
        data: fetchErr?.data,
      });
      throw new Error(
        'Hindi ma-load ang iyong profile. Siguraduhing tumatakbo ang backend at may internet connection.'
      );
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

    const [wordLog, readingActivities, uploads, lessonRows, assignedActivities] = await Promise.all([
      getOrCreateWordOfDay(profile.id, Number(profile.grade_level || 1)),
      supabase.from('reading_activities').select('words').eq('grade', Number(profile.grade_level || 1)),
      fetchTeacherUploads(Number(profile.grade_level || 1)),
      loadPublishedLessons(Number(profile.grade_level || 1)),
      fetchStudentActivities(profile.auth_uid, profile.id).catch((err) => {
        console.warn('[StudentDashboard] activities load failed:', err?.message || err);
        setActivitiesError('Hindi ma-load ang activity calendar. Subukan muli mamaya.');
        return [] as StudentActivity[];
      }),
    ]);

    setWordOfDay(wordLog);

    if (readingActivities.error) throw readingActivities.error;
    const practiceWordsList = (readingActivities.data || []).flatMap((row: any) =>
      Array.isArray(row.words) ? row.words : []
    );
    setPracticeWords([...new Set(practiceWordsList)]);
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
    if (status === 'overdue') return DANGER;
    return WARNING;
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
    const { error } = await supabase
      .from('activities')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', activity.id);

    if (error) {
      console.warn('[Activities] complete failed:', error.message || error);
      Alert.alert('Hindi na-save', 'Hindi ma-complete ang activity. Subukan muli.');
      return;
    }

    setActivities((prev) =>
      prev.map((item) => (item.id === activity.id ? { ...item, status: 'completed' } : item)),
    );
    await notifyParent('Assignment Completed', `${child?.name || 'Student'} completed "${activity.title}".`, 'assignment');
  };

  const handleWordOfDayResult = async (correct: boolean, attempts: number, score?: number, transcript?: string) => {
    try {
      if (!progress) return;
      const addXp = correct ? XP_CORRECT : XP_WRONG;
      const next = buildNextProgress(progress, wordOfDay?.word || '', addXp, { countsAsPracticeSession: false });
      await saveProgress(next);
      setProgress(next);
      await notifyParent(
        'Word of the Day',
        `${child?.name || 'Student'} ${correct ? 'completed' : 'tried'} the word "${wordOfDay?.word || ''}" and earned ${addXp} XP.`,
        'word',
      );
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next, child?.name || '', child?.parent_id);
      if (newlyUnlocked?.length) setAchievement({ emoji: newlyUnlocked[0].emoji || '🏅', title: newlyUnlocked[0].title || 'Bagong Badge' });
    } catch (e) {
      console.warn('wordOfDay result handling failed', e);
    }
  };

  const speakPracticeWord = (word = selectedWord || '') => {
    if (!word) return;
    Speech.stop();
    Speech.speak(word.replace(/-/g, ' '), {
      language: 'fil-PH',
      rate: 0.68,
      pitch: 1.1,
    });
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
      const xpAward = correct ? XP_CORRECT : 0;
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

      Speech.stop();
      Speech.speak(correct ? feedback : `${feedback} Pakinggan mo. ${selectedWord.replace(/-/g, ' ')}`, {
        language: 'fil-PH',
        rate: correct ? 0.9 : 0.72,
        pitch: 1.12,
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
      const next = buildNextProgress(progress, selectedWord, xpAward, { countsAsPracticeSession: true });
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
      if (updatedProgress) setProgress(updatedProgress);
      if (newlyUnlocked?.length) setAchievement({ emoji: newlyUnlocked[0].emoji || '🏅', title: newlyUnlocked[0].title || 'Bagong Badge' });
    } catch (e) {
      console.warn('practice result handler failed', e);
    }
  };

  const startPracticeListening = async () => {
    if (!selectedWord) return;
    try {
      setPracticeResult(null);
      setPracticeTranscript('');
      setPracticeStatus('Humihingi ng microphone permission...');
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

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setPracticeStatus('Kailangan natin ng microphone permission para makinig.');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'fil-PH',
        interimResults: true,
        continuous: false,
        maxAlternatives: 3,
        contextualStrings: [selectedWord, selectedWord.replace(/-/g, ''), ...DEFAULT_PHONETIC_WORDS],
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 700,
          EXTRA_MASK_OFFENSIVE_WORDS: false,
        },
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

  const renderWordOfDay = () => (
    <ScrollView contentContainerStyle={styles.content}>
      {!!error && (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => setRetryKey((prev) => prev + 1)}
          >
            <Text style={styles.retryButtonText}>Subukan muli</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Welcome banner */}
      <View style={styles.welcomeBanner}>
        <Text style={styles.welcomeHello}>Kumusta, {getFirstName(child?.name || '')}! 👋</Text>
        <Text style={styles.welcomeSub}>Handa ka na bang matuto ngayon?</Text>
        <View style={styles.chipsRow}>
          <View style={styles.chip}><Text style={styles.chipText}>🔥 {stats.streak}</Text></View>
          <View style={styles.chip}><Text style={styles.chipText}>⭐ {stats.xp}</Text></View>
          <View style={styles.chip}><Text style={styles.chipText}>📖 {stats.completed}</Text></View>
        </View>
      </View>

      {/* Word of the Day — main focus */}
      {wordOfDay ? (
        <View style={styles.wordOfDayCard}>
          <Text style={styles.sectionTitle}>Salita Ngayon 📅</Text>
          <Text style={styles.sectionSubtitle}>Bigkasin ang salitang ito nang tama!</Text>
          <StudentWordOfDay log={wordOfDay} onResult={handleWordOfDayResult} />
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📅</Text>
          <Text style={styles.empty}>Wala pang salita ngayon. Subukan muli mamaya.</Text>
        </View>
      )}

      {/* XP bar below word of the day */}
      <View style={styles.levelCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={styles.levelLabel}>📚 {stats.level}</Text>
          {levelInfo.next && (
            <Text style={{ color: TEXT_SECONDARY, fontSize: 12 }}>
              {Math.max(0, levelInfo.need - levelInfo.current)} XP → {levelInfo.next}
            </Text>
          )}
        </View>
        <View style={styles.xpBarTrack}>
          <View style={[styles.xpBarFill, { width: `${Math.round((levelInfo.current / levelInfo.max) * 100)}%` }]} />
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickAction} onPress={() => setSection('learn')}>
          <Ionicons name="library-outline" size={20} color={PRIMARY} />
          <Text style={styles.quickLabel}>Learn</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickAction} onPress={() => setSection('practice')}>
          <Ionicons name="mic-outline" size={20} color={PRIMARY} />
          <Text style={styles.quickLabel}>Practice</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickAction} onPress={() => setSection('progress')}>
          <Ionicons name="analytics-outline" size={20} color={PRIMARY} />
          <Text style={styles.quickLabel}>Progress</Text>
        </TouchableOpacity>
      </View>

      {/* Calendar widget */}
      <View style={styles.homeCalendarWidget}>
        <View style={styles.homeCalendarHeader}>
          <Text style={styles.homeCalendarTitle}>📅 Upcoming Deadlines</Text>
          <TouchableOpacity onPress={() => setSection('learn')}>
            <Text style={styles.homeCalendarLink}>View lessons</Text>
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
              <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.empty}>No upcoming activities yet.</Text>
        )}
      </View>
    </ScrollView>
  );

  const renderPractice = () => {
    const words = practiceWords.length ? practiceWords : DEFAULT_PHONETIC_WORDS;
    const goalProgress = Math.min(100, Math.round(((progress?.total_attempts || 0) % DAILY_GOAL) / DAILY_GOAL * 100));

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

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.practiceIntro}>
          <Text style={styles.practiceIntroEmoji}>🎤</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.practiceIntroTitle}>Say the Word</Text>
            <Text style={styles.practiceIntroSub}>Makinig, magsalita, kumuha ng stars, at dagdagan ang XP.</Text>
          </View>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalTopRow}>
            <Text style={styles.goalTitle}>Daily Goal</Text>
            <Text style={styles.goalCount}>{Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL)}/{DAILY_GOAL}</Text>
          </View>
          <View style={styles.goalTrack}>
            <View style={[styles.goalFill, { width: `${goalProgress}%` }]} />
          </View>
          <View style={styles.rewardRow}>
            <View style={styles.rewardPill}><Text style={styles.rewardText}>⭐ {stats.xp} XP</Text></View>
            <View style={styles.rewardPill}><Text style={styles.rewardText}>🔥 {stats.streak} streak</Text></View>
            <View style={styles.rewardPill}><Text style={styles.rewardText}>🏅 {progress?.achievements?.length || 0} badges</Text></View>
          </View>
        </View>

        <View style={styles.wordGrid}>
          {words.map((word) => {
            const done = progress?.completed_words?.includes(word);
            return (
              <TouchableOpacity
                key={word}
                style={[styles.wordCard, done && styles.wordCardDone]}
                onPress={() => {
                  setSelectedWord(word);
                  setPracticeResult(null);
                  setPracticeAttempts(0);
                  setPracticeTranscript('');
                  setPracticeStatus('Pindutin ang mikropono kapag handa ka na.');
                  speakPracticeWord(word);
                }}
              >
                {done && (<Text style={styles.wordCardCheck}>✅</Text>)}
                <Text style={[styles.wordText, done && { color: '#10b981' }]}>{word}</Text>
                <Text style={styles.wordCardHint}>Tapikin</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderActivities = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Learn</Text>
      <Text style={styles.sectionSubtitle}>Teacher PDF lessons and assigned learning materials.</Text>
      {activities.length ? (
        <View style={styles.selectedTasksCard}>
          {activities.map((activity) => (
            <View key={activity.id} style={styles.activityTaskRow}>
              <View style={[styles.statusStrip, { backgroundColor: getStatusColor(activity.status) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTaskTitle}>{activity.title}</Text>
                <Text style={styles.activityTaskMeta}>
                  {activity.subject || 'Activity'} • Due {new Date(activity.deadline).toLocaleDateString()}
                </Text>
                {!!activity.description && <Text style={styles.activityTaskDescription}>{activity.description}</Text>}
              </View>
              {activity.status === 'completed' ? (
                <Text style={[styles.statusBadge, { color: getStatusColor(activity.status) }]}>{activity.status}</Text>
              ) : (
                <TouchableOpacity style={styles.openButton} onPress={() => void completeActivity(activity)}>
                  <Text style={styles.openButtonText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📋</Text>
          <Text style={styles.empty}>Wala pang assigned activities.</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>PDF Lessons</Text>
      {lessonsLoading && (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="small" color={PRIMARY} />
          <Text style={styles.empty}>Loading lessons...</Text>
        </View>
      )}
      {!!lessonsError && (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{lessonsError}</Text>
        </View>
      )}
      {!lessonsLoading && lessons.length ? (
        lessons.map((lesson) => (
          <View key={lesson.id} style={styles.uploadCard}>
            <Ionicons name="document-text-outline" size={26} color={PRIMARY} />
            <View style={styles.uploadBody}>
              <Text style={styles.uploadTitle}>{lesson.title}</Text>
              <Text style={styles.uploadDate}>
                {lesson.subject || 'Lesson'} - {lesson.grade_level || 'All grades'} - {new Date(lesson.created_at).toLocaleDateString()}
              </Text>
              {!!lesson.description && <Text style={styles.activityTaskDescription}>{lesson.description}</Text>}
            </View>
            <TouchableOpacity style={styles.openButton} onPress={() => openLesson(lesson)}>
              <Text style={styles.openButtonText}>Open</Text>
            </TouchableOpacity>
          </View>
        ))
      ) : null}
      {!lessonsLoading && !lessons.length && <Text style={styles.empty}>No lessons uploaded yet.</Text>}

      {!!uploadsError && (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{uploadsError}</Text>
        </View>
      )}
      {!lessons.length && uploads.map((upload) => {
        const name = upload.metadata?.title || upload.path.split('/').pop() || 'Aralin';
        return (
          <View key={upload.id} style={styles.uploadCard}>
            <Ionicons name={iconForUpload(upload.content_type)} size={26} color={PRIMARY} />
            <View style={styles.uploadBody}><Text style={styles.uploadTitle}>{name}</Text><Text style={styles.uploadDate}>{new Date(upload.created_at).toLocaleDateString()}</Text></View>
            <TouchableOpacity style={styles.openButton} onPress={() => openUpload(upload)}><Text style={styles.openButtonText}>Buksan</Text></TouchableOpacity>
          </View>
        );
      })}
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
              const hasCompleted = dayActivities.some((activity) => activity.status === 'completed');
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
                <Text style={[styles.statusBadge, { color: getStatusColor(activity.status) }]}>{activity.status}</Text>
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

  const renderProgress = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Proseso</Text>
      <View style={styles.statsGrid}>
        <View style={styles.statCard}><Text style={styles.statValue}>🔥 {stats.streak}</Text><Text style={styles.statLabel}>Streak</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>⭐ {stats.xp}</Text><Text style={styles.statLabel}>XP</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>{stats.completed}</Text><Text style={styles.statLabel}>Words</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>{stats.level}</Text><Text style={styles.statLabel}>Level</Text></View>
      </View>
      <Text style={{ marginTop: 12 }}>Mga Salitang Natapos</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {(progress?.completed_words || []).slice(0,5).map((w) => (<View key={w} style={{ backgroundColor: '#eef2ff', padding: 8, borderRadius: 12, marginRight: 8 }}><Text>{w}</Text></View>))}
        {progress && (progress.completed_words?.length || 0) > 5 && <Text style={{ alignSelf: 'center' }}>+{(progress.completed_words?.length || 0) - 5} pa</Text>}
      </View>
    </ScrollView>
  );

  const renderAchievements = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Mga Badge Mo 🏆</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {ACHIEVEMENTS.map((badge) => {
          const unlocked = progress?.achievements?.some((a) => a.id === badge.id);
          return (
            <View key={badge.id} style={[styles.badgeCard, unlocked ? {} : styles.lockedBadge, { width: '48%' }]}>
              <Text style={styles.badgeEmoji}>{unlocked ? badge.emoji : '🔒'}</Text>
              <Text style={styles.badgeTitle}>{badge.title}</Text>
              {unlocked ? <Text style={{ color: SUCCESS }}>✅ Na-unlock</Text> : <Text style={{ color: TEXT_SECONDARY }}> Patuloy lang!</Text>}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  const renderNotifications = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Messages / Notifications</Text>
      <View style={styles.profileCard}>
        <View style={styles.profileRow}>
          <Ionicons name="notifications-outline" size={22} color={PRIMARY} />
          <View style={{ flex: 1 }}>
            <Text style={styles.profileLabel}>Learning updates</Text>
            <Text style={styles.profileValue}>
              Assignment reminders and teacher messages will appear here.
            </Text>
          </View>
        </View>
      </View>
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

  return (
    <View style={styles.container}>
      {/* Top header */}
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={openSidebar} style={{ padding: 8 }}><Ionicons name="menu-outline" size={28} color={PRIMARY} /></TouchableOpacity>
        <Text style={styles.appTitle}>LinawLetra</Text>
        <View style={styles.streakPill}><Text style={{ color: '#fff', fontWeight: '900' }}>🔥 {stats.streak}</Text></View>
      </View>

      {/* Section content */}
      {section === 'home' && renderWordOfDay()}
      {section === 'learn' && renderActivities()}
      {section === 'practice' && renderPractice()}
      {section === 'progress' && renderProgress()}
      {section === 'settings' && renderSettings()}

      {/* Sidebar overlay + animated sidebar */}
      {sidebarOpen && (
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} pointerEvents={sidebarOpen ? 'auto' : 'none'}>
          <TouchableOpacity style={{ flex: 1 }} onPress={closeSidebar} />
        </Animated.View>
      )}
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}>
        <View style={styles.sidebarProfile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.sidebarName}>{child?.name || 'Estudyante'}</Text>
          <Text style={styles.sidebarEmail}>{child?.username || 'student account'}</Text>
        </View>
        <ScrollView style={styles.sidebarNav} showsVerticalScrollIndicator={false}>
          {[
            { k: 'home', l: 'Home', i: 'home-outline' },
            { k: 'learn', l: 'Learn', i: 'library-outline' },
            { k: 'practice', l: 'Practice', i: 'mic-outline' },
            { k: 'progress', l: 'Progress', i: 'analytics-outline' },
            { k: 'settings', l: 'Settings', i: 'settings-outline' },
          ].map((it: any) => (
            <TouchableOpacity
              key={it.k}
              style={[styles.navItem, section === it.k && styles.navItemActive]}
              onPress={() => navigateTo(it.k)}
            >
              <Ionicons name={it.i as any} size={20} color={section === it.k ? PRIMARY_TEXT : '#fff'} />
              <Text style={[styles.navLabel, section === it.k && styles.navLabelActive]}>{it.l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.sidebarLogout} onPress={async () => { await signOutUser(); navigation.replace('Login'); }}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.sidebarLogoutText}>Mag-log out</Text>
        </TouchableOpacity>
      </Animated.View>

      <AchievementModal
        visible={!!achievement}
        emoji={achievement?.emoji || ''}
        title={achievement?.title || ''}
        onClose={() => setAchievement(null)}
      />
    </View>
  );
}

function Stat({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={20} color={PRIMARY} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  container: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
  header: { paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 24, fontWeight: '900', color: '#111827' },
  subtitle: { color: '#6B7280', marginTop: 4 },
  logout: { backgroundColor: '#E74C3C', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 48 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { width: '48%', backgroundColor: '#fff', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' },
  statValue: { fontSize: 18, fontWeight: '900', color: '#111827', marginTop: 8 },
  statLabel: { color: '#6B7280', fontSize: 12, marginTop: 4 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#111827', marginTop: 18, marginBottom: 10 },
  badgeRow: { gap: 10, paddingBottom: 4 },
  badgeCard: { width: 128, backgroundColor: '#fff', borderRadius: 8, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  lockedBadge: { opacity: 0.55 },
  badgeEmoji: { fontSize: 28 },
  badgeTitle: { textAlign: 'center', fontWeight: '800', color: '#374151', marginTop: 6 },
  uploadCard: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  uploadBody: { flex: 1 },
  uploadTitle: { fontWeight: '800', color: '#111827' },
  uploadDate: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  openButton: { backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  openButtonText: { color: '#fff', fontWeight: '800' },
  wordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wordCard: { backgroundColor: '#fff', borderRadius: 8, padding: 14, minWidth: '30%', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
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
  topHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 12 },
  appTitle: { fontSize: 20, fontWeight: '900', color: PRIMARY },
  streakPill: { backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000' },
  sidebar: {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: 270,
    backgroundColor: PRIMARY, paddingTop: 48, zIndex: 100,
    shadowColor: '#000', shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.18, shadowRadius: 20, elevation: 20,
  },
  sidebarProfile: {
    alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarText: { fontSize: 26, fontWeight: '900', color: '#fff' },
  sidebarName: { fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'center' },
  sidebarEmail: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4, textAlign: 'center' },
  sidebarNav: { flex: 1, paddingHorizontal: 14, paddingTop: 16 },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14,
    marginBottom: 4,
  },
  navItemActive: { backgroundColor: '#fff' },
  navLabel: { fontSize: 14, fontWeight: '700', color: '#fff', flex: 1 },
  navLabelActive: { color: PRIMARY_TEXT },
  sidebarLogout: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 20, padding: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  sidebarLogoutText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  welcomeBanner: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 14 },
  welcomeHello: { fontSize: 20, fontWeight: '900', color: '#111827' },
  welcomeSub: { color: '#6B7280', marginTop: 6 },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { backgroundColor: '#eef2ff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginRight: 8 },
  chipText: { color: PRIMARY, fontWeight: '800' },
  levelCard: { backgroundColor: '#fff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  levelLabel: { color: '#6B7280', fontWeight: '700' },
  levelName: { fontSize: 18, fontWeight: '900', color: '#111827' },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  xpBarTrack: { backgroundColor: '#F3F4F6', height: 10, borderRadius: 8, marginTop: 10, overflow: 'hidden' },
  xpBarFill: { backgroundColor: '#4f46e5', height: 10 },
  levelNote: { color: '#6B7280', marginTop: 8 },
  wordOfDayCard: { backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  quickAction: { backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', width: '32%', borderWidth: 1, borderColor: '#E5E7EB' },
  quickLabel: { marginTop: 8, fontWeight: '800', color: PRIMARY },
  bigWord: { fontSize: 48, fontWeight: '900', color: PRIMARY, marginVertical: 10 },
  listenButton: { marginTop: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: PRIMARY },
  // Practice feedback styles
  practiceIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: PRIMARY,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  practiceIntroEmoji: { fontSize: 34 },
  practiceIntroTitle: { color: '#fff', fontWeight: '900', fontSize: 24 },
  practiceIntroSub: { color: '#e0e7ff', fontWeight: '700', marginTop: 4 },
  goalCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 14,
  },
  goalTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalTitle: { color: TEXT_PRIMARY, fontWeight: '900' },
  goalCount: { color: PRIMARY, fontWeight: '900' },
  goalTrack: { backgroundColor: '#f1f5f9', borderRadius: 999, height: 12, overflow: 'hidden', marginTop: 10 },
  goalFill: { backgroundColor: PRIMARY, height: 12, borderRadius: 999 },
  rewardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  rewardPill: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  rewardText: { color: '#92400e', fontWeight: '900', fontSize: 12 },
  wordCardHint: { color: TEXT_SECONDARY, fontSize: 11, marginTop: 6, fontWeight: '700' },
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
  wordCardCheck: { position: 'absolute', top: 6, right: 6, fontSize: 14 },
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
  homeCalendarWidget: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  homeCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  homeCalendarTitle: { color: TEXT_PRIMARY, fontWeight: '900', fontSize: 16 },
  homeCalendarLink: { color: PRIMARY, fontWeight: '800' },
  homeActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  homeStatusDot: { width: 10, height: 10, borderRadius: 5 },
  homeActivityTitle: { color: TEXT_PRIMARY, fontWeight: '900' },
  homeActivityMeta: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 2 },
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
