import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, AppState, AppStateStatus, Image, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
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
import { getAsiaManilaDate, getOrCreateWordOfDay, WordOfDayLog } from '../services/wordOfDayService';
import { buildNextProgress, ChildProgress, saveProgress } from '../services/progressService';
import {
  ACHIEVEMENTS, unlockAchievements, getPronunciationStats, PronunciationStats, AchievementCategory, AchievementDefinition,
  MIN_ATTEMPTS_FOR_AVERAGE_BADGE, CHALLENGING_WORDS_REQUIRED, IMPROVEMENT_POINTS_REQUIRED, averageAccuracy,
} from '../services/achievementService';
import { fetchStudentActivities, StudentActivity } from '../services/activityService';
import { speakPhrase, stopSpeaking, setTtsEnabled, setSpeechRateSetting } from '../services/ttsService';
import { speakWordCloud, speakSyllablesCloud, stopCloudSpeaking, setCloudSpeechRate } from '../services/cloudTtsService';
import SyllableKaraokeText from '../components/SyllableKaraokeText';
import WordMeaningReveal from '../components/WordMeaningReveal';
import { fetchDashboardSettings, DashboardSettings } from '../services/settingsService';
import { fetchPublishedLessons, Lesson, subscribeToPublishedLessons } from '../services/lessonService';
import { fetchLessonProgress, markLessonCompleted, markLessonOpened, LessonProgressRow } from '../services/lessonProgressService';
import { PRACTICE_PASSING_SCORE, scorePronunciation, scoreMessage } from '../utils/scorePronunciation';
import { fetchPersonalizedContent, RankedContentEntry } from '../services/wordsService';
import { fetchPronunciationSessions } from '../services/pronunciationSessionService';
import { createNotification, createParentNotification, fetchNotifications, markNotificationRead, NotificationItem, subscribeToStudentNotifications } from '../services/notificationService';
import { loadWordDefinitions, normalizeWordKey, WordDefinition } from '../services/wordDefinitionsService';
import DashboardSettingsScreen from './DashboardSettingsScreen';
import DashboardBottomNav, { BottomNavItem } from '../components/DashboardBottomNav';
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
import { colors, typography, radius, shadows } from '../theme';
import { fetchStudentProfile } from '../services/profileService';
import { studentAvatarSource } from '../utils/studentAvatar';
import StudentModules from './StudentModules';
import StudentProfileScreen from './StudentProfileScreen';
import TabHeroHeader from '../components/TabHeroHeader';

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

// Text-only variants of colors.warning/colors.danger: the base hex values are tuned for
// backgrounds/icons/borders and fail WCAG AA (~2.15:1 / ~3.78:1) when used as
// text color on white. These darker shades stay in the same amber/red family
// but clear AA for normal-size text. Use ONLY for Text color - leave
// colors.warning/colors.danger as-is everywhere else.
// XP_GOLD is intentionally not a theme token - it carries an "XP gold"
// semantic distinct from theme.colors.warning, even though the hex is
// numerically identical.
const XP_GOLD = '#f59e0b';
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
// The legacy Practice surface does not render long-form paragraph/story
// modules yet; those enter through the upcoming module detail flow.
type CurriculumPracticeType = Exclude<ReadingContentType, 'paragraph' | 'story'>;

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
  const [studentAvatarUrl, setStudentAvatarUrl] = useState<string | null>(null);
  const [studentAvatarKey, setStudentAvatarKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<ChildProgress | null>(null);
  const [wordOfDay, setWordOfDay] = useState<WordOfDayLog | null>(null);
  const [manilaDateKey, setManilaDateKey] = useState(getAsiaManilaDate());
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
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
  const [listenPlaying, setListenPlaying] = useState(false);
  const [listenJustFinished, setListenJustFinished] = useState(false);
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
  type Section = 'home' | 'learn' | 'practice' | 'achievements' | 'notifications' | 'settings' | 'profile';
  const [section, setSection] = useState<Section>('home');
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
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
      const rows = await fetchPronunciationSessions(childId);
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
      setCloudSpeechRate(result.speech_rate || 'normal');
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

  const handleStudentLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const { error: logoutError } = await signOutUser();
      if (logoutError) throw logoutError;
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (logoutError: any) {
      setLoggingOut(false);
      Alert.alert('Hindi Maka-logout', logoutError?.message || 'Subukan muli.');
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

  const loadCurrentPracticeItem = async (contentType?: CurriculumPracticeType) => {
    setWordBankLoading(true);
    try {
      const [ranked] = await fetchPersonalizedContent(1, contentType);
      setCurrentPracticeItem(ranked || null);
      setCurrentPracticeReason(ranked?.recommendationReason || 'Susunod na bukas na bahagi ng kurikulum.');
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
      // Note: ApiError's own .message is always the raw "<status> <statusText>"
      // line (see ApiError in config/api.ts) - the backend's actual JSON message
      // is on .data.message.
      const backendMessage = error?.data?.message;
      setWordBankError(
        backendMessage === 'No personalized curriculum practice is available yet.' ? '' : (backendMessage || 'Hindi ma-load ang susunod na practice item.'),
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

    // The learning profile and avatar both live on the canonical child row.
    void fetchStudentProfile(profile.auth_uid)
      .then((studentProfile) => {
        setStudentAvatarUrl(studentProfile?.avatar_url || null);
        setStudentAvatarKey(studentProfile?.avatar_key || null);
      })
      .catch((avatarError: any) => {
        console.warn('[StudentDashboard] avatar load failed:', avatarError?.message || avatarError);
      });

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
    const checkManilaDate = async () => {
      const currentDate = getAsiaManilaDate();  
      if (currentDate !== manilaDateKey) {
        setManilaDateKey(currentDate);
        if (child?.id) {
          try {
            const wordLog = await getOrCreateWordOfDay(child.id, Number(child.grade_level || 1));
            if (wordLog?.date !== wordOfDay?.date) {
              setWordOfDay(wordLog);
            }
          } catch (err: any) {
            console.warn('[StudentDashboard] failed to refresh Word of the Day at Manila midnight:', err?.message || err);
          }
        }
      }
    };

    const interval = setInterval(checkManilaDate, 30_000);
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appState.match(/inactive|background/) && nextState === 'active') {
        await checkManilaDate();
      }
      setAppState(nextState);
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [appState, child?.grade_level, child?.id, manilaDateKey, wordOfDay?.date]);

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
    if (days <= 0) return 'Ngayon';
    if (days === 1) return 'Kahapon';
    if (days < 7) return `${days} araw na ang nakalipas`;
    return new Date(iso).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    if (status === 'completed') return colors.success;
    if (status === 'completed_late') return colors.warning;
    if (status === 'overdue') return colors.danger;
    return colors.warning;
  };

  // Text-safe variant of getStatusColor - getStatusColor's colors.warning/colors.danger
  // values are tuned for the status dot (background), not for text.
  const getStatusTextColor = (status: string) => {
    if (status === 'completed') return colors.success;
    if (status === 'completed_late') return colors.warningText;
    if (status === 'overdue') return colors.dangerText;
    return colors.warningText;
  };

  const getStatusLabel = (status: string) => {
    if (status === 'completed') return 'Naisumite';
    if (status === 'completed_late') return 'Naisumite (Huli)';
    if (status === 'overdue') return 'Lampas na sa Deadline';
    return 'Nakabinbin';
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
      Alert.alert('May Problema', 'Hindi ma-open ang file. Siguraduhing may internet connection.');
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
      Alert.alert('May Problema', 'Hindi ma-open ang lesson. Siguraduhing may internet connection.');
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
      await notifyStudent('Tapos na ang Aralin!', `Natapos mo ang "${lesson.title}". Magaling!`, 'lesson');
    } catch {
      Alert.alert('May Problema', 'Hindi na-save ang progress. Subukan muli.');
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

    const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next);
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
        await notifyStudent('New Badge Unlocked!', `${child?.name || 'Student'} earned the "${celebrate.title}" badge!`, 'achievement');
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
      // The endpoint has already saved this authoritative result. Reflect it
      // immediately so the card changes from the mic controls to the
      // completed-today message without requiring a dashboard reload.
      setWordOfDay((current) => current
        ? { ...current, attempts, correct: correct ? true : current.correct }
        : current);
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
            // Keep the local snapshot aligned with the server-owned Manila
            // day used by the successful Word-of-the-Day transaction.
            last_practice_date: getAsiaManilaDate(),
          }
        : computed;
      await saveProgress(next);
      setProgress(next);
      await notifyParent(
        'Salita ng Araw',
        `${correct ? 'Natapos' : 'Sinubukan'} ni ${child?.name || 'Mag-aaral'} ang salitang "${wordOfDay?.word || ''}" at nakakuha ng ${addXp} XP.`,
        'word',
      );
      if (correct && completion?.streak != null) {
        await notifyStudent(
          'Streak Continued!',
          `Great job! Your reading streak is now ${completion.streak} day${completion.streak === 1 ? '' : 's'}. Keep it going!`,
          'streak',
        );
      }
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next);
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
          await notifyStudent('New Badge Unlocked!', `${child?.name || 'Student'} earned the "${celebrate.title}" badge!`, 'achievement');
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

  // Prefers the client workbook's syllable_hyphenation column (linguistically
  // accurate - respects Tagalog onset-cluster rules) for curriculum words,
  // falling back to the syllabifyText() heuristic for anything outside the
  // curriculum (legacy hardcoded word lists). Confirmed the two sources
  // disagree on ~52% of the 600-word curriculum, so this preference matters,
  // not just a stylistic choice.
  const getSyllableParts = (word: string, contentId?: string | null): string[] => {
    // Split on both hyphens and whitespace, not just hyphens - phrase/sentence
    // content (Intermediate/Advanced) has no syllable_hyphenation seeded, so it
    // always falls back to syllabifyText(), whose output hyphenates within each
    // word but only space-separates between words. Splitting on '-' alone fused
    // the last syllable of one word with the first syllable of the next (e.g.
    // "masayang bata" -> "Ma-sa-yang Ba-ta" produced a "yang Ba" chunk).
    if (contentId) {
      const match = readingContent.find((item) => item.id === contentId);
      if (match?.syllable_hyphenation) {
        return match.syllable_hyphenation.split(/[-\s]+/).filter(Boolean);
      }
    }
    return syllabifyText(word).split(/[-\s]+/).filter(Boolean);
  };

  // Slow, syllable-by-syllable karaoke read-along, driven by real Google TTS
  // timepoints (see cloudTtsService.speakSyllablesCloud). No on-device
  // fallback exists for the *highlighting* (expo-speech has no timing API),
  // so on failure this still plays the word normally via speakPracticeWord -
  // the student always hears something, they just don't get the highlight.
  const playSyllableKaraoke = (word = selectedWord || '') => {
    if (!word) return;
    const parts = getSyllableParts(word, selectedContentId);
    stopSpeaking();
    stopCloudSpeaking();

    if (parts.length < 2) {
      // Nothing meaningful to highlight for a single-syllable word.
      speakPracticeWord(word);
      return;
    }

    setKaraokeLoading(true);
    setKaraokeSyllableIndex(0);
    setListenJustFinished(false);
    speakSyllablesCloud(parts, {
      onSyllableIndex: (index) => setKaraokeSyllableIndex(index),
      onDone: () => {
        setKaraokeSyllableIndex(null);
        setKaraokeLoading(false);
        setListenJustFinished(true);
      },
      onError: (message) => {
        setKaraokeSyllableIndex(null);
        setKaraokeLoading(false);
        setPracticeStatus(message);
        speakPracticeWord(word);
      },
    });
  };

  // Same plain-playback path as speakPracticeWord, but tracks a
  // playing/just-finished state so the Listen & Read screen can show real
  // visual feedback (pulsing "now playing" badge, brief "finished" check)
  // instead of the static display it had before - unlike Say the Word,
  // there's no speech-recognition result to drive that state off of here.
  const playListenWord = (word = selectedWord || '') => {
    if (!word) return;
    stopSpeaking();
    stopCloudSpeaking();
    setListenPlaying(true);
    setListenJustFinished(false);
    speakWordCloud(word.replace(/-/g, ' '), {
      onDone: () => {
        setListenPlaying(false);
        setListenJustFinished(true);
      },
      onError: (message) => {
        setListenPlaying(false);
        setPracticeStatus(message);
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
  // student's own auth_uid and links the same row to the enrolled child's
  // parent so it appears in both notification views and parent realtime.
  // Before this, nothing in the app ever wrote a
  // notification row addressed to the student themselves (every existing
  // call site was parent-only), so the student's own Notifications tab had
  // no real content to show. Only called at genuinely real events below -
  // deliberately not mirrored for every notifyParent() call, to avoid
  // notification spam (e.g. no per-attempt XP/assignment noise).
  const notifyStudent = async (title: string, message: string, type: string) => {
    if (!child?.auth_uid || !child?.id || !child?.parent_id) return;
    try {
      await createNotification(child.auth_uid, title, message, type, {
        studentId: child.id,
        parentId: child.parent_id,
      });
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
              : `Mas mabagal na pagbasa ay makakatulong. Simulan sa '${getSyllableParts(selectedWord, selectedContentId)[0] || selectedWord}'.`;
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
      const { progress: updatedProgress, newlyUnlocked } = await unlockAchievements(next);
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
          await notifyStudent('New Badge Unlocked!', `${child?.name || 'Student'} earned the "${celebrate.title}" badge!`, 'achievement');
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
          'Pagkilala sa Boses',
          'Kailangan ng Google Speech Recognition sa Android o suportadong browser sa web.'
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
    } catch {
      ExpoSpeechRecognitionModule.stop();
    }
    setPracticeProcessing(true);
    setPracticeStatus('Sinusuri ang iyong pagbasa...');
  };

  // Reuses the same continuously-running mascotPulse value (already looping
  // 1 -> 1.08 -> 1 from mount) rather than starting a second animation - just
  // interpolated to an opacity breathe instead of mascotPulse's own scale.
  const skeletonOpacity = mascotPulse.interpolate({ inputRange: [1, 1.08], outputRange: [0.55, 1] });

  if (loading) return (
    <View style={styles.center}>
      <Animated.View style={[styles.skeletonCard, { opacity: skeletonOpacity }]} />
      <Animated.View style={[styles.skeletonLine, { opacity: skeletonOpacity }]} />
      <Animated.View style={[styles.skeletonLineShort, { opacity: skeletonOpacity }]} />
      <View style={styles.skeletonGrid}>
        <Animated.View style={[styles.skeletonBlock, { opacity: skeletonOpacity }]} />
        <Animated.View style={[styles.skeletonBlock, { opacity: skeletonOpacity }]} />
      </View>
    </View>
  );

  const renderWordOfDay = () => {
    // Resets every 5 attempts, not at actual midnight - there's no calendar-
    // day boundary tracked yet. A true calendar-day version (reset at real
    // midnight, independent of attempt count) is a separate future task -
    // this is the existing, real mechanic, not a placeholder to fix now.
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
      detail: (s.accuracy_percentage || 0) >= 80 ? 'Magaling na bigkas' : 'Nagsanay ng bigkas',
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
        <TabHeroHeader
          onMenuPress={openSidebar}
          notifDot={unreadNotifCount > 0}
          title={`Kumusta,\n${getFirstName(child?.name || '')}! 👋`}
          subtitle="Handa ka na bang matuto ngayon?"
          illustration={require('../../assets/waving.webp')}
          titleA11yStyle={heroTitleA11yStyle}
          subtitleA11yStyle={heroSubtitleA11yStyle}
        />

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

          {/* Deadlines widget — moved to top so upcoming due dates are the
              first thing a student sees on Home */}
          <View style={styles.homeDeadlinesCard}>
            <View style={styles.homeDeadlinesHeader}>
              <Text style={[styles.homeDeadlinesTitle, cardTitleA11y]}>📅 Mga Paparating na Deadline</Text>
              <TouchableOpacity
                onPress={() => setSection('learn')}
                accessibilityRole="button"
                accessibilityLabel="View all lessons"
              >
                <Text style={[styles.homeDeadlinesLink, cardSubtitleA11y]}>Tingnan ang mga aralin</Text>
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
                  <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
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

          {/* Encouragement card — deliberately no exact numbers/percentages
              here. Detailed progress/accuracy stats are parent-only now
              (see Parent dashboard's Child Progress screen); the student
              side keeps only non-numeric encouragement plus the practice CTA. */}
          <View style={styles.homeTodayCard}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.homeTodayTitle, cardTitleA11y]}>Handa ka na{'\n'}bang magsanay?</Text>
              <Text style={[styles.homeTodayStatLine, bodyA11y]}>Bawat pagsasanay ay isang hakbang pasulong!</Text>
              <TouchableOpacity
                style={styles.homeTodayButton}
                onPress={() => goToPractice()}
                accessibilityRole="button"
                accessibilityLabel="Continue practice"
              >
                <Text style={[styles.homeTodayButtonText, buttonA11y]}>Ipagpatuloy ang Pagsasanay</Text>
              </TouchableOpacity>
            </View>
            <Image source={require('../../assets/thumbsup.webp')} style={{ width: 84, height: 84 }} resizeMode="contain" />
          </View>

          {/* Continue Learning — real in-progress lesson + inferred
              Lesson X of Y (see comment above on continueLessonIndex) */}
          {continueReadingLesson ? (
            <View style={styles.homeContinueCard}>
              <View style={styles.homeContinueImageWrap}>
                <Image source={require('../../assets/reading.webp')} style={styles.homeContinueImage} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.homeContinueTitle, cardTitleA11y]}>Ipagpatuloy ang Pag-aaral</Text>
                <Text style={[styles.homeContinueSubtitle, cardSubtitleA11y]}>{continueReadingLesson.title}</Text>
                <Text style={[styles.homeContinueLessonCount, smallLabelA11y]}>Aralin {continueLessonIndex + 1} ng {continueLessonTotal}</Text>
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
                <Text style={[styles.homeContinueButtonText, buttonA11y]}>Ipagpatuloy</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.homeContinueCard}>
              <View style={styles.homeContinueImageWrap}>
                <Image source={require('../../assets/reading.webp')} style={styles.homeContinueImage} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.homeContinueTitle, cardTitleA11y]}>Ipagpatuloy ang Pag-aaral</Text>
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
                {stats.streak > 0 && (
                  <View style={styles.homeHeroStreakPill}>
                    <Ionicons name="flame" size={13} color="#fff" />
                    <Text style={[styles.homeHeroStreakText, smallLabelA11y]}>SUNOD-SUNOD!</Text>
                  </View>
                )}
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
              <Ionicons name="mic" size={24} color={colors.lavenderDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.readyPracticeTitle, cardTitleA11y]}>Handa nang Magsanay?</Text>
              <Text style={[styles.readyPracticeSub, bodyA11y]}>Magsanay bumasa ng mga salita at mapabuti ang iyong bigkas gamit ang AI feedback.</Text>
            </View>
            <TouchableOpacity
              style={styles.readyPracticeButton}
              onPress={() => goToPractice()}
              accessibilityRole="button"
              accessibilityLabel="Start practice"
            >
              <Text style={[styles.readyPracticeButtonText, buttonA11y]}>Simulan ang Pagsasanay</Text>
            </TouchableOpacity>
          </View>

          {/* Recent Activity — merged real feed (see recentActivityItems
              comment above): whatever mix of completed lessons and
              pronunciation sessions actually happened, not a fixed layout */}
          <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Kamakailang Aktibidad</Text>
          {recentActivityItems.length ? (
            recentActivityItems.map((item) => (
              <View key={item.key} style={styles.homeRecentActivityCard}>
                <View style={[styles.homeRecentActivityIconWrap, { backgroundColor: item.kind === 'lesson' ? '#E9F1E2' : '#EFECFB' }]}>
                  <Ionicons
                    name={item.kind === 'lesson' ? 'checkmark-circle' : 'mic'}
                    size={20}
                    color={item.kind === 'lesson' ? colors.sage : colors.lavenderDark}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.homeRecentActivityTitle, cardSubtitleA11y]}>{item.kind === 'lesson' ? 'Tapos na ang Aralin' : 'Pagsasanay sa Bigkas'}</Text>
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
              <View style={[styles.homeQuickIconWrap, { backgroundColor: colors.lavender }]}>
                <Ionicons name="library-outline" size={20} color="#fff" />
              </View>
              <Text style={[styles.homeQuickLabel, cardSubtitleA11y]}>Aralin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeQuickCard, { backgroundColor: '#FBE7DF' }]}
              onPress={() => goToPractice()}
              accessibilityRole="button"
              accessibilityLabel="Go to Practice"
            >
              <View style={[styles.homeQuickIconWrap, { backgroundColor: colors.coral }]}>
                <Ionicons name="mic-outline" size={20} color="#fff" />
              </View>
              <Text style={[styles.homeQuickLabel, cardSubtitleA11y]}>Pagsasanay</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeQuickCard, { backgroundColor: '#E9F1E2' }]}
              onPress={() => setSection('achievements')}
              accessibilityRole="button"
              accessibilityLabel="Go to Badges"
            >
              <View style={[styles.homeQuickIconWrap, { backgroundColor: colors.sage }]}>
                <Ionicons name="ribbon-outline" size={20} color="#fff" />
              </View>
              <Text style={[styles.homeQuickLabel, cardSubtitleA11y]}>Parangal</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </>
    );
  };

  const renderPractice = () => {
    const currentLevel = officialProgression?.effective_level || progress?.level || 'Beginner';
    const practiceTypeLabels: Record<RankedContentEntry['contentType'], string> = {
      word: 'Words', phonetic: 'Phonetics', phrase: 'Phrases', sentence: 'Sentences', story: 'Stories',
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

    const startWord = (word: string, mode: 'say' | 'listen', contentId?: string | null) => {
      setPracticeMode(mode);
      setSelectedWord(word);
      setSelectedContentId(contentId || null);
      setPracticeResult(null);
      setPracticeAttempts(0);
      setPracticeTranscript('');
      setPracticeProcessing(false);
      setPracticeStatus('Pindutin ang mikropono kapag handa ka na.');
      setListenPlaying(false);
      setListenJustFinished(false);
      setKaraokeSyllableIndex(null);
      setKaraokeLoading(false);
      // "Listen & Read" always speaks - that's the mode's whole purpose.
      // "Say the Word" only auto-speaks on select if Auto Read Words is on.
      if (mode === 'listen') {
        playListenWord(word);
      } else if (dashboardSettings?.auto_read_words !== false) {
        speakPracticeWord(word);
      }
    };

    if (selectedWord && child && practiceMode === 'listen') {
      // Intermediate/Advanced content can be a whole phrase or sentence, not
      // just a short word - the giant centered word display needs to shrink
      // and left-align so it wraps naturally instead of overflowing.
      const isLongSelectedContent = selectedWord.length > 20;
      const isKaraokeActive = karaokeLoading || karaokeSyllableIndex !== null;
      const isAnyPlaying = listenPlaying || isKaraokeActive;
      const listenBadgeColor = isAnyPlaying ? colors.vivid.teal : listenJustFinished ? colors.success : colors.lavender;
      const listenBadgeIcon = isAnyPlaying ? 'volume-high' : listenJustFinished ? 'checkmark' : 'book-outline';
      const listenStatusText = isAnyPlaying
        ? 'Pinapatugtog... sundan ng mata ang bawat pantig.'
        : listenJustFinished
        ? 'Magaling! Ulitin muli o magpatuloy sa susunod.'
        : 'Pakinggan ang salita habang sinusundan mo ito sa mata.';

      return (
        <View style={{ flex: 1 }}>
          {/* Rendered outside the ScrollView so it stays pinned while content scrolls underneath it - same pattern as the Say the Word hero. */}
          <TabHeroHeader
            onBackPress={() => {
              stopSpeaking();
              stopCloudSpeaking();
              setSelectedWord(null);
              setSelectedContentId(null);
            }}
            title={'Basahin\nKasama Ako'}
            subtitle="Sundan ng mata ang bawat pantig habang binabasa ko ito para sa iyo."
            illustration={require('../../assets/reading.webp')}
            titleA11yStyle={heroTitleA11yStyle}
            subtitleA11yStyle={heroSubtitleA11yStyle}
            backLabelA11yStyle={bodyA11y}
          />

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
            <View style={styles.learnProgressCard}>
              <View style={styles.learnProgressTopRow}>
                <View style={styles.practiceProgressTitleRow}>
                  <Ionicons name="albums-outline" size={16} color={colors.lavenderDark} />
                  <Text style={[styles.learnProgressTitle, cardTitleA11y]}>Pagsasanay Ngayon</Text>
                </View>
                {wordTotal > 0 && (
                  <View style={styles.practiceWordPill}>
                    <Text style={[styles.practiceWordPillText, smallLabelA11y]}>Salita {wordPosition} ng {wordTotal}</Text>
                  </View>
                )}
              </View>
              <View style={styles.learnProgressTrack}>
                <View style={{ width: `${wordTotal ? Math.max(4, Math.round((wordPosition / wordTotal) * 100)) : 4}%`, height: '100%' }}>
                  <LinearGradient
                    colors={[colors.heroGradient[0], colors.heroGradient[1]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1, borderRadius: 5 }}
                  />
                </View>
              </View>
            </View>

            <View style={styles.practiceHero}>
              <Animated.View
                style={[
                  styles.practiceMoodBadge,
                  { backgroundColor: listenBadgeColor },
                  { transform: [{ scale: mascotPulse }] },
                ]}
              >
                <Ionicons name={listenBadgeIcon as any} size={26} color="#fff" />
              </Animated.View>
              <Text style={[styles.practicePrompt, cardTitleA11y]}>Pakinggan at Basahin</Text>
              <Text style={[
                styles.practiceWordDisplay,
                isLongSelectedContent && styles.practiceWordDisplayWide,
                a11yText(isLongSelectedContent ? 20 : 32, 'bold'),
              ]}>{selectedWord}</Text>
              <SyllableKaraokeText
                syllables={getSyllableParts(selectedWord, selectedContentId)}
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
                  style={[
                    styles.sayWordButton,
                    { flex: 1, width: undefined, backgroundColor: colors.sage, shadowColor: colors.sage },
                    listenPlaying && styles.listenButtonActive,
                  ]}
                  onPress={() => playListenWord(selectedWord)}
                  disabled={isKaraokeActive}
                  accessibilityRole="button"
                  accessibilityLabel={`Play pronunciation for ${selectedWord}`}
                >
                  <Ionicons name={listenPlaying ? 'volume-high' : 'play'} size={26} color="#fff" />
                  <Text style={[styles.sayWordButtonText, buttonA11y]}>{listenPlaying ? 'Pinapatugtog' : 'Pakinggan'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.sayWordButton,
                    { flex: 1, width: undefined, backgroundColor: colors.lavenderDark, shadowColor: colors.lavenderDark },
                    isKaraokeActive && styles.listenButtonActive,
                  ]}
                  onPress={() => playSyllableKaraoke(selectedWord)}
                  disabled={karaokeLoading || listenPlaying}
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

              <Text style={[styles.practiceStatus, bodyA11y]}>{listenStatusText}</Text>
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
              <Ionicons name="arrow-forward" size={16} color={colors.sage} />
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

    // Deliberately non-numeric — exact word counts/accuracy percentages are
    // parent-only now (see Parent dashboard's Child Progress screen).
    const renderSessionProgressCard = () => (
      <View style={styles.practiceStatsCard}>
        <View style={styles.practiceStatsRow}>
          <View style={[styles.practiceStatsIconWrap, { backgroundColor: colors.vivid.green }]}>
            <Ionicons name="happy" size={22} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, cardTitleA11y, { flex: 1 }]}>
            {wordsPracticedToday > 0 ? 'Magaling! Ipagpatuloy mo ang pagsasanay!' : 'Handa ka na bang magsanay?'}
          </Text>
        </View>
      </View>
    );

    const renderReadingTipCard = () => (
      <View style={styles.practiceTipCard}>
        <View style={[styles.categoryIconWrap, { backgroundColor: colors.vivid.amber, marginBottom: 0 }]}>
          <Ionicons name="bulb" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.practiceTipCardTitle, cardTitleA11y]}>Tip sa Pagbasa</Text>
          <Text style={[styles.practiceTipCardText, bodyA11y]}>Basahin ang bawat pantig nang dahan-dahan bago sabihin ang buong salita.</Text>
        </View>
      </View>
    );

    if (selectedWord && child) {
      // Same long-content accommodation as the "listen" view above.
      const isLongSelectedContent = selectedWord.length > 20;
      return (
        <View style={{ flex: 1 }}>
          <ConfettiOverlay visible={confettiVisible} />
          {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
          <TabHeroHeader
            onBackPress={() => {
              ExpoSpeechRecognitionModule.abort();
              setSelectedWord(null);
              setSelectedContentId(null);
              setPracticeResult(null);
              setPracticeAttempts(0);
              setPracticeTranscript('');
              setPracticeProcessing(false);
            }}
            title={'Pagsasanay sa\nPagbigkas'}
            subtitle="Basahin nang malakas ang salita at hayaang suriin ng AI ang bigkas mo."
            illustration={require('../../assets/singing.webp')}
            titleA11yStyle={heroTitleA11yStyle}
            subtitleA11yStyle={heroSubtitleA11yStyle}
            backLabelA11yStyle={bodyA11y}
          />

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
            <View style={styles.learnProgressCard}>
              <View style={styles.learnProgressTopRow}>
                <View style={styles.practiceProgressTitleRow}>
                  <Ionicons name="albums-outline" size={16} color={colors.lavenderDark} />
                  <Text style={[styles.learnProgressTitle, cardTitleA11y]}>Pagsasanay Ngayon</Text>
                </View>
                {wordTotal > 0 && (
                  <View style={styles.practiceWordPill}>
                    <Text style={[styles.practiceWordPillText, smallLabelA11y]}>Salita {wordPosition} ng {wordTotal}</Text>
                  </View>
                )}
              </View>
              <View style={styles.learnProgressTrack}>
                <View style={{ width: `${wordTotal ? Math.max(4, Math.round((wordPosition / wordTotal) * 100)) : 4}%`, height: '100%' }}>
                  <LinearGradient
                    colors={[colors.heroGradient[0], colors.heroGradient[1]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1, borderRadius: 5 }}
                  />
                </View>
              </View>
              <View style={styles.practiceTipRow}>
                <Ionicons name="bulb" size={14} color={colors.sun} />
                <Text style={[styles.practiceTipText, bodyA11y]}>Ipagpatuloy ang pagsasanay para umangat ang bigkas mo!</Text>
              </View>
            </View>

            <View style={styles.practiceHero}>
              <Animated.View
                style={[
                  styles.practiceMoodBadge,
                  { backgroundColor: practiceResult?.correct ? colors.success : practiceProcessing ? colors.vivid.orange : practiceListening ? colors.vivid.teal : colors.lavender },
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
              <Text style={[
                styles.practiceWordDisplay,
                isLongSelectedContent && styles.practiceWordDisplayWide,
                a11yText(isLongSelectedContent ? 20 : 32, 'bold'),
              ]}>{selectedWord}</Text>
              <SyllableKaraokeText
                syllables={getSyllableParts(selectedWord, selectedContentId)}
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
                  <Ionicons name="volume-high-outline" size={18} color={colors.lavenderDark} />
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
                    <Text style={[styles.encourageTitle, cardTitleA11y]}>Bawat pagsasanay ay ginagawa kang mas magaling na mambabasa!</Text>
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
                        <Ionicons name="refresh" size={16} color={colors.lavenderDark} />
                        <Text style={[styles.encourageButtonGhostText, buttonA11y]}>Magsanay Muli</Text>
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
                          <Text style={[styles.encourageButtonSolidText, buttonA11y]}>Susunod na Salita</Text>
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

    return (
      <View style={{ flex: 1 }}>
        <TabHeroHeader
          onMenuPress={openSidebar}
          notifDot={unreadNotifCount > 0}
          title="Pagsasanay"
          subtitle="Magsanay tayong magbasa nang magkasama!"
          illustration={require('../../assets/singing.webp')}
          titleA11yStyle={heroTitleA11yStyle}
          subtitleA11yStyle={heroSubtitleA11yStyle}
        />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.goalCard}>
          <View style={styles.goalTopRow}>
            <Text style={[styles.goalTitle, cardTitleA11y]}>Pagsasanay Ngayon</Text>
          </View>
          <Text style={[styles.goalEmptyNote, bodyA11y]}>
            {goalDone === 0 ? 'Simulan ang unang pagsasanay ngayon! 🌱' : '✨ Ang galing! Ipagpatuloy mo!'}
          </Text>
          <View style={styles.rewardRow}>
            <View style={[styles.rewardPill, { backgroundColor: '#FBE7DF' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="star" size={13} color={colors.coral} />
              </View>
              <Text style={[styles.rewardText, { color: colors.coral }, smallLabelA11y]}>
                {stats.xp > 0 ? 'Kumikita ng XP!' : 'Simulan ang XP mo!'}
              </Text>
            </View>
            <View style={[styles.rewardPill, { backgroundColor: '#FFF3DC' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="flame" size={13} color={colors.sun} />
              </View>
              <Text style={[styles.rewardText, { color: colors.sun }, smallLabelA11y]}>
                {stats.streak > 0 ? 'May-init ang streak mo!' : 'Simulan ang streak!'}
              </Text>
            </View>
            <View style={[styles.rewardPill, { backgroundColor: '#EFECFB' }]}>
              <View style={[styles.rewardIconWrap, { backgroundColor: '#fff' }]}>
                <Ionicons name="ribbon" size={13} color={colors.lavenderDark} />
              </View>
              <Text style={[styles.rewardText, { color: colors.lavenderDark }, smallLabelA11y]}>
                {(progress?.achievements?.length || 0) > 0 ? 'May mga parangal ka na!' : 'Kumuha ng unang parangal!'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>🤖 Inirekomendang Pagsasanay sa Pagbasa</Text>

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
                  {currentPracticeReason || 'Susunod na bukas na bahagi ng kurikulum.'}
                </Text>
              </View>
              {readingProfile && (
                <View style={styles.aiConfidencePill}>
                  <Text style={styles.aiConfidenceValue}>{readingProfile.confidenceScore}%</Text>
                  <Text style={styles.aiConfidenceLabel}>Kumpiyansa</Text>
                </View>
              )}
            </View>
            {!!readingProfile?.recommendedFocus && (
              <Text style={[styles.aiRecommendationFocus, bodyA11y]}>Pokus: {readingProfile.recommendedFocus}</Text>
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
          <TouchableOpacity
            style={styles.completedTrackBanner}
            onPress={() => setSection('learn')}
            accessibilityRole="button"
            accessibilityLabel="Go to Learn tab to take the module assessment"
          >
            <Ionicons name="checkmark-circle" size={24} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.completedTrackTitle, cardTitleA11y]}>Tapos na ang mga aralin sa modyul na ito!</Text>
              <Text style={[styles.completedTrackText, bodyA11y]}>Puntahan ang tab na Aralin para kunin ang pagsusulit ng modyul.</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.practiceModeCard, !recommendedItem && styles.practiceModeCardDisabled]}
          disabled={!recommendedItem}
          onPress={() => recommendedItem && startWord(recommendedItem.contentText, 'say', recommendedItem.id)}
          accessibilityRole="button"
          accessibilityLabel="Start Say the Word practice mode"
        >
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="mic" size={24} color={colors.lavenderDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.practiceModeTitle, cardTitleA11y]}>Sabihin ang Salita</Text>
            <Text style={[styles.practiceModeSub, bodyA11y]}>Pakinggan ang salita, pagkatapos sabihin ito nang malakas.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#EFECFB' }]}>
              <Text style={[styles.practiceModeTagText, { color: colors.lavenderDark }, smallLabelA11y]}>AI na Pagsasanay sa Bigkas</Text>
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
            <Ionicons name="volume-high" size={24} color={colors.sage} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.practiceModeTitle, cardTitleA11y]}>Pakinggan at Basahin</Text>
            <Text style={[styles.practiceModeSub, bodyA11y]}>Pakinggan ang salita at sundan ito habang binabasa.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#E9F1E2' }]}>
              <Text style={[styles.practiceModeTagText, { color: colors.sage }, smallLabelA11y]}>Suporta sa Text-to-Speech</Text>
            </View>
          </View>
          <View style={[styles.practiceModeStartPill, { backgroundColor: colors.sage }]}>
            <Text style={[styles.practiceModeStartText, buttonA11y]}>Simulan</Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.practiceModeCard, styles.practiceModeCardDisabled]}>
          <View style={[styles.practiceModeIconWrap, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="book" size={24} color={colors.sun} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.practiceModeTitle, cardTitleA11y]}>Basahin nang Malakas</Text>
            <Text style={[styles.practiceModeSub, bodyA11y]}>Magsanay bumasa ng mga pangungusap nang malakas.</Text>
            <View style={[styles.practiceModeTag, { backgroundColor: '#FFF3DC' }]}>
              <Text style={[styles.practiceModeTagText, { color: colors.sun }, smallLabelA11y]}>Sa Madaling Panahon</Text>
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
              <Text style={[styles.categoryFilterBarReset, buttonA11y]}>Ipakita Lahat</Text>
            </TouchableOpacity>
          </View>
        )}

        {renderSessionProgressCard()}
        {renderReadingTipCard()}
      </ScrollView>
      </View>
    );
  };

  // Restored 2026-08-14: this used to be folded into a full-screen
  // renderActivities() that doubled as the whole Learn tab. Since
  // StudentModules now owns Learn (the sequential module path), this is
  // trimmed to just the two things that only exist here - teacher
  // assignments and teacher-uploaded PDF lessons - and rendered as a fixed
  // section above <StudentModules/> so it's visible immediately, with no
  // scrolling past the module list required. Learning Categories/Reading
  // Tip/Daily Goal/Journey card are deliberately dropped, not restored -
  // Home and the module path already show that information; keeping it here
  // too would just be duplicate chrome.
  const renderAssignmentsSection = () => {

    const lessonSubjects = Array.from(new Set(lessons.map((l) => l.subject).filter(Boolean))) as string[];

    const lessonsAscending = lessons
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const filteredLessonsAscending = lessonFilter === 'Lahat'
      ? lessonsAscending
      : lessonsAscending.filter((l) => l.subject === lessonFilter);

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

    const lessonStateLabel = (state: 'not_started' | 'in_progress' | 'completed') =>
      state === 'completed' ? 'Nabasa na' : state === 'in_progress' ? 'Binabasa' : 'Hindi pa binuksan';

    return (
    <View style={styles.assignmentsSectionWrap}>
      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#EFECFB' }]}>
          <Ionicons name="clipboard" size={16} color={colors.lavenderDark} />
          <Text style={[styles.learnBadgeText, { color: colors.lavenderDark }, smallLabelA11y]}>MGA TAKDANG-ARALIN</Text>
        </View>
        <Text style={[styles.learnSectionSubtitle, bodyA11y]}>Mga takdang-aralin mula sa iyong guro</Text>
      </View>

      {activitiesLoading ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="small" color={colors.lavender} />
          <Text style={[styles.empty, bodyA11y]}>Naglo-load ng mga aktibidad...</Text>
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
                <Ionicons name="clipboard" size={22} color={colors.lavenderDark} />
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
                  <Text style={[styles.learnActionButtonText, buttonA11y]}>Isumite</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC' }]}>
          <View style={[styles.learnEmptyIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="clipboard-outline" size={40} color={colors.lavenderDark} />
          </View>
          <Text style={[styles.learnEmptyTitle, cardTitleA11y]}>Wala ka pang assignment ngayon</Text>
          <Text style={[styles.learnEmptySubtext, bodyA11y]}>Hihintayin natin ang unang takdang-aralin mula sa guro mo! 📝</Text>
        </View>
      )}

      <View style={styles.learnSectionHeader}>
        <View style={[styles.learnBadgePill, { backgroundColor: '#E9F1E2' }]}>
          <Ionicons name="document-text" size={16} color={colors.sage} />
          <Text style={[styles.learnBadgeText, { color: colors.sage }, smallLabelA11y]}>MGA ARALIN (PDF)</Text>
        </View>
        <Text style={[styles.learnSectionSubtitle, bodyA11y]}>Mga PDF na inupload ng iyong guro</Text>
      </View>

      {totalLessonsCount > 0 ? (
        <View style={styles.learnProgressCard}>
          <View style={styles.learnProgressTopRow}>
            <Text style={[styles.learnProgressTitle, cardTitleA11y]}>Progreso sa Pag-aaral</Text>
            <Text style={[styles.learnProgressPct, statValueA11y]}>{learningProgressPct}%</Text>
          </View>
          <Text style={[styles.learnProgressCount, bodyA11y]}>{completedLessonsCount} / {totalLessonsCount} Lessons Completed</Text>
          <View style={styles.learnProgressTrack}>
            <View style={{ width: `${Math.max(4, learningProgressPct)}%`, height: '100%' }}>
              <LinearGradient
                colors={[colors.heroGradient[0], colors.heroGradient[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ flex: 1, borderRadius: 5 }}
              />
            </View>
          </View>
          <Text style={[styles.learnProgressMsg, bodyA11y]}>
            {completedLessonsCount === 0 ? 'Simulan ang unang aralin mo!' : 'Ipagpatuloy mo! Umaangat ka nang umaangat.'}
          </Text>
        </View>
      ) : (
        <View style={[styles.learnEmptyCard, { backgroundColor: '#F5F3FC' }]}>
          <View style={[styles.learnEmptyIconWrap, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="book-outline" size={40} color={colors.lavenderDark} />
          </View>
          <Text style={[styles.learnEmptyTitle, cardTitleA11y]}>Wala ka pang aralin</Text>
          <Text style={[styles.learnEmptySubtext, bodyA11y]}>Kapag nag-upload na ang guro mo ng aralin, makikita mo agad dito ang iyong progreso! 📚</Text>
        </View>
      )}

      {totalLessonsCount > 0 && (
        <>
          <Text style={[styles.practiceSectionTitle, cardTitleA11y]}>Aklatan ng Aralin</Text>

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
              <ActivityIndicator size="small" color={colors.lavender} />
              <Text style={[styles.empty, bodyA11y]}>Naglo-load ng mga aralin...</Text>
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
                        {lesson.subject || 'Aralin'} • {lessonStateLabel(state)}
                      </Text>
                    </View>
                    {state === 'completed' ? (
                      <TouchableOpacity
                        style={styles.lessonStepButtonGhost}
                        onPress={() => openLesson(lesson)}
                        accessibilityRole="button"
                        accessibilityLabel={`Review lesson: ${lesson.title}`}
                      >
                        <Text style={[styles.lessonStepButtonGhostText, { color: colors.vivid.green }, buttonA11y]}>Balikan ang Aralin</Text>
                      </TouchableOpacity>
                    ) : state === 'in_progress' ? (
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <TouchableOpacity
                          style={styles.lessonStepButtonLight}
                          onPress={() => openLesson(lesson)}
                          accessibilityRole="button"
                          accessibilityLabel={`Continue lesson: ${lesson.title}`}
                        >
                          <Text style={[styles.lessonStepButtonLightText, buttonA11y]}>Ipagpatuloy ang Pag-aaral</Text>
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
                        colors={[colors.heroGradient[0], colors.heroGradient[1]]}
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
                  <Ionicons name={iconForUpload(upload.content_type)} size={22} color={colors.sage} />
                </View>
                <View style={styles.uploadBody}>
                  <Text style={[styles.learnItemTitle, cardTitleA11y]}>{name}</Text>
                  <Text style={[styles.learnItemMeta, smallLabelA11y]}>{new Date(upload.created_at).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.learnActionButton, { backgroundColor: colors.sage }]}
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
    </View>
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

    const filterTabs: { key: 'all' | AchievementCategory; label: string }[] = [
      { key: 'all', label: 'Lahat' },
      { key: 'reading', label: 'Pagbasa' },
      { key: 'practice', label: 'Pagsasanay' },
      { key: 'progress', label: 'Progreso' },
      { key: 'consistency', label: 'Katatagan' },
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
        <TabHeroHeader
          onMenuPress={openSidebar}
          title={'Aking mga\nParangal'}
          subtitle="Ipagdiwang ang bawat tagumpay mo sa pagbasa!"
          illustration={require('../../assets/trophy.webp')}
          illustrationStyle={styles.badgesHeroImage}
          titleA11yStyle={heroTitleA11yStyle}
          subtitleA11yStyle={heroSubtitleA11yStyle}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.achievementSummaryCard}>
          <Text style={[styles.progressHeroTitle, cardTitleA11y]}>Buod ng mga Parangal</Text>
          <View style={styles.achievementSummaryRow}>
            <View style={styles.achievementSummaryLeftCol}>
              <Text style={[styles.achievementSummaryLabel, cardSubtitleA11y]}>Mga Nakuhang Parangal</Text>
              <Text style={[styles.achievementSummaryCount, a11yText(28, 'bold')]}>
                {unlockedCount}<Text style={[styles.achievementSummaryCountTotal, statLabelA11y]}>/{totalCount}</Text>
              </Text>
              <Text style={[styles.achievementSummaryHint, bodyA11y]}>
                {unlockedCount === totalCount ? 'Nakuha mo na ang lahat ng parangal! 🎉' : 'Magpatuloy sa pag-aaral para makakuha pa ng parangal! ✨'}
              </Text>
            </View>
            <View style={styles.progressRingShadowWrap}>
              <ProgressRing
                percent={unlockPct}
                size={92}
                strokeWidth={10}
                color={colors.lavenderDark}
                trackColor="rgba(124,111,207,0.12)"
                gradientColors={[colors.heroGradient[1], colors.heroGradient[0]]}
                gradientId="badgesSummaryRing"
              >
                <Text style={[styles.progressHeroRingPct, statValueA11y]}>{unlockPct}%</Text>
                <Text style={[styles.progressHeroRingLabel, smallLabelA11y]}>Kumpleto</Text>
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
                <Text style={[styles.badgeUnlockedPillText, smallLabelA11y]}>Nabuksan na</Text>
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
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Koleksyon ng Parangal</Text>
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
            <Text style={[styles.spotlightEyebrow, smallLabelA11y]}>Malapit na!</Text>
            <Text style={[styles.spotlightTitle, cardTitleA11y]}>Kasalukuyang Progreso ng Parangal</Text>
            <View style={styles.spotlightRow}>
              <Image source={spotlight.badge.image} style={styles.spotlightImage} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.spotlightBadgeTitle, cardSubtitleA11y]}>{spotlight.badge.title}</Text>
                <Text style={[styles.spotlightProgressText, smallLabelA11y]}>Progreso {spotlight.progress.current}/{spotlight.progress.target}</Text>
                <View style={styles.spotlightTrack}>
                  <View style={[styles.spotlightFill, { width: `${Math.max(4, spotlight.progress.pct || 0)}%` }]} />
                </View>
              </View>
            </View>
            <Text style={[styles.spotlightHint, bodyA11y]}>Malapit ka na! Ipagpatuloy ang pagsasanay. →</Text>
            <TouchableOpacity
              style={styles.spotlightButton}
              onPress={() => goToPractice()}
              accessibilityRole="button"
              accessibilityLabel="Practice now"
            >
              <Text style={[styles.spotlightButtonText, buttonA11y]}>Magsanay Ngayon</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.progressSectionHeader}>
          <View style={[styles.progressSectionIconWrap, { backgroundColor: colors.sage }]}>
            <Ionicons name="time" size={14} color="#fff" />
          </View>
          <Text style={[styles.practiceSectionTitle, styles.progressSectionTitleText, cardTitleA11y]}>Kamakailang Nakuha</Text>
        </View>
        {recentlyEarned.length ? (
          <View style={styles.learnCardList}>
            {recentlyEarned.map((r) => (
              <View key={r.badge.id} style={styles.homeRecentActivityCard}>
                <View style={[styles.homeRecentActivityIconWrap, { backgroundColor: '#FFF3DC' }]}>
                  <Image source={r.badge.image} style={{ width: 30, height: 30 }} resizeMode="contain" />
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

        <LinearGradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.badgesCelebrateBanner}
        >
          <Image source={require('../../assets/celebrate.webp')} style={styles.badgesCelebrateImage} resizeMode="contain" />
          <View style={{ maxWidth: '62%' }}>
            <Text style={[styles.badgesCelebrateTitle, cardTitleA11y]}>Magaling na Trabaho!</Text>
            <Text style={[styles.badgesCelebrateSub, bodyA11y]}>Bawat parangal ay sumasalamin sa iyong sipag at lumalakas na kasanayan sa pagbasa.</Text>
          </View>
          <View style={styles.badgesNextCard}>
            {spotlight ? (
              <>
                <Text style={[styles.badgesNextLabel, smallLabelA11y]}>Susunod na Parangal na Mabubuksan</Text>
                <Text style={[styles.badgesNextTitle, cardSubtitleA11y]}>{spotlight.badge.title}</Text>
                <Text style={[styles.badgesNextDetail, smallLabelA11y]}>
                  {Math.max(0, (spotlight.progress.target || 0) - (spotlight.progress.current || 0))} na lang
                </Text>
              </>
            ) : (
              <Text style={[styles.badgesNextTitle, cardSubtitleA11y]}>
                {unlockedCount === totalCount ? 'Nabuksan na ang lahat ng parangal!' : 'Magpatuloy sa pagsasanay para umunlad!'}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.badgesCelebrateButton}
            onPress={() => goToPractice()}
            accessibilityRole="button"
            accessibilityLabel="Continue learning"
          >
            <Text style={[styles.badgesCelebrateButtonText, buttonA11y]}>Ipagpatuloy ang Pag-aaral →</Text>
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
      if (date.toDateString() === now.toDateString()) return 'Ngayon';
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) return 'Kahapon';
      const daysAgo = Math.floor((now.getTime() - date.getTime()) / 86400000);
      return daysAgo < 7 ? 'Mas Naunang Linggo' : 'Mas Naunang Petsa';
    };
    const groupOrder = ['Ngayon', 'Kahapon', 'Mas Naunang Linggo', 'Mas Naunang Petsa'];
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
          return { icon: 'book', color: colors.sage, actionLabel: 'Tingnan ang Aralin', actionSection: 'learn' };
        case 'achievement':
          return { icon: 'trophy', color: XP_GOLD, actionLabel: 'Tingnan ang Parangal', actionSection: 'achievements' };
        case 'streak':
          return { icon: 'flame', color: colors.sun, actionLabel: 'Magsanay Na', actionSection: 'practice' };
        default:
          return { icon: 'notifications', color: colors.lavenderDark, actionLabel: null as string | null, actionSection: null as string | null };
      }
    };

    const markAllNotificationsRead = async () => {
      const unreadIds = notifications.filter((n) => !(n.is_read ?? n.read)).map((n) => n.id);
      if (!unreadIds.length) return;
      await Promise.all(unreadIds.map((id) => markNotificationRead(id).catch(() => {})));
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, read: true })));
    };

    const filterTabs: { key: typeof notifFilter; label: string }[] = [
      { key: 'all', label: 'Lahat' },
      { key: 'unread', label: 'Hindi Pa Nabasa' },
      { key: 'lesson', label: 'Mga Aralin' },
      { key: 'practice', label: 'Pagsasanay' },
      { key: 'achievement', label: 'Mga Parangal' },
    ];

    return (
      <>
        {/* Rendered outside the ScrollView below so it stays pinned while content scrolls underneath it. */}
        <TabHeroHeader
          onBackPress={() => navigateTo('home')}
          notifDot={unreadNotifCount > 0}
          title="Mga Abiso"
          subtitle="Manatiling updated sa iyong paglalakbay sa pagbasa."
          illustration={require('../../assets/bell.webp')}
          illustrationStyle={styles.notifHeroImage}
          titleA11yStyle={heroTitleA11yStyle}
          subtitleA11yStyle={heroSubtitleA11yStyle}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.notifSummaryCard}>
          <View style={[styles.notifSummaryIconWrap, { backgroundColor: unreadNotifCount > 0 ? colors.vivid.amber : colors.success }]}>
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
              <Text style={[styles.notifMarkAllButtonText, buttonA11y]}>Markahan Lahat Bilang Nabasa</Text>
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
                            <Ionicons name="chevron-forward" size={14} color={colors.lavenderDark} />
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
            <Ionicons name="notifications-outline" size={40} color={colors.lavender} />
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
      onGoBack={() => navigateTo('home')}
      gradeLevel={child?.grade_level}
      readingLevel={progress?.level}
      onSaved={(saved) => {
        setDashboardSettings(saved);
        setAccessibilitySettings(accessibilityFromSettings(saved));
      }}
      onProfileChanged={(updatedProfile) => {
        setStudentAvatarUrl(updatedProfile.avatar_url || null);
        setStudentAvatarKey(updatedProfile.avatar_key || null);
        if (updatedProfile.full_name) {
          setChild((current) => current ? { ...current, name: updatedProfile.full_name as string } : current);
        }
      }}
    />
  );

  const renderProfile = () => (
    <StudentProfileScreen
      navigation={navigation}
      onGoBack={() => navigateTo('home')}
      gradeLevel={child?.grade_level}
      readingLevel={progress?.level}
      onProfileChanged={(updatedProfile) => {
        setStudentAvatarUrl(updatedProfile.avatar_url || null);
        setStudentAvatarKey(updatedProfile.avatar_key || null);
        if (updatedProfile.full_name) {
          setChild((current) => current ? { ...current, name: updatedProfile.full_name as string } : current);
        }
      }}
    />
  );

  // Same unread-notification count that used to live in the header bell on
  // every tab - now surfaced only via the "Notifications" row in the sidebar.
  const unreadNotifCount = notifications.filter((n) => !(n.is_read ?? n.read)).length;
  // Same accuracy_sum/total_attempts formula as the Progress tab's "Overall
  // Reading Progress" ring - not a separately-computed version.
  const studentBottomItems: BottomNavItem[] = [
    { key: 'home', label: 'Simula', icon: 'home-outline' },
    { key: 'learn', label: 'Aralin', icon: 'library-outline' },
    { key: 'practice', label: 'Pagsasanay', icon: 'mic-outline' },
    { key: 'achievements', label: 'Parangal', icon: 'ribbon-outline' },
  ];
  const studentSidebarItems = [
    { key: 'profile', label: 'Aking Detalye', icon: 'person-outline', onPress: () => navigateTo('profile') },
    { key: 'notifications', label: 'Mga Abiso', icon: 'notifications-outline', badge: unreadNotifCount, onPress: () => navigateTo('notifications') },
    { key: 'settings', label: 'Mga Setting', icon: 'settings-outline', onPress: () => navigateTo('settings') },
    { key: 'help', label: 'Tulong', icon: 'help-circle-outline', onPress: contactSupportFromSidebar },
    { key: 'about', label: 'Tungkol Dito', icon: 'information-circle-outline', onPress: () => Alert.alert('Tungkol sa LinawLetra', 'Isang kasama sa pagbasa na dinisenyo upang tulungan ang bawat mag-aaral na umunlad nang may tiwala.') },
    { key: 'privacy', label: 'Pagkapribado', icon: 'shield-checkmark-outline', onPress: () => Linking.openURL('https://linawletra.app/privacy').catch(() => Alert.alert('Hindi Mabuksan', 'Hindi mabuksan ang Patakaran sa Pagkapribado.')) },
  ];

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
        <View style={styles.homeBg}>
          {/* Presentation-only Beginner Modules 1-5 surface. This replaces the
              old teacher-lesson-first Learn layout for the MVP, but it does
              not merge Badges, remove its nav item, or imply that B/K/D is
              the final Beginner curriculum. */}
          {/* Teacher assignments/PDF lessons restored (2026-08-14) -
              previously dropped entirely when the module path replaced the
              old Learn layout, leaving Home's "Continue Learning"/"Upcoming
              Deadlines" cards pointing at a dead end. Passed into
              StudentModules as topSection so it renders inside its scroll,
              after the hero header but before the module path list - not as
              a sibling before the header, and not buried below 17+ modules. */}
          <StudentModules
            firstName={getFirstName(child?.name || 'Mag-aaral')}
            onOpenSidebar={openSidebar}
            topSection={renderAssignmentsSection()}
            onPracticeItem={(item) => {
              setPracticeCategoryFilter(item.content_type as CurriculumPracticeType);
              setPracticeMode('listen');
              setSelectedWord(item.content_text);
              setSelectedContentId(item.content_id);
              setPracticeResult(null);
              setPracticeAttempts(0);
              setPracticeTranscript('');
              setPracticeStatus('Pindutin ang mikropono kapag handa ka na.');
              setSection('practice');
            }}
          />
        </View>
      ) : section === 'practice' ? (
        // renderPractice() now renders its own TabHeroHeader in every one of
        // its states (grid, "say", "listen") - each with the right variant
        // (menu vs back button) - so this branch needs no header of its own.
        <View style={styles.homeBg}>
          {renderPractice()}
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
      ) : section === 'profile' ? (
        <View style={styles.homeBg}>
          {renderProfile()}
        </View>
      ) : null}

      {section !== 'profile' && section !== 'settings' && section !== 'notifications' && (
        <DashboardBottomNav
          items={studentBottomItems}
          activeKey={section}
          onSelect={(key) => navigateTo(key as Section)}
        />
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
            colors={colors.heroGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sidebarProfileCard}
          >
            <TouchableOpacity style={styles.sidebarCloseButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={closeSidebar}>
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>
            <View style={styles.sidebarProfileRow}>
              {studentAvatarSource(studentAvatarKey, studentAvatarUrl) ? (
                <Image source={studentAvatarSource(studentAvatarKey, studentAvatarUrl)!} style={styles.sidebarAvatarWrap} resizeMode="contain" />
              ) : (
                <View style={styles.sidebarAvatarWrap}>
                  <Text style={styles.sidebarAvatarText}>{initials}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarProfileName} numberOfLines={1}>{child?.name || 'Estudyante'}</Text>
                <Text style={styles.sidebarProfileGrade}>Mag-aaral sa Baitang {child?.grade_level || '-'}</Text>
                <TouchableOpacity onPress={() => navigateTo('profile')}>
                  <Text style={styles.sidebarProfileLink}>Tingnan ang Profile ›</Text>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>

          <Text style={styles.sidebarSectionLabel}>MENU NG ESTUDYANTE</Text>
          {studentSidebarItems.map((item) => (
            <TouchableOpacity key={item.key} style={styles.navItem} onPress={item.onPress} activeOpacity={0.78}>
              <View style={styles.navIconWrap}>
                <Ionicons name={item.icon as any} size={20} color={colors.lavenderDark} />
              </View>
              <Text style={styles.navLabel}>{item.label}</Text>
              {!!item.badge && (
                <View style={styles.navCountBadge}>
                  <Text style={styles.navCountBadgeText}>{item.badge > 9 ? '9+' : item.badge}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
            </TouchableOpacity>
          ))}

          <Text style={styles.sidebarSectionLabel}>AKAWNT</Text>
          <TouchableOpacity style={[styles.sidebarLogout, loggingOut && { opacity: 0.65 }]} onPress={handleStudentLogout} disabled={loggingOut}>
            {loggingOut ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="log-out-outline" size={20} color="#fff" />}
            <Text style={styles.sidebarLogoutText}>{loggingOut ? 'Nag-lo-log out...' : 'Mag-log out'}</Text>
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
  const ringColor = score >= 85 ? colors.success : score >= 60 ? colors.warning : colors.danger;
  // Text-safe variant of ringColor - ringColor itself stays for the ring's
  // borderColor (non-text), this is for the score percentage Text below.
  const ringTextColor = score >= 85 ? colors.success : score >= 60 ? colors.warningText : colors.dangerText;
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
            <Text style={styles.accuracyLabel}>kawastuhan</Text>
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
          <Text style={styles.accuracyLabel}>kawastuhan</Text>
        </View>
      )}
      <Text style={styles.scoreCoachText}>{scoreMessage(score)}</Text>

      <View style={styles.comparisonBox}>
        <View style={styles.comparisonRow}>
          <Text style={styles.comparisonIcon}>🎤</Text>
          <Text style={styles.comparisonLabel}>Sinabi mo:</Text>
          <Text style={[styles.comparisonWord, { color: colors.dangerText }]}>&quot;{transcript || '—'}&quot;</Text>
        </View>
        <View style={styles.comparisonDivider} />
        <View style={styles.comparisonRow}>
          <Text style={styles.comparisonIcon}>✅</Text>
          <Text style={styles.comparisonLabel}>Tamang bigkas:</Text>
          <Text style={[styles.comparisonWord, { color: colors.success, fontWeight: '900' }]}>{word.toUpperCase()}</Text>
        </View>
      </View>

      <View style={[styles.xpPill, { backgroundColor: colors.warning }]}>
        <Text style={styles.xpPillText}>+{xpAward} XP 💛 (para sa pagsisikap!)</Text>
      </View>

      <View style={styles.resultButtons}>
        <TouchableOpacity style={styles.listenAgainButton} onPress={onReplay}>
          <Ionicons name="volume-high-outline" size={18} color={colors.lavenderDark} />
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
  // --- Progress tab (accent: colors.success green — "growth over time") ---
  progressStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  progressStatCard: {
    width: '48%', borderRadius: radius.lg, padding: 14, alignItems: 'flex-start', minHeight: 84, justifyContent: 'center',
    ...shadows.card,
  },
  progressStatIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  progressStatValue: { fontFamily: typography.family.displaySemi, fontSize: 20, marginTop: 2 },
  progressStatLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '700', marginTop: 2, lineHeight: 14 },
  progressStreakBestPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, marginTop: 6,
  },
  progressStreakBestText: { color: colors.ink, fontWeight: '800', fontSize: 10 },
  progressHeroCard: {
    backgroundColor: '#fff', borderRadius: 28, padding: 20, alignItems: 'center', marginBottom: 20,
    ...shadows.raised,
  },
  progressHeroTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 18, textAlign: 'center', marginBottom: 4 },
  progressOverallRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 14, width: '100%' },
  progressOverallCol: { flex: 1, gap: 8 },
  progressOverallStatCard: { width: '100%', minHeight: 76, padding: 10 },
  progressRingShadowWrap: {
    shadowColor: colors.lavenderDark, shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  progressHeroRingPct: { fontFamily: typography.family.display, color: colors.lavenderDark, fontSize: 28 },
  progressHeroRingLabel: { color: colors.inkSoft, fontWeight: '700', fontSize: 11, marginTop: 2 },
  progressHeroLabel: { color: colors.ink, fontWeight: '800', fontSize: 14, marginBottom: 8 },
  progressHeroStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F5F3FC',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
  },
  progressHeroStatusText: { fontWeight: '800', fontSize: 13 },
  progressHeroEmptyText: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  progressSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 12 },
  progressSectionIconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  progressSectionTitleText: { marginTop: 0, marginBottom: 0 },
  progressChartCard: {
    backgroundColor: '#fff', borderRadius: radius.xl, padding: 16, marginBottom: 20,
    ...shadows.card,
  },
  progressChartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  progressChartTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 16 },
  progressChartBars: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 150, gap: 6, paddingHorizontal: 4,
  },
  progressChartBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  progressChartBarValue: { fontSize: 10, fontWeight: '900', marginBottom: 4 },
  progressChartBar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8, minWidth: 10 },
  progressChartDayRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 6 },
  progressChartDayLabel: { flex: 1, textAlign: 'center', color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  progressChartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  progressLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressLegendDot: { width: 8, height: 8, borderRadius: 4 },
  progressLegendText: { color: colors.inkSoft, fontSize: 11, fontWeight: '700' },
  progressTrendMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  progressTrendMsgText: { color: colors.inkSoft, fontWeight: '700', fontSize: 12 },
  progressChartEmpty: { alignItems: 'center', paddingVertical: 24 },
  progressChartEmptyText: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  skillsCard: {
    backgroundColor: '#fff', borderRadius: radius.xl, padding: 16, marginBottom: 20,
    ...shadows.card,
  },
  skillRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  skillIconWrap: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.ink, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  skillTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  skillLabel: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  skillTagPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  skillTagText: { fontWeight: '800', fontSize: 11 },
  skillTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden' },
  skillTrackFill: { height: '100%', borderRadius: 5 },
  skillPct: { color: colors.inkSoft, fontWeight: '800', fontSize: 12, minWidth: 34, textAlign: 'right' },
  progressMonthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  progressPbBadge: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: XP_GOLD, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3,
  },
  progressPbBadgeText: { color: '#fff', fontWeight: '900', fontSize: 9 },
  progressWordsCard: {
    backgroundColor: 'rgba(124,111,207,0.08)', borderRadius: radius.xl, padding: 16,
    ...shadows.card, shadowColor: colors.lavenderDark,
  },
  progressWordsTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 15, marginBottom: 10 },
  progressWordsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  progressWordChip: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  progressWordChipText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 13 },
  progressWordsMore: { color: colors.inkSoft, fontWeight: '700', fontSize: 12, marginLeft: 2 },
  progressWordsEmpty: { color: colors.inkSoft, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#111827', marginTop: 18, marginBottom: 10 },
  badgeRow: { gap: 10, paddingBottom: 4 },
  // --- Badges tab (accent: lavender, ties into Home's achievement showcase) ---
  // 1280x1920 in the source art (own ratio group, distinct from
  // learn.png/book.png and singing.png/learn2.png).
  badgesHeroImage: { position: 'absolute', right: -2, bottom: -10, width: 154, height: 231 },
  achievementSummaryCard: {
    backgroundColor: '#fff', borderRadius: 28, padding: 20, marginBottom: 20,
    ...shadows.raised,
  },
  achievementSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 14 },
  achievementSummaryLeftCol: { flex: 1 },
  achievementSummaryLabel: { color: colors.inkSoft, fontWeight: '700', fontSize: 13, marginBottom: 4 },
  achievementSummaryCount: { fontFamily: typography.family.display, color: colors.lavenderDark, fontSize: 32 },
  achievementSummaryCountTotal: { fontFamily: typography.family.displaySemi, color: colors.inkSoft, fontSize: 18 },
  achievementSummaryHint: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 4, maxWidth: '90%' },
  achievementFeaturedCallout: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF3DC',
    borderRadius: radius.md, padding: 14, width: '100%',
    ...shadows.card,
  },
  achievementFeaturedImage: { width: 50, height: 50 },
  achievementFeaturedTitle: { color: colors.ink, fontWeight: '900', fontSize: 14, marginBottom: 2 },
  achievementFeaturedDesc: { color: colors.inkSoft, fontWeight: '600', fontSize: 12 },
  spotlightEyebrow: { color: colors.lavenderDark, fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  spotlightHint: { color: colors.inkSoft, fontWeight: '700', fontSize: 12, marginTop: 10, marginBottom: 4 },
  badgesCelebrateBanner: {
    borderRadius: 28, padding: 20, marginBottom: 20, overflow: 'hidden',
    ...shadows.hero,
  },
  // 1184x2096 in the source art (same ratio group as learn.png/book.png).
  badgesCelebrateImage: { position: 'absolute', right: 10, top: 8, width: 84, height: 147 },
  badgesCelebrateTitle: { fontFamily: typography.family.display, color: '#fff', fontSize: 20, marginBottom: 4 },
  badgesCelebrateSub: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  badgesNextCard: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.md, padding: 14, marginBottom: 14 },
  badgesNextLabel: { color: 'rgba(255,255,255,0.85)', fontWeight: '800', fontSize: 11, marginBottom: 3 },
  badgesNextTitle: { color: '#fff', fontWeight: '900', fontSize: 15, marginBottom: 2 },
  badgesNextDetail: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 12 },
  badgesCelebrateButton: { backgroundColor: '#fff', borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  badgesCelebrateButtonText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 14 },
  badgesFilterRow: { marginBottom: 16 },
  badgesFilterChip: {
    backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 13, marginRight: 8,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  badgesFilterChipActive: { backgroundColor: colors.lavender },
  badgesFilterChipText: { color: colors.inkSoft, fontWeight: '800', fontSize: 13 },
  badgesFilterChipTextActive: { color: '#fff' },
  badgesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  badgeCard: {
    width: '48%', backgroundColor: '#F5F3FC', borderRadius: radius.lg, padding: 14,
    alignItems: 'center', marginBottom: 14,
    ...shadows.card,
  },
  badgeCardLocked: { backgroundColor: '#F3F4F6' },
  badgeLockIcon: {
    position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(59,50,44,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  badgeImage: { width: 80, height: 80 },
  badgeImageLocked: { opacity: 0.45 },
  badgeTitle: { textAlign: 'center', fontWeight: '800', color: colors.ink, marginTop: 8, fontSize: 13 },
  badgeCondition: { textAlign: 'center', color: colors.inkSoft, fontSize: 12, marginTop: 8, lineHeight: 16 },
  badgeUnlockedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.success,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8,
  },
  badgeUnlockedPillText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  badgeEarnedDate: { color: colors.inkSoft, fontWeight: '600', fontSize: 11, marginTop: 5 },
  badgeLockedPill: {
    backgroundColor: 'rgba(59,50,44,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8,
  },
  badgeLockedPillText: { color: colors.inkSoft, fontWeight: '800', fontSize: 11 },
  badgeProgressWrap: { width: '100%', marginTop: 8, alignItems: 'center' },
  badgeProgressTrack: {
    width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(59,50,44,0.12)', overflow: 'hidden', marginBottom: 4,
  },
  badgeProgressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.sage },
  badgeProgressText: { color: colors.inkSoft, fontWeight: '800', fontSize: 11 },
  spotlightCard: { backgroundColor: '#fff', borderRadius: radius.xl, padding: 18, marginBottom: 20, ...shadows.card },
  spotlightTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 16, marginBottom: 12 },
  spotlightRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  spotlightImage: { width: 62, height: 62 },
  spotlightBadgeTitle: { color: colors.ink, fontWeight: '900', fontSize: 15, marginBottom: 4 },
  spotlightProgressText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12, marginBottom: 6 },
  spotlightTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden' },
  spotlightFill: { height: '100%', borderRadius: 4, backgroundColor: colors.lavender },
  spotlightButton: { backgroundColor: colors.lavender, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  spotlightButtonText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  uploadBody: { flex: 1 },
  // --- Learn tab (assignments = lavender family, PDF lessons = sage family) ---
  assignmentsSectionWrap: {
    paddingBottom: 10, marginBottom: 6,
    borderBottomWidth: 1, borderBottomColor: '#E9E4F2',
  },
  learnSectionHeader: { marginTop: 8, marginBottom: 14 },
  learnBadgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 8,
  },
  learnBadgeText: { fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  learnSectionSubtitle: { color: colors.inkSoft, fontWeight: '600', fontSize: 13 },
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
  learnItemTitle: { color: colors.ink, fontWeight: '900', fontSize: 15 },
  learnItemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  learnStatusDot: { width: 8, height: 8, borderRadius: 4 },
  learnItemMeta: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
  learnItemDescription: { color: colors.inkSoft, fontSize: 13, marginTop: 6 },
  learnStatusBadge: { fontWeight: '900', fontSize: 12 },
  learnActionButton: { backgroundColor: colors.lavender, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  learnActionButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  learnEmptyCard: {
    alignItems: 'center', borderRadius: radius.xl, paddingVertical: 32, paddingHorizontal: 20, marginBottom: 8,
    ...shadows.card,
  },
  learnEmptyIconWrap: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  learnEmptyTitle: { color: colors.ink, fontWeight: '900', fontSize: 16, marginBottom: 6, textAlign: 'center' },
  learnEmptySubtext: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  learnMarkDoneText: { color: colors.inkSoft, fontWeight: '700', fontSize: 12, textDecorationLine: 'underline' },
  learnContinueCard: {
    backgroundColor: colors.sage, borderRadius: radius.xl, padding: 18, minHeight: 158,
    ...shadows.raised, shadowColor: colors.sage,
    position: 'relative', overflow: 'hidden',
  },
  learnContinueCopy: { maxWidth: '72%', flex: 1, justifyContent: 'center' },
  learnContinuePill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10,
  },
  learnContinuePillText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 },
  learnContinueTitle: { fontFamily: typography.family.display, color: '#fff', fontSize: 19, marginBottom: 4 },
  learnContinueSub: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 13, marginBottom: 14, lineHeight: 18 },
  learnContinueButton: {
    alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11,
  },
  learnContinueButtonText: { color: colors.sage, fontWeight: '900', fontSize: 14 },
  learnFilterRow: { marginBottom: 14 },
  learnFilterChip: {
    backgroundColor: '#F1F6ED', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginRight: 8,
  },
  learnFilterChipActive: { backgroundColor: colors.sage },
  learnFilterChipText: { color: colors.inkSoft, fontWeight: '800', fontSize: 13 },
  learnFilterChipTextActive: { color: '#fff' },
  learnJourneyCard: {
    backgroundColor: '#F5F3FC', borderRadius: radius.xl, padding: 18, marginTop: 8, marginBottom: 8,
    ...shadows.card,
  },
  learnJourneyTitle: { color: colors.ink, fontWeight: '900', fontSize: 15, marginBottom: 6 },
  learnJourneyLevel: { fontFamily: typography.family.display, color: colors.lavenderDark, fontSize: 20, marginBottom: 10 },
  learnJourneyTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden', marginBottom: 8 },
  learnJourneyFill: { height: '100%', borderRadius: 5, backgroundColor: colors.lavender },
  learnJourneyMsg: { color: colors.inkSoft, fontWeight: '600', fontSize: 13 },
  learnHeroImage: { position: 'absolute', right: -2, bottom: -10, width: 132, height: 233 },
  // 1184x2096 in the source art (same ratio group as learn.png/book.png) -
  // sized to that real aspect ratio, not the 1120x2240 group's heroImage box.
  progressHeroImage: { position: 'absolute', right: -2, bottom: -10, width: 132, height: 233 },
  learnProgressCard: {
    backgroundColor: '#fff', borderRadius: radius.xl, padding: 18, marginBottom: 20,
    ...shadows.raised,
  },
  learnProgressTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  learnProgressTitle: { fontFamily: typography.family.display, color: colors.ink, fontSize: 16 },
  learnProgressPct: { fontFamily: typography.family.display, color: colors.lavenderDark, fontSize: 18 },
  learnProgressCount: { color: colors.inkSoft, fontWeight: '700', fontSize: 13, marginBottom: 12 },
  learnProgressTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden', marginBottom: 10 },
  learnProgressMsg: { color: colors.lavenderDark, fontWeight: '700', fontSize: 13 },

  lessonStepList: { marginBottom: 8 },
  lessonStepRow: { flexDirection: 'row', gap: 12 },
  lessonStepRail: { width: 24, alignItems: 'center' },
  lessonStepDot: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
    borderWidth: 2, borderColor: 'rgba(124,111,207,0.35)', alignItems: 'center', justifyContent: 'center',
  },
  lessonStepDotDone: { backgroundColor: colors.vivid.green, borderColor: colors.vivid.green },
  lessonStepDotActive: { backgroundColor: colors.heroGradient[1], borderColor: colors.heroGradient[1] },
  lessonStepLine: { flex: 1, width: 2, backgroundColor: 'rgba(124,111,207,0.25)', marginVertical: 2, minHeight: 24 },
  lessonStepCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 18, padding: 14, marginBottom: 14,
  },
  lessonStepCardDone: { backgroundColor: '#EAF7EE' },
  lessonStepCardMuted: { backgroundColor: '#F1EFF9' },
  lessonStepCardActive: {},
  lessonStepBody: { flex: 1 },
  lessonStepTitle: { color: colors.ink, fontWeight: '900', fontSize: 14 },
  lessonStepTitleLight: { color: '#fff' },
  lessonStepMeta: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 2 },
  lessonStepMetaLight: { color: 'rgba(255,255,255,0.85)' },
  lessonStepButtonGhost: { backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  lessonStepButtonGhostText: { color: colors.inkSoft, fontWeight: '800', fontSize: 12 },
  lessonStepButtonLight: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  lessonStepButtonLightText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 12 },
  lessonStepMarkDoneLight: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 11, textDecorationLine: 'underline' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  // overflow:'hidden' deliberately lives on categoryTipCard, not here - iOS
  // clips a view's own shadow when overflow:hidden sits on the same style
  // object, and only the Reading Tip variant actually needs the clip (for
  // its bleeding categoryTipImage). Keeping it off the shared base lets the
  // other 3 grid cards render shadows.card correctly on iOS too.
  categoryCard: {
    width: '47%', borderRadius: radius.lg, padding: 16, minHeight: 118,
    position: 'relative',
    ...shadows.card,
  },
  categoryTipCard: { position: 'relative', overflow: 'hidden' },
  categoryIconWrap: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  categoryTitle: { color: colors.ink, fontWeight: '900', fontSize: 15, marginBottom: 4 },
  categorySub: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, lineHeight: 16 },
  categoryTipImage: { position: 'absolute', right: 4, bottom: -8, width: 66, height: 116 },

  learnSupportStack: { gap: 12, marginBottom: 8 },
  learnSupportCard: {
    minHeight: 118, borderRadius: radius.lg, padding: 16, paddingRight: 76,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    ...shadows.card,
  },
  learnSupportCopy: { flex: 1, minWidth: 0 },
  learnContinueImage: { position: 'absolute', right: 8, bottom: -12, width: 80, height: 158 },
  learnGoalCard: {
    backgroundColor: colors.lavenderDark, borderRadius: 24, padding: 18,
    shadowColor: colors.lavenderDark, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  learnGoalTitle: { fontFamily: typography.family.display, color: '#fff', fontSize: 15, marginBottom: 4 },
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
  // Cream/lavender-tinted placeholders (matching homeHeroCard's own cream +
  // lavender-border language) instead of flat off-palette gray, plus the
  // opacity breathe from skeletonOpacity above - so the loading moment reads
  // as "this app, still warming up" rather than a generic gray placeholder.
  skeletonCard: { width: '92%', height: 180, borderRadius: radius.md, backgroundColor: colors.cream, borderWidth: 1, borderColor: 'rgba(124,111,207,0.18)', marginBottom: 16 },
  skeletonLine: { width: '82%', height: 16, borderRadius: 8, backgroundColor: 'rgba(124,111,207,0.16)', marginBottom: 10 },
  skeletonLineShort: { width: '45%', height: 16, borderRadius: 8, backgroundColor: 'rgba(124,111,207,0.16)', marginBottom: 22 },
  skeletonGrid: { width: '92%', flexDirection: 'row', justifyContent: 'space-between' },
  skeletonBlock: { width: '48%', height: 100, borderRadius: 14, backgroundColor: 'rgba(124,111,207,0.12)' },
  practicePanel: { marginTop: 18, padding: 16, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  practiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  practiceTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  practiceClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  practiceCloseText: { color: '#6B7280', fontWeight: '800' },
  practiceSubtitle: { color: '#6B7280', marginBottom: 12 },
  resultCard: {
    marginTop: 20, borderRadius: 24, padding: 20, alignItems: 'center',
    shadowColor: colors.ink, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  correctCard: { backgroundColor: '#EAF7EE' },
  wrongCard: { backgroundColor: '#FFF3DC' },
  resultEmoji: { fontSize: 28, textAlign: 'center', marginBottom: 8 },
  resultTitle: { fontFamily: typography.family.display, fontSize: 19, textAlign: 'center', color: colors.ink },
  resultTranscript: { color: '#6B7280', fontSize: 13, marginTop: 10, textAlign: 'center' },
  resultScore: { marginTop: 8, color: colors.primary, fontWeight: '700', textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 18 },
  modalCard: { backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  close: { alignSelf: 'flex-end', padding: 8 },
  // Tinted indigo scrim (matches the drawer's own palette) instead of flat black
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(30,23,66,0.6)' },
  sidebar: {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: SIDEBAR_WIDTH,
    backgroundColor: colors.cream, paddingTop: 48, zIndex: 100,
    shadowColor: '#000', shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 20,
  },
  sidebarScrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  sidebarProfileCard: {
    borderRadius: 24, padding: 18, marginBottom: 16, position: 'relative',
    shadowColor: colors.lavenderDark, shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  sidebarCloseButton: {
    position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  sidebarProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 24 },
  sidebarAvatarWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  sidebarAvatarText: { fontSize: 26, fontWeight: '900', color: '#fff' },
  sidebarProfileName: { fontFamily: typography.family.displaySemi, fontSize: 16, color: '#fff' },
  sidebarProfileGrade: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 12, marginTop: 2 },
  sidebarProfileLink: { color: '#fff', fontWeight: '900', fontSize: 12, marginTop: 6, textDecorationLine: 'underline' },
  sidebarLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, paddingHorizontal: 2 },
  sidebarLogoIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.lavenderDark,
    alignItems: 'center', justifyContent: 'center',
  },
  sidebarLogoText: { fontFamily: typography.family.display, fontSize: 16, color: colors.ink },
  sidebarLogoTagline: { color: colors.inkSoft, fontWeight: '700', fontSize: 10.5, marginTop: 1 },
  sidebarSectionLabel: {
    color: colors.inkSoft, fontWeight: '900', fontSize: 11, letterSpacing: 0.8,
    marginBottom: 8, marginTop: 4, paddingHorizontal: 2,
  },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
    marginBottom: 6, backgroundColor: '#fff',
    shadowColor: colors.ink, shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  navItemActive: { backgroundColor: '#EFECFB' },
  navIconWrap: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F3FC',
  },
  navIconWrapActive: { backgroundColor: '#fff' },
  navLabel: { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1 },
  navLabelActive: { color: colors.lavenderDark, fontWeight: '900' },
  navCountBadge: {
    backgroundColor: colors.danger, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  navCountBadgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  navFractionPill: { backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  navFractionPillText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 10.5 },
  sidebarProgressCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16, overflow: 'hidden',
    shadowColor: colors.ink, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  sidebarProgressTitle: { color: colors.ink, fontWeight: '800', fontSize: 13, maxWidth: '72%' },
  sidebarProgressPct: { fontFamily: typography.family.displaySemi, color: colors.lavenderDark, fontSize: 20, marginTop: 4, maxWidth: '72%' },
  sidebarProgressTrack: {
    height: 8, borderRadius: 4, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden',
    marginTop: 10, maxWidth: '72%',
  },
  sidebarProgressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.lavenderDark },
  sidebarProgressMsg: { color: colors.inkSoft, fontWeight: '700', fontSize: 11, marginTop: 8, maxWidth: '72%' },
  // 1120x2240 in the source art (same ratio group as singing.png/learn2.png) -
  // "peeking" from the bottom-right corner of the mini progress card.
  sidebarProgressImage: { position: 'absolute', right: -7, bottom: -11, width: 78, height: 154 },
  sidebarQuickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 14, padding: 12, marginBottom: 8,
    shadowColor: colors.ink, shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  sidebarQuickIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sidebarQuickLabel: { color: colors.ink, fontWeight: '700', fontSize: 14, flex: 1 },
  sidebarAccessibilityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E9F1E2',
    borderRadius: 16, padding: 14, marginTop: 4, marginBottom: 16,
  },
  sidebarAccessibilityTitle: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  sidebarAccessibilitySub: { color: colors.inkSoft, fontWeight: '600', fontSize: 11, marginTop: 2 },
  sidebarLogout: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 15, borderRadius: 14, backgroundColor: colors.danger,
  },
  sidebarLogoutText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  // --- Home tab ---
  homeBg: { flex: 1, width: '100%', backgroundColor: '#EEF0FA' },
  homeContent: { padding: 18, paddingBottom: 48 },
  homeErrorBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(240,150,125,0.16)', borderWidth: 1.5, borderColor: colors.coral,
    borderRadius: 20, padding: 14, marginBottom: 16,
  },
  homeBannerEmoji: { fontSize: 20 },
  homeErrorText: { color: colors.ink, fontWeight: '700', marginBottom: 8 },
  homeBannerButton: {
    alignSelf: 'flex-start', backgroundColor: colors.coral,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
  },
  homeBannerButtonText: { color: '#fff', fontWeight: '800' },
  heroBanner: { borderRadius: 28, padding: 22, marginBottom: 20, overflow: 'hidden', position: 'relative', minHeight: 200 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  heroLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLogoText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  heroGreeting: { color: '#fff', fontSize: typography.size.hero, fontFamily: typography.family.display, lineHeight: 29, maxWidth: '68%' },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600', marginTop: 8, maxWidth: '62%' },
  // 1:2 aspect ratio in the source art (1120x2240) - sized as a tall
  // rectangle so the full character shows with no cropping, anchored to
  // bleed slightly past the card's bottom-right corner (heroBanner's
  // overflow:hidden clips it cleanly, matching the reference).
  heroImage: { position: 'absolute', right: -2, bottom: -14, width: 124, height: 246 },
  readyPracticeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FBE7DF', borderRadius: radius.xl, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(224,107,76,0.15)',
    ...shadows.card,
  },
  readyPracticeIconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#EFECFB',
    alignItems: 'center', justifyContent: 'center',
  },
  readyPracticeTitle: { fontFamily: typography.family.display, color: colors.ink, fontSize: 16, marginBottom: 4 },
  readyPracticeSub: { color: colors.inkSoft, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  readyPracticeButton: {
    backgroundColor: colors.lavender, borderRadius: 999, paddingHorizontal: 16,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  readyPracticeButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  homeRecentActivityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#EEE9F9',
    ...shadows.card,
  },
  homeRecentActivityIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  homeRecentActivityTitle: { fontWeight: '800', color: colors.ink, fontSize: 14 },
  homeRecentActivityDetail: { color: colors.inkSoft, fontSize: 12, fontWeight: '600', marginTop: 2 },
  homeRecentActivityTime: { color: colors.inkSoft, fontSize: 11, fontWeight: '600' },
  homeRecentActivityEmpty: { alignItems: 'center', paddingVertical: 20, marginBottom: 8 },
  homeRecentActivityEmptyText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  homeTodayCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3DC', borderRadius: radius.xl, padding: 18, marginBottom: 16,
    ...shadows.raised,
  },
  homeTodayTitle: { fontFamily: typography.family.display, color: colors.ink, fontSize: 19, lineHeight: 24 },
  homeTodayStatLine: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, marginTop: 8, marginBottom: 14 },
  homeTodayButton: {
    backgroundColor: colors.lavender, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, alignSelf: 'flex-start',
  },
  homeTodayButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  homeTodayRingPct: { fontFamily: typography.family.displaySemi, color: colors.lavenderDark, fontSize: 18 },
  homeTodayRingLabel: { color: colors.inkSoft, fontWeight: '700', fontSize: 10 },
  homeStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  homeGridCard: {
    width: '48%', borderRadius: radius.lg, padding: 14, minHeight: 92, justifyContent: 'center',
    ...shadows.card,
  },
  homeGridIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  homeGridValue: { fontFamily: typography.family.display, fontSize: 20, marginTop: 8 },
  homeGridLabel: { color: colors.inkSoft, fontWeight: '700', fontSize: 12, marginTop: 2 },
  homeContinueCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFECFB', borderRadius: radius.lg, padding: 16, marginBottom: 16, gap: 12,
    ...shadows.card,
  },
  homeContinueTitle: { fontFamily: typography.family.display, color: colors.ink, fontSize: 15 },
  homeContinueSubtitle: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 2, marginBottom: 10 },
  homeContinueTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeContinueTrack: { flex: 1, backgroundColor: 'rgba(124,111,207,0.2)', height: 8, borderRadius: 999, overflow: 'hidden' },
  homeContinueFill: { backgroundColor: colors.lavender, height: 8, borderRadius: 999 },
  homeContinuePct: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12 },
  homeContinueButton: { backgroundColor: colors.lavender, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  homeContinueButtonText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  // Source art is a tall 1:2 character illustration (1120x2240), not a
  // square headshot - a plain "cover" crop centers vertically and risks
  // cutting off the character's head/face. Instead the wrap clips a fixed
  // square, and the image inside is pinned to the top at its natural
  // width-scaled height (2x the box width, matching the real ratio), so it
  // crops the bottom off instead of the middle and keeps the head visible.
  homeContinueImageWrap: { width: 52, height: 52, borderRadius: 14, overflow: 'hidden', backgroundColor: '#fff' },
  homeContinueImage: { width: 58, height: 114, position: 'absolute', top: 0, left: 0 },
  homeContinueLessonCount: { color: colors.lavenderDark, fontWeight: '700', fontSize: 11, marginBottom: 8 },
  homeHeroCard: {
    backgroundColor: colors.cream, borderRadius: radius.xl, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(124,111,207,0.18)',
    ...shadows.raised,
  },
  homeHeroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  homeHeroBadge: {
    backgroundColor: colors.lavender, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  homeHeroBadgeText: { color: '#fff', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },
  homeHeroStreakPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.sun,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  homeHeroStreakText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.3 },
  homeHeroSub: { color: colors.inkSoft, fontWeight: '600', textAlign: 'center', marginBottom: 4, fontSize: 13 },
  homeHeroEmptyEmoji: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  homeHeroEmptyText: { color: colors.inkSoft, textAlign: 'center', fontWeight: '600' },
  homePracticeSectionTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 16, marginBottom: 10 },
  homePracticeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 18, padding: 14, marginBottom: 10, minHeight: 60,
  },
  homePracticeIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  homePracticeRowTitle: { fontWeight: '800', color: colors.ink, fontSize: 14 },
  homePracticeRowSubtitle: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 2 },
  homeQuoteBanner: {
    position: 'relative', overflow: 'hidden',
    backgroundColor: '#FFF3DC', borderRadius: 20, paddingVertical: 18, paddingLeft: 18, paddingRight: 84,
    marginTop: 4, marginBottom: 16, minHeight: 130, justifyContent: 'center',
  },
  homeQuoteText: { color: '#8A6416', fontWeight: '800', fontSize: 14, textAlign: 'left', lineHeight: 20, fontStyle: 'italic' },
  // Full-character, no-crop treatment, bleeding past the banner's
  // bottom-right corner (clipped by overflow:hidden there, by design). The
  // banner's minHeight must stay >= this image's height + |bottom offset|
  // (with a little headroom), or the character's head gets clipped by the
  // banner's own top edge instead of a clean corner bleed - the bug this
  // was fixing (image was 150 tall inside a 90-tall box).
  homeQuoteImage: { position: 'absolute', right: -4, bottom: -12, width: 64, height: 128 },
  homeQuickRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  homeQuickCard: {
    flex: 1, borderRadius: 20, paddingVertical: 16, alignItems: 'center', minHeight: 88, justifyContent: 'center',
  },
  homeQuickIconWrap: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  homeQuickLabel: { fontWeight: '800', color: colors.ink, fontSize: 13 },
  homeDeadlinesCard: {
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 20, padding: 16,
  },
  homeDeadlinesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  homeDeadlinesTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 16 },
  homeDeadlinesLink: { color: colors.lavenderDark, fontWeight: '800', fontSize: 13 },
  homeDeadlinesEmpty: { alignItems: 'center', paddingVertical: 14 },
  homeDeadlinesEmptyEmoji: { fontSize: 28, marginBottom: 6 },
  homeDeadlinesEmptyText: { color: colors.inkSoft, textAlign: 'center', fontWeight: '600', fontSize: 13 },
  // --- Notifications tab ---
  // Padding gives the negative-offset dot room inside this wrapper's own
  // bounding box instead of poking outside it - on Android, a
  // position:'absolute' sibling offset outside its parent's own measured
  // bounds was silently not rendering (parent had no explicit size beyond
  // the bare icon glyph), which is why the sidebar's unread badge showed
  // the correct count while this dot never appeared despite reading the
  // exact same unreadNotifCount value.
  heroMenuIconWrap: { padding: 4, position: 'relative' },
  heroMenuDot: {
    position: 'absolute', top: 0, right: 0, width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.heroGradient[0],
    zIndex: 10, elevation: 10,
  },
  // 1184x2096 in the source art (same ratio group as learn.png/book.png).
  notifHeroImage: { position: 'absolute', right: -2, bottom: -10, width: 132, height: 233 },
  notifSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 24, padding: 16, marginBottom: 16,
    shadowColor: colors.ink, shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  notifSummaryIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  notifSummaryTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 15 },
  notifSummarySub: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 3 },
  notifMarkAllButton: {
    backgroundColor: '#F5F3FC', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 13,
    minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  notifMarkAllButtonText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 11 },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: 18, padding: 14,
    shadowColor: colors.ink, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1,
  },
  notifCardUnread: { backgroundColor: '#F5F3FC' },
  notifIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lavender },
  notifTitle: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  notifBody: { color: colors.inkSoft, fontSize: 13, marginTop: 4, lineHeight: 18 },
  notifDate: { color: colors.inkSoft, fontSize: 11, fontWeight: '600', marginTop: 6 },
  notifActionButton: {
    flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: 8,
    paddingVertical: 10, paddingHorizontal: 2, minHeight: 44,
  },
  notifActionButtonText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 12 },
  notifEmptyCard: { alignItems: 'center', paddingVertical: 40 },
  notifEmptyText: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  bigWord: { fontSize: 48, fontWeight: '900', color: colors.primary, marginVertical: 10 },
  listenButton: { marginTop: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.primary },
  // Practice feedback styles
  goalCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 20,
    ...shadows.card,
  },
  goalTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 17 },
  goalCount: { color: colors.lavenderDark, fontWeight: '900' },
  goalCountEmpty: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12 },
  goalTrack: { height: 12, borderRadius: 6, backgroundColor: 'rgba(124,111,207,0.15)', overflow: 'hidden', marginTop: 14 },
  goalTrackFill: { height: '100%', borderRadius: 6, backgroundColor: colors.lavender },
  goalEmptyNote: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 10 },
  practiceSectionTitle: { fontFamily: typography.family.display, color: colors.ink, fontSize: 16, marginBottom: 12, marginTop: 4 },
  aiRecommendationCard: { backgroundColor: '#F8F7FF', borderWidth: 1, borderColor: '#D9D4F4', borderRadius: radius.md, padding: 14, marginBottom: 14, ...shadows.card },
  aiRecommendationTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiRecommendationIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  aiRecommendationWord: { color: colors.lavenderDark, fontWeight: '900', fontSize: 19 },
  aiRecommendationWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  trackPill: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#D9D4F4' },
  trackPillText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 10 },
  aiRecommendationReason: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, lineHeight: 17, marginTop: 2 },
  aiRecommendationFocus: { color: colors.ink, fontWeight: '700', fontSize: 12, marginTop: 10 },
  aiConfidencePill: { minWidth: 66, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 7, alignItems: 'center' },
  aiConfidenceValue: { color: colors.lavenderDark, fontWeight: '900', fontSize: 15 },
  aiConfidenceLabel: { color: colors.inkSoft, fontWeight: '700', fontSize: 9 },
  categoryFilterBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#EFECFB', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 14,
  },
  categoryFilterBarText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 13 },
  categoryFilterBarReset: { color: colors.lavenderDark, fontWeight: '900', fontSize: 13, textDecorationLine: 'underline' },
  practiceModeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: radius.lg, padding: 14, marginBottom: 12,
    ...shadows.card,
  },
  practiceModeCardDisabled: { opacity: 0.6 },
  practiceModeIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  practiceModeTitle: { color: colors.ink, fontWeight: '900', fontSize: 15 },
  practiceModeSub: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginTop: 3, lineHeight: 17 },
  practiceModeTag: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8 },
  practiceModeTagText: { fontWeight: '800', fontSize: 11 },
  practiceModeStartPill: { backgroundColor: colors.lavender, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11 },
  practiceModeStartText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  listenNextButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'center', backgroundColor: '#E9F1E2', borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 12, marginTop: 16,
  },
  listenNextButtonText: { color: colors.sage, fontWeight: '900', fontSize: 14 },
  listenButtonRow: { flexDirection: 'row', gap: 10, width: '100%' },
  practiceStatsCard: { backgroundColor: '#F5F3FC', borderRadius: radius.xl, padding: 18, marginTop: 8, marginBottom: 8, ...shadows.card },
  practiceStatsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  practiceStatsCol: { alignItems: 'center', flex: 1, gap: 4 },
  practiceStatsValue: { color: colors.ink, fontWeight: '900', fontSize: 16 },
  practiceStatsLabel: { color: colors.inkSoft, fontWeight: '600', fontSize: 11, textAlign: 'center' },
  rewardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  rewardPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, paddingRight: 12 },
  rewardIconWrap: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rewardText: { fontWeight: '900', fontSize: 12 },
  practiceHero: {
    backgroundColor: '#fff',
    borderRadius: radius.xl,
    padding: 22,
    alignItems: 'center',
    marginBottom: 8,
    ...shadows.raised,
  },
  practiceMoodBadge: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  practicePrompt: { color: colors.inkSoft, fontWeight: '900', textTransform: 'uppercase', fontSize: 12, marginBottom: 4, letterSpacing: 0.5 },
  practiceCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  practiceWordDisplay: {
    fontSize: 52, color: colors.lavenderDark,
    letterSpacing: 0, textAlign: 'center', marginBottom: 6,
    fontFamily: typography.family.display,
  },
  practiceWordDisplayWide: {
    textAlign: 'left', alignSelf: 'stretch', lineHeight: 28,
  },
  practiceSyllables: { color: colors.lavenderDark, fontSize: 16, fontWeight: '900', marginBottom: 14 },
  practiceWordLevel: {
    textAlign: 'center', color: colors.inkSoft, fontSize: 13,
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
  listenCoachText: { color: colors.lavenderDark, fontWeight: '900' },
  sayWordButton: {
    width: '100%',
    minHeight: 68,
    borderRadius: 20,
    backgroundColor: colors.lavender,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: colors.lavender,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  sayWordButtonListening: { backgroundColor: colors.danger },
  listenButtonActive: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  sayWordButtonText: { color: '#fff', fontWeight: '900', fontSize: 20 },
  practiceStatus: { color: colors.ink, textAlign: 'center', fontWeight: '800', marginTop: 14 },
  practiceTranscript: { color: colors.inkSoft, textAlign: 'center', marginTop: 8, fontWeight: '700' },

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
    backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0px 0px 14px rgba(95,82,176,0.35)' },
      default: { shadowColor: colors.lavenderDark, shadowOpacity: 0.35, shadowRadius: 14 },
    }),
  },
  micButtonRecording: {
    backgroundColor: colors.danger,
    ...Platform.select({
      web: { boxShadow: '0px 0px 14px rgba(239,68,68,0.35)' },
      default: { shadowColor: colors.danger },
    }),
  },
  micTimerText: { color: colors.dangerText, fontWeight: '900', fontSize: 13, marginTop: 8 },

  heroBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  heroBackText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  practiceProgressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  practiceWordPill: { backgroundColor: colors.lavender, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  practiceWordPillText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  practiceStatsIconWrap: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },

  practiceTipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  practiceTipText: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, flex: 1 },

  encourageCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F5F3FC', borderRadius: radius.xl, padding: 16, marginTop: 8, marginBottom: 20,
    ...shadows.card,
  },
  encourageImage: { width: 71, height: 124 },
  encourageTitle: { fontFamily: typography.family.display, color: colors.ink, fontSize: 15, marginBottom: 4 },
  encourageSub: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, marginBottom: 12 },
  encourageButtonRow: { flexDirection: 'row', gap: 10 },
  encourageButtonGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  encourageButtonGhostText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 12 },
  encourageButtonSolid: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.lavenderDark,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  encourageButtonSolidText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  practiceTipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FEF3D6', borderRadius: radius.lg, padding: 16, marginBottom: 8,
    ...shadows.card,
  },
  practiceTipCardTitle: { color: colors.ink, fontWeight: '900', fontSize: 14, marginBottom: 2 },
  practiceTipCardText: { color: colors.inkSoft, fontWeight: '600', fontSize: 12, lineHeight: 17 },

  backButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8,
  },
  backText: { color: colors.lavenderDark, fontWeight: '700', fontSize: 15 },

  resultBigEmoji: { fontSize: 72, marginBottom: 8 },
  resultSubtitle: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  scoreCoachText: { color: colors.ink, fontWeight: '800', marginTop: -10, marginBottom: 12 },
  starRow: { flexDirection: 'row', gap: 6, marginTop: -10, marginBottom: 14 },
  pronunciationStar: { color: XP_GOLD, fontSize: 28 },
  pronunciationStarDim: { color: '#d1d5db' },

  // Accuracy ring (simulated with a card)
  accuracyRing: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 8, borderColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, backgroundColor: '#fff',
    shadowColor: colors.ink, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  accuracyRingWrong: { borderColor: colors.warning },
  accuracyPercent: {
    fontFamily: typography.family.display, fontSize: 28, color: colors.success,
  },
  accuracyLabel: { fontSize: 11, color: colors.inkSoft, fontWeight: '600' },

  // Transcript row
  transcriptRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 16,
  },
  transcriptLabel: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  transcriptValue: { color: colors.ink, fontWeight: '800', fontSize: 13 },

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
  comparisonLabel: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', flex: 1 },
  comparisonWord: { fontSize: 15, fontWeight: '800' },

  // XP pill
  xpPill: {
    backgroundColor: colors.lavenderDark, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 10, marginBottom: 20,
  },
  xpPillText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  // Buttons in result card
  nextButton: {
    backgroundColor: colors.lavenderDark, borderRadius: 999,
    paddingHorizontal: 28, paddingVertical: 14,
    width: '100%', alignItems: 'center',
    shadowColor: colors.lavenderDark, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  nextButtonText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  resultButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  listenAgainButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderColor: colors.lavenderDark, borderRadius: 999,
    paddingVertical: 12,
  },
  listenAgainText: { color: colors.lavenderDark, fontWeight: '700' },
  retryMicButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: colors.lavenderDark, borderRadius: 999, paddingVertical: 12,
  },
  retryMicText: { color: '#fff', fontWeight: '700' },

  sectionSubtitle: { color: colors.textSecondary, fontSize: 13, marginBottom: 16 },
  emptyState: { alignItems: 'center', paddingTop: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  openSettingsButton: {
    marginTop: 16,
    backgroundColor: colors.primary,
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
  homeActivityTitle: { color: colors.ink, fontWeight: '900' },
  homeActivityMeta: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  profileHero: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  profileAvatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileAvatarText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  profileName: { color: colors.textPrimary, fontSize: 20, fontWeight: '900' },
  profileUsername: { color: colors.textSecondary, marginTop: 4 },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  profileLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  profileValue: { color: colors.textPrimary, fontWeight: '800', marginTop: 3 },
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
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calendarMonth: { fontSize: 16, fontWeight: '900', color: colors.textPrimary, marginBottom: 12 },
  weekHeader: { flexDirection: 'row', marginBottom: 8 },
  weekHeaderText: { flex: 1, textAlign: 'center', color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginBottom: 4,
  },
  dayCellSelected: { backgroundColor: colors.primary },
  dayText: { color: colors.textPrimary, fontWeight: '800' },
  dayTextSelected: { color: '#fff' },
  dayDots: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  dayCount: { fontSize: 9, color: colors.textSecondary, fontWeight: '800' },
  selectedTasksCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 14,
  },
  selectedTasksTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 16, marginBottom: 10 },
  activityTaskRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  statusStrip: { width: 4, borderRadius: 999 },
  activityTaskTitle: { color: colors.textPrimary, fontWeight: '900' },
  activityTaskMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  activityTaskDescription: { color: '#374151', fontSize: 12, marginTop: 6, lineHeight: 18 },
  statusBadge: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
});
