import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { supabase } from '../config/supabase';
import { getUserProfileById, onAuthStateChanged, signOutUser } from '../services/supabaseService';
import { fetchParentProfile } from '../services/profileService';
import { ACHIEVEMENTS } from '../services/achievementService';
import { fetchNotifications, subscribeToParentNotifications } from '../services/notificationService';
import { fetchPublishedLessons } from '../services/lessonService';
import { fetchLessonProgress } from '../services/lessonProgressService';
import { NotificationsView } from './ParentNotifications';
import EnrollChildModal from './EnrollChildModal';
import AddScheduledActivityModal from './AddScheduledActivityModal';
import EditParentProfileModal from './EditParentProfileModal';
import { StudentActivity } from '../services/activityService';
import { fetchScheduledActivities, completeScheduledActivity, ScheduledActivity } from '../services/scheduledActivityService';
import { buildApiUrl, getJson } from '../config/api';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  fetchDashboardSettings,
  updateDashboardSettings,
  changeEmail,
  DashboardSettings,
  SpeechRate,
} from '../services/settingsService';
import { setTtsEnabled, setSpeechRateSetting } from '../services/ttsService';

// Same palette as the Student Dashboard redesign, duplicated locally since
// this file doesn't share module scope - keeps the Parent Dashboard visually
// part of the same app while its own copy (below) stays more measured/adult
// in tone than the student-facing screens.
const HOME_CREAM = '#FBF3E2';
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#8A8078';
const HOME_SUN = '#E3971A';
const HOME_CORAL = '#E06B4C';
const HOME_SAGE = '#5C8047';
const HOME_LAVENDER = '#7C6FCF';
const HOME_LAVENDER_DARK = '#5F52B0';

type SkillCategory = 'letters' | 'syllables' | 'words';
const categorizeWord = (word: string): SkillCategory => {
  const clean = (word || '').replace(/-/g, '');
  if (clean.length <= 1) return 'letters';
  const syllables = (word || '').split('-').filter(Boolean);
  if (syllables.length <= 2) return 'syllables';
  return 'words';
};

function ProgressRing({
  percent,
  size = 96,
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

// Reuses the same react-native-svg dependency the progress rings already
// use (no charting library is installed anywhere in this project) to draw a
// simple connected-dot line chart, closer to the reference than a bar chart.
function TrendLineChart({
  points,
  width,
  height = 120,
  color,
}: {
  points: { label: string; pct: number | null }[];
  width: number;
  height?: number;
  color: string;
}) {
  const padding = 14;
  const usable = points.filter((p) => p.pct !== null) as { label: string; pct: number }[];
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const yFor = (pct: number) => padding + (1 - pct / 100) * (height - padding * 2);
  const coords = points.map((p, i) => (p.pct !== null ? { x: padding + step * i, y: yFor(p.pct) } : null));
  const linePoints = coords.filter((c): c is { x: number; y: number } => !!c).map((c) => `${c.x},${c.y}`).join(' ');

  return (
    <View>
      <Svg width={width} height={height}>
        {usable.length >= 2 && <Polyline points={linePoints} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {coords.map((c, i) =>
          c ? <Circle key={i} cx={c.x} cy={c.y} r={4} fill={color} /> : null,
        )}
      </Svg>
      <View style={styles.trendLineLabels}>
        {points.map((p, i) => (
          <Text key={i} style={styles.trendLineLabelText}>{p.label}</Text>
        ))}
      </View>
    </View>
  );
}

type Section = 'welcome' | 'progress' | 'calendar' | 'notifications' | 'settings';
type Level = 'Beginner' | 'Intermediate' | 'Advanced';

type ChildProgress = {
  xp: number;
  level: Level;
  streak: number;
  word_count?: number;
  completed_words: string[];
  achievements: Array<{ id: string; unlockedAt: string }>;
  total_attempts?: number;
  last_practice_date?: string | null;
  accuracy_sum?: number;
  activities_completed?: number;
};

type ChildRow = {
  id: string;
  auth_uid?: string | null;
  name: string;
  grade_level: number;
  username: string;
  child_progress?: ChildProgress[];
};

type PracticeSessionRow = {
  id: string;
  student_id: string;
  word: string;
  spoken_text?: string | null;
  accuracy_percentage: number;
  created_at: string;
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

const NAV_ITEMS: { key: Section; label: string; icon: string }[] = [
  { key: 'welcome', label: 'Dashboard / Home', icon: 'home-outline' },
  { key: 'progress', label: 'Child Progress', icon: 'bar-chart-outline' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline' },
  { key: 'notifications', label: 'Notifications / Reports', icon: 'notifications-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

const LEVEL_COLORS: Record<Level, string> = {
  Beginner: SUCCESS,
  Intermediate: PRIMARY,
  Advanced: '#7c3aed',
};

export default function ParentDashboardEnhanced({ navigation }: any) {
  const { width: screenWidth } = useWindowDimensions();
  const [parentId, setParentId] = useState('');
  const [parentName, setParentName] = useState('Magulang');
  const [parentEmail, setParentEmail] = useState('');
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [activities, setActivities] = useState<StudentActivity[]>([]);
  const [scheduledActivities, setScheduledActivities] = useState<ScheduledActivity[]>([]);
  const [activityModalVisible, setActivityModalVisible] = useState(false);
  const [editingScheduledActivity, setEditingScheduledActivity] = useState<ScheduledActivity | null>(null);
  const [practiceSessions, setPracticeSessions] = useState<PracticeSessionRow[]>([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('welcome');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEnroll, setShowEnroll] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [childSessions, setChildSessions] = useState<
    { word: string; accuracy_percentage: number; is_correct: boolean | null; duration_seconds: number | null; created_at: string }[]
  >([]);
  const [progressPeriod, setProgressPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [childLessonsTotal, setChildLessonsTotal] = useState<number | null>(null);
  const [childCompletedLessons, setChildCompletedLessons] = useState<number | null>(null);
  const [childCurrentLesson, setChildCurrentLesson] = useState<{ title: string; status: string } | null>(null);
  const [childInsightsLoading, setChildInsightsLoading] = useState(false);
  const [parentPhone, setParentPhone] = useState('');
  const [parentAvatarUrl, setParentAvatarUrl] = useState<string | null>(null);
  const [parentSettings, setParentSettings] = useState<DashboardSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettingKey, setSavingSettingKey] = useState<string | null>(null);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailModalError, setEmailModalError] = useState('');

  const sidebarAnim = useRef(new Animated.Value(-270)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const loadingParentRef = useRef<string | null>(null);
  const loadedParentRef = useRef<string | null>(null);

  const loadChildren = async (id: string) => {
    const { data, error: childError } = await supabase
      .from('children')
      .select('id,name,auth_uid,grade_level,username,child_progress(*)')
      .eq('parent_id', id)
      .order('created_at', { ascending: false });
    if (childError) throw childError;
    const rows = (data || []) as ChildRow[];
    setChildren(rows);
    return rows;
  };

  const loadActivitiesForChildren = async (rows: ChildRow[], activeParentId = parentId) => {
    if (!rows.length || !activeParentId) {
      setActivities([]);
      return;
    }

    try {
      const response = await getJson<{ success: boolean; activities?: StudentActivity[]; message?: string }>(
        buildApiUrl(`/activities?parentId=${encodeURIComponent(activeParentId)}`),
        15000,
      );
      setActivities(response.activities || []);
    } catch (error: any) {
      console.warn('[ParentDashboard] activities load failed, falling back to Supabase:', error?.message || error);

      try {
        const childIds = rows.map((child) => child.id).filter(Boolean);
        if (!childIds.length) {
          setActivities([]);
          return;
        }

        const { data: activities, error: supabaseError } = await supabase
          .from('activities')
          .select('id,title,description,deadline,subject,status,student_id')
          .in('student_id', childIds)
          .order('deadline', { ascending: true });

        if (supabaseError) throw supabaseError;
        setActivities((activities || []) as StudentActivity[]);
        console.log('[ParentDashboard] Supabase fallback succeeded for activities');
      } catch (supabaseErr: any) {
        console.warn('[ParentDashboard] Supabase fallback for activities failed:', supabaseErr?.message);
        setActivities([]);
      }
    }
  };

  const loadScheduledActivitiesForChildren = async (rows: ChildRow[]) => {
    const childIds = rows.map((child) => child.id).filter(Boolean);
    if (!childIds.length) {
      setScheduledActivities([]);
      return;
    }
    try {
      const lists = await Promise.all(childIds.map((id) => fetchScheduledActivities(id).catch(() => [])));
      setScheduledActivities(lists.flat());
    } catch (error: any) {
      console.warn('[ParentDashboard] scheduled activities load failed:', error?.message || error);
      setScheduledActivities([]);
    }
  };

  const loadPracticeSessionsForChildren = async (rows: ChildRow[]) => {
    const childIds = rows.map((child) => child.id).filter(Boolean);
    if (!childIds.length) {
      setPracticeSessions([]);
      return;
    }

    try {
      const response = await getJson<{ success: boolean; sessions?: PracticeSessionRow[]; message?: string }>(
        buildApiUrl(`/practice/sessions?limit=20&studentIds=${encodeURIComponent(childIds.join(','))}`),
        15000,
      );
      setPracticeSessions(response.sessions || []);
    } catch (error: any) {
      console.warn('[ParentDashboard] practice sessions load failed, falling back to Supabase:', error?.message || error);

      try {
        const { data: sessions, error: supabaseError } = await supabase
          .from('pronunciation_practice_sessions')
          .select('id,student_id,word,spoken_text,accuracy_percentage,created_at')
          .in('student_id', childIds)
          .order('created_at', { ascending: false })
          .limit(20);

        if (supabaseError) throw supabaseError;
        setPracticeSessions((sessions || []) as PracticeSessionRow[]);
        console.log('[ParentDashboard] Supabase fallback succeeded for practice sessions');
      } catch (supabaseErr: any) {
        console.warn('[ParentDashboard] Supabase fallback for practice sessions failed:', supabaseErr?.message);
        setPracticeSessions([]);
      }
    }
  };

  const loadChildInsights = async (child: ChildRow) => {
    setChildInsightsLoading(true);
    try {
      // No date filter here - the Progress tab's own 7/30/90/All period
      // filter needs the full history to slice client-side (and to compute
      // an equal-length "previous period" for the improvement delta).
      // Row-count capped instead, which is generous for a single child's
      // practice history.
      const [sessionsResult, lessonsResult, currentLessonResult, lessonProgressResult] = await Promise.allSettled([
        supabase
          .from('pronunciation_practice_sessions')
          .select('word, accuracy_percentage, is_correct, duration_seconds, created_at')
          .eq('student_id', child.id)
          .order('created_at', { ascending: false })
          .limit(2000),
        fetchPublishedLessons(child.grade_level),
        supabase
          .from('lesson_progress')
          .select('lesson_id, status, opened_at, lessons(title)')
          .eq('student_id', child.id)
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetchLessonProgress(child.id),
      ]);

      setChildSessions(
        sessionsResult.status === 'fulfilled' && !sessionsResult.value.error
          ? (sessionsResult.value.data as any[]) || []
          : [],
      );
      setChildLessonsTotal(lessonsResult.status === 'fulfilled' ? lessonsResult.value.length : null);

      // Real completed-lesson count (lesson_progress rows with status
      // 'completed') - previously the Home tab mistakenly used
      // progress.activities_completed here, which actually counts turned-in
      // assignments, not lesson completions.
      setChildCompletedLessons(
        lessonProgressResult.status === 'fulfilled'
          ? lessonProgressResult.value.filter((row) => row.status === 'completed').length
          : null,
      );

      if (
        currentLessonResult.status === 'fulfilled' &&
        !currentLessonResult.value.error &&
        currentLessonResult.value.data
      ) {
        const row = currentLessonResult.value.data as any;
        setChildCurrentLesson({ title: row.lessons?.title || 'Lesson', status: row.status });
      } else {
        // lesson_progress may not be available yet (pending migration) or the
        // child hasn't opened a lesson - omit the card rather than fabricate one.
        setChildCurrentLesson(null);
      }
    } finally {
      setChildInsightsLoading(false);
    }
  };

  useEffect(() => {
    if (!children.length) {
      setSelectedChildId(null);
      return;
    }
    if (!selectedChildId || !children.some((child) => child.id === selectedChildId)) {
      setSelectedChildId(children[0].id);
    }
  }, [children]);

  useEffect(() => {
    const child = children.find((c) => c.id === selectedChildId);
    if (!child) {
      setChildSessions([]);
      setChildLessonsTotal(null);
      setChildCompletedLessons(null);
      setChildCurrentLesson(null);
      return;
    }
    void loadChildInsights(child);
  }, [selectedChildId]);

  const refreshNotifications = async (id: string) => {
    try {
      const rows = await fetchNotifications(id);
      setUnreadNotifications(rows.filter((item) => !(item.is_read ?? item.read)).length);
    } catch (error: any) {
      console.warn('[ParentDashboard] notifications load failed:', error?.message || error);
      setUnreadNotifications(0);
    }
  };

  const loadParentSettings = async (id: string) => {
    setSettingsLoading(true);
    try {
      const data = await fetchDashboardSettings(id, 'parent');
      setParentSettings(data);
      setTtsEnabled(data.tts_enabled);
      setSpeechRateSetting(data.speech_rate || 'normal');
    } catch (error: any) {
      console.warn('[ParentDashboard] settings load failed:', error?.message || error);
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    if (section === 'settings' && parentId && !parentSettings && !settingsLoading) {
      void loadParentSettings(parentId);
    }
  }, [section, parentId]);

  const updateParentSetting = async <K extends keyof DashboardSettings>(key: K, value: DashboardSettings[K]) => {
    if (!parentId || !parentSettings) return;
    const previous = parentSettings;
    setParentSettings({ ...parentSettings, [key]: value });
    if (key === 'tts_enabled') setTtsEnabled(!!value);
    if (key === 'speech_rate') setSpeechRateSetting(value as SpeechRate);
    setSavingSettingKey(String(key));
    try {
      const saved = await updateDashboardSettings(parentId, 'parent', { [key]: value } as Partial<DashboardSettings>);
      setParentSettings(saved);
    } catch (error: any) {
      console.warn('[ParentDashboard] setting update failed:', error?.message || error);
      setParentSettings(previous);
      if (key === 'tts_enabled') setTtsEnabled(!!previous.tts_enabled);
      if (key === 'speech_rate') setSpeechRateSetting((previous.speech_rate || 'normal') as SpeechRate);
    } finally {
      setSavingSettingKey(null);
    }
  };

  const submitEmailChange = async () => {
    const trimmed = newEmailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailModalError('Ilagay ang tamang email address.');
      return;
    }
    setEmailModalError('');
    setSavingEmail(true);
    try {
      await changeEmail(trimmed);
      setEmailModalVisible(false);
      setError('');
    } catch (err: any) {
      setEmailModalError(err?.message || 'Hindi ma-update ang email.');
    } finally {
      setSavingEmail(false);
    }
  };

  const loadParent = async (id: string, email?: string) => {
    if (loadingParentRef.current === id) {
      console.log('[ParentDashboard] duplicate load skipped:', { auth_uid: id });
      return;
    }
    loadingParentRef.current = id;
    setError('');
    try {
      console.log('[ParentDashboard] loadParent start:', { auth_uid: id, email });
      const { data: parentData, error: parentErr } = await fetchParentProfile(id, { email });

      if (parentData) {
        setParentName(parentData.full_name || parentData.name || 'Magulang');
        setParentEmail(parentData.email || email || '');
        setParentPhone(parentData.phone_number || parentData.phone || '');
        setParentAvatarUrl(parentData.avatar_url || null);
        const rows = await loadChildren(id);
        await Promise.all([loadActivitiesForChildren(rows, id), loadScheduledActivitiesForChildren(rows), loadPracticeSessionsForChildren(rows), refreshNotifications(id)]);
        loadedParentRef.current = id;
        return;
      }

      if (parentErr) {
        setError('Hindi ma-load ang parent profile. Gamit muna ang backup profile data.');
      }

      const profile = await getUserProfileById(id);
      if (profile.data) {
        setParentName(profile.data.name || profile.data.full_name || 'Magulang');
        setParentEmail(profile.data.email || email || '');
      } else {
        setParentEmail(email || '');
      }
      const rows = await loadChildren(id);
      await Promise.all([loadActivitiesForChildren(rows, id), loadScheduledActivitiesForChildren(rows), loadPracticeSessionsForChildren(rows), refreshNotifications(id)]);
      loadedParentRef.current = id;
    } catch (err) {
      console.error('Failed to load parent dashboard:', err);
      setError('Hindi ma-load ang parent profile.');
      try {
        const rows = await loadChildren(id);
        await Promise.all([loadActivitiesForChildren(rows, id), loadScheduledActivitiesForChildren(rows), loadPracticeSessionsForChildren(rows), refreshNotifications(id)]);
      } catch (_) {}
    } finally {
      loadingParentRef.current = null;
    }
  };

  useEffect(() => {
    const { data } = onAuthStateChanged((_event, session) => {
      const user = session?.user;
      if (!user) {
        loadedParentRef.current = null;
        loadingParentRef.current = null;
        navigation.replace('Login');
        return;
      }
      if (loadedParentRef.current === user.id) {
        return;
      }
      setParentId(user.id);
      setLoading(true);
      loadParent(user.id, user.email)
        .catch(() => setError('Hindi ma-load ang parent dashboard.'))
        .finally(() => setLoading(false));
    });

    return () => data.subscription.unsubscribe();
  }, [navigation]);

  const selectedChildIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedChildIdRef.current = selectedChildId;
  }, [selectedChildId]);

  useEffect(() => {
    if (!parentId) return undefined;
    return subscribeToParentNotifications(parentId, () => {
      void refreshNotifications(parentId);
      void loadChildren(parentId).then((rows) => {
        void loadActivitiesForChildren(rows);
        void loadScheduledActivitiesForChildren(rows);
        void loadPracticeSessionsForChildren(rows);
        // child_progress-derived numbers refresh via the loadChildren() join
        // above, but the Progress tab's own session history/lesson totals/
        // current-lesson card only otherwise reload when selectedChildId
        // changes - re-run it here too so a lesson/practice event updates
        // that view promptly while the parent has it open, not just on next
        // child switch.
        const currentChild = rows.find((row) => row.id === selectedChildIdRef.current);
        if (currentChild) void loadChildInsights(currentChild);
      });
    });
  }, [parentId]);

  const initials = useMemo(
    () => parentName.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase(),
    [parentName],
  );

  const openSidebar = () => {
    setSidebarOpen(true);
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0.45, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeSidebar = () => {
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: -270, duration: 240, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => setSidebarOpen(false));
  };

  const navigateTo = (nextSection: Section) => {
    setSection(nextSection);
    closeSidebar();
  };

  const handleLogout = async () => {
    await signOutUser();
    navigation.replace('Login');
  };

  const contactSupport = async () => {
    const subject = encodeURIComponent('LinawLetra support - Parent account');
    const body = encodeURIComponent(`User ID: ${parentId}\n\nHow can we help?`);
    const url = `mailto:support@linawletra.app?subject=${subject}&body=${body}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  };

  const getLevelColor = (level: Level) => LEVEL_COLORS[level] || PRIMARY;

  const getNextLevel = (level: Level) => {
    if (level === 'Beginner') return 'Intermediate';
    if (level === 'Intermediate') return 'Advanced';
    return 'Master';
  };

  const getGreeting = (child: ChildRow) => {
    const progress = child.child_progress?.[0];
    const level = progress?.level || 'Beginner';
    const streak = progress?.streak || 0;
    const name = child.name.split(' ')[0];
    if (streak >= 7) return `"Kahanga-hanga, ${name}! ${streak} araw na streak! 🔥"`;
    if (streak >= 3) return `"Magaling, ${name}! Patuloy na mag-practice! ⭐"`;
    if (level === 'Advanced') return `"Ikaw na, ${name}! Advanced level na! 🚀"`;
    if (level === 'Intermediate') return `"Papalakas ka na, ${name}! 📈"`;
    return `"Patuloy na matuto, ${name}! 📚"`;
  };

  const getInsights = (progress: ChildProgress | undefined, name: string) => {
    const first = name.split(' ')[0];
    if (!progress) return [`${name} ay wala pang naitala na progreso. Hikayatin siyang magsimula!`];
    const out: string[] = [];

    if (progress.streak >= 7) out.push(`🔥 ${first} ay may ${progress.streak}-araw na streak — kahanga-hanga!`);
    else if (progress.streak >= 3) out.push(`✅ ${first} ay nag-practice ng ${progress.streak} araw. Ituloy!`);
    else if (progress.streak === 0) out.push(`⚠️ ${first} ay hindi pa nag-practice ngayong araw. Paalalahanin siya!`);

    const words = progress.word_count ?? progress.completed_words?.length ?? 0;
    if (words >= 50) out.push(`🏆 ${first} ay nakumpleto na ang 50+ salita — advanced learner!`);
    else if (words >= 10) out.push(`📚 ${first} ay natututo nang mabilis — ${words} salita na!`);
    else out.push(`📖 ${first} ay nagsisimula pa lang (${words} salita). Dagdagan ang practice time.`);

    if (progress.level === 'Advanced') out.push(`🚀 ${first} ay nasa pinakamataas na antas — Advanced!`);
    else if (progress.level === 'Intermediate') out.push(`📈 ${first} ay umuusad — nasa Intermediate na siya!`);
    else out.push(`💡 ${first} ay nasa Beginner level pa. 100 XP ang kailangan para sa Intermediate.`);

    if (progress.total_attempts && progress.total_attempts > 0) {
      const acc = Math.round((words / progress.total_attempts) * 100);
      if (acc >= 80) out.push(`✅ Magandang accuracy: ${acc}% — panatilihin ito!`);
      else if (acc < 50) out.push(`💡 Accuracy: ${acc}% — kailangan ng mas maraming repetition.`);
    }

    return out;
  };

  const recentActivities = useMemo(
    () =>
      children
        .flatMap((child) =>
          (child.child_progress?.[0]?.achievements || []).map((achievement) => ({
            childName: child.name,
            achievementId: achievement.id,
            unlockedAt: achievement.unlockedAt,
            def: ACHIEVEMENTS.find((d) => d.id === achievement.id),
          })),
        )
        .sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime())
        .slice(0, 10),
    [children],
  );

  const achievementStats = useMemo(
    () =>
      ACHIEVEMENTS.map((achievement) => ({
        achievement,
        unlockedBy: children
          .filter((child) => child.child_progress?.[0]?.achievements.some((item) => item.id === achievement.id))
          .map((child) => child.name),
      })),
    [children],
  );

  const getActivityDateKey = (activity: StudentActivity) => new Date(activity.deadline).toISOString().slice(0, 10);
  const getActivitiesForDate = (dateKey: string) =>
    activities.filter((activity) => getActivityDateKey(activity) === dateKey);
  const getStatusColor = (status: string) => {
    if (status === 'completed') return SUCCESS;
    if (status === 'overdue') return DANGER;
    return WARNING;
  };
  const getChildNameForActivity = (activity: StudentActivity) =>
    children.find((child) => child.id === activity.student_id || child.auth_uid === activity.student_id)?.name || 'Student';
  const getScheduledForDate = (dateKey: string) =>
    scheduledActivities.filter((item) => item.scheduled_date === dateKey);
  const getChildNameForScheduled = (item: ScheduledActivity) =>
    children.find((child) => child.id === item.child_id)?.name || 'Student';
  const SCHEDULED_TYPE_ICON: Record<ScheduledActivity['activity_type'], keyof typeof Ionicons.glyphMap> = {
    reading_lesson: 'book-outline',
    practice: 'mic-outline',
    reminder: 'alarm-outline',
    appointment: 'medical-outline',
  };
  const getScheduledStatusColor = (status: ScheduledActivity['status']) => {
    if (status === 'completed') return SUCCESS;
    if (status === 'missed') return DANGER;
    if (status === 'in_progress') return WARNING;
    return HOME_LAVENDER_DARK;
  };
  const toggleScheduledComplete = async (item: ScheduledActivity) => {
    try {
      await completeScheduledActivity(item.id);
      await loadScheduledActivitiesForChildren(children);
    } catch (error: any) {
      console.warn('[ParentDashboard] complete scheduled activity failed:', error?.message || error);
    }
  };
  const getCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const cells: Array<{ key: string; date?: Date }> = [];
    for (let i = 0; i < first.getDay(); i += 1) cells.push({ key: `blank-${i}` });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      cells.push({ key: date.toISOString(), date });
    }
    while (cells.length % 7 !== 0) cells.push({ key: `trail-${cells.length}` });
    return cells;
  };
  const shiftCalendarMonth = (delta: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };
  const upcomingActivities = useMemo(
    () =>
      activities
        .filter((activity) => activity.status !== 'completed')
        .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
        .slice(0, 4),
    [activities],
  );

  const renderWelcome = () => {
    const selectedChild = children.find((child) => child.id === selectedChildId) || children[0];

    if (!selectedChild) {
      return (
        <>
          <View style={styles.homeHeaderRow}>
            <View style={styles.homeAvatar}>
              <Text style={styles.homeAvatarText}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.homeGreeting}>Good Day, {parentName || 'Loading...'}!</Text>
              <Text style={styles.homeGreetingSub}>Here's how your child is doing today.</Text>
            </View>
          </View>
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👨‍👩‍👧</Text>
            <Text style={styles.emptyText}>Wala pang naka-enroll na bata.</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => setShowEnroll(true)}>
              <Text style={styles.emptyButtonText}>+ I-enroll ang Iyong Unang Bata</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    const progress = selectedChild.child_progress?.[0];
    const level = (progress?.level || 'Beginner') as Level;
    const avgAccuracy = progress && (progress.total_attempts || 0) > 0
      ? Math.round((progress.accuracy_sum || 0) / (progress.total_attempts || 1))
      : null;
    const isActivelyLearning = !!progress?.last_practice_date && progress.last_practice_date.slice(0, 10) === new Date().toISOString().slice(0, 10);
    const wordsPracticed = progress?.word_count ?? progress?.completed_words?.length ?? 0;
    const lessonsCompleted = childCompletedLessons ?? 0;
    const practiceSessions = progress?.total_attempts || 0;

    const tierColor = (pct: number) => (pct >= 80 ? SUCCESS : pct >= 60 ? WARNING : DANGER);
    const tierMessage = (name: string, pct: number | null) =>
      pct === null
        ? `${name} hasn't started practicing yet.`
        : pct >= 80
        ? `${name} is making great progress in reading.`
        : pct >= 60
        ? `${name} is making steady progress in reading.`
        : `${name} could use a bit more practice this week.`;

    // Weekly accuracy trend (last 4 weeks, most recent last) - real sessions
    // grouped by 7-day windows, same computation the Student Dashboard uses
    // day-by-day, just bucketed weekly to match this view's time horizon.
    const weekBuckets = Array.from({ length: 4 }, (_, i) => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() - (3 - i) * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const inRange = childSessions.filter((s) => {
        const t = new Date(s.created_at).getTime();
        return t >= start.getTime() && t <= end.getTime();
      });
      const avg = inRange.length
        ? Math.round(inRange.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / inRange.length)
        : null;
      return { label: `Week ${i + 1}`, pct: avg };
    });
    const weeksWithData = weekBuckets.filter((w) => w.pct !== null);

    // Month-over-month improvement - avg accuracy over the last 30 days vs
    // the 30 days before that. Omitted entirely (not shown as 0%) when there
    // isn't a full prior period to compare against.
    const dayMs = 86400000;
    const nowMs = Date.now();
    const avgOf = (rows: typeof childSessions) =>
      rows.length ? Math.round(rows.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / rows.length) : null;
    const last30 = childSessions.filter((s) => nowMs - new Date(s.created_at).getTime() <= 30 * dayMs);
    const prior30 = childSessions.filter((s) => {
      const age = nowMs - new Date(s.created_at).getTime();
      return age > 30 * dayMs && age <= 60 * dayMs;
    });
    const recentAvg = avgOf(last30);
    const priorAvg = avgOf(prior30);
    const monthDelta = recentAvg !== null && priorAvg !== null ? recentAvg - priorAvg : null;

    const lastSessionAt = childSessions[0]?.created_at;
    const relativeTime = (iso?: string) => {
      if (!iso) return null;
      const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
      if (hours < 1) return 'less than an hour ago';
      if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
      const days = Math.floor(hours / 24);
      return `${days} day${days === 1 ? '' : 's'} ago`;
    };

    // Areas to Practice - same real per-word-shape categories as the Student
    // Dashboard's "My Reading Skills" (categorizeWord), relabeled for a
    // parent audience but backed by the identical accuracy-by-category math.
    const skillGroups: Record<SkillCategory, { count: number; sum: number }> = {
      letters: { count: 0, sum: 0 },
      syllables: { count: 0, sum: 0 },
      words: { count: 0, sum: 0 },
    };
    childSessions.forEach((s) => {
      const cat = categorizeWord(s.word);
      skillGroups[cat].count += 1;
      skillGroups[cat].sum += Number(s.accuracy_percentage) || 0;
    });
    const skillMeta: { key: SkillCategory; label: string; icon: string }[] = [
      { key: 'letters', label: 'Letter Recognition', icon: 'text' },
      { key: 'syllables', label: 'Syllable Reading', icon: 'reader' },
      { key: 'words', label: 'Word Reading', icon: 'book' },
    ];
    const skillStatus = (avg: number | null) =>
      avg === null
        ? { label: 'Not started', color: HOME_INK_SOFT }
        : avg >= 80
        ? { label: 'Strong', color: SUCCESS }
        : avg >= 60
        ? { label: 'Improving', color: WARNING }
        : { label: 'Needs more practice', color: DANGER };

    return (
      <>
        <View style={styles.homeHeaderRow}>
          <View style={styles.homeAvatar}>
            <Text style={styles.homeAvatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.homeGreeting}>Good Day, {parentName || 'Loading...'}!</Text>
            <Text style={styles.homeGreetingSub}>Here's how your child is doing today.</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.viewingSelector}
          onPress={() => children.length > 1 && setChildPickerOpen((open) => !open)}
          activeOpacity={children.length > 1 ? 0.7 : 1}
        >
          <Text style={styles.viewingSelectorText}>Viewing: {selectedChild.name}</Text>
          {children.length > 1 && (
            <Ionicons name={childPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={HOME_LAVENDER_DARK} />
          )}
        </TouchableOpacity>

        {childPickerOpen && children.length > 1 && (
          <View style={styles.childPickerList}>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.childPickerRow}
                onPress={() => {
                  setSelectedChildId(child.id);
                  setChildPickerOpen(false);
                }}
              >
                <Text style={[styles.childPickerRowText, child.id === selectedChild.id && { color: HOME_LAVENDER_DARK, fontWeight: '800' }]}>
                  {child.name}
                </Text>
                {child.id === selectedChild.id && <Ionicons name="checkmark" size={16} color={HOME_LAVENDER_DARK} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.childSummaryCard}>
          <View style={styles.childAvatarLg}>
            <Text style={styles.childAvatarLgText}>{selectedChild.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.childSummaryName}>{selectedChild.name}</Text>
            <View style={styles.childSummaryBadgeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>Grade {selectedChild.grade_level}</Text>
              </View>
              <View style={[styles.levelBadgeOutline, { borderColor: getLevelColor(level) }]}>
                <Text style={[styles.levelBadgeOutlineText, { color: getLevelColor(level) }]}>{level}</Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusDotLg, { backgroundColor: isActivelyLearning ? SUCCESS : HOME_INK_SOFT }]} />
              <Text style={styles.statusRowText}>{isActivelyLearning ? 'Actively Learning' : 'No activity today'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.readingProgressCard}>
          <View style={styles.readingProgressHeader}>
            <Text style={styles.readingProgressTitle}>Reading Progress</Text>
            <Ionicons name="book" size={26} color={HOME_LAVENDER} />
          </View>
          <View style={{ alignItems: 'center', marginVertical: 12 }}>
            <ProgressRing percent={avgAccuracy ?? 0} color={HOME_LAVENDER_DARK} trackColor="rgba(124,111,207,0.15)">
              <Text style={styles.readingProgressPct}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
            </ProgressRing>
          </View>
          <Text style={styles.readingProgressLabel}>Overall Reading Progress</Text>
          {monthDelta !== null && (
            <View style={[styles.improvementBadge, { backgroundColor: monthDelta >= 0 ? '#E9F1E2' : '#FBE7DF' }]}>
              <Ionicons name={monthDelta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={monthDelta >= 0 ? SUCCESS : DANGER} />
              <Text style={[styles.improvementBadgeText, { color: monthDelta >= 0 ? SUCCESS : DANGER }]}>
                {monthDelta >= 0 ? '+' : ''}{monthDelta}% improvement this month
              </Text>
            </View>
          )}
          <Text style={styles.readingProgressMessage}>{tierMessage(selectedChild.name.split(' ')[0], avgAccuracy)}</Text>
        </View>

        <Text style={styles.homeSectionTitle}>Quick Overview</Text>
        <View style={styles.overviewGrid}>
          <View style={[styles.overviewCard, { backgroundColor: '#EAF3FB' }]}>
            <Ionicons name="book" size={20} color={HOME_LAVENDER_DARK} />
            <Text style={[styles.overviewValue, { color: HOME_LAVENDER_DARK }]}>{wordsPracticed}</Text>
            <Text style={styles.overviewLabel}>Words Practiced</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="checkmark-circle" size={20} color={HOME_SAGE} />
            <Text style={[styles.overviewValue, { color: HOME_SAGE }]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
            <Text style={styles.overviewLabel}>Reading Accuracy</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="school" size={20} color={HOME_LAVENDER} />
            <Text style={[styles.overviewValue, { color: HOME_LAVENDER }]}>
              {lessonsCompleted}{childLessonsTotal !== null ? `/${childLessonsTotal}` : ''}
            </Text>
            <Text style={styles.overviewLabel}>Lessons Completed</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="mic" size={20} color={HOME_SUN} />
            <Text style={[styles.overviewValue, { color: HOME_SUN }]}>{practiceSessions}</Text>
            <Text style={styles.overviewLabel}>Practice Sessions</Text>
          </View>
        </View>

        <Text style={styles.homeSectionTitle}>Reading Development</Text>
        <View style={styles.trendCard}>
          {weeksWithData.length >= 2 ? (
            <>
              <View style={styles.trendBars}>
                {weekBuckets.map((week, i) => {
                  const color = week.pct !== null ? tierColor(week.pct) : 'rgba(124,111,207,0.12)';
                  return (
                    <View key={i} style={styles.trendBarCol}>
                      {week.pct !== null && <Text style={[styles.trendBarValue, { color }]}>{week.pct}%</Text>}
                      <View style={[styles.trendBar, { height: week.pct !== null ? Math.max(6, Math.round((week.pct / 100) * 80)) : 6, backgroundColor: color }]} />
                      <Text style={styles.trendBarLabel}>{week.label}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={styles.trendMsgRow}>
                <Ionicons name="checkmark-circle" size={13} color={SUCCESS} />
                <Text style={styles.trendMsgText}>
                  {weeksWithData[weeksWithData.length - 1].pct! >= weeksWithData[0].pct!
                    ? `${selectedChild.name.split(' ')[0]}'s reading accuracy has improved this month.`
                    : `Keep practicing to build on ${selectedChild.name.split(' ')[0]}'s progress.`}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.trendEmpty}>
              <Ionicons name="analytics-outline" size={28} color={HOME_LAVENDER} />
              <Text style={styles.trendEmptyText}>Not enough practice sessions yet to show a trend.</Text>
            </View>
          )}
          {!!lastSessionAt && <Text style={styles.trendUpdated}>Last updated {relativeTime(lastSessionAt)}</Text>}
        </View>

        <Text style={styles.homeSectionTitle}>Areas to Practice</Text>
        <View style={styles.skillsRow}>
          {skillMeta.map(({ key, label, icon }) => {
            const group = skillGroups[key];
            const avg = group.count > 0 ? Math.round(group.sum / group.count) : null;
            const status = skillStatus(avg);
            return (
              <View key={key} style={styles.skillCard}>
                <Ionicons name={icon as any} size={18} color={status.color} />
                <Text style={styles.skillCardLabel} numberOfLines={2}>{label}</Text>
                <Text style={[styles.skillCardStatus, { color: status.color }]}>{status.label}</Text>
                <View style={styles.skillCardTrack}>
                  <View style={[styles.skillCardFill, { width: `${avg ? Math.max(4, avg) : 0}%`, backgroundColor: status.color }]} />
                </View>
              </View>
            );
          })}
        </View>
        <TouchableOpacity style={styles.viewLessonProgressButton} onPress={() => setSection('progress')}>
          <Text style={styles.viewLessonProgressText}>View Lesson Progress</Text>
        </TouchableOpacity>

        {childCurrentLesson && (
          <>
            <Text style={styles.homeSectionTitle}>Child's Current Lesson</Text>
            <View style={styles.currentLessonCard}>
              <Text style={styles.currentLessonTitle}>{childCurrentLesson.title}</Text>
              <View style={[styles.currentLessonStatus, { backgroundColor: childCurrentLesson.status === 'completed' ? '#E9F1E2' : '#FFF3DC' }]}>
                <Text style={[styles.currentLessonStatusText, { color: childCurrentLesson.status === 'completed' ? SUCCESS : HOME_SUN }]}>
                  {childCurrentLesson.status === 'completed' ? 'Completed' : 'In Progress'}
                </Text>
              </View>
            </View>
          </>
        )}

        <View style={styles.tipBanner}>
          <Ionicons name="heart" size={22} color={HOME_CORAL} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tipBannerTitle}>Keep Supporting Their Reading Journey</Text>
            <Text style={styles.tipBannerText}>Small steps every day can make a big difference. Encourage your child to practice reading regularly.</Text>
          </View>
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => setShowEnroll(true)}>
            <Ionicons name="person-add" size={16} color={HOME_LAVENDER_DARK} />
            <Text style={styles.quickActionText}>Enroll Child</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('progress')}>
            <Ionicons name="bar-chart" size={16} color={HOME_LAVENDER_DARK} />
            <Text style={styles.quickActionText}>View Reports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('settings')}>
            <Ionicons name="person-circle" size={16} color={HOME_LAVENDER_DARK} />
            <Text style={styles.quickActionText}>Manage Profile</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const renderProgress = () => {
    const selectedChild = children.find((child) => child.id === selectedChildId) || children[0];

    const header = (
      <View style={styles.homeHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.homeGreeting}>Child Progress</Text>
          <Text style={styles.homeGreetingSub}>Track your child's reading development.</Text>
        </View>
      </View>
    );

    if (!selectedChild) {
      return (
        <>
          {header}
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📝</Text>
            <Text style={styles.emptyText}>Wala pang anak na may progress.</Text>
          </View>
        </>
      );
    }

    const progress = selectedChild.child_progress?.[0];
    const level = (progress?.level || 'Beginner') as Level;
    const isActivelyLearning = !!progress?.last_practice_date && progress.last_practice_date.slice(0, 10) === new Date().toISOString().slice(0, 10);

    const PERIOD_LABELS: { key: typeof progressPeriod; label: string }[] = [
      { key: '7d', label: '7 Days' },
      { key: '30d', label: '30 Days' },
      { key: '90d', label: '3 Months' },
      { key: 'all', label: 'All Time' },
    ];
    const periodDays = progressPeriod === '7d' ? 7 : progressPeriod === '30d' ? 30 : progressPeriod === '90d' ? 90 : null;
    const nowMs = Date.now();
    const dayMs = 86400000;

    const inPeriod = periodDays === null
      ? childSessions
      : childSessions.filter((s) => nowMs - new Date(s.created_at).getTime() <= periodDays * dayMs);
    const priorPeriod = periodDays === null
      ? []
      : childSessions.filter((s) => {
          const age = nowMs - new Date(s.created_at).getTime();
          return age > periodDays * dayMs && age <= periodDays * 2 * dayMs;
        });

    const avgOf = (rows: typeof childSessions) =>
      rows.length ? Math.round(rows.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / rows.length) : null;
    const periodAvg = avgOf(inPeriod);
    const priorAvg = avgOf(priorPeriod);
    const periodDelta = periodDays !== null && periodAvg !== null && priorAvg !== null ? periodAvg - priorAvg : null;

    const totalWords = inPeriod.length;
    const correctCount = inPeriod.filter((s) => s.is_correct).length;

    const tierColor = (pct: number) => (pct >= 80 ? SUCCESS : pct >= 60 ? WARNING : DANGER);
    const tierMessage = (pct: number | null) =>
      pct === null
        ? 'No practice recorded in this period yet.'
        : pct >= 80
        ? `${selectedChild.name.split(' ')[0]} is making excellent progress in reading.`
        : pct >= 60
        ? `${selectedChild.name.split(' ')[0]} is making steady progress in reading.`
        : `${selectedChild.name.split(' ')[0]} could use a bit more practice this period.`;

    // Trend chart buckets - daily for 7d, weekly otherwise (bucket width
    // widens for longer periods so the chart doesn't get overcrowded).
    const bucketPoints = (() => {
      if (progressPeriod === '7d') {
        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() - (6 - i));
          const dayKey = d.toISOString().slice(0, 10);
          const rows = childSessions.filter((s) => (s.created_at || '').slice(0, 10) === dayKey);
          return { label: dayLabels[d.getDay()], pct: avgOf(rows) };
        });
      }
      const bucketCount = progressPeriod === '30d' ? 4 : 6;
      const bucketDays = progressPeriod === '30d' ? 7 : progressPeriod === '90d' ? 15 : 30;
      return Array.from({ length: bucketCount }, (_, i) => {
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        end.setDate(end.getDate() - (bucketCount - 1 - i) * bucketDays);
        const start = new Date(end);
        start.setDate(start.getDate() - (bucketDays - 1));
        start.setHours(0, 0, 0, 0);
        const rows = childSessions.filter((s) => {
          const t = new Date(s.created_at).getTime();
          return t >= start.getTime() && t <= end.getTime();
        });
        const label = progressPeriod === '30d' ? `Week ${i + 1}` : end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return { label, pct: avgOf(rows) };
      });
    })();
    const bucketsWithData = bucketPoints.filter((b) => b.pct !== null);

    // Skill categories - same real per-word-shape grouping as the Home tab
    // and the Student Dashboard, scoped to this period's sessions.
    const skillGroups: Record<SkillCategory, { count: number; sum: number }> = {
      letters: { count: 0, sum: 0 },
      syllables: { count: 0, sum: 0 },
      words: { count: 0, sum: 0 },
    };
    inPeriod.forEach((s) => {
      const cat = categorizeWord(s.word);
      skillGroups[cat].count += 1;
      skillGroups[cat].sum += Number(s.accuracy_percentage) || 0;
    });

    // Reading Fluency - an approximate proxy from average response time
    // (duration_seconds), not a real fluency measurement. Clearly labeled as
    // such since it's a heuristic (<=3s treated as fully fluent, >=10s as not)
    // rather than a validated metric, and only populates for sessions
    // recorded after duration tracking was added.
    const durations = inPeriod
      .map((s) => s.duration_seconds)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const FLUENCY_FAST_SECONDS = 3;
    const FLUENCY_SLOW_SECONDS = 10;
    const fluencyScore = avgDuration === null
      ? null
      : Math.round(Math.max(0, Math.min(100, (1 - (avgDuration - FLUENCY_FAST_SECONDS) / (FLUENCY_SLOW_SECONDS - FLUENCY_FAST_SECONDS)) * 100)));

    const skillMeta: { key: string; label: string; icon: string; avg: number | null; approximate?: boolean }[] = [
      { key: 'letters', label: 'Letter Recognition', icon: 'text', avg: skillGroups.letters.count ? Math.round(skillGroups.letters.sum / skillGroups.letters.count) : null },
      { key: 'syllables', label: 'Syllable Reading', icon: 'reader', avg: skillGroups.syllables.count ? Math.round(skillGroups.syllables.sum / skillGroups.syllables.count) : null },
      { key: 'words', label: 'Word Reading', icon: 'book', avg: skillGroups.words.count ? Math.round(skillGroups.words.sum / skillGroups.words.count) : null },
      { key: 'fluency', label: 'Reading Fluency (approx.)', icon: 'speedometer', avg: fluencyScore, approximate: true },
    ];
    const skillStatus = (avg: number | null) =>
      avg === null
        ? { label: 'Not enough data', color: HOME_INK_SOFT }
        : avg >= 80
        ? { label: 'Strong', color: SUCCESS }
        : avg >= 60
        ? { label: 'Improving', color: WARNING }
        : { label: 'Needs More Practice', color: DANGER };

    const scoredSkills = skillMeta.filter((s) => s.avg !== null) as (typeof skillMeta[number] & { avg: number })[];
    const weakestSkill = scoredSkills.length ? scoredSkills.reduce((a, b) => (a.avg <= b.avg ? a : b)) : null;

    // Words practiced per day (last 7 calendar days, independent of the
    // period filter - this specific mini-chart is always framed as "this week").
    const miniDayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const miniDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      const dayKey = d.toISOString().slice(0, 10);
      const count = childSessions.filter((s) => (s.created_at || '').slice(0, 10) === dayKey).length;
      const weekday = d.getDay() === 0 ? 6 : d.getDay() - 1;
      return { label: miniDayLabels[weekday], count };
    });
    const maxMiniCount = Math.max(1, ...miniDays.map((d) => d.count));
    const wordsThisWeek = miniDays.reduce((sum, d) => sum + d.count, 0);

    const historySessions = [...inPeriod].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const visibleHistory = historyExpanded ? historySessions.slice(0, 30) : historySessions.slice(0, 6);

    const chartWidth = Math.max(240, screenWidth - 32 - 32);

    return (
      <>
        {header}

        <TouchableOpacity
          style={styles.viewingSelector}
          onPress={() => children.length > 1 && setChildPickerOpen((open) => !open)}
          activeOpacity={children.length > 1 ? 0.7 : 1}
        >
          <Text style={styles.viewingSelectorText}>Viewing: {selectedChild.name}</Text>
          {children.length > 1 && <Ionicons name={childPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={HOME_LAVENDER_DARK} />}
        </TouchableOpacity>

        {childPickerOpen && children.length > 1 && (
          <View style={styles.childPickerList}>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.childPickerRow}
                onPress={() => {
                  setSelectedChildId(child.id);
                  setChildPickerOpen(false);
                }}
              >
                <Text style={[styles.childPickerRowText, child.id === selectedChild.id && { color: HOME_LAVENDER_DARK, fontWeight: '800' }]}>
                  {child.name}
                </Text>
                {child.id === selectedChild.id && <Ionicons name="checkmark" size={16} color={HOME_LAVENDER_DARK} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.childSummaryCard}>
          <View style={styles.childAvatarLg}>
            <Text style={styles.childAvatarLgText}>{selectedChild.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.childSummaryName}>{selectedChild.name}</Text>
            <View style={styles.childSummaryBadgeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>Grade {selectedChild.grade_level}</Text>
              </View>
              <View style={[styles.levelBadgeOutline, { borderColor: getLevelColor(level) }]}>
                <Text style={[styles.levelBadgeOutlineText, { color: getLevelColor(level) }]}>{level}</Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusDotLg, { backgroundColor: isActivelyLearning ? SUCCESS : HOME_INK_SOFT }]} />
              <Text style={styles.statusRowText}>{isActivelyLearning ? 'Actively Learning' : 'No activity today'}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.homeSectionTitle}>Progress Overview</Text>
        <Text style={styles.periodFilterLabel}>TIME PERIOD FILTER</Text>
        <View style={styles.periodFilterRow}>
          {PERIOD_LABELS.map((period) => (
            <TouchableOpacity
              key={period.key}
              style={[styles.periodChip, progressPeriod === period.key && styles.periodChipActive]}
              onPress={() => setProgressPeriod(period.key)}
            >
              <Text style={[styles.periodChipText, progressPeriod === period.key && styles.periodChipTextActive]}>{period.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.readingProgressCard}>
          <View style={styles.readingProgressHeader}>
            <Text style={styles.readingProgressTitle}>Overall Reading Progress</Text>
            <Ionicons name="book" size={24} color={HOME_LAVENDER} />
          </View>
          <View style={{ alignItems: 'center', marginVertical: 12 }}>
            <ProgressRing percent={periodAvg ?? 0} color={HOME_LAVENDER_DARK} trackColor="rgba(124,111,207,0.15)">
              <Text style={styles.readingProgressPct}>{periodAvg !== null ? `${periodAvg}%` : '--'}</Text>
              <Text style={styles.readingProgressPctSub}>Current Progress</Text>
            </ProgressRing>
          </View>
          {periodDelta !== null && (
            <View style={[styles.improvementBadge, { backgroundColor: periodDelta >= 0 ? '#E9F1E2' : '#FBE7DF' }]}>
              <Ionicons name={periodDelta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={periodDelta >= 0 ? SUCCESS : DANGER} />
              <Text style={[styles.improvementBadgeText, { color: periodDelta >= 0 ? SUCCESS : DANGER }]}>
                {periodDelta >= 0 ? '+' : ''}{periodDelta}% this period
              </Text>
            </View>
          )}
          <Text style={styles.readingProgressMessage}>{tierMessage(periodAvg)}</Text>
        </View>

        <Text style={styles.homeSectionTitle}>Reading Performance</Text>
        <View style={styles.trendCard}>
          {bucketsWithData.length >= 2 ? (
            <>
              <TrendLineChart points={bucketPoints} width={chartWidth} color={HOME_LAVENDER_DARK} />
              <View style={styles.trendMsgRow}>
                <Ionicons name="checkmark-circle" size={13} color={SUCCESS} />
                <Text style={styles.trendMsgText}>
                  {bucketsWithData[bucketsWithData.length - 1].pct! >= bucketsWithData[0].pct!
                    ? 'Reading accuracy has improved over this period.'
                    : 'Keep practicing to build on recent progress.'}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.trendEmpty}>
              <Ionicons name="analytics-outline" size={28} color={HOME_LAVENDER} />
              <Text style={styles.trendEmptyText}>Not enough practice sessions in this period to show a trend.</Text>
            </View>
          )}
        </View>

        <Text style={styles.homeSectionTitle}>Reading Skills</Text>
        <View style={styles.overallStatsRow}>
          <View style={styles.overallStatCell}>
            <Text style={styles.overallStatValue}>{periodAvg !== null ? `${periodAvg}%` : '--'}</Text>
            <Text style={styles.overallStatLabel}>Overall</Text>
          </View>
          <View style={styles.overallStatCell}>
            <Text style={styles.overallStatValue}>{totalWords}</Text>
            <Text style={styles.overallStatLabel}>Total Words</Text>
          </View>
          <View style={styles.overallStatCell}>
            <Text style={styles.overallStatValue}>{correctCount}</Text>
            <Text style={styles.overallStatLabel}>Correct</Text>
          </View>
          <View style={styles.overallStatCell}>
            <Text style={[styles.overallStatValue, { color: periodDelta === null ? HOME_INK : periodDelta >= 0 ? SUCCESS : DANGER }]}>
              {periodDelta === null ? '--' : `${periodDelta >= 0 ? '+' : ''}${periodDelta}%`}
            </Text>
            <Text style={styles.overallStatLabel}>Improvement</Text>
          </View>
        </View>

        <View style={styles.skillsGrid}>
          {skillMeta.map(({ key, label, icon, avg }) => {
            const status = skillStatus(avg);
            return (
              <View key={key} style={styles.skillGridCard}>
                <Ionicons name={icon as any} size={18} color={status.color} />
                <View style={styles.skillGridTopRow}>
                  <Text style={styles.skillGridLabel} numberOfLines={2}>{label}</Text>
                  <Text style={[styles.skillGridPct, { color: status.color }]}>{avg !== null ? `${avg}%` : '--'}</Text>
                </View>
                <Text style={[styles.skillGridStatus, { color: status.color }]}>{status.label}</Text>
                <View style={styles.skillCardTrack}>
                  <View style={[styles.skillCardFill, { width: `${avg ? Math.max(4, avg) : 0}%`, backgroundColor: status.color }]} />
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.miniChartCard}>
          <Text style={styles.miniChartTitle}>{wordsThisWeek} words practiced this week</Text>
          <View style={styles.miniChartBars}>
            {miniDays.map((d, i) => (
              <View key={i} style={styles.miniBarCol}>
                <View style={[styles.miniBar, { height: Math.max(4, Math.round((d.count / maxMiniCount) * 60)) }]} />
                <Text style={styles.miniBarLabel}>{d.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.miniChartSub}>
            Average {Math.round(wordsThisWeek / 7)} word{Math.round(wordsThisWeek / 7) === 1 ? '' : 's'} per day this week
          </Text>
        </View>

        {weakestSkill && (
          <View style={styles.recommendCard}>
            <View style={styles.recommendIconWrap}>
              <Ionicons name="bulb" size={18} color={HOME_SUN} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recommendTitle}>Recommended Next Step</Text>
              <Text style={styles.recommendText}>
                Continue practicing {weakestSkill.label.replace(' (approx.)', '')} - it's currently {selectedChild.name.split(' ')[0]}'s area with the most room to grow.
              </Text>
              <TouchableOpacity style={styles.recommendButton} onPress={() => setSection('welcome')}>
                <Text style={styles.recommendButtonText}>View Recommended Activities</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {periodAvg !== null && (
          <View style={styles.insightCardV2}>
            <Ionicons name="sparkles" size={18} color={HOME_LAVENDER_DARK} />
            <Text style={styles.insightCardV2Text}>
              {periodDelta !== null && periodDelta > 0
                ? `${selectedChild.name.split(' ')[0]}'s reading accuracy has improved by ${periodDelta}% in this period. Consistent practice is helping build confidence.`
                : `${selectedChild.name.split(' ')[0]} has completed ${totalWords} practice ${totalWords === 1 ? 'session' : 'sessions'} in this period. Keep encouraging regular practice.`}
            </Text>
          </View>
        )}

        <Text style={styles.homeSectionTitle}>Recent Learning History</Text>
        <View style={styles.selectedTasksCard}>
          {visibleHistory.length ? (
            visibleHistory.map((session, i) => (
              <View key={`${session.created_at}-${i}`} style={styles.activityRow}>
                <View style={styles.activityEmoji}>
                  <Ionicons name="mic" size={18} color={HOME_LAVENDER_DARK} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityChildName}>Tagalog Word Practice</Text>
                  <Text style={styles.activityTitle}>{session.word} · {new Date(session.created_at).toLocaleString()}</Text>
                </View>
                <Text style={[styles.recentActivityScore, { color: tierColor(Math.round(Number(session.accuracy_percentage) || 0)) }]}>
                  {Math.round(Number(session.accuracy_percentage) || 0)}%
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyDetail}>No speech practice yet.</Text>
          )}
        </View>

        <TouchableOpacity style={styles.detailedReportButton} onPress={() => setHistoryExpanded((v) => !v)}>
          <Text style={styles.detailedReportButtonText}>{historyExpanded ? 'Show Less' : 'View Detailed Report'}</Text>
        </TouchableOpacity>
      </>
    );
  };

  const renderInsights = () => (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>AI Reading Insights</Text>
      </View>
      {children.length ? (
        children.map((child) => {
          const progress = child.child_progress?.[0];
          const insightRows = getInsights(progress, child.name);
          return (
            <View key={child.id} style={styles.insightCard}>
              <Text style={styles.insightChildName}>{child.name}</Text>
              {insightRows.map((insight, index) => (
                <View
                  key={index}
                  style={[styles.insightRow, index === insightRows.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Text style={styles.insightText}>{insight}</Text>
                </View>
              ))}
            </View>
          );
        })
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>💡</Text>
          <Text style={styles.emptyText}>Wala pang anak na maaring magbigay ng insight.</Text>
        </View>
      )}
    </>
  );

  const renderActivities = () => (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>Recent Activities</Text>
      </View>
      {recentActivities.length ? (
        recentActivities.map((activity) => (
          <View key={`${activity.childName}-${activity.achievementId}-${activity.unlockedAt}`} style={styles.activityRow}>
            <View style={styles.activityEmoji}>
              <Text style={styles.activityEmojiText}>🎯</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityChildName}>{activity.childName} — {activity.def?.title || activity.achievementId}</Text>
              <Text style={styles.activityTitle}>{activity.def?.title || 'Achievement unlocked.'}</Text>
              <Text style={styles.activityDate}>{new Date(activity.unlockedAt).toLocaleDateString()} · {new Date(activity.unlockedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyText}>Wala pang aktibidad na naitala.</Text>
        </View>
      )}
    </>
  );

  const renderRewards = () => (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>Rewards & Achievements</Text>
      </View>
      <View style={styles.rewardsGrid}>
        {achievementStats.map(({ achievement, unlockedBy }) => {
          const unlocked = unlockedBy.length > 0;
          return (
            <View
              key={achievement.id}
              style={[
                styles.rewardCell,
                { backgroundColor: unlocked ? PRIMARY_LIGHT : '#f9fafb', borderColor: unlocked ? PRIMARY : BORDER },
              ]}
            >
              <Image source={achievement.image} style={styles.rewardImage} resizeMode="contain" />
              <Text style={styles.rewardTitle}>{achievement.title}</Text>
              <View style={styles.rewardChildRow}>
                {children.map((child) => {
                  const childUnlocked = child.child_progress?.[0]?.achievements.some((item) => item.id === achievement.id);
                  return (
                    <View
                      key={`${achievement.id}-${child.id}`}
                      style={[styles.rewardChip, { backgroundColor: childUnlocked ? SUCCESS : '#fee2e2' }]}
                    >
                      <Text style={[styles.rewardChipText, { color: childUnlocked ? TEXT_PRIMARY : DANGER }]}> 
                        {child.name.split(' ')[0]} {childUnlocked ? '✅' : '❌'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </>
  );

  const renderCalendar = () => {
    const selectedActivities = getActivitiesForDate(selectedCalendarDate);
    const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const overdueCount = activities.filter((activity) => activity.status === 'overdue').length;
    const completedCount = activities.filter((activity) => activity.status === 'completed').length;

    return (
      <>
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionHeaderTitle}>Calendar</Text>
            <Text style={styles.sectionHeaderSub}>
              {activities.length} activities - {overdueCount} overdue - {completedCount} completed
            </Text>
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
              const dayScheduled = getScheduledForDate(key);
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
                  {(!!dayActivities.length || !!dayScheduled.length) && (
                    <View style={styles.dayDots}>
                      {!!dayActivities.length && (
                        <View style={[styles.dayDot, { backgroundColor: hasOverdue ? DANGER : hasCompleted ? SUCCESS : WARNING }]} />
                      )}
                      {!!dayScheduled.length && <View style={[styles.dayDot, { backgroundColor: HOME_LAVENDER_DARK }]} />}
                      {dayActivities.length + dayScheduled.length > 1 && (
                        <Text style={styles.dayCount}>{dayActivities.length + dayScheduled.length}</Text>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.selectedTasksCard}>
          <View style={styles.selectedTasksHeaderRow}>
            <Text style={styles.selectedTasksTitle}>
              {new Date(`${selectedCalendarDate}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
            </Text>
            <TouchableOpacity
              style={styles.addPlanButton}
              onPress={() => {
                setEditingScheduledActivity(null);
                setActivityModalVisible(true);
              }}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addPlanButtonText}>Magdagdag</Text>
            </TouchableOpacity>
          </View>
          {selectedActivities.length ? (
            selectedActivities.map((activity) => (
              <View key={activity.id} style={styles.calendarTaskRow}>
                <View style={[styles.statusStrip, { backgroundColor: getStatusColor(activity.status) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityChildName}>{activity.title}</Text>
                  <Text style={styles.activityTitle}>
                    {getChildNameForActivity(activity)} - {activity.subject || 'Activity'} - {new Date(activity.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {!!activity.description && <Text style={styles.activityDate}>{activity.description}</Text>}
                </View>
                <Text style={[styles.statusBadge, { color: getStatusColor(activity.status) }]}>{activity.status}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyDetail}>No activities on this date.</Text>
          )}
        </View>

        <View style={styles.selectedTasksCard}>
          <Text style={styles.selectedTasksTitle}>Mga Plano Mo</Text>
          {getScheduledForDate(selectedCalendarDate).length ? (
            getScheduledForDate(selectedCalendarDate).map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.scheduledRow}
                onPress={() => {
                  setEditingScheduledActivity(item);
                  setActivityModalVisible(true);
                }}
              >
                <View style={styles.scheduledIconWrap}>
                  <Ionicons name={SCHEDULED_TYPE_ICON[item.activity_type]} size={18} color={HOME_LAVENDER_DARK} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityChildName}>{item.title}</Text>
                  <Text style={styles.activityTitle}>
                    {getChildNameForScheduled(item)}
                    {item.start_time ? ` - ${item.start_time.slice(0, 5)}` : ''}
                  </Text>
                  {!!item.description && <Text style={styles.activityDate}>{item.description}</Text>}
                </View>
                <TouchableOpacity
                  style={styles.scheduledCompleteButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    void toggleScheduledComplete(item);
                  }}
                  disabled={item.status === 'completed'}
                >
                  <Ionicons
                    name={item.status === 'completed' ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    size={22}
                    color={getScheduledStatusColor(item.status)}
                  />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.emptyDetail}>Wala ka pang naka-schedule na plano sa araw na ito.</Text>
          )}
        </View>
      </>
    );
  };

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const renderToggleRow = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    subtitle: string,
    key: keyof DashboardSettings,
    value: boolean | undefined,
    isLast = false,
  ) => (
    <View style={[styles.settingsToggleRow, isLast && { borderBottomWidth: 0 }]}>
      <Ionicons name={icon} size={20} color={HOME_LAVENDER_DARK} />
      <View style={{ flex: 1 }}>
        <Text style={styles.settingsRowTitle}>{title}</Text>
        <Text style={styles.settingsRowSub}>{subtitle}</Text>
      </View>
      <Switch
        value={!!value}
        onValueChange={(next) => updateParentSetting(key, next as any)}
        disabled={savingSettingKey === String(key)}
        trackColor={{ false: '#cbd5e1', true: 'rgba(95,82,176,0.4)' }}
        thumbColor={value ? HOME_LAVENDER_DARK : '#f8fafc'}
      />
    </View>
  );

  const renderSettings = () => (
    <>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionHeaderTitle}>Settings</Text>
          <Text style={styles.sectionHeaderSub}>Manage your account and preferences.</Text>
        </View>
      </View>

      <View style={styles.accountCard}>
        <View style={styles.accountCardTop}>
          {parentAvatarUrl ? (
            <Image source={{ uri: parentAvatarUrl }} style={styles.accountAvatar} />
          ) : (
            <View style={[styles.accountAvatar, styles.accountAvatarPlaceholder]}>
              <Text style={styles.accountAvatarInitial}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.accountName}>{parentName}</Text>
            <Text style={styles.accountEmail}>{parentEmail}</Text>
            <View style={styles.accountBadge}>
              <Text style={styles.accountBadgeText}>Parent Account</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.editProfileButton} onPress={() => setEditProfileVisible(true)}>
          <Text style={styles.editProfileButtonText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.settingsGroupTitle}>My Children</Text>
      {children.map((child) => {
        const childInitials = child.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
        const level = child.child_progress?.[0]?.level;
        return (
          <View key={child.id} style={styles.childSettingsCard}>
            <View style={[styles.accountAvatar, styles.accountAvatarPlaceholder, styles.childAvatarSize]}>
              <Text style={styles.accountAvatarInitial}>{childInitials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>{child.name}</Text>
              <Text style={styles.accountEmail}>
                Grade {child.grade_level}
                {level ? ` - ${level}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.manageChildButton}
              onPress={() => {
                setSelectedChildId(child.id);
                setSection('progress');
              }}
            >
              <Text style={styles.manageChildButtonText}>Manage Child</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <TouchableOpacity style={styles.enrollChildRow} onPress={() => setShowEnroll(true)}>
        <Ionicons name="add" size={18} color={HOME_LAVENDER_DARK} />
        <Text style={styles.enrollChildRowText}>Enroll New Child</Text>
      </TouchableOpacity>

      <Text style={styles.settingsGroupTitle}>Account Settings</Text>
      <View style={styles.settingsListCard}>
        <TouchableOpacity style={styles.settingsRow} onPress={() => setEditProfileVisible(true)}>
          <Ionicons name="person-outline" size={20} color={HOME_LAVENDER_DARK} />
          <View style={{ flex: 1 }}>
            <Text style={styles.settingsRowTitle}>Personal Information</Text>
            <Text style={styles.settingsRowSub}>Update your name and phone number</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HOME_INK_SOFT} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => {
            setNewEmailInput(parentEmail);
            setEmailModalError('');
            setEmailModalVisible(true);
          }}
        >
          <Ionicons name="mail-outline" size={20} color={HOME_LAVENDER_DARK} />
          <View style={{ flex: 1 }}>
            <Text style={styles.settingsRowTitle}>Email Address</Text>
            <Text style={styles.settingsRowSub}>{parentEmail}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HOME_INK_SOFT} />
        </TouchableOpacity>

        {!parentSettings ? (
          <ActivityIndicator color={HOME_LAVENDER_DARK} style={{ marginVertical: 16 }} />
        ) : (
          <>
            {renderToggleRow('book-outline', 'Lesson Updates', 'When your child opens a lesson', 'lesson_notifications', parentSettings.lesson_notifications)}
            {renderToggleRow('stats-chart-outline', 'Progress Updates', "Get notified about your child's reading progress", 'progress_notifications', parentSettings.progress_notifications)}
            {renderToggleRow('ribbon-outline', 'Achievement Updates', 'Celebrate milestones and achievements', 'milestone_alerts', parentSettings.milestone_alerts)}
            {renderToggleRow('calendar-outline', 'Weekly Progress Reports', "Weekly summary of your child's reading", 'weekly_progress_reports', parentSettings.weekly_progress_reports, true)}
          </>
        )}
      </View>

      <Text style={styles.settingsGroupTitle}>Reading Support Preferences</Text>
      <View style={styles.settingsListCard}>
        {!parentSettings ? (
          <ActivityIndicator color={HOME_LAVENDER_DARK} style={{ marginVertical: 16 }} />
        ) : (
          <>
            {renderToggleRow('text-outline', 'Dyslexia-Friendly Font', 'Use a font designed to improve readability', 'dyslexia_font', parentSettings.dyslexia_font)}
            {renderToggleRow('volume-high-outline', 'Text-to-Speech', 'Listen to text read aloud in the app', 'tts_enabled', parentSettings.tts_enabled)}
            <View style={[styles.settingsToggleRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="speedometer-outline" size={20} color={HOME_LAVENDER_DARK} />
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsRowTitle}>Speech Speed</Text>
                <Text style={styles.settingsRowSub}>{parentSettings.speech_rate || 'normal'}</Text>
              </View>
              <View style={styles.speedSegment}>
                {(['slow', 'normal', 'fast'] as SpeechRate[]).map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.speedSegmentButton, parentSettings.speech_rate === opt && styles.speedSegmentButtonActive]}
                    onPress={() => updateParentSetting('speech_rate', opt)}
                  >
                    <Text style={[styles.speedSegmentText, parentSettings.speech_rate === opt && styles.speedSegmentTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        )}
      </View>

      <Text style={styles.settingsGroupTitle}>Help & Support</Text>
      <View style={styles.settingsListCard}>
        <TouchableOpacity style={styles.settingsRow} onPress={contactSupport}>
          <Ionicons name="headset-outline" size={20} color={HOME_LAVENDER_DARK} />
          <View style={{ flex: 1 }}>
            <Text style={styles.settingsRowTitle}>Contact Support</Text>
            <Text style={styles.settingsRowSub}>Get help from our team</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HOME_INK_SOFT} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => Linking.openURL('https://linawletra.app/privacy').catch(() => {})}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={HOME_LAVENDER_DARK} />
          <View style={{ flex: 1 }}>
            <Text style={styles.settingsRowTitle}>Privacy Policy</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HOME_INK_SOFT} />
        </TouchableOpacity>
        <View style={[styles.settingsRow, { borderBottomWidth: 0 }]}>
          <Ionicons name="information-circle-outline" size={20} color={HOME_LAVENDER_DARK} />
          <View style={{ flex: 1 }}>
            <Text style={styles.settingsRowTitle}>App Version</Text>
            <Text style={styles.settingsRowSub}>{appVersion} - Up to date</Text>
          </View>
        </View>
      </View>
    </>
  );

  const renderSection = () => {
    switch (section) {
      case 'welcome':
        return renderWelcome();
      case 'progress':
        return renderProgress();
      case 'calendar':
        return renderCalendar();
      case 'notifications':
        return (
          <ErrorBoundary title="Notifications unavailable" message="Notifications could not load right now. The rest of the dashboard is still ready.">
            <NotificationsView
              userId={parentId}
              childList={children.map((child) => ({ id: child.id, name: child.name }))}
              onUnreadChange={setUnreadNotifications}
              onNavigate={setSection}
            />
          </ErrorBoundary>
        );
      case 'settings':
        return renderSettings();
      default:
        return renderWelcome();
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={openSidebar} style={styles.menuButton}>
          <Ionicons name="menu-outline" size={26} color={PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.appTitle}>LinawLetra</Text>
        {/* Balances menuButton's width so appTitle stays centered now that
            the bell (moved into the sidebar's Notifications nav item) is gone. */}
        <View style={styles.topBarSpacer} />
      </View>

      {!!error && <Text style={styles.errorBanner}>{error}</Text>}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {renderSection()}
      </ScrollView>

      {sidebarOpen && (
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} onTouchEnd={closeSidebar} />
      )}

      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}> 
        <View style={styles.sidebarProfile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.sidebarName}>{parentName}</Text>
          <Text style={styles.sidebarEmail}>{parentEmail}</Text>
        </View>
        <ScrollView style={styles.sidebarNav} showsVerticalScrollIndicator={false}>
          {NAV_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.navItem, section === item.key && styles.navItemActive]}
              onPress={() => navigateTo(item.key)}
            >
              <Ionicons name={item.icon as any} size={20} color={section === item.key ? PRIMARY_TEXT : '#fff'} />
              <Text style={[styles.navLabel, section === item.key && styles.navLabelActive]}>{item.label}</Text>
              {item.key === 'notifications' && unreadNotifications > 0 && <View style={styles.navDot} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.sidebarLogout} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.sidebarLogoutText}>Mag-log out</Text>
        </TouchableOpacity>
      </Animated.View>

      <EnrollChildModal
        visible={showEnroll}
        parentId={parentId}
        parentEmail={parentEmail}
        onClose={() => setShowEnroll(false)}
        onEnrolled={async () => {
          setShowEnroll(false);
          const rows = await loadChildren(parentId);
          await loadActivitiesForChildren(rows);
          await loadScheduledActivitiesForChildren(rows);
        }}
      />

      <AddScheduledActivityModal
        visible={activityModalVisible}
        date={selectedCalendarDate}
        children={children.map((child) => ({ id: child.id, name: child.name }))}
        defaultChildId={selectedChildId}
        editing={editingScheduledActivity}
        onClose={() => {
          setActivityModalVisible(false);
          setEditingScheduledActivity(null);
        }}
        onSaved={async () => {
          setActivityModalVisible(false);
          setEditingScheduledActivity(null);
          await loadScheduledActivitiesForChildren(children);
        }}
      />

      <EditParentProfileModal
        visible={editProfileVisible}
        parentId={parentId}
        initialName={parentName}
        initialPhone={parentPhone}
        initialAvatarUrl={parentAvatarUrl}
        onClose={() => setEditProfileVisible(false)}
        onSaved={(profile) => {
          setParentName(profile.full_name);
          setParentPhone(profile.phone_number);
          setParentAvatarUrl(profile.avatar_url);
          setEditProfileVisible(false);
        }}
      />

      <Modal visible={emailModalVisible} animationType="slide" transparent onRequestClose={() => setEmailModalVisible(false)}>
        <View style={styles.emailModalBackdrop}>
          <View style={styles.emailModalSheet}>
            <View style={styles.emailModalHeader}>
              <Text style={styles.emailModalTitle}>Baguhin ang Email</Text>
              <TouchableOpacity onPress={() => setEmailModalVisible(false)} disabled={savingEmail}>
                <Ionicons name="close" size={24} color={HOME_INK} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.emailModalInput}
              value={newEmailInput}
              onChangeText={setNewEmailInput}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Bagong email"
              placeholderTextColor={HOME_INK_SOFT}
            />
            {!!emailModalError && <Text style={styles.emailModalError}>{emailModalError}</Text>}
            <TouchableOpacity style={[styles.emailModalSubmit, savingEmail && { opacity: 0.6 }]} onPress={submitEmailChange} disabled={savingEmail}>
              {savingEmail ? <ActivityIndicator color="#fff" /> : <Text style={styles.emailModalSubmitText}>I-save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BACKGROUND },
  center: { justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  menuButton: { padding: 6 },
  topBarSpacer: { width: 38 },
  settingsButton: { padding: 6, marginRight: 6 },
  appTitle: { fontSize: 20, fontWeight: '900', color: PRIMARY, flex: 1, textAlign: 'center' },
  errorBanner: { color: DANGER, marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
  content: { padding: 16, paddingBottom: 40 },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', zIndex: 99 },
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
  navDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DANGER },
  sidebarLogout: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 20, padding: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  sidebarLogoutText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  childCard: {
    backgroundColor: SURFACE, borderRadius: 20, padding: 18,
    marginBottom: 14, borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  childCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  childAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: PRIMARY_LIGHT, alignItems: 'center', justifyContent: 'center',
  },
  childAvatarText: { fontSize: 18, fontWeight: '900', color: PRIMARY },
  childName: { fontSize: 17, fontWeight: '900', color: TEXT_PRIMARY },
  childMeta: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  levelBadge: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  levelBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  greeting: { fontSize: 14, color: TEXT_SECONDARY, fontStyle: 'italic', marginBottom: 14, lineHeight: 20 },
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: PRIMARY_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  statChipText: { fontSize: 12, fontWeight: '800', color: PRIMARY_TEXT },
  progressTrack: { height: 8, backgroundColor: BORDER, borderRadius: 999, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: PRIMARY, borderRadius: 999 },
  progressLabel: { fontSize: 11, color: TEXT_SECONDARY, textAlign: 'right', marginBottom: 10 },
  childDetails: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyDetail: { color: TEXT_SECONDARY, fontSize: 13, marginTop: 8 },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 8 },
  quickAction: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: HOME_LAVENDER_DARK, backgroundColor: SURFACE,
  },
  quickActionText: { fontSize: 12, fontWeight: '800', color: HOME_LAVENDER_DARK },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  // Home tab redesign - shares the Student Dashboard's HOME_* palette for
  // visual identity, kept measured/adult in tone (no display font, minimal
  // emoji) compared to the more playful student-facing screens.
  homeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  homeAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: HOME_LAVENDER,
    alignItems: 'center', justifyContent: 'center',
  },
  homeAvatarText: { fontSize: 18, fontWeight: '900', color: '#fff' },
  homeGreeting: { fontSize: 22, fontWeight: '900', color: HOME_INK },
  homeGreetingSub: { fontSize: 13, color: HOME_INK_SOFT, marginTop: 2 },
  viewingSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'flex-start',
    backgroundColor: '#EFECFB', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, gap: 6, marginBottom: 12,
  },
  viewingSelectorText: { fontSize: 13, fontWeight: '800', color: HOME_LAVENDER_DARK },
  childPickerList: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 12, overflow: 'hidden',
  },
  childPickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  childPickerRowText: { fontSize: 14, color: TEXT_PRIMARY, fontWeight: '600' },
  childSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: SURFACE, borderRadius: 20, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  childAvatarLg: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#EFECFB',
    alignItems: 'center', justifyContent: 'center',
  },
  childAvatarLgText: { fontSize: 22, fontWeight: '900', color: HOME_LAVENDER_DARK },
  childSummaryName: { fontSize: 18, fontWeight: '900', color: HOME_INK, marginBottom: 8 },
  childSummaryBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  gradeBadge: { backgroundColor: '#f3f4f6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  gradeBadgeText: { fontSize: 11, fontWeight: '700', color: TEXT_SECONDARY },
  levelBadgeOutline: { borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  levelBadgeOutlineText: { fontSize: 11, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDotLg: { width: 8, height: 8, borderRadius: 4 },
  statusRowText: { fontSize: 12, fontWeight: '700', color: HOME_INK_SOFT },
  readingProgressCard: {
    backgroundColor: SURFACE, borderRadius: 20, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
  },
  readingProgressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  readingProgressTitle: { fontSize: 17, fontWeight: '900', color: HOME_INK },
  readingProgressPct: { fontSize: 26, fontWeight: '900', color: HOME_LAVENDER_DARK },
  readingProgressLabel: { fontSize: 13, color: HOME_INK_SOFT, fontWeight: '600', marginBottom: 10 },
  improvementBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10,
  },
  improvementBadgeText: { fontSize: 12, fontWeight: '800' },
  readingProgressMessage: { fontSize: 13, color: HOME_INK_SOFT, textAlign: 'center' },
  homeSectionTitle: { fontSize: 16, fontWeight: '900', color: HOME_INK, marginBottom: 10 },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  overviewCard: { width: '47%', borderRadius: 16, padding: 14 },
  overviewValue: { fontSize: 20, fontWeight: '900', marginTop: 8 },
  overviewLabel: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2, fontWeight: '700' },
  trendCard: {
    backgroundColor: SURFACE, borderRadius: 18, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  trendBars: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 120, marginBottom: 8 },
  trendBarCol: { alignItems: 'center', gap: 4, flex: 1 },
  trendBarValue: { fontSize: 11, fontWeight: '800' },
  trendBar: { width: 22, borderRadius: 6 },
  trendBarLabel: { fontSize: 10, color: TEXT_SECONDARY, marginTop: 4 },
  trendMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  trendMsgText: { fontSize: 12, color: HOME_INK_SOFT, flex: 1 },
  trendEmpty: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  trendEmptyText: { fontSize: 13, color: HOME_INK_SOFT, textAlign: 'center' },
  trendUpdated: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 10, textAlign: 'right' },
  skillsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  skillCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: BORDER, gap: 6,
  },
  skillCardLabel: { fontSize: 12, fontWeight: '800', color: HOME_INK, minHeight: 30 },
  skillCardStatus: { fontSize: 11, fontWeight: '700' },
  skillCardTrack: { height: 5, backgroundColor: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  skillCardFill: { height: '100%', borderRadius: 999 },
  viewLessonProgressButton: {
    backgroundColor: HOME_LAVENDER_DARK, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginBottom: 16,
  },
  viewLessonProgressText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  currentLessonCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  currentLessonTitle: { fontSize: 14, fontWeight: '800', color: HOME_INK, flex: 1 },
  currentLessonStatus: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  currentLessonStatusText: { fontSize: 11, fontWeight: '800' },
  tipBanner: {
    flexDirection: 'row', gap: 12, backgroundColor: HOME_CREAM, borderRadius: 18,
    padding: 16, marginBottom: 16, alignItems: 'flex-start',
  },
  tipBannerTitle: { fontSize: 13, fontWeight: '800', color: HOME_INK, marginBottom: 4 },
  tipBannerText: { fontSize: 12, color: HOME_INK_SOFT, lineHeight: 17 },

  // Child Progress tab
  trendLineLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  trendLineLabelText: { fontSize: 10, color: TEXT_SECONDARY, flex: 1, textAlign: 'center' },
  periodFilterLabel: { fontSize: 10, fontWeight: '800', color: TEXT_SECONDARY, letterSpacing: 0.5, marginBottom: 8 },
  periodFilterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodChip: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 999, paddingVertical: 9,
    alignItems: 'center', borderWidth: 1, borderColor: BORDER,
  },
  periodChipActive: { backgroundColor: HOME_LAVENDER_DARK, borderColor: HOME_LAVENDER_DARK },
  periodChipText: { fontSize: 11, fontWeight: '700', color: TEXT_SECONDARY },
  periodChipTextActive: { color: '#fff' },
  readingProgressPctSub: { fontSize: 10, color: HOME_INK_SOFT, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  overallStatsRow: {
    flexDirection: 'row', backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: BORDER,
  },
  overallStatCell: { flex: 1, alignItems: 'center' },
  overallStatValue: { fontSize: 17, fontWeight: '900', color: HOME_INK },
  overallStatLabel: { fontSize: 10, color: TEXT_SECONDARY, marginTop: 3, fontWeight: '700' },
  skillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  skillGridCard: {
    width: '47%', backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, gap: 6,
  },
  skillGridTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },
  skillGridLabel: { fontSize: 12, fontWeight: '800', color: HOME_INK, flex: 1 },
  skillGridPct: { fontSize: 15, fontWeight: '900' },
  skillGridStatus: { fontSize: 11, fontWeight: '700' },
  miniChartCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  miniChartTitle: { fontSize: 13, fontWeight: '800', color: HOME_INK, marginBottom: 10 },
  miniChartBars: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 70 },
  miniBarCol: { alignItems: 'center', gap: 4, flex: 1 },
  miniBar: { width: 14, borderRadius: 4, backgroundColor: HOME_LAVENDER },
  miniBarLabel: { fontSize: 9, color: TEXT_SECONDARY },
  miniChartSub: { fontSize: 11, color: HOME_INK_SOFT, marginTop: 10, textAlign: 'center' },
  recommendCard: {
    flexDirection: 'row', gap: 12, backgroundColor: '#FFF3DC', borderRadius: 16,
    padding: 16, marginBottom: 12, alignItems: 'flex-start',
  },
  recommendIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  recommendTitle: { fontSize: 13, fontWeight: '800', color: HOME_INK, marginBottom: 4 },
  recommendText: { fontSize: 12, color: HOME_INK_SOFT, lineHeight: 17, marginBottom: 10 },
  recommendButton: {
    backgroundColor: HOME_SUN, borderRadius: 999, paddingVertical: 9,
    paddingHorizontal: 14, alignSelf: 'flex-start',
  },
  recommendButtonText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  insightCardV2: {
    flexDirection: 'row', gap: 10, backgroundColor: '#EFECFB', borderRadius: 16,
    padding: 16, marginBottom: 16, alignItems: 'flex-start',
  },
  insightCardV2Text: { fontSize: 12, color: HOME_INK, lineHeight: 18, flex: 1 },
  detailedReportButton: {
    backgroundColor: HOME_LAVENDER_DARK, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 4, marginBottom: 8,
  },
  detailedReportButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  recentActivityScore: { fontSize: 15, fontWeight: '900' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionHeaderTitle: { fontSize: 18, fontWeight: '900', color: TEXT_PRIMARY, flex: 1 },
  sectionHeaderSub: { fontSize: 12, color: TEXT_SECONDARY },
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
    backgroundColor: SURFACE,
    borderRadius: 18,
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
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 14,
  },
  selectedTasksTitle: { color: TEXT_PRIMARY, fontWeight: '900', fontSize: 16, marginBottom: 10 },
  selectedTasksHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  addPlanButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: HOME_LAVENDER_DARK,
    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12,
  },
  addPlanButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  scheduledRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  scheduledIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFECFB',
    alignItems: 'center', justifyContent: 'center',
  },
  scheduledCompleteButton: { padding: 4 },
  calendarTaskRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  statusStrip: { width: 4, borderRadius: 999 },
  statusBadge: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  insightCard: { backgroundColor: PRIMARY_LIGHT, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: PRIMARY, padding: 16, marginBottom: 12 },
  insightChildName: { fontSize: 14, fontWeight: '900', color: PRIMARY_TEXT, marginBottom: 10 },
  insightRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#c7d2fe' },
  insightText: { color: TEXT_PRIMARY, lineHeight: 20 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  activityEmoji: { width: 44, height: 44, borderRadius: 22, backgroundColor: PRIMARY_LIGHT, alignItems: 'center', justifyContent: 'center' },
  activityEmojiText: { fontSize: 22 },
  activityChildName: { fontWeight: '800', color: TEXT_PRIMARY },
  activityTitle: { color: TEXT_SECONDARY, fontSize: 13, marginTop: 2 },
  activityDate: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 2 },
  rewardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  rewardCell: { width: '47%', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1.5 },
  rewardEmoji: { fontSize: 30, marginBottom: 8 },
  rewardImage: { width: 56, height: 56, marginBottom: 8 },
  rewardTitle: { fontSize: 13, fontWeight: '800', textAlign: 'center', marginBottom: 10, color: TEXT_PRIMARY },
  rewardChildRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  rewardChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999 },
  rewardChipText: { fontSize: 10, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 14 },
  emptyText: { color: TEXT_SECONDARY, fontSize: 15, textAlign: 'center' },
  emptyButton: { backgroundColor: PRIMARY, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
  emptyButtonText: { color: '#fff', fontWeight: '800' },
  rewardsChip: { backgroundColor: PRIMARY_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  rewardsChipText: { color: PRIMARY_TEXT, fontWeight: '800', fontSize: 11 },

  accountCard: {
    backgroundColor: SURFACE, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 20,
  },
  accountCardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accountAvatar: { width: 60, height: 60, borderRadius: 30 },
  accountAvatarPlaceholder: { backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  accountAvatarInitial: { color: HOME_LAVENDER_DARK, fontSize: 20, fontWeight: '900' },
  accountName: { fontSize: 16, fontWeight: '900', color: HOME_INK },
  accountEmail: { fontSize: 12, color: HOME_INK_SOFT, marginTop: 2 },
  accountBadge: {
    alignSelf: 'flex-start', backgroundColor: '#EFECFB', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3, marginTop: 6,
  },
  accountBadgeText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 11 },
  editProfileButton: {
    borderWidth: 1.5, borderColor: HOME_LAVENDER_DARK, borderRadius: 999,
    paddingVertical: 11, alignItems: 'center', marginTop: 14,
  },
  editProfileButtonText: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 13 },

  settingsGroupTitle: { fontSize: 15, fontWeight: '900', color: HOME_INK, marginBottom: 10, marginTop: 4 },
  childSettingsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: SURFACE, borderRadius: 18,
    padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 10,
  },
  childAvatarSize: { width: 52, height: 52, borderRadius: 26 },
  manageChildButton: { borderWidth: 1.5, borderColor: HOME_LAVENDER_DARK, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  manageChildButtonText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 12 },
  enrollChildRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: HOME_LAVENDER_DARK, borderStyle: 'dashed', borderRadius: 16,
    paddingVertical: 14, marginBottom: 20,
  },
  enrollChildRowText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 14 },

  settingsListCard: {
    backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  settingsToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  settingsRowTitle: { color: HOME_INK, fontWeight: '800', fontSize: 14 },
  settingsRowSub: { color: HOME_INK_SOFT, fontSize: 11, marginTop: 2 },
  speedSegment: { flexDirection: 'row', backgroundColor: '#EFECFB', borderRadius: 999, padding: 3 },
  speedSegmentButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  speedSegmentButtonActive: { backgroundColor: HOME_LAVENDER_DARK },
  speedSegmentText: { color: HOME_LAVENDER_DARK, fontWeight: '800', fontSize: 11, textTransform: 'capitalize' },
  speedSegmentTextActive: { color: '#fff' },

  emailModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  emailModalSheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  emailModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  emailModalTitle: { fontSize: 20, fontWeight: '800', color: HOME_INK },
  emailModalInput: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, fontSize: 15, color: HOME_INK },
  emailModalError: { color: '#E0574C', marginTop: 10, fontWeight: '600' },
  emailModalSubmit: { backgroundColor: HOME_LAVENDER_DARK, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16 },
  emailModalSubmitText: { color: '#fff', fontWeight: '800' },
});
