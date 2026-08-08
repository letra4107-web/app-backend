import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import ReanimatedView, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { createSpeechRecognitionSession } from '../utils/speechRecognitionSession';
import { syllabifyText } from '../utils/tagalogSyllabification';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { buildApiUrl, getJson } from '../config/api';
import { onAuthStateChanged, signOutUser } from '../services/supabaseService';
import StudentWordOfDay from './StudentWordOfDay';
import ErrorBoundary from '../components/ErrorBoundary';
import ConfettiOverlay from '../components/ConfettiOverlay';
import AchievementModal from './AchievementModal';
import { getOrCreateWordOfDay, WordOfDayLog } from '../services/wordOfDayService';
import { buildNextProgress, ChildProgress, saveProgress } from '../services/progressService';
import {
  ACHIEVEMENTS, unlockAchievements, getPronunciationStats, PronunciationStats, AchievementCategory, AchievementDefinition,
  MIN_ATTEMPTS_FOR_AVERAGE_BADGE, CHALLENGING_WORDS_REQUIRED, IMPROVEMENT_POINTS_REQUIRED, averageAccuracy,
} from '../services/achievementService';
import { fetchStudentActivities, StudentActivity } from '../services/activityService';
import { speakPhrase, stopSpeaking, setTtsEnabled, setSpeechRateSetting } from '../services/ttsService';
import { speakWordCloud, speakSyllablesCloud, stopCloudSpeaking } from '../services/cloudTtsService';
import SyllableKaraokeText from '../components/SyllableKaraokeText';
import WordMeaningReveal from '../components/WordMeaningReveal';
import { fetchDashboardSettings, updateDashboardSettings, DashboardSettings } from '../services/settingsService';
import { fetchPublishedLessons, Lesson, subscribeToPublishedLessons } from '../services/lessonService';
import { fetchLessonProgress, markLessonCompleted, markLessonOpened, LessonProgressRow } from '../services/lessonProgressService';
import { PRACTICE_PASSING_SCORE, scorePronunciation, scoreMessage } from '../utils/scorePronunciation';
import { fetchPersonalizedContent, RankedContentEntry } from '../services/wordsService';
import { createNotification, createParentNotification, fetchNotifications, markNotificationRead, NotificationItem, subscribeToStudentNotifications } from '../services/notificationService';
import { loadWordDefinitions, normalizeWordKey, WordDefinition } from '../services/wordDefinitionsService';
import DashboardSettingsScreen from './DashboardSettingsScreen';
import { logPhonemeConfusion } from '../services/phonemeService';
import { analyzePhonology } from '../utils/tagalogPhonemes';
import { fetchReadingProfile, ReadingProfile } from '../services/readingInsightsService';
import { accessibilityFromSettings, useAccessibility } from '../contexts/AccessibilityContext';
import {
  fetchCompletedContentIds,
  fetchOfficialReadingProgress,
  fetchReadingContent,
  OfficialReadingProgress,
  ReadingContentItem,
  ReadingContentType,
  recordReadingContentAttempt,
} from '../services/readingContentService';

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
const PRIMARY_LIGHT = '#eef2ff';
const BORDER = '#e5e7eb';
const TEXT_PRIMARY = '#111827';
const TEXT_SECONDARY = '#6b7280';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';
const DANGER = '#ef4444';
// Text-only variants of WARNING/DANGER: the base hex values are tuned for
// backgrounds/icons/borders and fail WCAG AA (~2.15:1 / ~3.78:1) when used as
// text color on white. These darker shades stay in the same amber/red family
// but clear AA for normal-size text. Use ONLY for Text color - leave
// WARNING/DANGER as-is everywhere else.
const WARNING_TEXT = '#B45309';
const DANGER_TEXT = '#DC2626';
const XP_GOLD = '#f59e0b';

// Home tab tokens — a warm, "reading journey" pastel palette
// (cream/lavender/coral/sage/sun). Scoped to Home; other tabs keep PRIMARY etc.
const HOME_CREAM = '#FBF3E2';
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#5F5044';
const HOME_SUN = '#E3971A';
const HOME_CORAL = '#E06B4C';
const HOME_SAGE = '#5C8047';
const HOME_LAVENDER = '#7C6FCF';
const HOME_LAVENDER_DARK = '#5F52B0';
// Hero banner brand gradient only - not part of the general HOME_* palette
// used elsewhere on the page.
const HERO_GRADIENT_START = '#6D28D9';
// Darkened ~10% from the original #A855F7 - that shade only gave white hero
// text ~3.96:1 contrast at this gradient stop, below WCAG AA's 4.5:1 minimum
// for normal-size text (the smaller heroSubtitle line specifically failed).
// This keeps the same hue while clearing ~4.77:1.
const HERO_GRADIENT_MID = '#974CDE';
const HERO_GRADIENT_END = '#9D174D';
// Quick Stats icon-circle fills only - deliberately more saturated than the
// shared HOME_SAGE/HOME_CORAL/HOME_LAVENDER_DARK/HOME_SUN tokens (which stay
// unchanged everywhere else, e.g. Progress/Achievements), since those were
// reported as reading like faded tints rather than bold solid colors here.
const VIVID_GREEN = '#16A34A';
const VIVID_ORANGE = '#EA580C';
const VIVID_VIOLET = '#7C3AED';
const VIVID_AMBER = '#F59E0B';
const VIVID_TEAL = '#0D9488';
const VIVID_NAVY = '#1E3A8A';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';
// Single source of truth for the drawer's width - the closed-position
// translateX must always equal -SIDEBAR_WIDTH so the drawer fully clears the
// screen edge. A stale hardcoded offset here (from before the drawer was
// widened) was the bug: it left a permanent sliver of the drawer visible even
// when "closed".
const SIDEBAR_WIDTH = 300;
const XP_CORRECT = 50;
const XP_WRONG = 0;
const DAILY_GOAL = 5;

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

type SkillCategory = 'letters' | 'syllables' | 'words';
type CurriculumPracticeType = Exclude<ReadingContentType, 'paragraph'>;

const categorizeWord = (word: string): SkillCategory => {
  const clean = word.replace(/-/g, '');
  if (clean.length <= 1) return 'letters';
  const syllables = word.split('-').filter(Boolean);
  if (syllables.length <= 2) return 'syllables';
  return 'words';
};
const emptyProgress = (childId: string): ChildProgress => ({
  child_id: childId,
  xp: 0,
  level: 'Beginner',
  streak: 0,
  longest_streak: 0,
  last_practice_date: null,
  completed_words: [],
  total_attempts: 0,
  achievements: [],
  badges: [],
  baseline_accuracy: null,
  accuracy_sum: 0,
  activities_completed: 0,
});

const formatElapsed = (totalSeconds: number) => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StudentDashboard({ navigation }: any) {
  const [child, setChild] = useState<ChildProfile | null>(null);
  const [progress, setProgress] = useState<ChildProgress | null>(null);
  const [wordOfDay, setWordOfDay] = useState<WordOfDayLog | null>(null);
  const [wordDefinitions, setWordDefinitions] = useState<Map<string, WordDefinition>>(new Map());
  const getWordDefinition = (word: string) => wordDefinitions.get(normalizeWordKey(word));
  const [recentSessions, setRecentSessions] = useState<{ word: string; accuracy_percentage: number; created_at: string }[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonProgress, setLessonProgress] = useState<LessonProgressRow[]>([]);
  // The single current curriculum item to practice next, per the sequential
  // frontier the backend already computes (rankCurriculum's
  // first-incomplete-item-per-track policy) - the client never downloads or
  // ranks the full curriculum bank itself.
  const [currentPracticeItem, setCurrentPracticeItem] = useState<RankedContentEntry | null>(null);
  const [currentPracticeReason, setCurrentPracticeReason] = useState<string>('');
  const [readingProfile, setReadingProfile] = useState<ReadingProfile | null>(null);
  const [wordBankLoading, setWordBankLoading] = useState(false);
  // Distinguishes "the backend confirmed this track's frontier is fully
  // completed" from every other failure (network blip, timeout, backend
  // temporarily unavailable) - without this, a transient recommend failure
  // and a genuinely finished curriculum looked identical to the student.
  const [wordBankError, setWordBankError] = useState<string>('');
  const [lessonFilter, setLessonFilter] = useState<string>('Lahat');
  const [activities, setActivities] = useState<StudentActivity[]>([]);
  const [uploadsError, setUploadsError] = useState<string>('');
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState<string>('');
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string>('');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  // Index of the syllable currently being spoken during slow karaoke
  // read-along, driven by real Google TTS timepoints; null when idle.
  const [karaokeSyllableIndex, setKaraokeSyllableIndex] = useState<number | null>(null);
  const [karaokeLoading, setKaraokeLoading] = useState(false);
  const [practiceAttempts, setPracticeAttempts] = useState(0);
  // Set when a Learn tab category card (Letters/Syllables/Words) is tapped,
  // so the Practice tab actually narrows to that category instead of always
  // showing everything regardless of which card was pressed. Cleared
  // whenever Practice is entered any other way (sidebar, "Continue
  // Practice", etc.) so it never sticks around as a surprising filter.
  const [practiceCategoryFilter, setPracticeCategoryFilter] = useState<CurriculumPracticeType | null>(null);
  const [readingContent, setReadingContent] = useState<ReadingContentItem[]>([]);
  const [completedContentIds, setCompletedContentIds] = useState<Set<string>>(new Set());
  const [officialProgression, setOfficialProgression] = useState<OfficialReadingProgress | null>(null);
  type Section = 'home' | 'learn' | 'practice' | 'progress' | 'achievements' | 'notifications' | 'settings';
  const [section, setSection] = useState<Section>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [achievement, setAchievement] = useState<{ image: any; title: string; category?: AchievementCategory; xp?: number } | null>(null);
  const [expandedBadgeId, setExpandedBadgeId] = useState<string | null>(null);
  const [pronunciationStats, setPronunciationStats] = useState<PronunciationStats | null>(null);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings | null>(null);
  const { highContrast, a11yFont, a11ySize, setAccessibilitySettings } = useAccessibility();
  // Applied to every tab's hero banner title/subtitle (the shared masthead
  // rendered at the top of Home/Learn/Practice/Progress/Badges/Notifications)
  // so Text Size, Dyslexia-Friendly Font, and High Contrast have a real,
  // visible, consistent effect rather than only being saved and never read.
  const heroTitleA11yStyle = {
    fontSize: a11ySize(26),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const heroSubtitleA11yStyle = {
    fontSize: a11ySize(14),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
    ...(highContrast ? { color: '#ffffff' } : {}),
  };
  // Broader wiring: the hero banner above was the only place Text Size /
  // Dyslexia-Friendly Font actually did anything. a11yText(baseSize, weight)
  // reproduces that same "scaled size + swap font family, leave everything
  // else (color/weight/spacing) alone" pattern for one Text call at a time;
  // the named groups below just give the common, repeated cases (stat
  // values, card titles, body copy, etc.) a single reusable object instead
  // of re-deriving it inline at every one of those call sites.
  const a11yText = (baseSize: number, weight: 'regular' | 'medium' | 'bold' = 'regular') => ({
    fontSize: a11ySize(baseSize),
    ...(a11yFont(weight) ? { fontFamily: a11yFont(weight) } : {}),
  });
  const statValueA11y = a11yText(20, 'bold'); // homeGridValue-style big stat numbers
  const statLabelA11y = a11yText(12, 'medium'); // small captions under stat numbers
  const cardTitleA11y = a11yText(16, 'bold'); // card/section headings (Baloo display titles)
  const cardSubtitleA11y = a11yText(12, 'medium'); // card subtitles/detail lines
  const bodyA11y = a11yText(13, 'regular'); // paragraph/body copy
  const buttonA11y = a11yText(13, 'bold'); // button labels
  const smallLabelA11y = a11yText(11, 'medium'); // tiny meta text (timestamps, counts)
  const [badgeFilter, setBadgeFilter] = useState<'all' | AchievementCategory>('all');
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread' | 'lesson' | 'practice' | 'achievement'>('all');
  const [practiceResult, setPracticeResult] = useState<PracticeResult | null>(null);
  const [practiceTranscript, setPracticeTranscript] = useState('');
  const [practiceListening, setPracticeListening] = useState(false);
  const [practiceProcessing, setPracticeProcessing] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [practiceMode, setPracticeMode] = useState<'say' | 'listen'>('say');
  const [todaySessions, setTodaySessions] = useState<{ word: string; accuracy_percentage: number; is_correct: boolean; duration_seconds: number | null; created_at: string }[]>([]);
  const [practiceStatus, setPracticeStatus] = useState('Pindutin ang mikropono kapag handa ka na.');
  const [confettiVisible, setConfettiVisible] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const sidebarAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const mascotPulse = useRef(new Animated.Value(1)).current;
  const handledTranscriptRef = useRef('');
  // Android's on-device recognizer sometimes fires 'end' without ever
  // sending a final result (isFinal:true) for short utterances - without
  // this, evaluation would just never happen and the student would be left
  // stuck on "Nakikinig ako" with no feedback. Holds the latest interim
  // transcript so 'end' can fall back to treating it as final.
  const latestInterimTranscriptRef = useRef('');
  const practiceStartRef = useRef<number | null>(null);
  const recognitionSessionRef = useRef<any | null>(null);
  const micPulse = useSharedValue(1);
  const micAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: micPulse.value }] }));

  const UPLOADS_BUCKET = 'teacher-uploads'; // Update if your Supabase bucket name differs

  useSpeechRecognitionEvent('start', () => {
    if (section !== 'practice') return;
    setPracticeListening(true);
    setPracticeProcessing(false);
    setPracticeStatus('Nakikinig… Basahin nang malinaw.');
    practiceStartRef.current = Date.now();
    latestInterimTranscriptRef.current = '';
  });

  useSpeechRecognitionEvent('end', () => {
    if (section !== 'practice') return;
    setPracticeListening(false);
    setPracticeStatus('Tapos na ang pakikinig.');
    // Let the session finalize if it hasn't already submitted.
    const submitted = recognitionSessionRef.current?.onRecognitionEnd() || false;
    if (!submitted) {
      const fallbackTranscript = latestInterimTranscriptRef.current;
      if (fallbackTranscript && handledTranscriptRef.current !== fallbackTranscript) {
        handledTranscriptRef.current = fallbackTranscript;
        setPracticeProcessing(false);
        handlePracticeResult(fallbackTranscript);
      } else {
        setPracticeProcessing(false);
      }
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (section !== 'practice') return;
    const transcript = event.results?.[0]?.transcript?.trim() || '';
    if (!transcript) return;
    latestInterimTranscriptRef.current = transcript;
    setPracticeTranscript(transcript);
    setPracticeStatus(event.isFinal ? 'Narinig ko!' : 'Naririnig kita...');

    recognitionSessionRef.current?.onTranscript(transcript, event.isFinal);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (section !== 'practice') return;
    setPracticeListening(false);
    setPracticeProcessing(false);
    setPracticeStatus(
      event.error === 'no-speech'
        ? 'Hindi ko narinig. Subukan natin ulit.'
        : 'May problema sa mikropono. Subukan muli.'
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
      setAccessibilitySettings(accessibilityFromSettings(result));
      setTtsEnabled(result.tts_enabled);
      setSpeechRateSetting(result.speech_rate || 'normal');
      return result;
    } catch (error: any) {
      console.warn('[StudentDashboard] settings load failed:', error?.message || error);
      return null;
    }
  };

  // Same real dyslexia_font field/update path as the Settings tab's own
  // Accessibility toggle - not a second source of truth. DashboardSettingsScreen
  // unmounts/remounts whenever the Settings tab is left and reopened, so it
  // always refetches this value fresh; nothing to keep in sync there.
  const toggleDyslexiaFont = async (next: boolean) => {
    if (!child?.auth_uid) return;
    const previous = dashboardSettings;
    setDashboardSettings((prev) => (prev ? { ...prev, dyslexia_font: next } : prev));
    setAccessibilitySettings({ dyslexiaFont: next });
    try {
      const saved = await updateDashboardSettings(child.auth_uid, 'student', { dyslexia_font: next });
      setDashboardSettings(saved);
      setAccessibilitySettings(accessibilityFromSettings(saved));
    } catch (error: any) {
      console.warn('[Sidebar] dyslexia_font toggle failed:', error?.message || error);
      setDashboardSettings(previous);
      setAccessibilitySettings(accessibilityFromSettings(previous));
    }
  };

  // Same mailto pattern as DashboardSettingsScreen's contactSupport (that
  // component isn't mounted from the sidebar, so this is a small, deliberate
  // duplication matching how ParentDashboardEnhanced already keeps its own
  // local copy too, rather than a new shared-service refactor).
  const contactSupportFromSidebar = async () => {
    const subject = encodeURIComponent('LinawLetra support - Student account');
    const body = encodeURIComponent(`User ID: ${child?.auth_uid || ''}\n\nHow can we help?`);
    const url = `mailto:support@linawletra.app?subject=${subject}&body=${body}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
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

  const loadCurrentPracticeItem = async (contentType?: CurriculumPracticeType) => {
    setWordBankLoading(true);
    try {
      const [ranked] = await fetchPersonalizedContent(1, contentType);
      setCurrentPracticeItem(ranked || null);
      setCurrentPracticeReason(ranked?.recommendationReason || 'Current unlocked curriculum frontier.');
      setWordBankError('');
      void fetchReadingProfile().then(setReadingProfile).catch((profileError) => {
        console.warn('[StudentDashboard] reading profile unavailable:', profileError?.message || profileError);
      });
    } catch (error: any) {
      console.warn('[StudentDashboard] current practice item unavailable:', error?.message || error);
      setCurrentPracticeItem(null);
      setCurrentPracticeReason('');
      // Only the backend's specific empty-frontier message means the track
      // is genuinely finished - every other failure (network error, timeout,
      // 503 "temporarily unavailable") is transient and should offer a retry
      // instead of falsely telling the student they've completed the set.
      setWordBankError(
        error?.message === 'No personalized curriculum practice is available yet.' ? '' : (error?.message || 'Hindi ma-load ang susunod na practice item.'),
      );
    } finally {
      setWordBankLoading(false);
    }
  };

  const loadOfficialCurriculum = async (studentId: string) => {
    try {
      const [content, completionIds, progressionSnapshot] = await Promise.all([
        fetchReadingContent(),
        fetchCompletedContentIds(studentId),
        fetchOfficialReadingProgress(),
      ]);
      setReadingContent(content);
      setCompletedContentIds(completionIds);
      setOfficialProgression(progressionSnapshot);
      // The official server snapshot is authoritative over any stale level
      // embedded in the profile response.
      setProgress((current) => current ? { ...current, level: progressionSnapshot.effective_level } : current);
      return { content, completionIds, progressionSnapshot };
    } catch (error: any) {
      // Progress tab's requirement breakdown and this attempt's difficulty
      // lookup degrade gracefully to empty/default values without this data;
      // nothing in the UI blocks on it, so there's no loading/error state to
      // surface here.
      console.warn('[StudentDashboard] official curriculum load failed:', error?.message || error);
      return null;
    }
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

        // child_progress has a UNIQUE child_id constraint, so this join embeds
        // it as a single object, not an array - but callers read
        // `child_progress?.[0]`. Normalize so real progress isn't mistaken for
        // "no progress yet" and overwritten on the next save.
        const rawChildProgress = (child as any).child_progress;
        if (rawChildProgress && !Array.isArray(rawChildProgress)) {
          (child as any).child_progress = [rawChildProgress];
        }

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

    const [wordLog, uploads, lessonRows, assignedActivities, , , , , , , definitions] = await Promise.all([
      getOrCreateWordOfDay(profile.id, Number(profile.grade_level || 1)).catch((err) => {
        console.warn('[StudentDashboard] word-of-day load failed:', err?.message || err);
        return null;
      }),
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
      loadOfficialCurriculum(profile.id),
    ]);
    setWordDefinitions(definitions);

    if (wordLog) {
      setWordOfDay(wordLog);
    }

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
    // loadStudent is intentionally omitted: it's a plain (non-memoized)
    // function that transitively calls ~9 other unmemoized loaders, so a
    // fresh reference every render would re-run this whole auth+data-load
    // effect on every render instead of only on mount / explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, retryKey]);

  useEffect(() => {
    if (!child) return undefined;
    const unsubLessons = subscribeToPublishedLessons(() => {
      loadPublishedLessons(Number(child.grade_level || 1));
    });
    // Also subscribe to realtime notifications targeting this student (by
    // auth UID or by student_id) so the UI reflects new notices in real time.
    const unsubNotifications = subscribeToStudentNotifications(child.auth_uid || child.id, () => {
      if (child?.auth_uid) void loadNotifications(child.auth_uid);
    });
    return () => {
      unsubLessons?.();
      unsubNotifications?.();
    };
    // Narrowed to the two primitive fields actually read below (both already
    // in the deps array), rather than the whole `child` object - depending on
    // the object would re-subscribe to the realtime lessons listener whenever
    // any unrelated child field changes (e.g. name), not just grade_level.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child?.id, child?.grade_level]);

  useEffect(() => {
    if (!child?.id || !progress?.level) return;
    void loadCurrentPracticeItem(practiceCategoryFilter || undefined);
  }, [child?.id, progress?.level, practiceCategoryFilter]);

  useEffect(() => {
    if (practiceListening) {
      micPulse.value = withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    } else {
      micPulse.value = withTiming(1);
    }
  }, [practiceListening, micPulse]);

  useEffect(() => {
    if (!practiceListening) {
      setRecordingElapsed(0);
      return undefined;
    }
    const interval = setInterval(() => {
      setRecordingElapsed(practiceStartRef.current ? Math.floor((Date.now() - practiceStartRef.current) / 1000) : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [practiceListening]);

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
      Animated.timing(sidebarAnim, { toValue: -SIDEBAR_WIDTH, duration: 240, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(({ finished }) => {
      // A rapid re-open (openSidebar interrupting this close animation) stops
      // this timing early and still invokes this callback with finished:false.
      // Without this guard, setSidebarOpen(false) would fire right after the
      // newer openSidebar() call had just set it true, desyncing the overlay
      // (which unmounts when sidebarOpen is false) from the drawer's actual
      // on-screen position - the "stuck under rapid taps" half of this bug.
      if (finished) setSidebarOpen(false);
    });
  };

  const navigateTo = (s: any) => {
    if (s !== 'practice') setPracticeCategoryFilter(null);
    setSection(s);
    closeSidebar();
  };

  // Every entry point into the Practice tab goes through this, so the
  // category filter is always explicit: generic entries (Continue Practice,
  // sidebar, etc.) clear it back to "show everything" via the default
  // argument, while the Learn tab's official curriculum cards are the
  // only callers that pass a real category.
  const goToPractice = (category: CurriculumPracticeType | null = null) => {
    setPracticeCategoryFilter(category);
    setSection('practice');
  };

  const getFirstName = (full = '') => (full ? String(full).split(' ')[0] : 'Ka');

  const relativeBadgeDate = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Kahapon';
    if (days < 7) return `${days} araw na ang nakalipas`;
    return new Date(iso).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    if (status === 'completed') return SUCCESS;
    if (status === 'completed_late') return WARNING;
    if (status === 'overdue') return DANGER;
    return WARNING;
  };

  // Text-safe variant of getStatusColor - getStatusColor's WARNING/DANGER
  // values are tuned for the status dot (background), not for text.
  const getStatusTextColor = (status: string) => {
    if (status === 'completed') return SUCCESS;
    if (status === 'completed_late') return WARNING_TEXT;
    if (status === 'overdue') return DANGER_TEXT;
    return WARNING_TEXT;
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
      await notifyStudent('Lesson Completed!', `You finished "${lesson.title}". Great work!`, 'lesson');
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
      const saved = await saveProgress(updatedProgress);
      setProgress(saved.progress);
      // Only celebrate badges the server confirms are genuinely new-to-storage
      // this call - the client-side `newlyUnlocked` check above can be stale
      // (see saveProgress's newlyPersistedAchievementIds doc comment), which
      // was the root cause of the celebration re-triggering on every attempt.
      const celebrate = newlyUnlocked.find((a) => saved.newlyPersistedAchievementIds?.includes(a.id));
      if (celebrate) {
        setAchievement({ image: celebrate.image, title: celebrate.title });
        await notifyStudent('New Badge Unlocked!', `You earned the "${celebrate.title}" badge!`, 'achievement');
      }
    }
  };

  const handleWordOfDayResult = async (
    correct: boolean,
    attempts: number,
    score?: number,
    transcript?: string,
    completion?: { streak?: number; longest_streak?: number; xp_awarded?: number; total_xp?: number },
  ) => {
    try {
      if (!progress) return;
      const addXp = completion?.xp_awarded ?? 0;
      const computed = buildNextProgress(progress, wordOfDay?.word || '', 0, {
        countsAsPracticeSession: false,
        accuracy: score,
      });
      // The Word of the Day endpoint is the source of truth for the streak;
      // never calculate or increment it from the device response.
      const next = correct && completion
        ? {
            ...computed,
            xp: completion.total_xp ?? computed.xp,
            streak: completion.streak ?? computed.streak,
            longest_streak: completion.longest_streak ?? computed.longest_streak,
          }
        : computed;
      await saveProgress(next);
      setProgress(next);
      await notifyParent(
        'Word of the Day',
        `${child?.name || 'Student'} ${correct ? 'completed' : 'tried'} the word "${wordOfDay?.word || ''}" and earned ${addXp} XP.`,
        'word',
      );
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next, child?.name || '', child?.parent_id);
      if (newlyUnlocked?.length) {
        const saved = await saveProgress(updatedProgress);
        setProgress(saved.progress);
        // See the analogous comment in completeActivity - only celebrate
        // badges the server confirms are genuinely new-to-storage this call.
        const celebrate = newlyUnlocked.find((a) => saved.newlyPersistedAchievementIds?.includes(a.id));
        if (celebrate) {
          setAchievement({
            image: celebrate.image,
            title: celebrate.title,
            category: celebrate.category,
            xp: celebrate.xpReward,
          });
          await notifyStudent('New Badge Unlocked!', `You earned the "${celebrate.title}" badge!`, 'achievement');
        }
      }
    } catch (e) {
      console.warn('wordOfDay result handling failed', e);
    }
  };

  const speakPracticeWord = (word = selectedWord || '') => {
    if (!word) return;
    stopSpeaking();
    stopCloudSpeaking();
    speakWordCloud(word.replace(/-/g, ' '), { onError: (message) => setPracticeStatus(message) });
  };

  // Slow, syllable-by-syllable karaoke read-along, driven by real Google TTS
  // timepoints (see cloudTtsService.speakSyllablesCloud). No on-device
  // fallback exists for the *highlighting* (expo-speech has no timing API),
  // so on failure this still plays the word normally via speakPracticeWord -
  // the student always hears something, they just don't get the highlight.
  const playSyllableKaraoke = (word = selectedWord || '') => {
    if (!word) return;
    const parts = syllabifyText(word).split('-').filter(Boolean);
    stopSpeaking();
    stopCloudSpeaking();

    if (parts.length < 2) {
      // Nothing meaningful to highlight for a single-syllable word.
      speakPracticeWord(word);
      return;
    }

    setKaraokeLoading(true);
    setKaraokeSyllableIndex(0);
    speakSyllablesCloud(parts, {
      onSyllableIndex: (index) => setKaraokeSyllableIndex(index),
      onDone: () => {
        setKaraokeSyllableIndex(null);
        setKaraokeLoading(false);
      },
      onError: (message) => {
        setKaraokeSyllableIndex(null);
        setKaraokeLoading(false);
        setPracticeStatus(message);
        speakPracticeWord(word);
      },
    });
  };

  const savePronunciationSession = async (result: PracticeResult, word: string, durationSeconds: number | null) => {
    if (!child?.id) return false;
    const curriculumItem = selectedContentId
      ? readingContent.find((item) => item.id === selectedContentId) || null
      : null;
    const difficultyAtAttempt = (curriculumItem?.level || progress?.level)?.toLowerCase() || null;
    const normalizedWord = word.toLowerCase().replace(/[\s-]+/g, '');
    let wordId: string | null = curriculumItem?.word_id || null;

    if (!curriculumItem && difficultyAtAttempt) {
      const { data: wordRow, error: wordError } = await supabase
        .from('words')
        .select('id')
        .eq('word', normalizedWord)
        .eq('level', difficultyAtAttempt)
        .maybeSingle();
      if (wordError) {
        console.warn('[Practice] stable word id lookup failed; saving the attempt without word_id:', wordError.message || wordError);
      } else {
        wordId = wordRow?.id || null;
      }
    }

    const payload = {
      student_id: child.id,
      word_id: wordId,
      word,
      spoken_text: result.transcript,
      accuracy_percentage: result.score,
      is_correct: result.correct,
      duration_seconds: durationSeconds,
      difficulty_level_at_attempt: difficultyAtAttempt,
      practice_source: 'practice',
      attempts: Math.max(1, practiceAttempts + 1),
      confidence_score: Math.round(
        (result.score * 0.7)
        + ((durationSeconds == null ? 70 : durationSeconds <= 15 ? 100 : Math.max(0, 100 - ((durationSeconds - 15) * 3))) * 0.1)
        + (Math.max(0, 100 - (practiceAttempts * 20)) * 0.2),
      ),
      recommendation_reason: selectedContentId && selectedContentId === currentPracticeItem?.id ? currentPracticeReason || null : null,
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

    logPhonemeConfusion(child.id, word, result.transcript, 'practice', data?.id);
    void fetchReadingProfile().then(setReadingProfile).catch(() => undefined);
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

  // Student-facing counterpart to notifyParent - writes user_id = the
  // student's own auth_uid. Before this, nothing in the app ever wrote a
  // notification row addressed to the student themselves (every existing
  // call site was parent-only), so the student's own Notifications tab had
  // no real content to show. Only called at genuinely real events below -
  // deliberately not mirrored for every notifyParent() call, to avoid
  // notification spam (e.g. no per-attempt XP/assignment noise).
  const notifyStudent = async (title: string, message: string, type: string) => {
    if (!child?.auth_uid) return;
    try {
      await createNotification(child.auth_uid, title, message, type);
    } catch (error: any) {
      console.warn('[StudentDashboard] student notification failed:', {
        title,
        type,
        message: error?.message,
      });
    }
  };

  const handlePracticeResult = async (transcript: string) => {
    try {
      if (!selectedWord) return;
      const score = scorePronunciation(selectedWord, transcript);
      const correct = score >= PRACTICE_PASSING_SCORE;
      const previousSameWord = recentSessions.find(
        (session) => normalizeWordKey(session.word) === normalizeWordKey(selectedWord),
      );
      const improvement = previousSameWord ? score - Number(previousSameWord.accuracy_percentage || 0) : 0;
      const phonology = analyzePhonology(selectedWord, transcript);
      const weakSound = phonology.confusionKeys[0]?.split('-')?.[0];
      const feedback = improvement >= 5
        ? `Napabuti ang pagbigkas mo nang ${Math.round(improvement)} puntos kumpara sa huling pagsubok.`
        : correct
          ? 'Magaling! Malinaw at tama ang pagbigkas mo.'
          : weakSound
            ? `Subukan nating linawin ang tunog na '${weakSound}'.`
            : score >= 75
              ? 'Malapit na! Basahin muna ang bawat pantig bago buuin ang salita.'
              : `Mas mabagal na pagbasa ay makakatulong. Simulan sa '${syllabifyText(selectedWord).split('-')[0]}'.`;
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
      if (correct) {
        setConfettiVisible(true);
        setTimeout(() => setConfettiVisible(false), 2400);
      }

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

      let progressionAfterAttempt: OfficialReadingProgress | null = null;
      if (selectedContentId) {
        try {
          const recorded = await recordReadingContentAttempt({
            contentId: selectedContentId,
            accuracy: score,
            transcript,
            durationSeconds,
            // Paragraphs are assessment-only and are never routed through
            // this practice handler, so no practice attempt can accidentally
            // claim a full paragraph submission.
            isFullSubmission: false,
            source: 'practice',
          });
          progressionAfterAttempt = recorded.result.progression;
          setOfficialProgression(recorded.result.progression);
          setProgress((current) => current
            ? { ...current, level: recorded.result.progression.effective_level }
            : current);
          if (recorded.result.completion_awarded) {
            setCompletedContentIds((current) => new Set([...current, selectedContentId]));
            // Refresh only after the server-owned completion transaction so
            // the ranker receives the newly advanced per-track frontiers.
            void loadCurrentPracticeItem(practiceCategoryFilter || undefined);
          }
        } catch (contentError: any) {
          console.warn('[Practice] official curriculum attempt recording failed:', contentError?.message || contentError);
        }
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
      const computedNext = buildNextProgress(progress, selectedWord, xpAward, {
        countsAsPracticeSession: true,
        accuracy: score,
      });
      // Practice sessions should never change the authoritative streak
      // — only Word-of-the-Day completions (server-side) update streak.
      const next = progressionAfterAttempt
        ? { ...computedNext, level: progressionAfterAttempt.effective_level }
        : computedNext;
      // Preserve server-authoritative streak values from the existing progress
      // record so practice does not increment/reset streak locally.
      next.streak = progress.streak;
      next.longest_streak = progress.longest_streak ?? next.longest_streak;

      console.debug('[Practice] preserved streak (server authoritative):', { previousStreak: beforeStreak, nextStreak: next.streak });
      await saveProgress(next);
      setProgress(next);
      await notifyParent('XP Update', `${child?.name || 'Student'} earned ${xpAward} XP from speech practice.`, 'xp');
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next, child?.name || '', child?.parent_id);
      if (newlyUnlocked?.length) {
        const saved = await saveProgress(updatedProgress);
        setProgress(saved.progress);
        // See the analogous comment in completeActivity - only celebrate
        // badges the server confirms are genuinely new-to-storage this call.
        const celebrate = newlyUnlocked.find((a) => saved.newlyPersistedAchievementIds?.includes(a.id));
        if (celebrate) {
          setAchievement({
            image: celebrate.image,
            title: celebrate.title,
            category: celebrate.category,
            xp: celebrate.xpReward,
          });
          await notifyStudent('New Badge Unlocked!', `You earned the "${celebrate.title}" badge!`, 'achievement');
        }
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
      setPracticeStatus('Pindutin ang mikropono at basahin ang salita.\nKusang titigil ang recording kapag tapos ka nang magsalita.');
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

      // Reset any previous session, then create a new one which will manage
      // silence/hard timeouts and ensure single submission.
      recognitionSessionRef.current?.dispose?.();
      recognitionSessionRef.current = createSpeechRecognitionSession({
        stopRecognition: () => ExpoSpeechRecognitionModule.stop(),
        submitTranscript: (transcript: string) => handlePracticeResult(transcript),
        onStopRequested: () => setPracticeProcessing(true),
        hardTimeoutMs: 12000,
      });
      recognitionSessionRef.current.start();

      ExpoSpeechRecognitionModule.start({
        lang: 'fil-PH',
        interimResults: true,
        continuous: false,
        maxAlternatives: 3,
        contextualStrings: [selectedWord, selectedWord.replace(/-/g, ''), ...DEFAULT_PHONETIC_WORDS],
        ...(Platform.OS === 'android' ? {
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2300,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2200,
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 900,
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
    try {
      recognitionSessionRef.current?.manualStop?.();
    } catch (err) {
      ExpoSpeechRecognitionModule.stop();
    }
    setPracticeProcessing(true);
    setPracticeStatus('Sinusuri ang iyong pagbasa...');
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
        {/* Hero banner: brand gradient (deep purple -> magenta-purple ->
            deep pink), diagonal top-left to bottom-right, via
            expo-linear-gradient (already installed, not a new library).
            Rendered outside the ScrollView below so it stays pinned while
            content scrolls underneath it. */}
        <LinearGradient
          colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroBanner}
        >
          <View style={styles.heroTopRow}>
            <TouchableOpacity
              style={styles.heroLogoRow}
              onPress={openSidebar}
              accessibilityRole="button"
              accessibilityLabel="Open navigation menu"
            >
              <Ionicons name="menu-outline" size={20} color="#fff" />
              <Ionicons name="book" size={16} color="#fff" />
              <Text style={styles.heroLogoText}>LinawLetra</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.heroGreeting, heroTitleA11yStyle]}>Kumusta,{'\n'}{getFirstName(child?.name || '')}! 👋</Text>
          <Text style={[styles.heroSubtitle, heroSubtitleA11yStyle]}>Handa ka na bang matuto ngayon?</Text>
          <Image source={require('../../assets/waving.webp')} style={styles.heroImage} resizeMode="contain" />
        </LinearGradient>

        <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
          {!!error && (
            <View style={styles.homeErrorBanner}>
              <Text style={styles.homeBannerEmoji}>💛</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.homeErrorText, bodyA11y]}>{error}</Text>
                <TouchableOpacity
                  style={styles.homeBannerButton}
                  onPress={() => setRetryKey((prev) => prev + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading"
                >
                  <Text style={[styles.homeBannerButtonText, buttonA11y]}>Subukan muli</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Today's Reading Progress — real daily-goal data (same mechanic as
              the Practice tab's step-dots; resets every 5 attempts, not at
              midnight, since there's no calendar-day tracking yet) */}
          <View style={styles.homeTodayCard}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.homeTodayTitle, cardTitleA11y]}>Today&apos;s Reading{'\n'}Progress</Text>
              <Text style={[styles.homeTodayStatLine, bodyA11y]}>{goalDone} of {DAILY_GOAL} pagsasanay ngayon</Text>
              <TouchableOpacity
                style={styles.homeTodayButton}
                onPress={() => goToPractice()}
                accessibilityRole="button"
                accessibilityLabel="Continue practice"
              >
                <Text style={[styles.homeTodayButtonText, buttonA11y]}>Continue Practice</Text>
              </TouchableOpacity>
            </View>
            <ProgressRing percent={goalPct} color={HOME_LAVENDER} trackColor="rgba(124,111,207,0.15)">
              <Text style={[styles.homeTodayRingPct, statValueA11y]}>{goalPct}%</Text>
              <Text style={[styles.homeTodayRingLabel, smallLabelA11y]}>Complete</Text>
            </ProgressRing>
          </View>

          {/* Quick Stats 2x2 grid — Words Practiced, Reading Accuracy,
              Practice Sessions, Current Streak, all real fields */}
          <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Quick Stats</Text>
          <View style={styles.homeStatGrid}>
            <View style={[styles.homeGridCard, { backgroundColor: '#E9F1E2' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_GREEN }]}>
                <Ionicons name="book" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_GREEN }, statValueA11y]}>{stats.completed}</Text>
              <Text style={[styles.homeGridLabel, statLabelA11y]}>Words Practiced</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#FBE7DF' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_ORANGE }]}>
                <Ionicons name="locate" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_ORANGE }, statValueA11y]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
              <Text style={[styles.homeGridLabel, statLabelA11y]}>Reading Accuracy</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#EFECFB' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_VIOLET }]}>
                <Ionicons name="bar-chart" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_VIOLET }, statValueA11y]}>{progress?.total_attempts || 0}</Text>
              <Text style={[styles.homeGridLabel, statLabelA11y]}>Practice Sessions</Text>
            </View>
            <View style={[styles.homeGridCard, { backgroundColor: '#FFF3DC' }]}>
              <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_AMBER }]}>
                <Ionicons name="flame" size={18} color="#fff" />
              </View>
              <Text style={[styles.homeGridValue, { color: VIVID_AMBER }, statValueA11y]}>{stats.streak} {stats.streak === 1 ? 'Day' : 'Days'}</Text>
              <Text style={[styles.homeGridLabel, statLabelA11y]}>Current Streak</Text>
            </View>
          </View>

          {/* Continue Learning — real in-progress lesson + inferred
              Lesson X of Y (see comment above on continueLessonIndex) */}
          {continueReadingLesson ? (
            <View style={styles.homeContinueCard}>
              <View style={styles.homeContinueImageWrap}>
                <Image source={require('../../assets/reading.webp')} style={styles.homeContinueImage} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.homeContinueTitle, cardTitleA11y]}>Continue Learning</Text>
                <Text style={[styles.homeContinueSubtitle, cardSubtitleA11y]}>{continueReadingLesson.title}</Text>
                <Text style={[styles.homeContinueLessonCount, smallLabelA11y]}>Lesson {continueLessonIndex + 1} of {continueLessonTotal}</Text>
                <View style={styles.homeContinueTrackRow}>
                  <View style={styles.homeContinueTrack}>
                    <View style={[styles.homeContinueFill, { width: `${Math.max(4, continueLessonPct)}%` }]} />
                  </View>
                  <Text style={[styles.homeContinuePct, smallLabelA11y]}>{continueLessonPct}%</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.homeContinueButton}
                onPress={() => setSection('learn')}
                accessibilityRole="button"
                accessibilityLabel={`Continue lesson: ${continueReadingLesson.title}`}
              >
                <Text style={[styles.homeContinueButtonText, buttonA11y]}>Continue</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.homeContinueCard}>
              <View style={styles.homeContinueImageWrap}>
                <Image source={require('../../assets/reading.webp')} style={styles.homeContinueImage} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.homeContinueTitle, cardTitleA11y]}>Continue Learning</Text>
                <Text style={[styles.homeContinueSubtitle, cardSubtitleA11y]}>Wala pang binabasang aralin — simulan ang isa!</Text>
              </View>
              <TouchableOpacity
                style={styles.homeContinueButton}
                onPress={() => setSection('learn')}
                accessibilityRole="button"
                accessibilityLabel="Start a lesson"
              >
                <Text style={[styles.homeContinueButtonText, buttonA11y]}>Simulan</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Word of the Day — kept intact, a real distinct feature the new
              reference layout has no equivalent slot for */}
          {wordOfDay ? (
            <View style={styles.homeHeroCard}>
              <View style={styles.homeHeroTopRow}>
                <View style={styles.homeHeroBadge}>
                  <Text style={[styles.homeHeroBadgeText, smallLabelA11y]}>📅 SALITA NGAYON</Text>
                </View>
                <View style={styles.homeHeroStreakPill}>
                  <Ionicons name="flame" size={13} color="#fff" />
                  <Text style={[styles.homeHeroStreakText, smallLabelA11y]}>{stats.streak} {stats.streak === 1 ? 'DAY' : 'DAYS'}</Text>
                </View>
              </View>
              <Text style={[styles.homeHeroSub, bodyA11y]}>Bigkasin ang salitang ito nang tama!</Text>
              <ErrorBoundary
                title="Hindi ma-access ang mikropono"
                message="Nagkaroon ng problema sa pag-record. Subukan ulit."
              >
                <StudentWordOfDay log={wordOfDay} onResult={handleWordOfDayResult} definition={getWordDefinition(wordOfDay.word)} />
              </ErrorBoundary>
            </View>
          ) : (
            <View style={styles.homeHeroCard}>
              <Text style={styles.homeHeroEmptyEmoji}>📅</Text>
              <Text style={[styles.homeHeroEmptyText, bodyA11y]}>Wala pang salita ngayon. Subukan muli mamaya.</Text>
            </View>
          )}

          {/* Ready to Practice? — single consolidated card per reference
              layout, replacing the old two-row Say/Listen mode list */}
          <View style={styles.readyPracticeCard}>
            <View style={styles.readyPracticeIconWrap}>
              <Ionicons name="mic" size={24} color={HOME_LAVENDER_DARK} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.readyPracticeTitle, cardTitleA11y]}>Ready to Practice?</Text>
              <Text style={[styles.readyPracticeSub, bodyA11y]}>Magsanay bumasa ng mga salita at mapabuti ang iyong bigkas gamit ang AI feedback.</Text>
            </View>
            <TouchableOpacity
              style={styles.readyPracticeButton}
              onPress={() => goToPractice()}
              accessibilityRole="button"
              accessibilityLabel="Start practice"
            >
              <Text style={[styles.readyPracticeButtonText, buttonA11y]}>Start Practice</Text>
            </TouchableOpacity>
          </View>

          {/* Recent Activity — merged real feed (see recentActivityItems
              comment above): whatever mix of completed lessons and
              pronunciation sessions actually happened, not a fixed layout */}
          <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Recent Activity</Text>
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
                  <Text style={[styles.homeRecentActivityTitle, cardSubtitleA11y]}>{item.kind === 'lesson' ? 'Lesson Completed' : 'Pronunciation Practice'}</Text>
                  <Text style={[styles.homeRecentActivityDetail, smallLabelA11y]}>{item.title} • {item.detail}</Text>
                </View>
                <Text style={[styles.homeRecentActivityTime, smallLabelA11y]}>{formatActivityTime(item.timestamp)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.homeRecentActivityEmpty}>
              <Text style={[styles.homeRecentActivityEmptyText, bodyA11y]}>Wala ka pang aktibidad. Magsimula ng pagsasanay ngayon!</Text>
            </View>
          )}

          {/* Bottom encouragement banner */}
          <View style={styles.homeQuoteBanner}>
            <Text style={[styles.homeQuoteText, bodyA11y]}>&quot;Bawat salitang nababasa mo, lumalakas ka!&quot;</Text>
            <Image source={require('../../assets/thumbsup.webp')} style={styles.homeQuoteImage} resizeMode="contain" />
          </View>

          {/* Quick actions */}
          <View style={styles.homeQuickRow}>
            <TouchableOpacity
              style={[styles.homeQuickCard, { backgroundColor: '#EFECFB' }]}
              onPress={() => setSection('learn')}
              accessibilityRole="button"
              accessibilityLabel="Go to Learn"
            >
              <View style={[styles.homeQuickIconWrap, { backgroundColor: HOME_LAVENDER }]}>
                <Ionicons name="library-outline" size={20} color="#fff" />
              </View>
              <Text style={[styles.homeQuickLabel, cardSubtitleA11y]}>Learn</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeQuickCard, { backgroundColor: '#FBE7DF' }]}
              onPress={() => goToPractice()}
              accessibilityRole="button"
              accessibilityLabel="Go to Practice"
            >
              <View style={[styles.homeQuickIconWrap, { backgroundColor: HOME_CORAL }]}>
                <Ionicons name="mic-outline" size={20} color="#fff" />
              </View>
              <Text style={[styles.homeQuickLabel, cardSubtitleA11y]}>Practice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeQuickCard, { backgroundColor: '#E9F1E2' }]}
              onPress={() => setSection('progress')}
              accessibilityRole="button"
              accessibilityLabel="Go to Progress"
            >
              <View style={[styles.homeQuickIconWrap, { backgroundColor: HOME_SAGE }]}>
                <Ionicons name="analytics-outline" size={20} color="#fff" />
              </View>
              <Text style={[styles.homeQuickLabel, cardSubtitleA11y]}>Progress</Text>
            </TouchableOpacity>
          </View>

          {/* Deadlines widget */}
          <View style={styles.homeDeadlinesCard}>
            <View style={styles.homeDeadlinesHeader}>
              <Text style={[styles.homeDeadlinesTitle, cardTitleA11y]}>📅 Upcoming Deadlines</Text>
              <TouchableOpacity
                onPress={() => setSection('learn')}
                accessibilityRole="button"
                accessibilityLabel="View all lessons"
              >
                <Text style={[styles.homeDeadlinesLink, cardSubtitleA11y]}>View lessons</Text>
              </TouchableOpacity>
            </View>
            {activities.length ? (
              activities.slice(0, 3).map((activity) => (
                <TouchableOpacity
                  key={activity.id}
                  style={styles.homeActivityRow}
                  onPress={() => setSection('learn')}
                  accessibilityRole="button"
                  accessibilityLabel={`${activity.title}, due ${new Date(activity.deadline).toLocaleDateString()}`}
                >
                  <View style={[styles.homeStatusDot, { backgroundColor: getStatusColor(activity.status) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.homeActivityTitle, cardSubtitleA11y]}>{activity.title}</Text>
                    <Text style={[styles.homeActivityMeta, smallLabelA11y]}>
                      {activity.subject || 'Activity'} • {new Date(activity.deadline).toLocaleDateString()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={HOME_INK_SOFT} />
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.homeDeadlinesEmpty}>
                <Text style={styles.homeDeadlinesEmptyEmoji}>🌱</Text>
                <Text style={[styles.homeDeadlinesEmptyText, bodyA11y]}>
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
    const currentLevel = officialProgression?.effective_level || progress?.level || 'Beginner';
    const practiceTypeLabels: Record<CurriculumPracticeType, string> = {
      word: 'Words', phonetic: 'Phonetics', phrase: 'Phrases', sentence: 'Sentences',
    };
    const companionType: CurriculumPracticeType = currentLevel === 'Beginner'
      ? 'phonetic'
      : currentLevel === 'Intermediate' ? 'phrase' : 'sentence';
    // Only the current word/companion item is ever fetched or shown - no
    // full curriculum bank is downloaded or rendered as a tappable list.
    // Counts come from the server's own requirement tally, not a client-side
    // filter over the full bank.
    const activeTypes: CurriculumPracticeType[] = practiceCategoryFilter ? [practiceCategoryFilter] : ['word', companionType];
    const levelRequirements = (officialProgression?.requirements || []).filter(
      (row) => row.level === currentLevel && activeTypes.includes(row.content_type as CurriculumPracticeType),
    );
    const wordTotal = levelRequirements.reduce((sum, row) => sum + row.required_count, 0);
    const wordsDoneCount = levelRequirements.reduce((sum, row) => sum + Math.min(row.completed_count, row.required_count), 0);
    const wordPosition = Math.min(wordsDoneCount + 1, Math.max(wordTotal, 1));
    const remainingWords = Math.max(0, wordTotal - wordsDoneCount);

    const recommendedItem = currentPracticeItem;

    const wordsPracticedToday = todaySessions.length;
    const correctToday = todaySessions.filter((s) => s.is_correct).length;
    const accuracyToday = todaySessions.length
      ? Math.round(todaySessions.reduce((sum, s) => sum + (s.accuracy_percentage || 0), 0) / todaySessions.length)
      : 0;

    const startWord = (word: string, mode: 'say' | 'listen', contentId?: string | null) => {
      setPracticeMode(mode);
      setSelectedWord(word);
      setSelectedContentId(contentId || null);
      setPracticeResult(null);
      setPracticeAttempts(0);
      setPracticeTranscript('');
      setPracticeProcessing(false);
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
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
            <TouchableOpacity
              onPress={() => {
                stopSpeaking();
                setSelectedWord(null);
                setSelectedContentId(null);
              }}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={HOME_LAVENDER_DARK} />
              <Text style={[styles.backText, bodyA11y]}>Bumalik</Text>
            </TouchableOpacity>

            <View style={styles.practiceHero}>
              <Text style={[styles.practicePrompt, cardTitleA11y]}>Pakinggan at Basahin</Text>
              <Text style={[styles.practiceWordDisplay, a11yText(32, 'bold')]}>{selectedWord}</Text>
              <SyllableKaraokeText
                syllables={syllabifyText(selectedWord).split('-').filter(Boolean)}
                activeIndex={karaokeSyllableIndex}
              />
              {!!getWordDefinition(selectedWord) && (
                <WordMeaningReveal
                  key={selectedWord}
                  definition={{
                    displayWord: getWordDefinition(selectedWord)!.display_word,
                    meaningFil: getWordDefinition(selectedWord)!.meaning_fil,
                    isAmbiguous: getWordDefinition(selectedWord)!.is_ambiguous,
                  }}
                  bodyA11yStyle={bodyA11y}
                />
              )}

              <View style={styles.listenButtonRow}>
                <TouchableOpacity
                  style={[styles.sayWordButton, { flex: 1, width: undefined, backgroundColor: HOME_SAGE, shadowColor: HOME_SAGE }]}
                  onPress={() => speakPracticeWord(selectedWord)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play pronunciation for ${selectedWord}`}
                >
                  <Ionicons name="volume-high" size={26} color="#fff" />
                  <Text style={[styles.sayWordButtonText, buttonA11y]}>Pakinggan</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sayWordButton, { flex: 1, width: undefined, backgroundColor: HOME_LAVENDER_DARK, shadowColor: HOME_LAVENDER_DARK }]}
                  onPress={() => playSyllableKaraoke(selectedWord)}
                  disabled={karaokeLoading}
                  accessibilityRole="button"
                  accessibilityLabel={`Play slow syllable-by-syllable pronunciation for ${selectedWord}`}
                >
                  {karaokeLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="albums-outline" size={26} color="#fff" />
                  )}
                  <Text style={[styles.sayWordButtonText, buttonA11y]}>Pantig-pantig</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.practiceStatus, bodyA11y]}>Pakinggan ang salita habang sinusundan mo ito sa mata.</Text>
            </View>

            <TouchableOpacity
              style={styles.listenNextButton}
              onPress={() => {
                startWord(selectedWord, 'say', selectedContentId);
              }}
              accessibilityRole="button"
              accessibilityLabel="Practice this item aloud"
            >
              <Text style={[styles.listenNextButtonText, buttonA11y]}>Subukan Bigkasin</Text>
              <Ionicons name="arrow-forward" size={16} color={HOME_SAGE} />
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }

    const handlePracticeAgain = () => {
      setPracticeResult(null);
      setPracticeTranscript('');
      setPracticeStatus('Kaya mo yan. Subukan ulit!');
    };
    const handleNextWord = () => {
      if (!practiceResult?.correct) return;
      if (!recommendedItem) {
        setSelectedWord(null);
        setSelectedContentId(null);
        setPracticeResult(null);
        return;
      }
      startWord(recommendedItem.contentText, 'say', recommendedItem.id);
    };

    const renderSessionProgressCard = () => (
      <View style={styles.practiceStatsCard}>
        <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Session Progress</Text>
        <View style={styles.practiceStatsRow}>
          <View style={styles.practiceStatsCol}>
            <View style={[styles.practiceStatsIconWrap, { backgroundColor: VIVID_NAVY }]}>
              <Ionicons name="bar-chart" size={18} color="#fff" />
            </View>
            <Text style={[styles.practiceStatsValue, statValueA11y]}>{wordsPracticedToday}</Text>
            <Text style={[styles.practiceStatsLabel, statLabelA11y]}>Words Practiced</Text>
          </View>
          <View style={styles.practiceStatsCol}>
            <View style={[styles.practiceStatsIconWrap, { backgroundColor: VIVID_GREEN }]}>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
            </View>
            <Text style={[styles.practiceStatsValue, statValueA11y]}>{correctToday}</Text>
            <Text style={[styles.practiceStatsLabel, statLabelA11y]}>Correct Pronunciation</Text>
          </View>
          <View style={styles.practiceStatsCol}>
            <View style={[styles.practiceStatsIconWrap, { backgroundColor: VIVID_ORANGE }]}>
              <Ionicons name="locate" size={18} color="#fff" />
            </View>
            <Text style={[styles.practiceStatsValue, statValueA11y]}>{accuracyToday}%</Text>
            <Text style={[styles.practiceStatsLabel, statLabelA11y]}>Average Accuracy</Text>
          </View>
          <View style={styles.practiceStatsCol}>
            <View style={[styles.practiceStatsIconWrap, { backgroundColor: VIVID_AMBER }]}>
              <Ionicons name="albums" size={18} color="#fff" />
            </View>
            <Text style={[styles.practiceStatsValue, statValueA11y]}>{remainingWords}</Text>
            <Text style={[styles.practiceStatsLabel, statLabelA11y]}>Remaining Words</Text>
          </View>
        </View>
      </View>
    );

    const renderReadingTipCard = () => (
      <View style={styles.practiceTipCard}>
        <View style={[styles.categoryIconWrap, { backgroundColor: VIVID_AMBER, marginBottom: 0 }]}>
          <Ionicons name="bulb" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.practiceTipCardTitle, cardTitleA11y]}>Reading Tip</Text>
          <Text style={[styles.practiceTipCardText, bodyA11y]}>Basahin ang bawat pantig nang dahan-dahan bago sabihin ang buong salita.</Text>
        </View>
      </View>
    );

    if (selectedWord && child) {
      return (
        <View style={{ flex: 1 }}>
          <ConfettiOverlay visible={confettiVisible} />
          {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
          <LinearGradient
            colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroBanner}
          >
            <TouchableOpacity
              style={styles.heroBackRow}
              onPress={() => {
                ExpoSpeechRecognitionModule.abort();
                setSelectedWord(null);
                setSelectedContentId(null);
                setPracticeResult(null);
                setPracticeAttempts(0);
                setPracticeTranscript('');
                setPracticeProcessing(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
              <Text style={[styles.heroBackText, bodyA11y]}>Bumalik</Text>
            </TouchableOpacity>
            <Text style={[styles.heroGreeting, heroTitleA11yStyle]}>Voice Reading{'\n'}Practice</Text>
            <Text style={[styles.heroSubtitle, heroSubtitleA11yStyle]}>Basahin nang malakas ang salita at hayaang suriin ng AI ang bigkas mo.</Text>
            <Image source={require('../../assets/singing.webp')} style={styles.heroImage} resizeMode="contain" />
          </LinearGradient>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
            <View style={styles.learnProgressCard}>
              <View style={styles.learnProgressTopRow}>
                <View style={styles.practiceProgressTitleRow}>
                  <Ionicons name="albums-outline" size={16} color={HOME_LAVENDER_DARK} />
                  <Text style={[styles.learnProgressTitle, cardTitleA11y]}>Today&apos;s Practice</Text>
                </View>
                {wordTotal > 0 && (
                  <View style={styles.practiceWordPill}>
                    <Text style={[styles.practiceWordPillText, smallLabelA11y]}>Word {wordPosition} of {wordTotal}</Text>
                  </View>
                )}
              </View>
              <View style={styles.learnProgressTrack}>
                <View style={{ width: `${wordTotal ? Math.max(4, Math.round((wordPosition / wordTotal) * 100)) : 4}%`, height: '100%' }}>
                  <LinearGradient
                    colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1, borderRadius: 5 }}
                  />
                </View>
              </View>
              <View style={styles.practiceTipRow}>
                <Ionicons name="bulb" size={14} color={HOME_SUN} />
                <Text style={[styles.practiceTipText, bodyA11y]}>Ipagpatuloy ang pagsasanay para umangat ang bigkas mo!</Text>
              </View>
            </View>

            <View style={styles.practiceHero}>
              <Animated.View
                style={[
                  styles.practiceMoodBadge,
                  { backgroundColor: practiceResult?.correct ? SUCCESS : practiceProcessing ? VIVID_ORANGE : practiceListening ? VIVID_TEAL : HOME_LAVENDER },
                  { transform: [{ scale: mascotPulse }] },
                ]}
              >
                <Ionicons
                  name={practiceResult?.correct ? 'sparkles' : practiceProcessing ? 'hourglass-outline' : practiceListening ? 'ear-outline' : 'happy-outline'}
                  size={26}
                  color="#fff"
                />
              </Animated.View>
              <Text style={[styles.practicePrompt, cardTitleA11y]}>Sabihin ang Salita</Text>
              <Text style={[styles.practiceWordDisplay, a11yText(32, 'bold')]}>{selectedWord}</Text>
              <SyllableKaraokeText
                syllables={syllabifyText(selectedWord).split('-').filter(Boolean)}
                activeIndex={null}
              />
              {!!getWordDefinition(selectedWord) && (
                <WordMeaningReveal
                  key={selectedWord}
                  definition={{
                    displayWord: getWordDefinition(selectedWord)!.display_word,
                    meaningFil: getWordDefinition(selectedWord)!.meaning_fil,
                    isAmbiguous: getWordDefinition(selectedWord)!.is_ambiguous,
                  }}
                  bodyA11yStyle={bodyA11y}
                />
              )}

              <View style={styles.practiceDivider} />

              <View style={styles.micSection}>
                <TouchableOpacity
                  style={styles.listenCoachButton}
                  disabled={practiceListening || practiceProcessing}
                  onPress={() => speakPracticeWord(selectedWord)}
                  accessibilityRole="button"
                  accessibilityLabel={`Listen to pronunciation of ${selectedWord}`}
                >
                  <Ionicons name="volume-high-outline" size={18} color={HOME_LAVENDER_DARK} />
                  <Text style={[styles.listenCoachText, bodyA11y]}>Pakinggan muna</Text>
                </TouchableOpacity>

                <ReanimatedView.View style={micAnimatedStyle}>
                  <View style={[styles.micGlowOuter, practiceListening && styles.micGlowOuterRecording]}>
                    <View style={[styles.micGlowInner, practiceListening && styles.micGlowInnerRecording]}>
                      <TouchableOpacity
                        style={[styles.micButton, practiceListening && styles.micButtonRecording]}
                        disabled={practiceProcessing}
                        onPress={practiceListening ? stopPracticeListening : startPracticeListening}
                        accessibilityRole="button"
                        accessibilityLabel={
                          practiceProcessing
                            ? 'Processing your recording'
                            : practiceListening
                            ? 'Stop recording'
                            : `Record yourself saying ${selectedWord}`
                        }
                      >
                        {practiceProcessing ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Ionicons name={practiceListening ? 'stop-circle-outline' : 'mic-outline'} size={36} color="#fff" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </ReanimatedView.View>

                <Text style={[styles.practiceStatus, bodyA11y]}>{practiceStatus}</Text>
                {practiceListening && (
                  <Text style={styles.micTimerText}>{formatElapsed(recordingElapsed)} • Nakikinig...</Text>
                )}
                {!!practiceTranscript && (
                  <Text style={[styles.practiceTranscript, bodyA11y]}>Narinig ko: &quot;{practiceTranscript}&quot;</Text>
                )}
              </View>
            </View>

            {practiceResult && (
              <>
                <PracticeResultCard
                  result={practiceResult}
                  word={selectedWord}
                  showScore={dashboardSettings?.show_accuracy_score !== false}
                  onReplay={() => speakPracticeWord(selectedWord)}
                  onRetry={handlePracticeAgain}
                  onNext={handleNextWord}
                />

                <View style={styles.encourageCard}>
                  <Image source={require('../../assets/book.webp')} style={styles.encourageImage} resizeMode="contain" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.encourageTitle, cardTitleA11y]}>Every practice makes you a better reader!</Text>
                    <Text style={[styles.encourageSub, bodyA11y]}>
                      {remainingWords > 0
                        ? `${remainingWords} pang salita para matapos ang set ngayon!`
                        : 'Natapos mo na ang lahat ng salita ngayon! 🎉'}
                    </Text>
                    <View style={styles.encourageButtonRow}>
                      <TouchableOpacity
                        style={styles.encourageButtonGhost}
                        onPress={handlePracticeAgain}
                        accessibilityRole="button"
                        accessibilityLabel="Practice this word again"
                      >
                        <Ionicons name="refresh" size={16} color={HOME_LAVENDER_DARK} />
                        <Text style={[styles.encourageButtonGhostText, buttonA11y]}>Practice Again</Text>
                      </TouchableOpacity>
                      {/* Next Word only appears once the attempt actually passed -
                          matching PracticeResultCard's own gating (no "Susunod na
                          Salita" button on a wrong result) so this card can't be
                          used to skip ahead on a failed attempt. */}
                      {practiceResult.correct && (
                        <TouchableOpacity
                          style={styles.encourageButtonSolid}
                          onPress={handleNextWord}
                          accessibilityRole="button"
                          accessibilityLabel="Go to next word"
                        >
                          <Text style={[styles.encourageButtonSolidText, buttonA11y]}>Next Word</Text>
                          <Ionicons name="arrow-forward" size={16} color="#fff" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              </>
            )}

            {renderSessionProgressCard()}
            {renderReadingTipCard()}
          </ScrollView>
        </View>
      );
    }

    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const goalPct = Math.round((goalDone / DAILY_GOAL) * 100);

    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.homeHeaderRow}>
          <View style={styles.homeHeaderAvatar}>
            <Text style={styles.homeHeaderAvatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.homeGreetingHello, cardTitleA11y]}>Practice</Text>
            <Text style={[styles.homeGreetingSub, bodyA11y]}>Magsanay tayong magbasa nang magkasama!</Text>
          </View>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalTopRow}>
            <Text style={[styles.goalTitle, cardTitleA11y]}>Today&apos;s Practice</Text>
            {goalDone > 0 ? (
              <Text style={[styles.goalCount, statLabelA11y]}>{goalDone}/{DAILY_GOAL}</Text>
            ) : (
              <Text style={[styles.goalCountEmpty, statLabelA11y]}>Bagong simula!</Text>
            )}
          </View>
          <View style={styles.goalTrack}>
            <View style={[styles.goalTrackFill, { width: `${Math.max(4, goalPct)}%` }]} />
          </View>
          <Text style={[styles.goalEmptyNote, bodyA11y]}>
            {goalDone === 0 ? 'Simulan ang unang pagsasanay ngayon! 🌱' : '✨ Ang galing! Ipagpatuloy mo!'}
          </Text>
          <View style={styles.rewardRow}>
            <View style={[styles.rewardPill, { backgroundColor: '#FBE7DF' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="star" size={13} color={HOME_CORAL} />
              </View>
              <Text style={[styles.rewardText, { color: HOME_CORAL }, smallLabelA11y]}>
                {stats.xp > 0 ? `${stats.xp} XP` : 'Simulan ang XP mo!'}
              </Text>
            </View>
            <View style={[styles.rewardPill, { backgroundColor: '#FFF3DC' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="flame" size={13} color={HOME_SUN} />
              </View>
              <Text style={[styles.rewardText, { color: HOME_SUN }, smallLabelA11y]}>
                {stats.streak > 0 ? `${stats.streak} streak` : 'Simulan ang streak!'}
              </Text>
            </View>
            <View style={[styles.rewardPill, { backgroundColor: '#EFECFB' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="ribbon" size={13} color={HOME_LAVENDER_DARK} />
              </View>
              <Text style={[styles.rewardText, { color: HOME_LAVENDER_DARK }, smallLabelA11y]}>
                {(progress?.achievements?.length || 0) > 0 ? `${progress?.achievements?.length} badges` : 'Kumuha ng unang badge!'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>🤖 Recommended Reading Practice</Text>

        {recommendedItem && (
          <View style={styles.aiRecommendationCard}>
            <View style={styles.aiRecommendationTopRow}>
              <View style={styles.aiRecommendationIcon}>
                <Ionicons name="sparkles" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.aiRecommendationWordRow}>
                  <Text style={[styles.aiRecommendationWord, cardTitleA11y]}>{recommendedItem.contentText}</Text>
                  <View style={styles.trackPill}>
                    <Text style={[styles.trackPillText, smallLabelA11y]}>
                      {practiceTypeLabels[recommendedItem.contentType]}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.aiRecommendationReason, bodyA11y]}>
                  {currentPracticeReason || 'Current unlocked curriculum frontier.'}
                </Text>
              </View>
              {readingProfile && (
                <View style={styles.aiConfidencePill}>
                  <Text style={styles.aiConfidenceValue}>{readingProfile.confidenceScore}%</Text>
                  <Text style={styles.aiConfidenceLabel}>Confidence</Text>
                </View>
              )}
            </View>
            {!!readingProfile?.recommendedFocus && (
              <Text style={[styles.aiRecommendationFocus, bodyA11y]}>Focus: {readingProfile.recommendedFocus}</Text>
            )}
          </View>
        )}

        {!recommendedItem && !wordBankLoading && !!wordBankError && (
          <View style={styles.errorBlock}>
            <Text style={[styles.error, bodyA11y]}>{wordBankError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => void loadCurrentPracticeItem(practiceCategoryFilter || undefined)}
              accessibilityRole="button"
              accessibilityLabel="Retry loading practice item"
            >
              <Text style={[styles.retryButtonText, buttonA11y]}>Subukan muli</Text>
            </TouchableOpacity>
          </View>
        )}

        {!recommendedItem && !wordBankLoading && !wordBankError && (
          <View style={styles.completedTrackBanner}>
            <Ionicons name="checkmark-circle" size={24} color={SUCCESS} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.completedTrackTitle, cardTitleA11y]}>Tapos na ang kasalukuyang curriculum set!</Text>
              <Text style={[styles.completedTrackText, bodyA11y]}>Wala nang naka-lock na practice item sa antas na ito.</Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.practiceModeCard, !recommendedItem && styles.practiceModeCardDisabled]}
          disabled={!recommendedItem}
          onPress={() => recommendedItem && startWord(recommendedItem.contentText, 'say', recommendedItem.id)}
          accessibilityRole="button"
          accessibilityLabel="Start Say the Word practice mode"
        >
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="mic" size={24} color={HOME_LAVENDER_DARK} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.practiceModeTitle, cardTitleA11y]}>Sabihin ang Salita</Text>
            <Text style={[styles.practiceModeSub, bodyA11y]}>Pakinggan ang salita, pagkatapos sabihin ito nang malakas.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#EFECFB' }]}>
              <Text style={[styles.practiceModeTagText, { color: HOME_LAVENDER_DARK }, smallLabelA11y]}>AI Pronunciation Practice</Text>
            </View>
          </View>
          <View style={styles.practiceModeStartPill}>
            <Text style={[styles.practiceModeStartText, buttonA11y]}>Simulan</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.practiceModeCard, !recommendedItem && styles.practiceModeCardDisabled]}
          disabled={!recommendedItem}
          onPress={() => recommendedItem && startWord(recommendedItem.contentText, 'listen', recommendedItem.id)}
          accessibilityRole="button"
          accessibilityLabel="Start Listen and Read practice mode"
        >
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="volume-high" size={24} color={HOME_SAGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.practiceModeTitle, cardTitleA11y]}>Pakinggan at Basahin</Text>
            <Text style={[styles.practiceModeSub, bodyA11y]}>Pakinggan ang salita at sundan ito habang binabasa.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#E9F1E2' }]}>
              <Text style={[styles.practiceModeTagText, { color: HOME_SAGE }, smallLabelA11y]}>Text-to-Speech Support</Text>
            </View>
          </View>
          <View style={[styles.practiceModeStartPill, { backgroundColor: HOME_SAGE }]}>
            <Text style={[styles.practiceModeStartText, buttonA11y]}>Simulan</Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.practiceModeCard, styles.practiceModeCardDisabled]}>
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="book" size={24} color={HOME_SUN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.practiceModeTitle, cardTitleA11y]}>Basahin nang Malakas</Text>
            <Text style={[styles.practiceModeSub, bodyA11y]}>Magsanay bumasa ng mga pangungusap nang malakas.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#FFF3DC' }]}>
              <Text style={[styles.practiceModeTagText, { color: HOME_SUN }, smallLabelA11y]}>Sa Madaling Panahon</Text>
            </View>
          </View>
        </View>

        {!!practiceCategoryFilter && (
          <View style={styles.categoryFilterBar}>
            <Text style={[styles.categoryFilterBarText, bodyA11y]}>
              Showing: {practiceTypeLabels[practiceCategoryFilter]}
            </Text>
            <TouchableOpacity
              onPress={() => setPracticeCategoryFilter(null)}
              accessibilityRole="button"
              accessibilityLabel="Clear category filter, show all"
            >
              <Text style={[styles.categoryFilterBarReset, buttonA11y]}>Show All</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Compact, read-only progress summary - replaces the old full word
            grid. reading_content stays the source of truth server-side; the
            client only ever fetches/shows the current item plus a count,
            never the whole sequence rendered as tappable cards. */}
        <View style={styles.learnProgressCard}>
          <View style={styles.learnProgressTopRow}>
            <View style={styles.practiceProgressTitleRow}>
              <Ionicons name="albums-outline" size={16} color={HOME_LAVENDER_DARK} />
              <Text style={[styles.learnProgressTitle, cardTitleA11y]}>
                {practiceCategoryFilter ? practiceTypeLabels[practiceCategoryFilter] : 'Curriculum Progress'}
              </Text>
            </View>
            {wordTotal > 0 && (
              <View style={styles.practiceWordPill}>
                <Text style={[styles.practiceWordPillText, smallLabelA11y]}>Salita {wordPosition} sa {wordTotal}</Text>
              </View>
            )}
          </View>
          <View style={styles.learnProgressTrack}>
            <View style={{ width: `${wordTotal ? Math.max(4, Math.round((wordsDoneCount / wordTotal) * 100)) : 4}%`, height: '100%' }}>
              <LinearGradient
                colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1, borderRadius: 5 }}
              />
            </View>
          </View>
          <View style={styles.practiceTipRow}>
            <Ionicons name="bulb" size={14} color={HOME_SUN} />
            <Text style={[styles.practiceTipText, bodyA11y]}>
              {wordTotal === 0
                ? 'Wala pang item sa antas na ito.'
                : remainingWords > 0
                ? `${remainingWords} pang item para matapos ang set na ito!`
                : 'Tapos na ang buong set!'}
            </Text>
          </View>
        </View>

        {renderSessionProgressCard()}
        {renderReadingTipCard()}
      </ScrollView>
    );
  };

  const renderActivities = () => {

    const lessonSubjects = Array.from(new Set(lessons.map((l) => l.subject).filter(Boolean))) as string[];

    const lessonsAscending = lessons
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const filteredLessonsAscending = lessonFilter === 'Lahat'
      ? lessonsAscending
      : lessonsAscending.filter((l) => l.subject === lessonFilter);

    const inProgressRows = lessonProgress
      .filter((p) => p.status === 'in_progress')
      .slice()
      .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
    const continueReadingLesson = inProgressRows.length
      ? lessons.find((l) => l.id === inProgressRows[0].lesson_id) || null
      : null;

    // "Learning Progress" - real completed/total lesson counts, no fixed
    // denominator. See migration/migrations/013_lesson_progress.sql: lessons
    // have no sequence field, so there's no real "5 lessons" curriculum to
    // measure against - the total is whatever the teacher has actually
    // uploaded and published.
    const totalLessonsCount = lessons.length;
    const completedLessonsCount = lessonProgress.filter((p) => p.status === 'completed').length;
    const learningProgressPct = totalLessonsCount
      ? Math.round((completedLessonsCount / totalLessonsCount) * 100)
      : 0;

    // Same daily-goal metric already shown on Home and Practice (real
    // total_attempts mod DAILY_GOAL) - intentionally the same number a third
    // time, not a competing/fabricated metric.
    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const goalPct = Math.round((goalDone / DAILY_GOAL) * 100);

    // Official workbook curriculum and stable-id completions replace the
    // historical local arrays/completed_words string matching.
    const currentReadingLevel = officialProgression?.effective_level || progress?.level || 'Beginner';
    const currentLevelContent = readingContent.filter((item) => item.level === currentReadingLevel);
    const wordItems = currentLevelContent.filter((item) => item.content_type === 'word');
    const companionType: CurriculumPracticeType = currentReadingLevel === 'Beginner'
      ? 'phonetic'
      : currentReadingLevel === 'Intermediate' ? 'phrase' : 'sentence';
    const companionItems = currentLevelContent.filter((item) => item.content_type === companionType);
    const assessmentItems = readingContent.filter((item) => item.content_type === 'paragraph' && item.is_assessment);
    const completedCount = (items: ReadingContentItem[]) => items.filter((item) => completedContentIds.has(item.id)).length;
    const wordsDone = completedCount(wordItems);
    const companionDone = completedCount(companionItems);
    const assessmentsDone = completedCount(assessmentItems);
    const companionLabel = companionType === 'phonetic' ? 'Phonetics' : companionType === 'phrase' ? 'Phrases' : 'Sentences';

    const lessonStateLabel = (state: 'not_started' | 'in_progress' | 'completed') =>
      state === 'completed' ? 'Nabasa na' : state === 'in_progress' ? 'Binabasa' : 'Hindi pa binuksan';

    const currentRequirements = officialProgression?.requirements.filter((row) => row.level === currentReadingLevel) || [];
    const requiredTotal = currentRequirements.reduce((sum, row) => sum + row.required_count, 0);
    const officialCompletedTotal = currentRequirements.reduce(
      (sum, row) => sum + Math.min(row.completed_count, row.required_count),
      0,
    );
    const journeyPct = requiredTotal ? Math.round((officialCompletedTotal / requiredTotal) * 100) : 0;
    const journeyRemaining = Math.max(0, requiredTotal - officialCompletedTotal);

    return (
    <>
      {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
      <LinearGradient
        colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroBanner}
      >
        <View style={styles.heroTopRow}>
          <TouchableOpacity
            style={styles.heroLogoRow}
            onPress={openSidebar}
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
          >
            <Ionicons name="menu-outline" size={20} color="#fff" />
            <Ionicons name="book" size={16} color="#fff" />
            <Text style={styles.heroLogoText}>LinawLetra</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.heroGreeting, heroTitleA11yStyle]}>Matuto tayo,{'\n'}{getFirstName(child?.name || '')}!</Text>
        <Text style={[styles.heroSubtitle, heroSubtitleA11yStyle]}>Piliin ang aralin at ipagpatuloy ang iyong paglalakbay sa pagbasa.</Text>
        <Image source={require('../../assets/learn.webp')} style={styles.learnHeroImage} resizeMode="contain" />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#EFECFB' }]}>
          <Ionicons name="library" size={16} color={HOME_LAVENDER_DARK} />
          <Text style={[styles.learnBadgeText, { color: HOME_LAVENDER_DARK }, smallLabelA11y]}>LEARN</Text>
        </View>
        <Text style={[styles.learnSectionSubtitle, bodyA11y]}>Mga takdang-aralin mula sa iyong guro</Text>
      </View>

      {activitiesLoading ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="small" color={HOME_LAVENDER} />
          <Text style={[styles.empty, bodyA11y]}>Loading activities...</Text>
        </View>
      ) : activitiesError ? (
        <View style={styles.errorBlock}>
          <Text style={[styles.error, bodyA11y]}>{activitiesError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={retryActivities}
            accessibilityRole="button"
            accessibilityLabel="Retry loading activities"
          >
            <Text style={[styles.retryButtonText, buttonA11y]}>Subukan muli</Text>
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
                <Text style={[styles.learnItemTitle, cardTitleA11y]}>{activity.title}</Text>
                <View style={styles.learnItemMetaRow}>
                  <View style={[styles.learnStatusDot, { backgroundColor: getStatusColor(activity.status) }]} />
                  <Text style={[styles.learnItemMeta, smallLabelA11y]}>
                    {activity.subject || 'Activity'} • Due {new Date(activity.deadline).toLocaleDateString()}
                  </Text>
                </View>
                {!!activity.description && <Text style={[styles.learnItemDescription, bodyA11y]}>{activity.description}</Text>}
              </View>
              {activity.status === 'completed' || activity.status === 'completed_late' ? (
                <Text style={[styles.learnStatusBadge, { color: getStatusTextColor(activity.status) }, smallLabelA11y]}>{getStatusLabel(activity.status)}</Text>
              ) : (
                <TouchableOpacity
                  style={styles.learnActionButton}
                  onPress={() => void completeActivity(activity)}
                  accessibilityRole="button"
                  accessibilityLabel={`Turn in ${activity.title}`}
                >
                  <Text style={[styles.learnActionButtonText, buttonA11y]}>Turn In</Text>
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
          <Text style={[styles.learnEmptyTitle, cardTitleA11y]}>Wala ka pang assignment ngayon</Text>
          <Text style={[styles.learnEmptySubtext, bodyA11y]}>Hihintayin natin ang unang takdang-aralin mula sa guro mo! 📝</Text>
        </View>
      )}

      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#EFECFB' }]}>
          <Ionicons name="flag" size={16} color={HOME_LAVENDER_DARK} />
          <Text style={[styles.learnBadgeText, { color: HOME_LAVENDER_DARK }, smallLabelA11y]}>MY LEARNING PATH</Text>
        </View>
        <Text style={[styles.learnSectionSubtitle, bodyA11y]}>Sundan ang mga aralin at buuin ang iyong reading skills</Text>
      </View>

      {totalLessonsCount > 0 ? (
        <View style={styles.learnProgressCard}>
          <View style={styles.learnProgressTopRow}>
            <Text style={[styles.learnProgressTitle, cardTitleA11y]}>Learning Progress</Text>
            <Text style={[styles.learnProgressPct, statValueA11y]}>{learningProgressPct}%</Text>
          </View>
          <Text style={[styles.learnProgressCount, bodyA11y]}>{completedLessonsCount} / {totalLessonsCount} Lessons Completed</Text>
          <View style={styles.learnProgressTrack}>
            <View style={{ width: `${Math.max(4, learningProgressPct)}%`, height: '100%' }}>
              <LinearGradient
                colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1, borderRadius: 5 }}
              />
            </View>
          </View>
          <Text style={[styles.learnProgressMsg, bodyA11y]}>
            {completedLessonsCount === 0 ? 'Simulan ang unang aralin mo!' : 'Keep going! Umaangat ka nang umaangat.'}
          </Text>
        </View>
      ) : (
        <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC' }]}>
          <View style={[styles.learnEmptyIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="book-outline" size={40} color={HOME_LAVENDER_DARK} />
          </View>
          <Text style={[styles.learnEmptyTitle, cardTitleA11y]}>Wala ka pang aralin</Text>
          <Text style={[styles.learnEmptySubtext, bodyA11y]}>Kapag nag-upload na ang guro mo ng aralin, makikita mo agad dito ang iyong progress! 📚</Text>
        </View>
      )}

      {totalLessonsCount > 0 && (
        <>
          <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Lesson Library</Text>

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
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter lessons: ${subj}`}
                  accessibilityState={{ selected: lessonFilter === subj }}
                >
                  <Text style={[styles.learnFilterChipText, lessonFilter === subj && styles.learnFilterChipTextActive, smallLabelA11y]}>
                    {subj}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {lessonsLoading && (
            <View style={styles.centerBlock}>
              <ActivityIndicator size="small" color={HOME_LAVENDER} />
              <Text style={[styles.empty, bodyA11y]}>Loading lessons...</Text>
            </View>
          )}
          {!lessonsLoading && !!lessonsError && (
            <View style={styles.errorBlock}>
              <Text style={[styles.error, bodyA11y]}>{lessonsError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={retryLessons}
                accessibilityRole="button"
                accessibilityLabel="Retry loading lessons"
              >
                <Text style={[styles.retryButtonText, buttonA11y]}>Subukan muli</Text>
              </TouchableOpacity>
            </View>
          )}
          {!lessonsLoading && !lessonsError && (
            <View style={styles.lessonStepList}>
              {filteredLessonsAscending.map((lesson, index) => {
                const state = getLessonState(lesson.id);
                const isLast = index === filteredLessonsAscending.length - 1;
                const cardBody = (
                  <>
                    <View style={styles.lessonStepBody}>
                      <Text
                        style={[styles.lessonStepTitle, state === 'in_progress' && styles.lessonStepTitleLight, cardTitleA11y]}
                        numberOfLines={1}
                      >
                        {lesson.title}
                      </Text>
                      <Text
                        style={[styles.lessonStepMeta, state === 'in_progress' && styles.lessonStepMetaLight, smallLabelA11y]}
                        numberOfLines={1}
                      >
                        {lesson.subject || 'Lesson'} • {lessonStateLabel(state)}
                      </Text>
                    </View>
                    {state === 'completed' ? (
                      <TouchableOpacity
                        style={styles.lessonStepButtonGhost}
                        onPress={() => openLesson(lesson)}
                        accessibilityRole="button"
                        accessibilityLabel={`Review lesson: ${lesson.title}`}
                      >
                        <Text style={[styles.lessonStepButtonGhostText, { color: VIVID_GREEN }, buttonA11y]}>Review Lesson</Text>
                      </TouchableOpacity>
                    ) : state === 'in_progress' ? (
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <TouchableOpacity
                          style={styles.lessonStepButtonLight}
                          onPress={() => openLesson(lesson)}
                          accessibilityRole="button"
                          accessibilityLabel={`Continue lesson: ${lesson.title}`}
                        >
                          <Text style={[styles.lessonStepButtonLightText, buttonA11y]}>Continue Learning</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => void finishLesson(lesson)}
                          accessibilityRole="button"
                          accessibilityLabel={`Mark lesson as finished: ${lesson.title}`}
                        >
                          <Text style={[styles.lessonStepMarkDoneLight, smallLabelA11y]}>Tapos na</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.lessonStepButtonGhost}
                        onPress={() => openLesson(lesson)}
                        accessibilityRole="button"
                        accessibilityLabel={`Start lesson: ${lesson.title}`}
                      >
                        <Text style={[styles.lessonStepButtonGhostText, buttonA11y]}>Simulan</Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
                return (
                  <View key={lesson.id} style={styles.lessonStepRow}>
                    <View style={styles.lessonStepRail}>
                      <View
                        style={[
                          styles.lessonStepDot,
                          state === 'completed' && styles.lessonStepDotDone,
                          state === 'in_progress' && styles.lessonStepDotActive,
                        ]}
                      >
                        {state === 'completed' && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                      {!isLast && <View style={styles.lessonStepLine} />}
                    </View>
                    {state === 'in_progress' ? (
                      <LinearGradient
                        colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.lessonStepCard, styles.lessonStepCardActive]}
                      >
                        {cardBody}
                      </LinearGradient>
                    ) : (
                      <View style={[styles.lessonStepCard, state === 'completed' ? styles.lessonStepCardDone : styles.lessonStepCardMuted]}>
                        {cardBody}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Learning Categories</Text>
      <View style={styles.categoryGrid}>
        <TouchableOpacity
          style={[styles.categoryCard, { backgroundColor: '#F1E9FE' }]}
          onPress={() => goToPractice('word')}
          accessibilityRole="button"
          accessibilityLabel={`Practice Words, ${wordsDone} of ${wordItems.length} completed`}
        >
          <View style={[styles.categoryIconWrap, { backgroundColor: VIVID_VIOLET }]}>
            <Ionicons name="book" size={20} color="#fff" />
          </View>
          <Text style={[styles.categoryTitle, cardTitleA11y]}>Words</Text>
          <Text style={[styles.categorySub, bodyA11y]}>{wordsDone} of {wordItems.length} completed</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.categoryCard, { backgroundColor: '#E1F5F2' }]}
          onPress={() => goToPractice(companionType)}
          accessibilityRole="button"
          accessibilityLabel={`Practice ${companionLabel}, ${companionDone} of ${companionItems.length} completed`}
        >
          <View style={[styles.categoryIconWrap, { backgroundColor: VIVID_TEAL }]}>
            <Ionicons name="reader" size={20} color="#fff" />
          </View>
          <Text style={[styles.categoryTitle, cardTitleA11y]}>{companionLabel}</Text>
          <Text style={[styles.categorySub, bodyA11y]}>{companionDone} of {companionItems.length} completed</Text>
        </TouchableOpacity>
        {currentReadingLevel === 'Advanced' && (
          <View style={[styles.categoryCard, { backgroundColor: '#E7ECF8' }]}>
            <View style={[styles.categoryIconWrap, { backgroundColor: VIVID_NAVY }]}>
              <Ionicons name="document-text" size={20} color="#fff" />
            </View>
            <Text style={[styles.categoryTitle, cardTitleA11y]}>Paragraph Assessments</Text>
            <Text style={[styles.categorySub, bodyA11y]}>{assessmentsDone} of {assessmentItems.length} submitted</Text>
            <Text style={[styles.categorySub, smallLabelA11y]}>Assessment content — not ordinary practice</Text>
          </View>
        )}
        <View style={[styles.categoryCard, styles.categoryTipCard, { backgroundColor: '#FEF3D6' }]}>
          <View style={[styles.categoryIconWrap, { backgroundColor: VIVID_AMBER }]}>
            <Ionicons name="bulb" size={20} color="#fff" />
          </View>
          <Text style={[styles.categoryTitle, cardTitleA11y]}>Reading Tip</Text>
          <Text style={[styles.categorySub, bodyA11y]}>Bigkasin ang bawat pantig nang dahan-dahan bago pagsamahin.</Text>
          <Image source={require('../../assets/learnboypng.webp')} style={styles.categoryTipImage} resizeMode="contain" />
        </View>
      </View>

      <View style={styles.learnBottomRow}>
        {continueReadingLesson ? (
          <View style={[styles.learnContinueCard, styles.learnBottomCard]}>
            <View style={{ maxWidth: '66%' }}>
              <View style={styles.learnContinuePill}>
                <Text style={[styles.learnContinuePillText, smallLabelA11y]}>IPAGPATULOY</Text>
              </View>
              <Text style={[styles.learnContinueTitle, cardTitleA11y]} numberOfLines={2}>{continueReadingLesson.title}</Text>
              <TouchableOpacity
                style={styles.learnContinueButton}
                onPress={() => openLesson(continueReadingLesson)}
                accessibilityRole="button"
                accessibilityLabel={`Continue lesson: ${continueReadingLesson.title}`}
              >
                <Text style={[styles.learnContinueButtonText, buttonA11y]}>Ipagpatuloy</Text>
              </TouchableOpacity>
            </View>
            <Image source={require('../../assets/learn2.webp')} style={styles.learnContinueImage} resizeMode="contain" />
          </View>
        ) : (
          <View style={[styles.learnContinueCard, styles.learnBottomCard]}>
            <View style={{ maxWidth: '66%' }}>
              <View style={styles.learnContinuePill}>
                <Text style={[styles.learnContinuePillText, smallLabelA11y]}>MGA PANTIG</Text>
              </View>
              <Text style={[styles.learnContinueTitle, cardTitleA11y]}>Magsanay Magbasa</Text>
              <TouchableOpacity
                style={styles.learnContinueButton}
                onPress={() => goToPractice()}
                accessibilityRole="button"
                accessibilityLabel="Start practice"
              >
                <Text style={[styles.learnContinueButtonText, buttonA11y]}>Simulan</Text>
              </TouchableOpacity>
            </View>
            <Image source={require('../../assets/learn2.webp')} style={styles.learnContinueImage} resizeMode="contain" />
          </View>
        )}

        <View style={[styles.learnGoalCard, styles.learnBottomCard]}>
          <Text style={[styles.learnGoalTitle, cardTitleA11y]}>Daily Learning Goal</Text>
          <Text style={[styles.learnGoalSub, bodyA11y]}>{goalDone} of {DAILY_GOAL} learning activities today</Text>
          <View style={styles.learnGoalTrack}>
            <View style={[styles.learnGoalTrackFill, { width: `${Math.max(4, goalPct)}%` }]} />
          </View>
          <Text style={[styles.learnGoalMsg, bodyA11y]}>
            {goalDone === 0 ? 'Simulan ang unang aralin ngayon!' : goalDone >= DAILY_GOAL ? 'Tapos na ang goal mo! 🎉' : 'Halos tapos na, ipagpatuloy mo!'}
          </Text>
        </View>
      </View>

      {!!uploadsError && (
        <View style={styles.errorBlock}>
          <Text style={[styles.error, bodyA11y]}>{uploadsError}</Text>
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
                  <Text style={[styles.learnItemTitle, cardTitleA11y]}>{name}</Text>
                  <Text style={[styles.learnItemMeta, smallLabelA11y]}>{new Date(upload.created_at).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.learnActionButton, { backgroundColor: HOME_SAGE }]}
                  onPress={() => openUpload(upload)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}`}
                >
                  <Text style={[styles.learnActionButtonText, buttonA11y]}>Buksan</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.learnJourneyCard}>
        <Text style={styles.learnJourneyTitle}>Iyong Paglalakbay sa Pagbasa</Text>
        <Text style={styles.learnJourneyLevel}>{currentReadingLevel}</Text>
        <View style={styles.learnJourneyTrack}>
          <View style={[styles.learnJourneyFill, { width: `${Math.max(4, journeyPct)}%` }]} />
        </View>
        <Text style={styles.learnJourneyMsg}>
          {officialProgression?.program_complete
            ? 'Nakumpleto mo na ang official reading program!'
            : `${journeyRemaining} official curriculum item${journeyRemaining === 1 ? '' : 's'} remaining at this level.`}
        </Text>
      </View>
    </ScrollView>
    </>
    );
  };

  const renderProgress = () => {
    const avgAccuracy = (progress?.total_attempts || 0) > 0
      ? Math.round((progress?.accuracy_sum || 0) / (progress!.total_attempts || 1))
      : null;
    const tierColor = (pct: number) => (pct >= 80 ? SUCCESS : pct >= 60 ? WARNING : DANGER);
    // Text-safe variant for the same tiers - used wherever the color paints
    // Text rather than a background/icon/border.
    const tierTextColor = (pct: number) => (pct >= 80 ? SUCCESS : pct >= 60 ? WARNING_TEXT : DANGER_TEXT);
    const tierMessage = (pct: number) =>
      pct >= 80 ? "You're making great progress!" : pct >= 60 ? 'Sige lang, umaangat ka!' : 'Ipagpatuloy ang pagsasanay!';
    const maxBarHeight = 90;
    const completedWords = progress?.completed_words || [];
    const lessonsCompletedCount = lessonProgress.filter((p) => p.status === 'completed').length;
    // Personal-best streak (021_longest_streak.sql) - never lower than the
    // live current streak, which itself can reset to 0. Falls back to the
    // current streak if the column hasn't been migrated yet for this row.
    const longestStreak = Math.max(progress?.longest_streak || 0, progress?.streak || 0);

    const monthKey = new Date().toISOString().slice(0, 7);

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

    // Weekly Reading Activity — real session COUNT per day (distinct from
    // the accuracy trend above), same last7Days/dayLabels, same hand-built
    // View-height-percentage bar technique - no charting library.
    const weeklyActivity = last7Days.map((day) => {
      const dayKey = day.toISOString().slice(0, 10);
      const count = recentSessions.filter((s) => (s.created_at || '').slice(0, 10) === dayKey).length;
      return { label: dayLabels[day.getDay()], count };
    });
    const sessionsThisWeek = weeklyActivity.reduce((sum, d) => sum + d.count, 0);
    const maxWeeklyCount = Math.max(1, ...weeklyActivity.map((d) => d.count));

    // My Reading Skills — real categories derived from actual word shape
    // (see categorizeWord), scored from actual pronunciation session rows.
    // Only 3 real rows exist (letters/syllables/words) - no "Sentence
    // Reading" (nothing sentence-level is tracked anywhere) and no separate
    // "Pronunciation" row (every row here already IS a pronunciation-scored
    // measurement, so a 5th row would double-count the same data).
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
        ? { label: 'Wala Pang Sinubukan', color: HOME_INK_SOFT, textColor: HOME_INK_SOFT }
        : avg >= 80
        ? { label: 'Strong', color: SUCCESS, textColor: SUCCESS }
        : avg >= 60
        ? { label: 'Improving', color: WARNING, textColor: WARNING_TEXT }
        : { label: 'Keep Practicing', color: DANGER, textColor: DANGER_TEXT };

    // This Month — real month-scoped aggregations, not lifetime totals.
    const lessonsCompletedThisMonth = lessonProgress.filter(
      (p) => p.status === 'completed' && !!p.completed_at && (p.completed_at as string).slice(0, 7) === monthKey
    ).length;
    const monthSessions = recentSessions.filter((s) => (s.created_at || '').slice(0, 7) === monthKey);
    const wordsReadThisMonth = new Set(monthSessions.map((s) => s.word)).size;
    const monthAvgAccuracy = monthSessions.length
      ? Math.round(monthSessions.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / monthSessions.length)
      : null;

    // Recent Activity — merged real feed (same pattern as the Home tab):
    // whatever mix of completed lessons and pronunciation sessions actually
    // happened, sorted by real timestamp, not a fabricated fixed layout.
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
      detail: `${Math.round(Number(s.accuracy_percentage) || 0)}% accuracy`,
      timestamp: s.created_at,
    }));
    const recentActivityItems = [...lessonActivityItems, ...pronunciationActivityItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 4);
    const formatActivityTime = (iso: string) => {
      const date = new Date(iso);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return isToday ? `Today ${time}` : `${date.toLocaleDateString()} ${time}`;
    };

    return (
      <>
        {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
        <LinearGradient
          colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroBanner}
        >
          <View style={styles.heroTopRow}>
            <TouchableOpacity
              style={styles.heroLogoRow}
              onPress={openSidebar}
              accessibilityRole="button"
              accessibilityLabel="Open navigation menu"
            >
              <Ionicons name="menu-outline" size={20} color="#fff" />
              <Ionicons name="book" size={16} color="#fff" />
              <Text style={styles.heroLogoText}>LinawLetra</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.heroGreeting, heroTitleA11yStyle]}>My Reading{'\n'}Progress</Text>
          <Text style={[styles.heroSubtitle, heroSubtitleA11yStyle]}>See how much you&apos;ve improved on your reading journey.</Text>
          <Image source={require('../../assets/clipboard.webp')} style={styles.progressHeroImage} resizeMode="contain" />
        </LinearGradient>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.progressHeroCard}>
          <Text style={[styles.progressHeroTitle, cardTitleA11y]}>Overall Reading Progress</Text>
          <View style={styles.progressOverallRow}>
            <View style={styles.progressOverallCol}>
              <View style={[styles.progressStatCard, styles.progressOverallStatCard, { backgroundColor: '#EFECFB' }]}>
                <View style={[styles.progressStatIconWrap, { backgroundColor: VIVID_VIOLET }]}>
                  <Ionicons name="school" size={16} color="#fff" />
                </View>
                <Text style={[styles.progressStatValue, { color: VIVID_VIOLET }, statValueA11y]}>{lessonsCompletedCount}</Text>
                <Text style={[styles.progressStatLabel, statLabelA11y]}>Lessons Completed</Text>
              </View>
              <View style={[styles.progressStatCard, styles.progressOverallStatCard, { backgroundColor: '#E9F1E2' }]}>
                <View style={[styles.progressStatIconWrap, { backgroundColor: VIVID_GREEN }]}>
                  <Ionicons name="book" size={16} color="#fff" />
                </View>
                <Text style={[styles.progressStatValue, { color: VIVID_GREEN }, statValueA11y]}>{stats.completed}</Text>
                <Text style={[styles.progressStatLabel, statLabelA11y]}>Words Practiced</Text>
              </View>
            </View>
            <View style={styles.progressRingShadowWrap}>
              <ProgressRing
                percent={avgAccuracy ?? 0}
                size={112}
                strokeWidth={12}
                color={HOME_LAVENDER_DARK}
                trackColor="rgba(124,111,207,0.12)"
                gradientColors={[HERO_GRADIENT_MID, HERO_GRADIENT_START]}
                gradientId="progressOverallRing"
              >
                <Text style={[styles.progressHeroRingPct, statValueA11y]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
                <Text style={[styles.progressHeroRingLabel, smallLabelA11y]}>Complete</Text>
              </ProgressRing>
            </View>
            <View style={styles.progressOverallCol}>
              <View style={[styles.progressStatCard, styles.progressOverallStatCard, { backgroundColor: '#FBE7DF' }]}>
                <View style={[styles.progressStatIconWrap, { backgroundColor: VIVID_ORANGE }]}>
                  <Ionicons name="mic" size={16} color="#fff" />
                </View>
                <Text style={[styles.progressStatValue, { color: VIVID_ORANGE }, statValueA11y]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
                <Text style={[styles.progressStatLabel, statLabelA11y]}>Pronunciation Accuracy</Text>
              </View>
              <View style={[styles.progressStatCard, styles.progressOverallStatCard, { backgroundColor: '#FFF3DC' }]}>
                <View style={[styles.progressStatIconWrap, { backgroundColor: VIVID_AMBER }]}>
                  <Ionicons name="flame" size={16} color="#fff" />
                </View>
                <Text style={[styles.progressStatValue, { color: VIVID_AMBER }, statValueA11y]}>{progress?.streak || 0} Days</Text>
                <Text style={[styles.progressStatLabel, statLabelA11y]}>Current Streak</Text>
                {longestStreak > 0 && (
                  <View style={styles.progressStreakBestPill}>
                    <Ionicons name="star" size={9} color={XP_GOLD} />
                    <Text style={[styles.progressStreakBestText, smallLabelA11y]}>Best: {longestStreak}d</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          {avgAccuracy !== null ? (
            <View style={styles.progressHeroStatusPill}>
              <Ionicons name="checkmark-circle" size={14} color={tierColor(avgAccuracy)} />
              <Text style={[styles.progressHeroStatusText, { color: tierTextColor(avgAccuracy) }, bodyA11y]}>{tierMessage(avgAccuracy)}</Text>
            </View>
          ) : (
            <Text style={[styles.progressHeroEmptyText, bodyA11y]}>Magsanay para makita ang iyong progress dito!</Text>
          )}
        </View>

        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: VIVID_TEAL }]}>
            <Ionicons name="ribbon" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Reading Skills</Text>
        </View>
        <View style={styles.skillsCard}>
          {skillMeta.map(({ key, label, icon }, idx) => {
            const group = skillGroups[key];
            const avg = group.count > 0 ? Math.round(group.sum / group.count) : null;
            const tag = skillTag(avg);
            return (
              <View key={key} style={[styles.skillRow, idx === skillMeta.length - 1 && { marginBottom: 0 }]}>
                <View style={[styles.skillIconWrap, { backgroundColor: tag.color }]}>
                  <Ionicons name={icon as any} size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.skillTopRow}>
                    <Text style={[styles.skillLabel, cardSubtitleA11y]}>{label}</Text>
                    <View style={[styles.skillTagPill, { backgroundColor: `${tag.color}22` }]}>
                      <Text style={[styles.skillTagText, { color: tag.textColor }, smallLabelA11y]}>{tag.label}</Text>
                    </View>
                  </View>
                  <View style={styles.skillTrackRow}>
                    <View style={styles.skillTrack}>
                      <View style={[styles.skillTrackFill, { width: `${avg ? Math.max(4, avg) : 0}%`, backgroundColor: tag.color }]} />
                    </View>
                    <Text style={[styles.skillPct, smallLabelA11y]}>{avg !== null ? `${avg}%` : '—'}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* Weekly Reading Activity — real session COUNT per day (separate
            metric from the "Reading Accuracy" trend chart above) */}
        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: VIVID_VIOLET }]}>
            <Ionicons name="bar-chart" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Weekly Reading Activity</Text>
        </View>
        <View style={styles.progressChartCard}>
          {sessionsThisWeek > 0 ? (
            <View style={styles.progressChartBars}>
              {weeklyActivity.map((day, i) => (
                <View key={i} style={styles.progressChartBarCol}>
                  {day.count > 0 && <Text style={[styles.progressChartBarValue, { color: HOME_LAVENDER_DARK }, smallLabelA11y]}>{day.count}</Text>}
                  <LinearGradient
                    colors={[HOME_LAVENDER, HOME_LAVENDER_DARK]}
                    style={[
                      styles.progressChartBar,
                      { height: Math.max(6, Math.round((day.count / maxWeeklyCount) * maxBarHeight)) },
                    ]}
                    accessible
                    accessibilityLabel={`${day.label}: ${day.count} session${day.count === 1 ? '' : 's'}`}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.progressChartEmpty}>
              <Ionicons name="bar-chart-outline" size={32} color={HOME_LAVENDER} />
              <Text style={[styles.progressChartEmptyText, bodyA11y]}>Wala ka pang practice session ngayong linggo.</Text>
            </View>
          )}
          <View style={styles.progressChartDayRow}>
            {weeklyActivity.map((day, i) => (
              <Text key={i} style={[styles.progressChartDayLabel, smallLabelA11y]}>{day.label}</Text>
            ))}
          </View>
          <View style={styles.progressTrendMsgRow}>
            <Ionicons name="calendar" size={14} color={HOME_LAVENDER_DARK} />
            <Text style={styles.progressTrendMsgText}>{sessionsThisWeek} Practice Session{sessionsThisWeek === 1 ? '' : 's'} This Week</Text>
          </View>
        </View>

        {/* Weekly accuracy trend — real sessions grouped by day */}
        <View style={styles.progressChartCard}>
          <View style={styles.progressChartHeader}>
            <View style={[styles.progressSectionIconWrap, { backgroundColor: HOME_CORAL }]}>
              <Ionicons name="analytics" size={14} color="#fff" />
            </View>
            <Text style={[styles.progressChartTitle, cardTitleA11y]}>Reading Accuracy</Text>
          </View>
          {daysWithData.length >= 2 ? (
            <>
              <View style={styles.progressChartBars}>
                {weeklyTrend.map((day, i) => {
                  const color = day.pct !== null ? tierColor(day.pct) : 'rgba(124,111,207,0.12)';
                  const textColor = day.pct !== null ? tierTextColor(day.pct) : color;
                  return (
                    <View key={i} style={styles.progressChartBarCol}>
                      {day.pct !== null && <Text style={[styles.progressChartBarValue, { color: textColor }, smallLabelA11y]}>{day.pct}%</Text>}
                      <LinearGradient
                        colors={day.pct !== null ? [`${color}99`, color] : [color, color]}
                        style={[
                          styles.progressChartBar,
                          { height: day.pct !== null ? Math.max(6, Math.round((day.pct / 100) * maxBarHeight)) : 6 },
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
                  <Text key={i} style={[styles.progressChartDayLabel, smallLabelA11y]}>{day.label}</Text>
                ))}
              </View>
              <View style={styles.progressChartLegend}>
                <View style={styles.progressLegendItem}>
                  <View style={[styles.progressLegendDot, { backgroundColor: SUCCESS }]} />
                  <Text style={[styles.progressLegendText, smallLabelA11y]}>Magaling (80%+)</Text>
                </View>
                <View style={styles.progressLegendItem}>
                  <View style={[styles.progressLegendDot, { backgroundColor: WARNING }]} />
                  <Text style={[styles.progressLegendText, smallLabelA11y]}>Sige lang (60-79%)</Text>
                </View>
                <View style={styles.progressLegendItem}>
                  <View style={[styles.progressLegendDot, { backgroundColor: DANGER }]} />
                  <Text style={[styles.progressLegendText, smallLabelA11y]}>Mas mababa sa 60%</Text>
                </View>
              </View>
              <View style={styles.progressTrendMsgRow}>
                <Ionicons name="checkmark-circle" size={14} color={SUCCESS} />
                <Text style={[styles.progressTrendMsgText, bodyA11y]}>
                  {trendImproving ? 'Your accuracy is improving!' : 'Magpatuloy sa pagsasanay!'}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.progressChartEmpty}>
              <Ionicons name="analytics-outline" size={32} color={HOME_LAVENDER} />
              <Text style={[styles.progressChartEmptyText, bodyA11y]}>
                Magsanay pa ng ilang beses para makita ang iyong progress chart dito!
              </Text>
            </View>
          )}
        </View>

        {/* This Month — real month-scoped aggregations (lessonsCompletedThisMonth,
            wordsReadThisMonth, monthAvgAccuracy) plus the real longestStreak
            personal-best, not lifetime totals repeated */}
        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: VIVID_NAVY }]}>
            <Ionicons name="calendar" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>This Month</Text>
        </View>
        <View style={styles.progressMonthGrid}>
          <View style={[styles.homeGridCard, styles.progressMonthTile, { backgroundColor: '#EFECFB' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_VIOLET }]}>
              <Ionicons name="trophy" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_VIOLET }, statValueA11y]}>{lessonsCompletedThisMonth}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Lessons Finished</Text>
          </View>
          <View style={[styles.homeGridCard, styles.progressMonthTile, { backgroundColor: '#E9F1E2' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_GREEN }]}>
              <Ionicons name="book" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_GREEN }, statValueA11y]}>{wordsReadThisMonth}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Words Read</Text>
          </View>
          <View style={[styles.homeGridCard, styles.progressMonthTile, { backgroundColor: '#FBE7DF' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_ORANGE }]}>
              <Ionicons name="locate" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_ORANGE }, statValueA11y]}>{monthAvgAccuracy !== null ? `${monthAvgAccuracy}%` : '--'}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Average Accuracy</Text>
          </View>
          <View style={[styles.homeGridCard, styles.progressMonthTile, { backgroundColor: '#FFF3DC' }]}>
            {longestStreak > 0 && (
              <View style={styles.progressPbBadge}>
                <Ionicons name="star" size={9} color="#fff" />
                <Text style={[styles.progressPbBadgeText, smallLabelA11y]}>PB</Text>
              </View>
            )}
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_AMBER }]}>
              <Ionicons name="flame" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_AMBER }, statValueA11y]}>{longestStreak} Day{longestStreak === 1 ? '' : 's'}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Longest Streak</Text>
          </View>
        </View>

        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: HOME_SAGE }]}>
            <Ionicons name="time" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Recent Activity</Text>
        </View>
        {recentActivityItems.length ? (
          <View style={styles.learnCardList}>
            {recentActivityItems.map((item) => (
              <View key={item.key} style={[styles.homeRecentActivityCard, styles.progressActivityCardShadow]}>
                <View style={[styles.homeRecentActivityIconWrap, { backgroundColor: item.kind === 'lesson' ? '#E9F1E2' : '#EFECFB' }]}>
                  <Ionicons
                    name={item.kind === 'lesson' ? 'checkmark-circle' : 'mic'}
                    size={20}
                    color={item.kind === 'lesson' ? HOME_SAGE : HOME_LAVENDER_DARK}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.homeRecentActivityTitle, cardSubtitleA11y]}>
                    {item.kind === 'lesson' ? `Completed "${item.title}"` : 'Practice Pronunciation Accuracy'}
                  </Text>
                  <Text style={[styles.homeRecentActivityDetail, smallLabelA11y]}>
                    {item.kind === 'lesson' ? item.detail : `${item.title} • ${item.detail}`}
                  </Text>
                </View>
                <Text style={[styles.homeRecentActivityTime, smallLabelA11y]}>{formatActivityTime(item.timestamp)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC', marginBottom: 20 }]}>
            <Text style={[styles.learnEmptySubtext, bodyA11y]}>Wala ka pang practice session. Simulan na sa Practice tab!</Text>
          </View>
        )}

        <View style={styles.progressWordsCard}>
          <View style={styles.progressSectionHeader}>
            <View style={[styles.progressSectionIconWrap, { backgroundColor: HOME_LAVENDER_DARK }]}>
              <Ionicons name="checkmark-done" size={14} color="#fff" />
            </View>
            <Text style={[styles.progressWordsTitle, styles.progressSectionTitleText, cardTitleA11y]}>Mga Salitang Natapos</Text>
          </View>
          {completedWords.length ? (
            <View style={styles.progressWordsWrap}>
              {completedWords.slice(0, 8).map((w) => (
                <View key={w} style={styles.progressWordChip}>
                  <Text style={[styles.progressWordChipText, smallLabelA11y]}>{w}</Text>
                </View>
              ))}
              {completedWords.length > 8 && (
                <Text style={[styles.progressWordsMore, smallLabelA11y]}>+{completedWords.length - 8} pa</Text>
              )}
            </View>
          ) : (
            <Text style={[styles.progressWordsEmpty, bodyA11y]}>Wala ka pang natatapos na salita. Simulan na sa Practice tab!</Text>
          )}
        </View>
      </ScrollView>
      </>
    );
  };

  const renderAchievements = () => {
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

    // Single unified grid, all 20 real badges (incl. the 2 meta/cascade
    // badges) — matches the reference's one "Badge Collection" grid instead
    // of separate Unlocked/Locked/Special sections.
    const filteredBadges = ACHIEVEMENTS.filter((b) => badgeFilter === 'all' || b.category === badgeFilter);

    const spotlightCandidates = ACHIEVEMENTS.filter((b) => !unlockedIds.has(b.id))
      .map((b) => ({ badge: b, progress: getBadgeProgress(b) }))
      .filter((c) => c.progress.hasFraction && (c.progress.pct || 0) < 100)
      .sort((a, b) => (b.progress.pct || 0) - (a.progress.pct || 0));
    const spotlight = spotlightCandidates[0];

    // Most recently unlocked badge — real unlockedAt timestamps stored on
    // progress.achievements at the moment each badge unlocks (unlockAchievements()).
    const unlockedRecords = (progress?.achievements || [])
      .map((a) => ({ badge: ACHIEVEMENTS.find((b) => b.id === a.id), unlockedAt: a.unlockedAt }))
      .filter((r): r is { badge: AchievementDefinition; unlockedAt: string } => !!r.badge)
      .sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime());
    const mostRecent = unlockedRecords[0];
    const recentlyEarned = unlockedRecords.slice(0, 5);

    // Learning Milestones — the exact same real fields/formula already
    // established on the Progress tab, not recomputed differently.
    const lessonsCompletedCount = lessonProgress.filter((p) => p.status === 'completed').length;
    const overallAccuracyPct = (progress?.total_attempts || 0) > 0
      ? Math.round((progress?.accuracy_sum || 0) / (progress!.total_attempts || 1))
      : null;

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
          accessibilityRole="button"
          accessibilityLabel={
            unlocked && record
              ? `${badge.title}, earned ${relativeBadgeDate(record.unlockedAt)}`
              : `${badge.title}, locked${bp?.hasFraction ? `, ${bp.current} of ${bp.target}` : ''}. Double tap for details.`
          }
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
          <Text style={[styles.badgeTitle, cardSubtitleA11y]} numberOfLines={2}>{badge.title}</Text>
          {unlocked && record ? (
            <>
              <View style={styles.badgeUnlockedPill}>
                <Ionicons name="checkmark" size={11} color="#fff" />
                <Text style={[styles.badgeUnlockedPillText, smallLabelA11y]}>Nakuha na!</Text>
              </View>
              <Text style={[styles.badgeEarnedDate, smallLabelA11y]}>{relativeBadgeDate(record.unlockedAt)}</Text>
            </>
          ) : (
            <>
              {bp?.hasFraction ? (
                <View style={styles.badgeProgressWrap}>
                  <View style={styles.badgeProgressTrack}>
                    <View style={[styles.badgeProgressFill, { width: `${Math.max(4, bp.pct || 0)}%` }]} />
                  </View>
                  <Text style={[styles.badgeProgressText, smallLabelA11y]}>{bp.current}/{bp.target}</Text>
                </View>
              ) : (
                <View style={styles.badgeLockedPill}>
                  <Text style={[styles.badgeLockedPillText, smallLabelA11y]}>{expanded ? 'Itago' : 'Tingnan'}</Text>
                </View>
              )}
            </>
          )}
          {expanded && !unlocked && (
            <Text style={[styles.badgeCondition, bodyA11y]}>{badge.description}</Text>
          )}
        </TouchableOpacity>
      );
    };

    return (
      <>
        {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
        <LinearGradient
          colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroBanner}
        >
          <View style={styles.heroTopRow}>
            <TouchableOpacity
              style={styles.heroLogoRow}
              onPress={openSidebar}
              accessibilityRole="button"
              accessibilityLabel="Open navigation menu"
            >
              <Ionicons name="menu-outline" size={20} color="#fff" />
              <Ionicons name="book" size={16} color="#fff" />
              <Text style={styles.heroLogoText}>LinawLetra</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.heroGreeting, heroTitleA11yStyle]}>My Learning{'\n'}Badges</Text>
          <Text style={[styles.heroSubtitle, heroSubtitleA11yStyle]}>Celebrate every reading milestone you achieve!</Text>
          <Image source={require('../../assets/trophy.webp')} style={styles.badgesHeroImage} resizeMode="contain" />
        </LinearGradient>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.achievementSummaryCard}>
          <Text style={[styles.progressHeroTitle, cardTitleA11y]}>Achievement Summary</Text>
          <View style={styles.achievementSummaryRow}>
            <View style={styles.achievementSummaryLeftCol}>
              <Text style={[styles.achievementSummaryLabel, cardSubtitleA11y]}>Badges Earned</Text>
              <Text style={[styles.achievementSummaryCount, a11yText(28, 'bold')]}>
                {unlockedCount}<Text style={[styles.achievementSummaryCountTotal, statLabelA11y]}>/{totalCount}</Text>
              </Text>
              <Text style={[styles.achievementSummaryHint, bodyA11y]}>
                {unlockedCount === totalCount ? 'Nakuha mo na ang lahat ng badge! 🎉' : 'Keep learning to unlock more achievements! ✨'}
              </Text>
            </View>
            <View style={styles.progressRingShadowWrap}>
              <ProgressRing
                percent={unlockPct}
                size={92}
                strokeWidth={10}
                color={HOME_LAVENDER_DARK}
                trackColor="rgba(124,111,207,0.12)"
                gradientColors={[HERO_GRADIENT_MID, HERO_GRADIENT_START]}
                gradientId="badgesSummaryRing"
              >
                <Text style={[styles.progressHeroRingPct, statValueA11y]}>{unlockPct}%</Text>
                <Text style={[styles.progressHeroRingLabel, smallLabelA11y]}>Complete</Text>
              </ProgressRing>
            </View>
          </View>
          {mostRecent ? (
            <View style={styles.achievementFeaturedCallout}>
              <Image source={mostRecent.badge.image} style={styles.achievementFeaturedImage} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.achievementFeaturedTitle, cardSubtitleA11y]} numberOfLines={1}>{mostRecent.badge.title}</Text>
                <Text style={[styles.achievementFeaturedDesc, smallLabelA11y]} numberOfLines={2}>{mostRecent.badge.description}</Text>
              </View>
              <View style={styles.badgeUnlockedPill}>
                <Ionicons name="checkmark" size={11} color="#fff" />
                <Text style={[styles.badgeUnlockedPillText, smallLabelA11y]}>Unlocked</Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.progressHeroEmptyText, bodyA11y]}>Magsanay para makakuha ng unang badge!</Text>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgesFilterRow} contentContainerStyle={{ gap: 8 }}>
          {filterTabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.badgesFilterChip, badgeFilter === tab.key && styles.badgesFilterChipActive]}
              onPress={() => setBadgeFilter(tab.key)}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Filter badges: ${tab.label}`}
              accessibilityState={{ selected: badgeFilter === tab.key }}
            >
              <Text style={[styles.badgesFilterChipText, badgeFilter === tab.key && styles.badgesFilterChipTextActive, smallLabelA11y]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: XP_GOLD }]}>
            <Ionicons name="trophy" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Badge Collection</Text>
        </View>
        {filteredBadges.length ? (
          <View style={styles.badgesGrid}>{filteredBadges.map(renderBadgeCard)}</View>
        ) : (
          <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC', marginBottom: 20 }]}>
            <Text style={[styles.learnEmptySubtext, bodyA11y]}>Wala pang badge sa kategoryang ito.</Text>
          </View>
        )}

        {spotlight && (
          <View style={styles.spotlightCard}>
            <Text style={[styles.spotlightEyebrow, smallLabelA11y]}>Almost There!</Text>
            <Text style={[styles.spotlightTitle, cardTitleA11y]}>Current Badge Progress</Text>
            <View style={styles.spotlightRow}>
              <Image source={spotlight.badge.image} style={styles.spotlightImage} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.spotlightBadgeTitle, cardSubtitleA11y]}>{spotlight.badge.title}</Text>
                <Text style={[styles.spotlightProgressText, smallLabelA11y]}>Progress {spotlight.progress.current}/{spotlight.progress.target}</Text>
                <View style={styles.spotlightTrack}>
                  <View style={[styles.spotlightFill, { width: `${Math.max(4, spotlight.progress.pct || 0)}%` }]} />
                </View>
              </View>
            </View>
            <Text style={[styles.spotlightHint, bodyA11y]}>You&apos;re getting closer! Keep practicing. →</Text>
            <TouchableOpacity
              style={styles.spotlightButton}
              onPress={() => goToPractice()}
              accessibilityRole="button"
              accessibilityLabel="Practice now"
            >
              <Text style={[styles.spotlightButtonText, buttonA11y]}>Practice Now</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: HOME_SAGE }]}>
            <Ionicons name="time" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Recently Earned</Text>
        </View>
        {recentlyEarned.length ? (
          <View style={styles.learnCardList}>
            {recentlyEarned.map((r) => (
              <View key={r.badge.id} style={[styles.homeRecentActivityCard, styles.progressActivityCardShadow]}>
                <View style={[styles.homeRecentActivityIconWrap, { backgroundColor: '#FFF3DC' }]}>
                  <Image source={r.badge.image} style={{ width: 26, height: 26 }} resizeMode="contain" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.homeRecentActivityTitle, cardSubtitleA11y]}>{r.badge.title}</Text>
                  <Text style={[styles.homeRecentActivityDetail, smallLabelA11y]} numberOfLines={1}>{r.badge.description}</Text>
                </View>
                <Text style={[styles.homeRecentActivityTime, smallLabelA11y]}>{relativeBadgeDate(r.unlockedAt)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC', marginBottom: 20 }]}>
            <Text style={[styles.learnEmptySubtext, bodyA11y]}>Wala ka pang nakukuhang badge. Magsanay para makakuha ng una mo!</Text>
          </View>
        )}

        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: VIVID_NAVY }]}>
            <Ionicons name="school" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Learning Milestones</Text>
        </View>
        <View style={styles.homeStatGrid}>
          <View style={[styles.homeGridCard, { backgroundColor: '#EFECFB' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_NAVY }]}>
              <Ionicons name="school" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_NAVY }, statValueA11y]}>{lessonsCompletedCount}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Lessons Completed</Text>
          </View>
          <View style={[styles.homeGridCard, { backgroundColor: '#FBE7DF' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_ORANGE }]}>
              <Ionicons name="mic" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_ORANGE }, statValueA11y]}>{progress?.total_attempts || 0}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Voice Practices</Text>
          </View>
          <View style={[styles.homeGridCard, { backgroundColor: '#FFF3DC' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_AMBER }]}>
              <Ionicons name="book" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_AMBER }, statValueA11y]}>{stats.completed}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Words Practiced</Text>
          </View>
          <View style={[styles.homeGridCard, { backgroundColor: '#E9F1E2' }]}>
            <View style={[styles.homeGridIconWrap, { backgroundColor: VIVID_GREEN }]}>
              <Ionicons name="bar-chart" size={18} color="#fff" />
            </View>
            <Text style={[styles.homeGridValue, { color: VIVID_GREEN }, statValueA11y]}>{overallAccuracyPct !== null ? `${overallAccuracyPct}%` : '--'}</Text>
            <Text style={[styles.homeGridLabel, statLabelA11y]}>Overall Progress</Text>
          </View>
        </View>

        <LinearGradient
          colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.badgesCelebrateBanner}
        >
          <Image source={require('../../assets/celebrate.webp')} style={styles.badgesCelebrateImage} resizeMode="contain" />
          <View style={{ maxWidth: '62%' }}>
            <Text style={[styles.badgesCelebrateTitle, cardTitleA11y]}>Fantastic Work!</Text>
            <Text style={[styles.badgesCelebrateSub, bodyA11y]}>Every badge represents your hard work and growing reading skills.</Text>
          </View>
          <View style={styles.badgesNextCard}>
            {spotlight ? (
              <>
                <Text style={[styles.badgesNextLabel, smallLabelA11y]}>Next Badge to Unlock</Text>
                <Text style={[styles.badgesNextTitle, cardSubtitleA11y]}>{spotlight.badge.title}</Text>
                <Text style={[styles.badgesNextDetail, smallLabelA11y]}>
                  {Math.max(0, (spotlight.progress.target || 0) - (spotlight.progress.current || 0))} more to go
                </Text>
              </>
            ) : (
              <Text style={[styles.badgesNextTitle, cardSubtitleA11y]}>
                {unlockedCount === totalCount ? 'All badges unlocked!' : 'Keep practicing to make progress!'}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.badgesCelebrateButton}
            onPress={() => goToPractice()}
            accessibilityRole="button"
            accessibilityLabel="Continue learning"
          >
            <Text style={[styles.badgesCelebrateButtonText, buttonA11y]}>Continue Learning →</Text>
          </TouchableOpacity>
        </LinearGradient>
      </ScrollView>
      </>
    );
  };

  const renderNotifications = () => {
    // Filter tabs map onto the real type values this app actually creates for
    // students today: 'lesson' (Lesson Completed!, New Lesson Ready), 'streak'
    // (Daily Reading Reminder - the real Streak Milestone event), 'achievement'
    // (New Badge Unlocked!, tied to the badge-unlock persistence fix). 'word'/
    // 'xp'/'practice' are included under the Practice filter too only so any
    // old fossil rows still display sensibly - no new notifications of those
    // types are created (deliberately, to avoid per-attempt notification spam).
    const filteredNotifs = notifications.filter((n) => {
      const unread = !(n.is_read ?? n.read);
      if (notifFilter === 'all') return true;
      if (notifFilter === 'unread') return unread;
      if (notifFilter === 'lesson') return n.type === 'lesson';
      if (notifFilter === 'practice') return ['practice', 'word', 'xp', 'streak'].includes(n.type || '');
      if (notifFilter === 'achievement') return n.type === 'achievement';
      return true;
    });

    const groupLabel = (iso: string) => {
      const date = new Date(iso);
      const now = new Date();
      if (date.toDateString() === now.toDateString()) return 'Today';
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
      const daysAgo = Math.floor((now.getTime() - date.getTime()) / 86400000);
      return daysAgo < 7 ? 'Earlier This Week' : 'Earlier';
    };
    const groupOrder = ['Today', 'Yesterday', 'Earlier This Week', 'Earlier'];
    const groups: { label: string; items: NotificationItem[] }[] = [];
    filteredNotifs.forEach((item) => {
      const label = groupLabel(item.created_at);
      let group = groups.find((g) => g.label === label);
      if (!group) {
        group = { label, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });
    groups.sort((a, b) => groupOrder.indexOf(a.label) - groupOrder.indexOf(b.label));

    const typeMeta = (type?: string | null) => {
      switch (type) {
        case 'lesson':
          return { icon: 'book', color: HOME_SAGE, actionLabel: 'View Lesson', actionSection: 'learn' };
        case 'achievement':
          return { icon: 'trophy', color: XP_GOLD, actionLabel: 'View Badge', actionSection: 'achievements' };
        case 'streak':
          return { icon: 'flame', color: HOME_SUN, actionLabel: 'Practice Now', actionSection: 'practice' };
        default:
          return { icon: 'notifications', color: HOME_LAVENDER_DARK, actionLabel: null as string | null, actionSection: null as string | null };
      }
    };

    const markAllNotificationsRead = async () => {
      const unreadIds = notifications.filter((n) => !(n.is_read ?? n.read)).map((n) => n.id);
      if (!unreadIds.length) return;
      await Promise.all(unreadIds.map((id) => markNotificationRead(id).catch(() => {})));
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, read: true })));
    };

    const filterTabs: { key: typeof notifFilter; label: string }[] = [
      { key: 'all', label: 'All' },
      { key: 'unread', label: 'Unread' },
      { key: 'lesson', label: 'Lessons' },
      { key: 'practice', label: 'Practice' },
      { key: 'achievement', label: 'Achievements' },
    ];

    return (
      <>
        {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
        <LinearGradient
          colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroBanner}
        >
          <View style={styles.heroTopRow}>
            <TouchableOpacity
              style={styles.heroLogoRow}
              onPress={openSidebar}
              accessibilityRole="button"
              accessibilityLabel="Open navigation menu"
            >
              <View>
                <Ionicons name="menu-outline" size={20} color="#fff" />
                {unreadNotifCount > 0 && <View style={styles.heroMenuDot} />}
              </View>
              <Ionicons name="book" size={16} color="#fff" />
              <Text style={styles.heroLogoText}>LinawLetra</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.heroGreeting, heroTitleA11yStyle]}>Notifications</Text>
          <Text style={[styles.heroSubtitle, heroSubtitleA11yStyle]}>Stay updated on your reading journey.</Text>
          <Image source={require('../../assets/bell.webp')} style={styles.notifHeroImage} resizeMode="contain" />
        </LinearGradient>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.notifSummaryCard}>
          <View style={[styles.notifSummaryIconWrap, { backgroundColor: unreadNotifCount > 0 ? VIVID_AMBER : SUCCESS }]}>
            <Ionicons name={unreadNotifCount > 0 ? 'notifications' : 'checkmark-circle'} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.notifSummaryTitle, cardTitleA11y]}>
              {unreadNotifCount > 0 ? `${unreadNotifCount} New Notification${unreadNotifCount === 1 ? '' : 's'}` : "You're All Caught Up!"}
            </Text>
            <Text style={[styles.notifSummarySub, bodyA11y]}>
              {unreadNotifCount > 0 ? 'Tap a notification to mark it as read.' : 'Wala pang bagong update ngayon.'}
            </Text>
          </View>
          {unreadNotifCount > 0 && (
            <TouchableOpacity
              style={styles.notifMarkAllButton}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Mark all notifications as read"
              onPress={markAllNotificationsRead}
            >
              <Text style={[styles.notifMarkAllButtonText, buttonA11y]}>Mark All Read</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgesFilterRow} contentContainerStyle={{ gap: 8 }}>
          {filterTabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.badgesFilterChip, notifFilter === tab.key && styles.badgesFilterChipActive]}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Filter notifications: ${tab.label}`}
              accessibilityState={{ selected: notifFilter === tab.key }}
              onPress={() => setNotifFilter(tab.key)}
            >
              <Text style={[styles.badgesFilterChipText, notifFilter === tab.key && styles.badgesFilterChipTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {groups.length ? (
          groups.map((group) => (
            <View key={group.label}>
              <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>{group.label}</Text>
              <View style={{ gap: 10, marginBottom: 12 }}>
                {group.items.map((item) => {
                  const unread = !(item.is_read ?? item.read);
                  const meta = typeMeta(item.type);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.notifCard, unread && styles.notifCardUnread]}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}${unread ? ', unread. Double tap to mark as read.' : ', read'}`}
                      onPress={async () => {
                        if (!unread) return;
                        await markNotificationRead(item.id).catch(() => {});
                        setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true, read: true } : n)));
                      }}
                    >
                      <View style={[styles.notifIconWrap, { backgroundColor: meta.color }]}>
                        <Ionicons name={meta.icon as any} size={18} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.notifTitleRow}>
                          <Text style={[styles.notifTitle, cardSubtitleA11y]}>{item.title}</Text>
                          {unread && <View style={styles.notifDot} />}
                        </View>
                        {!!(item.message || item.body) && <Text style={[styles.notifBody, bodyA11y]}>{item.message || item.body}</Text>}
                        <Text style={[styles.notifDate, smallLabelA11y]}>{new Date(item.created_at).toLocaleString()}</Text>
                        {!!meta.actionLabel && (
                          <TouchableOpacity
                            style={styles.notifActionButton}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityRole="button"
                            accessibilityLabel={`${meta.actionLabel} for ${item.title}`}
                            onPress={(e) => {
                              // Stop the tap from also bubbling to the parent
                              // notifCard's own onPress (mark-as-read) - the
                              // two are separate actions (navigate vs. mark
                              // read) and both need to fire independently
                              // rather than the card's tap swallowing this.
                              e.stopPropagation();
                              setSection(meta.actionSection as any);
                            }}
                          >
                            <Text style={[styles.notifActionButtonText, buttonA11y]}>{meta.actionLabel}</Text>
                            <Ionicons name="chevron-forward" size={14} color={HOME_LAVENDER_DARK} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.notifEmptyCard}>
            <Ionicons name="notifications-outline" size={40} color={HOME_LAVENDER} />
            <Text style={[styles.notifEmptyText, bodyA11y]}>Wala ka pang mensahe. Dito lalabas ang mga update at paalala.</Text>
          </View>
        )}
      </ScrollView>
      </>
    );
  };

  const renderSettings = () => (
    <DashboardSettingsScreen
      role="student"
      navigation={navigation}
      embedded
      heroMode
      onOpenSidebar={openSidebar}
      gradeLevel={child?.grade_level}
      readingLevel={progress?.level}
      onSaved={(saved) => {
        setDashboardSettings(saved);
        setAccessibilitySettings(accessibilityFromSettings(saved));
      }}
    />
  );

  const navPendingCount = activities.filter((a) => a.status === 'pending' || a.status === 'overdue').length;
  const navBadgeFraction = `${progress?.achievements?.length || 0}/${ACHIEVEMENTS.length}`;
  // Same unread-notification count that used to live in the header bell on
  // every tab - now surfaced only via the "Notifications" row in the sidebar.
  const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;
  // Same accuracy_sum/total_attempts formula as the Progress tab's "Overall
  // Reading Progress" ring - not a separately-computed version.
  const sidebarOverallPct = (progress?.total_attempts || 0) > 0
    ? Math.round((progress?.accuracy_sum || 0) / (progress!.total_attempts || 1))
    : 0;

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
      ) : section === 'learn' ? (
        // Same reasoning as Home: renderActivities() now opens with its own
        // hero banner (menu trigger + notification bell), so topHeaderNode
        // would duplicate that chrome.
        <View style={styles.homeBg}>
          {renderActivities()}
        </View>
      ) : section === 'practice' && selectedWord && practiceMode !== 'listen' ? (
        // Same reasoning again, scoped narrowly: only the mic/"say" screen
        // inside renderPractice() has its own hero banner (with a back
        // button, not a menu, since it's a nested detail view reached from
        // the grid, which still uses topHeaderNode for sidebar access) -
        // this was missed when that banner was added, leaving the old
        // header stacked above it. The word-selection grid and "listen"
        // sub-view are unaffected and keep topHeaderNode as before.
        <View style={styles.homeBg}>
          {renderPractice()}
        </View>
      ) : section === 'progress' ? (
        // Same reasoning again: renderProgress() now opens with its own
        // hero banner (menu trigger + notification bell).
        <View style={styles.homeBg}>
          {renderProgress()}
        </View>
      ) : section === 'achievements' ? (
        // Same reasoning again: renderAchievements() now opens with its own
        // hero banner (menu trigger + notification bell).
        <View style={styles.homeBg}>
          {renderAchievements()}
        </View>
      ) : section === 'settings' ? (
        // Same reasoning again: renderSettings() now opens with its own
        // hero banner (menu trigger), passed via DashboardSettingsScreen's
        // heroMode/onOpenSidebar props - Parent Settings is unaffected since
        // those props are only ever passed from this student call site.
        <View style={styles.homeBg}>
          {renderSettings()}
        </View>
      ) : section === 'notifications' ? (
        // Same reasoning again: renderNotifications() now opens with its own
        // hero banner (menu trigger with an unread dot instead of the old
        // separate bell button).
        <View style={styles.homeBg}>
          {renderNotifications()}
        </View>
      ) : (
        <>
          {topHeaderNode}
          {section === 'practice' && renderPractice()}
        </>
      )}

      {/* Sidebar overlay + animated sidebar */}
      {sidebarOpen && (
        <Animated.View style={[styles.overlay, { opacity: overlayAnim, pointerEvents: sidebarOpen ? 'auto' : 'none' }]}>
          <TouchableOpacity style={{ flex: 1 }} onPress={closeSidebar} />
        </Animated.View>
      )}
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sidebarScrollContent} showsVerticalScrollIndicator={false}>
          <LinearGradient
            colors={[HERO_GRADIENT_START, HERO_GRADIENT_MID, HERO_GRADIENT_END]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sidebarProfileCard}
          >
            <TouchableOpacity style={styles.sidebarCloseButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={closeSidebar}>
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>
            <View style={styles.sidebarProfileRow}>
              <View style={styles.sidebarAvatarWrap}>
                <Text style={styles.sidebarAvatarText}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarProfileName} numberOfLines={1}>{child?.name || 'Estudyante'}</Text>
                <Text style={styles.sidebarProfileGrade}>Grade {child?.grade_level || '-'} Student</Text>
                <TouchableOpacity onPress={() => navigateTo('settings')}>
                  <Text style={styles.sidebarProfileLink}>View Profile ›</Text>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.sidebarLogoRow}>
            <View style={styles.sidebarLogoIconWrap}>
              <Ionicons name="book" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sidebarLogoText}>LinawLetra</Text>
              <Text style={styles.sidebarLogoTagline}>Clearer Reading. Brighter Learning.</Text>
            </View>
          </View>

          <Text style={styles.sidebarSectionLabel}>MAIN NAVIGATION</Text>
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
                  <Ionicons name={it.i as any} size={17} color={active ? HOME_LAVENDER_DARK : HOME_INK_SOFT} />
                </View>
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{it.l}</Text>
                {!!it.count && (
                  <View style={styles.navCountBadge}>
                    <Text style={styles.navCountBadgeText}>{it.count > 9 ? '9+' : it.count}</Text>
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

          <Text style={styles.sidebarSectionLabel}>PROGRESS</Text>
          <View style={styles.sidebarProgressCard}>
            <Text style={styles.sidebarProgressTitle}>Your Reading Progress</Text>
            <Text style={styles.sidebarProgressPct}>{sidebarOverallPct}% Complete</Text>
            <View style={styles.sidebarProgressTrack}>
              <View style={[styles.sidebarProgressFill, { width: `${Math.max(4, sidebarOverallPct)}%` }]} />
            </View>
            <Text style={styles.sidebarProgressMsg}>Keep going {getFirstName(child?.name || '')}! ✦</Text>
            <Image source={require('../../assets/menu.webp')} style={styles.sidebarProgressImage} resizeMode="contain" />
          </View>

          <Text style={styles.sidebarSectionLabel}>QUICK ACCESS</Text>
          <TouchableOpacity style={styles.sidebarQuickRow} onPress={() => navigateTo('notifications')}>
            <View style={[styles.sidebarQuickIconWrap, { backgroundColor: VIVID_TEAL }]}>
              <Ionicons name="notifications" size={16} color="#fff" />
            </View>
            <Text style={styles.sidebarQuickLabel}>Notifications</Text>
            {unreadNotifCount > 0 && (
              <View style={styles.navCountBadge}>
                <Text style={styles.navCountBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color={HOME_INK_SOFT} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sidebarQuickRow} onPress={contactSupportFromSidebar}>
            <View style={[styles.sidebarQuickIconWrap, { backgroundColor: VIVID_TEAL }]}>
              <Ionicons name="help-circle" size={16} color="#fff" />
            </View>
            <Text style={styles.sidebarQuickLabel}>Help & Support</Text>
            <Ionicons name="chevron-forward" size={16} color={HOME_INK_SOFT} />
          </TouchableOpacity>

          <View style={styles.sidebarAccessibilityCard}>
            <View style={[styles.sidebarQuickIconWrap, { backgroundColor: HOME_SAGE }]}>
              <Ionicons name="accessibility" size={16} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sidebarAccessibilityTitle}>Dyslexia-Friendly Mode</Text>
              <Text style={styles.sidebarAccessibilitySub}>Make reading more comfortable.</Text>
            </View>
            <Switch
              value={!!dashboardSettings?.dyslexia_font}
              onValueChange={toggleDyslexiaFont}
              trackColor={{ false: '#cbd5e1', true: 'rgba(124,111,207,0.4)' }}
              thumbColor={dashboardSettings?.dyslexia_font ? HOME_LAVENDER_DARK : '#f8fafc'}
            />
          </View>

          <Text style={styles.sidebarSectionLabel}>ACCOUNT</Text>
          <TouchableOpacity style={styles.sidebarLogout} onPress={async () => { await signOutUser(); navigation.replace('Login'); }}>
            <Ionicons name="log-out-outline" size={20} color="#fff" />
            <Text style={styles.sidebarLogoutText}>Log Out</Text>
          </TouchableOpacity>
        </ScrollView>
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
  gradientColors,
  gradientId = 'progressRingStroke',
  children,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor: string;
  // Optional two-tone stroke (Defs/SvgLinearGradient/Stop, same react-native-svg
  // primitives used elsewhere in this file) instead of a flat `color`. Give
  // each concurrently-mounted ring a distinct gradientId so their <Defs>
  // don't collide.
  gradientColors?: [string, string];
  gradientId?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);
  const stroke = gradientColors ? `url(#${gradientId})` : color;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {gradientColors && (
          <Defs>
            <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={gradientColors[0]} />
              <Stop offset="1" stopColor={gradientColors[1]} />
            </SvgLinearGradient>
          </Defs>
        )}
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
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
  }, [scaleAnim]);

  const { correct, score, transcript, feedback, xpAward } = result;
  const ringColor = score >= 85 ? SUCCESS : score >= 60 ? WARNING : DANGER;
  // Text-safe variant of ringColor - ringColor itself stays for the ring's
  // borderColor (non-text), this is for the score percentage Text below.
  const ringTextColor = score >= 85 ? SUCCESS : score >= 60 ? WARNING_TEXT : DANGER_TEXT;
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
          <Text style={[styles.accuracyPercent, { color: ringTextColor }]}>{score}%</Text>
          <Text style={styles.accuracyLabel}>accuracy</Text>
        </View>
      )}
      <Text style={styles.scoreCoachText}>{scoreMessage(score)}</Text>

      <View style={styles.comparisonBox}>
        <View style={styles.comparisonRow}>
          <Text style={styles.comparisonIcon}>🎤</Text>
          <Text style={styles.comparisonLabel}>Sinabi mo:</Text>
          <Text style={[styles.comparisonWord, { color: DANGER_TEXT }]}>&quot;{transcript || '—'}&quot;</Text>
        </View>
        <View style={styles.comparisonDivider} />
        <View style={styles.comparisonRow}>
          <Text style={styles.comparisonIcon}>✅</Text>
          <Text style={styles.comparisonLabel}>Tamang bigkas:</Text>
          <Text style={[styles.comparisonWord, { color: SUCCESS, fontWeight: '900' }]}>{word.toUpperCase()}</Text>
        </View>
      </View>

      <View style={[styles.xpPill, { backgroundColor: WARNING }]}>
        <Text style={styles.xpPillText}>+{xpAward} XP 💛 (para sa pagsisikap!)</Text>
      </View>

      <View style={styles.resultButtons}>
        <TouchableOpacity style={styles.listenAgainButton} onPress={onReplay}>
          <Ionicons name="volume-high-outline" size={18} color={HOME_LAVENDER_DARK} />
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
  progressStatIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  progressStatValue: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 20, marginTop: 2 },
  progressStatLabel: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '700', marginTop: 2 },
  progressStreakBestPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, marginTop: 6,
  },
  progressStreakBestText: { color: HOME_INK, fontWeight: '800', fontSize: 10 },
  progressHeroCard: {
    backgroundColor: '#fff', borderRadius: 28, padding: 20, alignItems: 'center', marginBottom: 20,
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 5,
  },
  progressHeroTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 18, textAlign: 'center', marginBottom: 4 },
  progressOverallRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 14, width: '100%' },
  progressOverallCol: { flex: 1, gap: 8 },
  progressOverallStatCard: { width: '100%', minHeight: 76, padding: 10 },
  progressRingShadowWrap: {
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  progressHeroRingPct: { fontFamily: FONT_DISPLAY, color: HOME_LAVENDER_DARK, fontSize: 28 },
  progressHeroRingLabel: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 11, marginTop: 2 },
  progressHeroLabel: { color: HOME_INK, fontWeight: '800', fontSize: 14, marginBottom: 8 },
  progressHeroStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F5F3FC',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
  },
  progressHeroStatusText: { fontWeight: '800', fontSize: 13 },
  progressHeroEmptyText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  progressSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 12 },
  progressSectionIconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  progressSectionTitleText: { marginTop: 0, marginBottom: 0 },
  progressChartCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 16, marginBottom: 20,
    shadowColor: HOME_INK, shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  progressChartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  progressChartTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 16 },
  progressChartBars: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 150, gap: 6, paddingHorizontal: 4,
  },
  progressChartBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  progressChartBarValue: { fontSize: 10, fontWeight: '900', marginBottom: 4 },
  progressChartBar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8, minWidth: 10 },
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
  skillsCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 16, marginBottom: 20,
    shadowColor: HOME_INK, shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  skillRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  skillIconWrap: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    shadowColor: HOME_INK, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  skillTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  skillLabel: { color: HOME_INK, fontWeight: '800', fontSize: 14 },
  skillTagPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  skillTagText: { fontWeight: '800', fontSize: 11 },
  skillTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden' },
  skillTrackFill: { height: '100%', borderRadius: 5 },
  skillPct: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 12, minWidth: 34, textAlign: 'right' },
  progressMonthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  progressMonthTile: {
    shadowColor: HOME_INK, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  progressPbBadge: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: XP_GOLD, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3,
  },
  progressPbBadgeText: { color: '#fff', fontWeight: '900', fontSize: 9 },
  progressActivityCardShadow: {
    shadowColor: HOME_INK, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  progressWordsCard: {
    backgroundColor: 'rgba(124,111,207,0.08)', borderRadius: 24, padding: 16,
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  progressWordsTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 15, marginBottom: 10 },
  progressWordsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  progressWordChip: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  progressWordChipText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 13 },
  progressWordsMore: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12, marginLeft: 2 },
  progressWordsEmpty: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#111827', marginTop: 18, marginBottom: 10 },
  badgeRow: { gap: 10, paddingBottom: 4 },
  // --- Badges tab (accent: lavender, ties into Home's achievement showcase) ---
  // 1280x1920 in the source art (own ratio group, distinct from
  // learn.png/book.png and singing.png/learn2.png).
  badgesHeroImage: { position: 'absolute', right: 0, bottom: -8, width: 140, height: 210 },
  achievementSummaryCard: {
    backgroundColor: '#fff', borderRadius: 28, padding: 20, marginBottom: 20,
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 5,
  },
  achievementSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 14 },
  achievementSummaryLeftCol: { flex: 1 },
  achievementSummaryLabel: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 13, marginBottom: 4 },
  achievementSummaryCount: { fontFamily: FONT_DISPLAY, color: HOME_LAVENDER_DARK, fontSize: 32 },
  achievementSummaryCountTotal: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK_SOFT, fontSize: 18 },
  achievementSummaryHint: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 4, maxWidth: '90%' },
  achievementFeaturedCallout: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF3DC',
    borderRadius: 18, padding: 14, width: '100%',
  },
  achievementFeaturedImage: { width: 44, height: 44 },
  achievementFeaturedTitle: { color: HOME_INK, fontWeight: '900', fontSize: 14, marginBottom: 2 },
  achievementFeaturedDesc: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12 },
  spotlightEyebrow: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  spotlightHint: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 12, marginTop: 10, marginBottom: 4 },
  badgesCelebrateBanner: {
    borderRadius: 28, padding: 20, marginBottom: 20, overflow: 'hidden',
    shadowColor: HERO_GRADIENT_START, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  // 1184x2096 in the source art (same ratio group as learn.png/book.png).
  badgesCelebrateImage: { position: 'absolute', right: 14, top: 10, width: 76, height: 134 },
  badgesCelebrateTitle: { fontFamily: FONT_DISPLAY, color: '#fff', fontSize: 20, marginBottom: 4 },
  badgesCelebrateSub: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  badgesNextCard: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 18, padding: 14, marginBottom: 14 },
  badgesNextLabel: { color: 'rgba(255,255,255,0.85)', fontWeight: '800', fontSize: 11, marginBottom: 3 },
  badgesNextTitle: { color: '#fff', fontWeight: '900', fontSize: 15, marginBottom: 2 },
  badgesNextDetail: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 12 },
  badgesCelebrateButton: { backgroundColor: '#fff', borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  badgesCelebrateButtonText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 14 },
  badgesFilterRow: { marginBottom: 16 },
  badgesFilterChip: {
    backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 13, marginRight: 8,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  badgesFilterChipActive: { backgroundColor: HOME_LAVENDER },
  badgesFilterChipText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 13 },
  badgesFilterChipTextActive: { color: '#fff' },
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
    position: 'relative', overflow: 'hidden',
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
  learnHeroImage: { position: 'absolute', right: 0, bottom: -8, width: 120, height: 212 },
  // 1184x2096 in the source art (same ratio group as learn.png/book.png) -
  // sized to that real aspect ratio, not the 1120x2240 group's heroImage box.
  progressHeroImage: { position: 'absolute', right: 0, bottom: -8, width: 120, height: 212 },
  learnProgressCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 18, marginBottom: 20,
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  learnProgressTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  learnProgressTitle: { fontFamily: FONT_DISPLAY, color: HOME_INK, fontSize: 16 },
  learnProgressPct: { fontFamily: FONT_DISPLAY, color: HOME_LAVENDER_DARK, fontSize: 18 },
  learnProgressCount: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 13, marginBottom: 12 },
  learnProgressTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden', marginBottom: 10 },
  learnProgressMsg: { color: HOME_LAVENDER_DARK, fontWeight: '700', fontSize: 13 },

  lessonStepList: { marginBottom: 8 },
  lessonStepRow: { flexDirection: 'row', gap: 12 },
  lessonStepRail: { width: 24, alignItems: 'center' },
  lessonStepDot: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
    borderWidth: 2, borderColor: 'rgba(124,111,207,0.35)', alignItems: 'center', justifyContent: 'center',
  },
  lessonStepDotDone: { backgroundColor: VIVID_GREEN, borderColor: VIVID_GREEN },
  lessonStepDotActive: { backgroundColor: HERO_GRADIENT_MID, borderColor: HERO_GRADIENT_MID },
  lessonStepLine: { flex: 1, width: 2, backgroundColor: 'rgba(124,111,207,0.25)', marginVertical: 2, minHeight: 24 },
  lessonStepCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 18, padding: 14, marginBottom: 14,
  },
  lessonStepCardDone: { backgroundColor: '#EAF7EE' },
  lessonStepCardMuted: { backgroundColor: '#F1EFF9' },
  lessonStepCardActive: {},
  lessonStepBody: { flex: 1 },
  lessonStepTitle: { color: HOME_INK, fontWeight: '900', fontSize: 14 },
  lessonStepTitleLight: { color: '#fff' },
  lessonStepMeta: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 2 },
  lessonStepMetaLight: { color: 'rgba(255,255,255,0.85)' },
  lessonStepButtonGhost: { backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  lessonStepButtonGhostText: { color: HOME_INK_SOFT, fontWeight: '800', fontSize: 12 },
  lessonStepButtonLight: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  lessonStepButtonLightText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 12 },
  lessonStepMarkDoneLight: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 11, textDecorationLine: 'underline' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  categoryCard: {
    width: '47%', borderRadius: 20, padding: 16, minHeight: 118,
    overflow: 'hidden', position: 'relative',
  },
  categoryTipCard: { justifyContent: 'flex-start' },
  categoryIconWrap: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  categoryTitle: { color: HOME_INK, fontWeight: '900', fontSize: 15, marginBottom: 4 },
  categorySub: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, lineHeight: 16 },
  categoryTipImage: { position: 'absolute', right: 2, bottom: -6, width: 52, height: 92 },

  learnBottomRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  learnBottomCard: { flex: 1, marginBottom: 0 },
  learnContinueImage: { position: 'absolute', right: 4, bottom: -8, width: 52, height: 104 },
  learnGoalCard: {
    backgroundColor: HOME_LAVENDER_DARK, borderRadius: 24, padding: 18,
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  learnGoalTitle: { fontFamily: FONT_DISPLAY, color: '#fff', fontSize: 15, marginBottom: 4 },
  learnGoalSub: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 12, marginBottom: 12 },
  learnGoalTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginBottom: 10 },
  learnGoalTrackFill: { height: '100%', borderRadius: 5, backgroundColor: '#7DD3FC' },
  learnGoalMsg: { color: 'rgba(255,255,255,0.9)', fontWeight: '700', fontSize: 12 },
  completedTrackBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 14,
    borderRadius: 16, backgroundColor: '#F0FDF4', borderWidth: 1.5, borderColor: '#86EFAC',
  },
  completedTrackTitle: { color: '#166534', fontWeight: '900', fontSize: 15 },
  completedTrackText: { color: '#166534', fontWeight: '600', fontSize: 12, marginTop: 2 },
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
  practicePanel: { marginTop: 18, padding: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER },
  practiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  practiceTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  practiceClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  practiceCloseText: { color: '#6B7280', fontWeight: '800' },
  practiceSubtitle: { color: '#6B7280', marginBottom: 12 },
  resultCard: {
    marginTop: 20, borderRadius: 24, padding: 20, alignItems: 'center',
    shadowColor: HOME_INK, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  correctCard: { backgroundColor: '#EAF7EE' },
  wrongCard: { backgroundColor: '#FFF3DC' },
  resultEmoji: { fontSize: 28, textAlign: 'center', marginBottom: 8 },
  resultTitle: { fontFamily: FONT_DISPLAY, fontSize: 19, textAlign: 'center', color: HOME_INK },
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
    position: 'absolute', top: 0, bottom: 0, left: 0, width: SIDEBAR_WIDTH,
    backgroundColor: HOME_CREAM, paddingTop: 48, zIndex: 100,
    shadowColor: '#000', shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 20,
  },
  sidebarScrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  sidebarProfileCard: {
    borderRadius: 24, padding: 18, marginBottom: 16, position: 'relative',
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  sidebarCloseButton: {
    position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  sidebarProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 24 },
  sidebarAvatarWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  sidebarAvatarText: { fontSize: 22, fontWeight: '900', color: '#fff' },
  sidebarProfileName: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 16, color: '#fff' },
  sidebarProfileGrade: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 12, marginTop: 2 },
  sidebarProfileLink: { color: '#fff', fontWeight: '900', fontSize: 12, marginTop: 6, textDecorationLine: 'underline' },
  sidebarLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, paddingHorizontal: 2 },
  sidebarLogoIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: HOME_LAVENDER_DARK,
    alignItems: 'center', justifyContent: 'center',
  },
  sidebarLogoText: { fontFamily: FONT_DISPLAY, fontSize: 16, color: HOME_INK },
  sidebarLogoTagline: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 10.5, marginTop: 1 },
  sidebarSectionLabel: {
    color: HOME_INK_SOFT, fontWeight: '900', fontSize: 11, letterSpacing: 0.8,
    marginBottom: 8, marginTop: 4, paddingHorizontal: 2,
  },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
    marginBottom: 6, backgroundColor: '#fff',
    shadowColor: HOME_INK, shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  navItemActive: { backgroundColor: '#EFECFB' },
  navIconWrap: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F3FC',
  },
  navIconWrapActive: { backgroundColor: '#fff' },
  navLabel: { fontSize: 14, fontWeight: '700', color: HOME_INK, flex: 1 },
  navLabelActive: { color: HOME_LAVENDER_DARK, fontWeight: '900' },
  navCountBadge: {
    backgroundColor: DANGER, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  navCountBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  navFractionPill: { backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  navFractionPillText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 10.5 },
  sidebarProgressCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16, overflow: 'hidden',
    shadowColor: HOME_INK, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  sidebarProgressTitle: { color: HOME_INK, fontWeight: '800', fontSize: 13, maxWidth: '72%' },
  sidebarProgressPct: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_LAVENDER_DARK, fontSize: 20, marginTop: 4, maxWidth: '72%' },
  sidebarProgressTrack: {
    height: 8, borderRadius: 4, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden',
    marginTop: 10, maxWidth: '72%',
  },
  sidebarProgressFill: { height: '100%', borderRadius: 4, backgroundColor: HOME_LAVENDER_DARK },
  sidebarProgressMsg: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 11, marginTop: 8, maxWidth: '72%' },
  // 1120x2240 in the source art (same ratio group as singing.png/learn2.png) -
  // "peeking" from the bottom-right corner of the mini progress card.
  sidebarProgressImage: { position: 'absolute', right: -6, bottom: -10, width: 70, height: 140 },
  sidebarQuickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 14, padding: 12, marginBottom: 8,
    shadowColor: HOME_INK, shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  sidebarQuickIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sidebarQuickLabel: { color: HOME_INK, fontWeight: '700', fontSize: 14, flex: 1 },
  sidebarAccessibilityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E9F1E2',
    borderRadius: 16, padding: 14, marginTop: 4, marginBottom: 16,
  },
  sidebarAccessibilityTitle: { color: HOME_INK, fontWeight: '800', fontSize: 13 },
  sidebarAccessibilitySub: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 11, marginTop: 2 },
  sidebarLogout: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 15, borderRadius: 14, backgroundColor: DANGER,
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
  heroBanner: { borderRadius: 28, padding: 22, marginBottom: 20, overflow: 'hidden', position: 'relative', minHeight: 200 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  heroLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLogoText: { color: '#fff', fontWeight: '800', fontSize: 14 },
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
  // --- Notifications tab ---
  heroMenuDot: {
    position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: DANGER, borderWidth: 1.5, borderColor: HERO_GRADIENT_START,
  },
  // 1184x2096 in the source art (same ratio group as learn.png/book.png).
  notifHeroImage: { position: 'absolute', right: 0, bottom: -8, width: 120, height: 212 },
  notifSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 24, padding: 16, marginBottom: 16,
    shadowColor: HOME_INK, shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  notifSummaryIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  notifSummaryTitle: { fontFamily: FONT_DISPLAY_SEMI, color: HOME_INK, fontSize: 15 },
  notifSummarySub: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginTop: 3 },
  notifMarkAllButton: {
    backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 13,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  notifMarkAllButtonText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 11 },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: 18, padding: 14,
    shadowColor: HOME_INK, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  notifCardUnread: { backgroundColor: '#F5F3FC' },
  notifIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HOME_LAVENDER },
  notifTitle: { color: HOME_INK, fontWeight: '800', fontSize: 14 },
  notifBody: { color: HOME_INK_SOFT, fontSize: 13, marginTop: 4, lineHeight: 18 },
  notifDate: { color: HOME_INK_SOFT, fontSize: 11, fontWeight: '600', marginTop: 6 },
  notifActionButton: {
    flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: 8,
    paddingVertical: 10, paddingHorizontal: 2, minHeight: 44,
  },
  notifActionButtonText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 12 },
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
  aiRecommendationCard: { backgroundColor: '#F8F7FF', borderWidth: 1, borderColor: '#D9D4F4', borderRadius: 18, padding: 14, marginBottom: 14 },
  aiRecommendationTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiRecommendationIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: HOME_LAVENDER, alignItems: 'center', justifyContent: 'center' },
  aiRecommendationWord: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 19 },
  aiRecommendationWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  trackPill: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#D9D4F4' },
  trackPillText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 10 },
  aiRecommendationReason: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, lineHeight: 17, marginTop: 2 },
  aiRecommendationFocus: { color: HOME_INK, fontWeight: '700', fontSize: 12, marginTop: 10 },
  aiConfidencePill: { minWidth: 66, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 7, alignItems: 'center' },
  aiConfidenceValue: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 15 },
  aiConfidenceLabel: { color: HOME_INK_SOFT, fontWeight: '700', fontSize: 9 },
  categoryFilterBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#EFECFB', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 14,
  },
  categoryFilterBarText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 13 },
  categoryFilterBarReset: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 13, textDecorationLine: 'underline' },
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
  listenButtonRow: { flexDirection: 'row', gap: 10, width: '100%' },
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
    padding: 22,
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: HOME_INK,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  practiceMoodBadge: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  practicePrompt: { color: HOME_INK_SOFT, fontWeight: '900', textTransform: 'uppercase', fontSize: 12, marginBottom: 4, letterSpacing: 0.5 },
  practiceCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  practiceWordDisplay: {
    fontSize: 52, color: HOME_LAVENDER_DARK,
    letterSpacing: 0, textAlign: 'center', marginBottom: 6,
    fontFamily: FONT_DISPLAY,
  },
  practiceSyllables: { color: HOME_LAVENDER_DARK, fontSize: 16, fontWeight: '900', marginBottom: 14 },
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

  practiceDivider: { height: 1, width: '100%', backgroundColor: 'rgba(124,111,207,0.15)', marginVertical: 18 },
  micSection: {
    width: '100%', alignItems: 'center', backgroundColor: 'rgba(124,111,207,0.08)',
    borderRadius: 20, paddingVertical: 24, paddingHorizontal: 12,
  },
  micGlowOuter: {
    width: 118, height: 118, borderRadius: 59, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124,111,207,0.12)',
  },
  micGlowOuterRecording: { backgroundColor: 'rgba(239,68,68,0.12)' },
  micGlowInner: {
    width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124,111,207,0.22)',
  },
  micGlowInnerRecording: { backgroundColor: 'rgba(239,68,68,0.22)' },
  micButton: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: HOME_LAVENDER, alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0px 0px 14px rgba(95,82,176,0.35)' },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.35, shadowRadius: 14 },
    }),
  },
  micButtonRecording: {
    backgroundColor: DANGER,
    ...Platform.select({
      web: { boxShadow: '0px 0px 14px rgba(239,68,68,0.35)' },
      default: { shadowColor: DANGER },
    }),
  },
  micTimerText: { color: DANGER_TEXT, fontWeight: '900', fontSize: 13, marginTop: 8 },

  heroBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  heroBackText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  practiceProgressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  practiceWordPill: { backgroundColor: HOME_LAVENDER, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  practiceWordPillText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  practiceStatsIconWrap: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },

  practiceTipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  practiceTipText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, flex: 1 },

  encourageCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F5F3FC', borderRadius: 24, padding: 16, marginTop: 8, marginBottom: 20,
  },
  encourageImage: { width: 64, height: 113 },
  encourageTitle: { fontFamily: FONT_DISPLAY, color: HOME_INK, fontSize: 15, marginBottom: 4 },
  encourageSub: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, marginBottom: 12 },
  encourageButtonRow: { flexDirection: 'row', gap: 10 },
  encourageButtonGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  encourageButtonGhostText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 12 },
  encourageButtonSolid: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: HOME_LAVENDER_DARK,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  encourageButtonSolidText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  practiceTipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FEF3D6', borderRadius: 20, padding: 16, marginBottom: 8,
  },
  practiceTipCardTitle: { color: HOME_INK, fontWeight: '900', fontSize: 14, marginBottom: 2 },
  practiceTipCardText: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 12, lineHeight: 17 },

  backButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8,
  },
  backText: { color: HOME_LAVENDER_DARK, fontWeight: '700', fontSize: 15 },

  resultBigEmoji: { fontSize: 72, marginBottom: 8 },
  resultSubtitle: { fontSize: 14, color: HOME_INK_SOFT, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  scoreCoachText: { color: HOME_INK, fontWeight: '800', marginTop: -10, marginBottom: 12 },
  starRow: { flexDirection: 'row', gap: 6, marginTop: -10, marginBottom: 14 },
  pronunciationStar: { color: XP_GOLD, fontSize: 28 },
  pronunciationStarDim: { color: '#d1d5db' },

  // Accuracy ring (simulated with a card)
  accuracyRing: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 8, borderColor: SUCCESS,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, backgroundColor: '#fff',
    shadowColor: HOME_INK, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  accuracyRingWrong: { borderColor: WARNING },
  accuracyPercent: {
    fontFamily: FONT_DISPLAY, fontSize: 28, color: SUCCESS,
  },
  accuracyLabel: { fontSize: 11, color: HOME_INK_SOFT, fontWeight: '600' },

  // Transcript row
  transcriptRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 16,
  },
  transcriptLabel: { color: HOME_INK_SOFT, fontSize: 13, fontWeight: '600' },
  transcriptValue: { color: HOME_INK, fontWeight: '800', fontSize: 13 },

  // Comparison box (wrong result)
  comparisonBox: {
    width: '100%', backgroundColor: '#fff', borderRadius: 20,
    padding: 16, marginBottom: 16,
  },
  comparisonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
  },
  comparisonDivider: { height: 1, backgroundColor: 'rgba(124,111,207,0.15)', marginVertical: 4 },
  comparisonIcon: { fontSize: 18, width: 28 },
  comparisonLabel: { color: HOME_INK_SOFT, fontSize: 13, fontWeight: '600', flex: 1 },
  comparisonWord: { fontSize: 15, fontWeight: '800' },

  // XP pill
  xpPill: {
    backgroundColor: HOME_LAVENDER_DARK, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 10, marginBottom: 20,
  },
  xpPillText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  // Buttons in result card
  nextButton: {
    backgroundColor: HOME_LAVENDER_DARK, borderRadius: 999,
    paddingHorizontal: 28, paddingVertical: 14,
    width: '100%', alignItems: 'center',
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  nextButtonText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  resultButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  listenAgainButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderColor: HOME_LAVENDER_DARK, borderRadius: 999,
    paddingVertical: 12,
  },
  listenAgainText: { color: HOME_LAVENDER_DARK, fontWeight: '700' },
  retryMicButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: HOME_LAVENDER_DARK, borderRadius: 999, paddingVertical: 12,
  },
  retryMicText: { color: '#fff', fontWeight: '700' },

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
    borderColor: BORDER,
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
    borderColor: BORDER,
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
    backgroundColor: PRIMARY_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
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
    borderColor: BORDER,
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
