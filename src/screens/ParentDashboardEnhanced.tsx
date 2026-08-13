import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Linking, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Polyline, Stop } from 'react-native-svg';
import { supabase } from '../config/supabase';
import { getUserProfileById, onAuthStateChanged, signOutUser } from '../services/supabaseService';
import { fetchParentProfile } from '../services/profileService';
import { fetchNotifications, subscribeToParentNotifications } from '../services/notificationService';
import { fetchPublishedLessons, Lesson } from '../services/lessonService';
import { fetchLessonProgress, LessonProgressRow } from '../services/lessonProgressService';
import { fetchPronunciationSessions } from '../services/pronunciationSessionService';
import { NotificationsView } from './ParentNotifications';
import EnrollChildModal from './EnrollChildModal';
import AddScheduledActivityModal from './AddScheduledActivityModal';
import EditParentProfileModal from './EditParentProfileModal';
import { StudentActivity } from '../services/activityService';
import { fetchScheduledActivities, completeScheduledActivity, ScheduledActivity, subscribeToScheduledActivities } from '../services/scheduledActivityService';
import { buildApiUrl, getJson } from '../config/api';
import ErrorBoundary from '../components/ErrorBoundary';
import DashboardBottomNav, { BottomNavItem } from '../components/DashboardBottomNav';
import {
  fetchDashboardSettings,
  updateDashboardSettings,
  changeEmail,
  changePassword,
  DashboardSettings,
  SpeechRate,
} from '../services/settingsService';
import { setTtsEnabled, setSpeechRateSetting } from '../services/ttsService';
import { accessibilityFromSettings, useAccessibility } from '../contexts/AccessibilityContext';
import { fetchReadingProfile, ReadingProfile } from '../services/readingInsightsService';
import { averageAccuracy } from '../services/achievementService';
import { colors, radius, shadows } from '../theme';

// Same daily-goal formula as the Student Dashboard (total_attempts mod
// DAILY_GOAL) - kept identical so a child's "goal" means the same thing
// whether they or their parent is looking at it.
const DAILY_GOAL = 5;
const SIDEBAR_WIDTH = 300;
// Distinct from theme.colors.lavenderDark so the Calendar's Lesson vs
// Practice day-dots read as genuinely different hues at 6px, not two shades
// of purple.
const CALENDAR_PRACTICE_BLUE = '#2F80ED';

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
  gradientColors,
  gradientId,
  children,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor: string;
  gradientColors?: [string, string];
  gradientId?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference * (1 - clamped / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {gradientColors && gradientId && (
          <Defs>
            <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={gradientColors[0]} />
              <Stop offset="100%" stopColor={gradientColors[1]} />
            </SvgLinearGradient>
          </Defs>
        )}
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={gradientColors && gradientId ? `url(#${gradientId})` : color}
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
  achievements: { id: string; unlockedAt: string }[];
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

// PRIMARY_TEXT/SURFACE/BACKGROUND are intentionally NOT theme tokens - kept
// local rather than coerced onto a nearby-but-different color.
const PRIMARY_TEXT = '#3730a3';
const SURFACE = '#ffffff';
const BACKGROUND = '#f5f3ff';

const PARENT_BOTTOM_ITEMS: BottomNavItem[] = [
  { key: 'welcome', label: 'Home', icon: 'home-outline' },
  { key: 'progress', label: 'Progress', icon: 'bar-chart-outline' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

const LEVEL_COLORS: Record<Level, string> = {
  Beginner: colors.success,
  Intermediate: colors.primary,
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
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [section, setSection] = useState<Section>('welcome');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEnroll, setShowEnroll] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [childSessions, setChildSessions] = useState<
    { word: string; accuracy_percentage: number; is_correct?: boolean | null; duration_seconds?: number | null; attempts?: number | null; created_at: string }[]
  >([]);
  const [childReadingProfile, setChildReadingProfile] = useState<ReadingProfile | null>(null);
  const [progressPeriod, setProgressPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('all');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [childLessonsTotal, setChildLessonsTotal] = useState<number | null>(null);
  const [childLessonsList, setChildLessonsList] = useState<Lesson[]>([]);
  const [childCompletedLessons, setChildCompletedLessons] = useState<number | null>(null);
  const [childLessonProgressRows, setChildLessonProgressRows] = useState<LessonProgressRow[]>([]);
  const [childCurrentLesson, setChildCurrentLesson] = useState<{ title: string; status: string; openedAt: string | null } | null>(null);
  const [parentPhone, setParentPhone] = useState('');
  const [parentAvatarUrl, setParentAvatarUrl] = useState<string | null>(null);
  const [parentSettings, setParentSettings] = useState<DashboardSettings | null>(null);
  // Last-persisted snapshot, separate from the draft above - lets the
  // Settings tab offer real manual Save/Discard (matching the student
  // Settings tab's pattern) instead of saving on every toggle.
  const [savedParentSettings, setSavedParentSettings] = useState<DashboardSettings | null>(null);
  const { highContrast, a11yFont, a11ySize, setAccessibilitySettings } = useAccessibility();
  // Same real-effect treatment as StudentDashboard's hero banners, scaled
  // from each style's own actual base size (22/13 for the Home-style
  // greeting used on Home/Progress/Calendar, 18/12 for the plain Settings
  // header) rather than one shared absolute size, so relative hierarchy
  // between the two is preserved at every text-size setting.
  const heroTitleA11yStyle = {
    fontSize: a11ySize(22),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const heroSubtitleA11yStyle = {
    fontSize: a11ySize(13),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
    ...(highContrast ? { color: colors.ink } : {}),
  };
  const settingsHeaderTitleA11yStyle = {
    fontSize: a11ySize(18),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const settingsHeaderSubA11yStyle = {
    fontSize: a11ySize(12),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
    ...(highContrast ? { color: colors.ink } : {}),
  };
  // Broadened a11y wiring (audit follow-up) - grouped by shared style
  // constant/visual level rather than one bespoke override per Text, each
  // scaled from that group's own current base fontSize so relative
  // hierarchy is preserved at every text-size setting.
  const heroCardTitleA11yStyle = {
    fontSize: a11ySize(19),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const sectionTitleA11yStyle = {
    fontSize: a11ySize(16),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const sectionTitleInlineA11yStyle = {
    fontSize: a11ySize(15),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const cardTitleA11yStyle = {
    fontSize: a11ySize(17),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const childNameA11yStyle = {
    fontSize: a11ySize(18),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const accountNameA11yStyle = {
    fontSize: a11ySize(16),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const accountSubA11yStyle = {
    fontSize: a11ySize(12),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const toggleTitleA11yStyle = {
    fontSize: a11ySize(14),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const toggleSubA11yStyle = {
    fontSize: a11ySize(11),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const overviewValueA11yStyle = {
    fontSize: a11ySize(20),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const overviewLabelA11yStyle = {
    fontSize: a11ySize(12),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const overallStatValueA11yStyle = {
    fontSize: a11ySize(17),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const overallStatLabelA11yStyle = {
    fontSize: a11ySize(10),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const weekStatValueA11yStyle = {
    fontSize: a11ySize(20),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const weekStatLabelA11yStyle = {
    fontSize: a11ySize(10.5),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const goalCardValueA11yStyle = {
    fontSize: a11ySize(22),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const saveDiscardBarTextA11yStyle = {
    fontSize: a11ySize(13),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const saveDiscardButtonTextA11yStyle = {
    fontSize: a11ySize(14),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettingKey, setSavingSettingKey] = useState<string | null>(null);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailModalError, setEmailModalError] = useState('');
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordModalError, setPasswordModalError] = useState('');

  const sidebarAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
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
    // child_progress has a UNIQUE child_id constraint, so PostgREST embeds it
    // as a to-one relationship (a single object) per row, not an array - but
    // every read site here uses `child.child_progress?.[0]`, expecting an
    // array. Left un-normalized, that silently returns undefined even though
    // the real row was just fetched, making every child look like it has no
    // progress at all.
    const rows = ((data || []) as any[]).map((row) => ({
      ...row,
      child_progress: row.child_progress
        ? Array.isArray(row.child_progress)
          ? row.child_progress
          : [row.child_progress]
        : [],
    })) as ChildRow[];
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

  const loadChildInsights = async (child: ChildRow) => {
    // No date filter here - the Progress tab's own 7/30/90/All period
    // filter needs the full history to slice client-side (and to compute
    // an equal-length "previous period" for the improvement delta).
    // Row-count capped instead, which is generous for a single child's
    // practice history.
    const [sessionsResult, lessonsResult, currentLessonResult, lessonProgressResult, readingProfileResult] = await Promise.allSettled([
      fetchPronunciationSessions(child.id),
      fetchPublishedLessons(child.grade_level),
      supabase
        .from('lesson_progress')
        .select('lesson_id, status, opened_at, lessons(title)')
        .eq('student_id', child.id)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      fetchLessonProgress(child.id),
      fetchReadingProfile(child.id),
    ]);

    setChildSessions(
      sessionsResult.status === 'fulfilled'
        ? sessionsResult.value
        : [],
    );
    setChildLessonsTotal(lessonsResult.status === 'fulfilled' ? lessonsResult.value.length : null);
    setChildLessonsList(lessonsResult.status === 'fulfilled' ? lessonsResult.value : []);

    // Real completed-lesson count (lesson_progress rows with status
    // 'completed') - previously the Home tab mistakenly used
    // progress.activities_completed here, which actually counts turned-in
    // assignments, not lesson completions.
    setChildCompletedLessons(
      lessonProgressResult.status === 'fulfilled'
        ? lessonProgressResult.value.filter((row) => row.status === 'completed').length
        : null,
    );
    setChildLessonProgressRows(lessonProgressResult.status === 'fulfilled' ? lessonProgressResult.value : []);
    setChildReadingProfile(readingProfileResult.status === 'fulfilled' ? readingProfileResult.value : null);

    if (
      currentLessonResult.status === 'fulfilled' &&
      !currentLessonResult.value.error &&
      currentLessonResult.value.data
    ) {
      const row = currentLessonResult.value.data as any;
      setChildCurrentLesson({ title: row.lessons?.title || 'Lesson', status: row.status, openedAt: row.opened_at || null });
    } else {
      // lesson_progress may not be available yet (pending migration) or the
      // child hasn't opened a lesson - omit the card rather than fabricate one.
      setChildCurrentLesson(null);
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
  }, [children, selectedChildId]);

  useEffect(() => {
    const child = children.find((c) => c.id === selectedChildId);
    if (!child) {
      setChildSessions([]);
      setChildReadingProfile(null);
      setChildLessonsTotal(null);
      setChildLessonsList([]);
      setChildCompletedLessons(null);
      setChildLessonProgressRows([]);
      setChildCurrentLesson(null);
      return;
    }
    void loadChildInsights(child);
    // `children` is intentionally omitted: this effect's job is "reload when
    // the selected child changes." Reloading whenever the `children` array
    // reference changes too would double-fire loadChildInsights alongside
    // the real-time-subscription effect below, which already explicitly
    // re-runs it after every children refresh (see its comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setSavedParentSettings(data);
      setAccessibilitySettings(accessibilityFromSettings(data));
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
    // loadParentSettings is intentionally invoked only when the Settings
    // section first opens; including its per-render function identity would
    // repeatedly refetch and discard an in-progress settings draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, parentId, parentSettings, settingsLoading]);

  // Draft-only, like the student Settings tab's updateSetting: gives an
  // immediate live preview for in-session behavior (TTS voice, speech rate)
  // but does not touch the backend. Persisting only happens via the explicit
  // Save Changes button (saveParentSettingsDraft).
  const updateParentSetting = <K extends keyof DashboardSettings>(key: K, value: DashboardSettings[K]) => {
    if (!parentSettings) return;
    setParentSettings({ ...parentSettings, [key]: value });
    if (key === 'tts_enabled') setTtsEnabled(!!value);
    if (key === 'speech_rate') setSpeechRateSetting(value as SpeechRate);
  };

  const hasUnsavedParentSettingsChanges =
    !!parentSettings && !!savedParentSettings && JSON.stringify(parentSettings) !== JSON.stringify(savedParentSettings);

  const saveParentSettingsDraft = async () => {
    if (!parentId || !parentSettings || !hasUnsavedParentSettingsChanges) return;
    setSavingSettingKey('__all__');
    try {
      const saved = await updateDashboardSettings(parentId, 'parent', parentSettings);
      setParentSettings(saved);
      setSavedParentSettings(saved);
      setAccessibilitySettings(accessibilityFromSettings(saved));
    } catch (error: any) {
      console.warn('[ParentDashboard] settings save failed:', error?.message || error);
    } finally {
      setSavingSettingKey(null);
    }
  };

  const discardParentSettingsDraft = () => {
    if (!savedParentSettings) return;
    setParentSettings(savedParentSettings);
    setAccessibilitySettings(accessibilityFromSettings(savedParentSettings));
    setTtsEnabled(!!savedParentSettings.tts_enabled);
    setSpeechRateSetting((savedParentSettings.speech_rate || 'normal') as SpeechRate);
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

  const openPasswordModal = () => {
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setPasswordModalError('');
    setPasswordModalVisible(true);
  };

  const closePasswordModal = () => {
    if (savingPassword) return;
    setPasswordModalVisible(false);
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setPasswordModalError('');
  };

  const submitPasswordChange = async () => {
    if (newPasswordInput.length < 8) {
      setPasswordModalError('Ang password ay dapat hindi bababa sa 8 character.');
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordModalError('Hindi magkatugma ang dalawang password.');
      return;
    }

    setPasswordModalError('');
    setSavingPassword(true);
    try {
      await changePassword(newPasswordInput);
      setPasswordModalVisible(false);
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      Alert.alert('Password Updated', 'Matagumpay na napalitan ang iyong password.');
    } catch (err: any) {
      setPasswordModalError(err?.message || 'Hindi mapalitan ang password. Subukan muli.');
    } finally {
      setSavingPassword(false);
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
        await Promise.all([loadActivitiesForChildren(rows, id), loadScheduledActivitiesForChildren(rows), refreshNotifications(id)]);
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
      await Promise.all([loadActivitiesForChildren(rows, id), loadScheduledActivitiesForChildren(rows), refreshNotifications(id)]);
      loadedParentRef.current = id;
    } catch (err) {
      console.error('Failed to load parent dashboard:', err);
      setError('Hindi ma-load ang parent profile.');
      try {
        const rows = await loadChildren(id);
        await Promise.all([loadActivitiesForChildren(rows, id), loadScheduledActivitiesForChildren(rows), refreshNotifications(id)]);
      } catch {}
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
    // loadParent is intentionally omitted: it's a plain (non-memoized)
    // function that transitively calls several other unmemoized loaders
    // (loadChildren, loadActivitiesForChildren, etc.), so a fresh reference
    // every render would re-subscribe to auth state changes on every render
    // instead of only on mount / when navigation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // loadActivitiesForChildren (and the other loaders called above) are
    // intentionally omitted: they're plain non-memoized functions, so
    // including them would tear down and recreate this realtime subscription
    // on every render instead of only when parentId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  useEffect(() => {
    if (!parentId || !children.length) return undefined;
    return subscribeToScheduledActivities(children.map((child) => child.id), () => {
      void loadScheduledActivitiesForChildren(children);
    });
    // Reloading is intentionally scoped to changes in the owned child set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, children.map((child) => child.id).sort().join(',')]);

  const initials = useMemo(
    () => parentName.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase(),
    [parentName],
  );

  const selectedChild = useMemo(
    () => children.find((row) => row.id === selectedChildId) || children[0] || null,
    [children, selectedChildId],
  );
  const selectedChildStats = useMemo(() => {
    const progress = selectedChild?.child_progress?.[0];
    const sessionAverage = childSessions.length
      ? Math.round(childSessions.reduce((sum, session) => sum + (Number(session.accuracy_percentage) || 0), 0) / childSessions.length)
      : null;
    return {
      overallAccuracy: progress ? Math.round(averageAccuracy(progress)) : sessionAverage,
      wordsPracticed: progress?.word_count ?? progress?.completed_words?.length ?? 0,
      totalAttempts: progress?.total_attempts ?? childSessions.length,
      streak: progress?.streak ?? 0,
    };
  }, [selectedChild, childSessions]);
  const enrolledChildrenText = children.length === 0
    ? 'No enrolled child yet'
    : children.length === 1
      ? '1 child enrolled'
      : `${children.length} children enrolled`;

  const openSidebar = () => {
    setSidebarOpen(true);
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(overlayAnim, { toValue: 0.45, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeSidebar = () => {
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: -SIDEBAR_WIDTH, duration: 240, useNativeDriver: true }),
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

  const getLevelColor = (level: Level) => LEVEL_COLORS[level] || colors.primary;

  const getActivityDateKey = (activity: StudentActivity) => new Date(activity.deadline).toISOString().slice(0, 10);
  const SCHEDULED_TYPE_ICON: Record<ScheduledActivity['activity_type'], keyof typeof Ionicons.glyphMap> = {
    reading_lesson: 'book-outline',
    practice: 'mic-outline',
    reminder: 'alarm-outline',
    appointment: 'medical-outline',
  };
  const getScheduledStatusColor = (status: ScheduledActivity['status']) => {
    if (status === 'completed') return colors.success;
    if (status === 'missed') return colors.danger;
    if (status === 'in_progress') return colors.warning;
    return colors.lavenderDark;
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
    const cells: { key: string; date?: Date }[] = [];
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
  const renderWelcome = () => {
    const selectedChild = children.find((child) => child.id === selectedChildId) || children[0];

    if (!selectedChild) {
      return (
        <>
          <View style={styles.homeHeaderRow}>
            {parentAvatarUrl ? (
              <Image source={{ uri: parentAvatarUrl }} style={styles.homeAvatar} />
            ) : (
              <View style={styles.homeAvatar}>
                <Text style={styles.homeAvatarText}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.homeGreeting, heroTitleA11yStyle]}>Good Day, {parentName || 'Loading...'}!</Text>
              <Text style={[styles.homeGreetingSub, heroSubtitleA11yStyle]}>Here&apos;s how your child is doing today.</Text>
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
    const avgAccuracy = selectedChildStats.overallAccuracy;
    const isActivelyLearning = !!progress?.last_practice_date && progress.last_practice_date.slice(0, 10) === new Date().toISOString().slice(0, 10);
    const wordsPracticed = selectedChildStats.wordsPracticed;
    const lessonsCompleted = childCompletedLessons ?? 0;
    const latestReading = childSessions[0] || null;

    const tierMessage = (name: string, pct: number | null) =>
      pct === null
        ? `${name} hasn't started practicing yet.`
        : pct >= 80
        ? `${name} is making great progress in reading.`
        : pct >= 60
        ? `${name} is making steady progress in reading.`
        : `${name} could use a bit more practice this week.`;

    const dayMs = 86400000;
    const nowMs = Date.now();
    const avgOf = (rows: typeof childSessions) =>
      rows.length ? Math.round(rows.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / rows.length) : null;

    // Week-over-week accuracy delta - backs the hero card's real "compared
    // with last week" figure (the reference's own framing, now real numbers).
    const last7 = childSessions.filter((s) => nowMs - new Date(s.created_at).getTime() <= 7 * dayMs);
    const prior7 = childSessions.filter((s) => {
      const age = nowMs - new Date(s.created_at).getTime();
      return age > 7 * dayMs && age <= 14 * dayMs;
    });
    const week7Avg = avgOf(last7);
    const priorWeekAvg = avgOf(prior7);
    const weekDelta = week7Avg !== null && priorWeekAvg !== null ? week7Avg - priorWeekAvg : null;

    // "Reading Practice" this week - same total_attempts source as the
    // lifetime count below, just windowed to match the reference's explicit
    // "sessions this week" framing for this specific tile.
    const practiceSessionsThisWeek = last7.length;

    // Weekly activity bar chart - real attempts-per-day for the last 7
    // calendar days. Deliberately no "practice minutes" line: duration_seconds
    // is genuinely tracked per attempt, but it's a per-single-word duration
    // (2-3 seconds), not a session length - summed per day it rounds to under
    // a minute, which reads as broken rather than honest. Attempt counts are
    // the real, meaningful unit here.
    const weekDayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekDayBars = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      const dayKey = d.toISOString().slice(0, 10);
      const count = childSessions.filter((s) => (s.created_at || '').slice(0, 10) === dayKey).length;
      const weekday = d.getDay() === 0 ? 6 : d.getDay() - 1;
      return { label: weekDayLabels[weekday], count };
    });
    const maxDayCount = Math.max(1, ...weekDayBars.map((d) => d.count));
    const activeDaysThisWeek = weekDayBars.filter((d) => d.count > 0).length;

    // Today's Reading Goal - identical DAILY_GOAL formula as the Student
    // Dashboard, read from this child's own progress.
    const goalDone = Math.min((progress?.total_attempts || 0) % DAILY_GOAL, DAILY_GOAL);
    const goalPct = Math.round((goalDone / DAILY_GOAL) * 100);

    // This Week's Insight - same real per-word-shape categories as the
    // Student Dashboard's own 3-row skill breakdown (categorizeWord, no
    // separate "Sentence Reading" or "Pronunciation" row - those aren't real
    // tracked categories on either side of this app). Scoped to the last 7
    // days (last7) to honestly match this section's "this week" framing,
    // not all-time history.
    const skillGroups: Record<SkillCategory, { count: number; sum: number }> = {
      letters: { count: 0, sum: 0 },
      syllables: { count: 0, sum: 0 },
      words: { count: 0, sum: 0 },
    };
    last7.forEach((s) => {
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
        ? { label: 'Not enough data', color: colors.inkSoft }
        : avg >= 80
        ? { label: 'Excellent', color: colors.success }
        : avg >= 60
        ? { label: 'Good Progress', color: colors.warning }
        : { label: 'Needs More Practice', color: colors.danger };

    // Recent activity - same merged real lesson+pronunciation feed pattern
    // as the Student Dashboard's Home/Progress tabs, scoped to this child.
    type RecentActivityItem = { key: string; kind: 'lesson' | 'pronunciation'; title: string; detail: string; timestamp: string };
    const lessonActivityItems: RecentActivityItem[] = childLessonProgressRows
      .filter((p) => p.status === 'completed' && !!p.completed_at)
      .map((p) => ({
        key: `lesson-${p.id}`,
        kind: 'lesson' as const,
        title: childLessonsList.find((l) => l.id === p.lesson_id)?.title || 'Lesson',
        detail: 'Completed',
        timestamp: p.completed_at as string,
      }));
    const pronunciationActivityItems: RecentActivityItem[] = childSessions.slice(0, 10).map((s, idx) => ({
      key: `pron-${s.created_at}-${idx}`,
      kind: 'pronunciation' as const,
      title: s.word,
      detail: `${Math.round(s.accuracy_percentage || 0)}% accuracy`,
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
        <View style={styles.homeHeaderRow}>
          {parentAvatarUrl ? (
            <Image source={{ uri: parentAvatarUrl }} style={styles.homeAvatar} />
          ) : (
            <View style={styles.homeAvatar}>
              <Text style={styles.homeAvatarText}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.homeGreeting, heroTitleA11yStyle]}>Good Day, {parentName || 'Loading...'}!</Text>
            <Text style={[styles.homeGreetingSub, heroSubtitleA11yStyle]}>Here&apos;s how your child is doing today.</Text>
          </View>
          <Image source={require('../../assets/decorate.webp')} style={styles.homeGreetingDecor} resizeMode="contain" />
        </View>

        <View style={styles.childSummaryCard}>
          <View style={styles.childAvatarLg}>
            <Text style={styles.childAvatarLgText}>{selectedChild.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.childSummaryEyebrow}>Your Child</Text>
            <Text style={[styles.childSummaryName, childNameA11yStyle]}>{selectedChild.name}</Text>
            <View style={styles.childSummaryBadgeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>Grade {selectedChild.grade_level}</Text>
              </View>
              <View style={[styles.levelBadgeOutline, { borderColor: getLevelColor(level) }]}>
                <Text style={[styles.levelBadgeOutlineText, { color: getLevelColor(level) }]}>{level}</Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusDotLg, { backgroundColor: isActivelyLearning ? colors.success : colors.inkSoft }]} />
              <Text style={styles.statusRowText}>{isActivelyLearning ? 'Active Today' : 'No activity today'}</Text>
            </View>
          </View>
          {children.length > 1 && (
            <TouchableOpacity
              style={styles.switchChildButton}
              onPress={() => setChildPickerOpen((open) => !open)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={childPickerOpen ? 'Close child switcher' : 'Switch to a different child'}
            >
              <Text style={styles.switchChildButtonText}>Switch Child</Text>
              <Ionicons name={childPickerOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.lavenderDark} />
            </TouchableOpacity>
          )}
        </View>

        {childPickerOpen && children.length > 1 && (
          <View style={styles.childPickerList}>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.childPickerRow}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${child.name}`}
                onPress={() => {
                  setSelectedChildId(child.id);
                  setChildPickerOpen(false);
                }}
              >
                <Text style={[styles.childPickerRowText, child.id === selectedChild.id && { color: colors.lavenderDark, fontWeight: '800' }]}>
                  {child.name}
                </Text>
                {child.id === selectedChild.id && <Ionicons name="checkmark" size={16} color={colors.lavenderDark} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.latestReadingCard}>
          <View style={styles.latestReadingHeader}>
            <View>
              <Text style={styles.latestReadingEyebrow}>LATEST READING RESULT</Text>
              <Text style={styles.latestReadingWord}>{latestReading?.word || 'No reading yet'}</Text>
            </View>
            <Ionicons name={latestReading?.is_correct ? 'checkmark-circle' : 'book-outline'} size={26} color={latestReading?.is_correct ? colors.success : colors.lavenderDark} />
          </View>
          <View style={styles.latestReadingStats}>
            <View style={styles.latestReadingStat}><Text style={styles.latestReadingValue}>{latestReading ? `${Math.round(latestReading.accuracy_percentage || 0)}%` : '--'}</Text><Text style={styles.latestReadingLabel}>Accuracy</Text></View>
            <View style={styles.latestReadingStat}><Text style={styles.latestReadingValue}>{latestReading?.attempts ?? '--'}</Text><Text style={styles.latestReadingLabel}>Attempts</Text></View>
            <View style={styles.latestReadingStat}><Text style={styles.latestReadingValue}>{latestReading?.duration_seconds != null ? `${latestReading.duration_seconds}s` : '--'}</Text><Text style={styles.latestReadingLabel}>Duration</Text></View>
            <View style={styles.latestReadingStat}><Text style={styles.latestReadingValue}>{selectedChildStats.streak}</Text><Text style={styles.latestReadingLabel}>Day Streak</Text></View>
          </View>
          <Text style={styles.latestReadingObservation}>
            {childReadingProfile?.insights[0] || 'Complete more reading practice to generate an observation.'}
          </Text>
          <Text style={styles.latestReadingPractice}>
            Home practice: {childReadingProfile?.recommendedHomePractice || 'Magbasa nang malakas sa loob ng 5 minuto.'}
          </Text>
        </View>

        <LinearGradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroProgressCard}
        >
          <View style={styles.heroDecorCircleLg} />
          <View style={styles.heroDecorCircleSm} />
          <Image source={require('../../assets/parentreading.webp')} style={styles.heroProgressImage} resizeMode="contain" />

          <View style={styles.heroProgressTopRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <View style={styles.heroProgressEyebrowRow}>
                <View style={styles.heroProgressIconWrap}>
                  <Ionicons name="book" size={12} color="#fff" />
                </View>
                <Text style={styles.heroProgressEyebrow}>READING PROGRESS</Text>
              </View>
              <Text style={[styles.heroProgressTitle, heroCardTitleA11yStyle]}>{selectedChild.name.split(' ')[0]}&apos;s Reading Progress</Text>
            </View>
            <View style={styles.heroProgressRingWrap}>
              <ProgressRing
                percent={avgAccuracy ?? 0}
                size={88}
                strokeWidth={9}
                color="#fff"
                trackColor="rgba(255,255,255,0.25)"
                gradientColors={['#ffffff', '#F5D0FE']}
                gradientId="parentHeroRing"
              >
                <Text style={styles.heroProgressPct}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
                <Text style={styles.heroProgressPctLabel}>Overall</Text>
              </ProgressRing>
            </View>
          </View>

          {weekDelta !== null && (
            <View style={styles.heroDeltaPill}>
              <Ionicons name={weekDelta >= 0 ? 'trending-up' : 'trending-down'} size={13} color="#fff" />
              <Text style={styles.heroDeltaPillText}>
                {weekDelta >= 0 ? '+' : ''}{weekDelta}% compared with last week
              </Text>
            </View>
          )}
          <Text style={styles.heroProgressMessage} numberOfLines={2}>
            {tierMessage(selectedChild.name.split(' ')[0], avgAccuracy)}
          </Text>
          <TouchableOpacity style={styles.heroProgressButton} onPress={() => setSection('progress')} activeOpacity={0.85}>
            <Text style={styles.heroProgressButtonText}>View Full Progress</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.heroGradient[0]} />
          </TouchableOpacity>
        </LinearGradient>

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>Quick Overview</Text>
        <View style={styles.overviewGrid}>
          <View style={[styles.overviewCard, { backgroundColor: '#EFECFB' }]}>
            <Ionicons name="school" size={20} color={colors.lavender} />
            <Text style={[styles.overviewValue, overviewValueA11yStyle, { color: colors.lavender }]}>
              {lessonsCompleted}{childLessonsTotal !== null ? `/${childLessonsTotal}` : ''}
            </Text>
            <Text style={[styles.overviewLabel, overviewLabelA11yStyle]}>Lessons Completed</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#FFF3DC' }]}>
            <Ionicons name="mic" size={20} color={colors.sun} />
            <Text style={[styles.overviewValue, overviewValueA11yStyle, { color: colors.sun }]}>{practiceSessionsThisWeek}</Text>
            <Text style={[styles.overviewLabel, overviewLabelA11yStyle]}>Reading Practice (this week)</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#EAF3FB' }]}>
            <Ionicons name="book" size={20} color={colors.lavenderDark} />
            <Text style={[styles.overviewValue, overviewValueA11yStyle, { color: colors.lavenderDark }]}>{wordsPracticed}</Text>
            <Text style={[styles.overviewLabel, overviewLabelA11yStyle]}>Words Practiced</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.sage} />
            <Text style={[styles.overviewValue, overviewValueA11yStyle, { color: colors.sage }]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
            <Text style={[styles.overviewLabel, overviewLabelA11yStyle]}>All-Time Average</Text>
          </View>
        </View>

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>This Week&apos;s Activity</Text>
        <View style={styles.trendCard}>
          <View style={styles.weekBarRow}>
            {weekDayBars.map((day, i) => (
              <View key={i} style={styles.weekBarCol}>
                <View style={styles.weekBarTrack}>
                  <View
                    style={[
                      styles.weekBarFill,
                      { height: day.count > 0 ? Math.max(6, Math.round((day.count / maxDayCount) * 70)) : 4 },
                    ]}
                  />
                </View>
                <Text style={styles.weekBarLabel}>{day.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.weekBarSummary}>
            {activeDaysThisWeek} active day{activeDaysThisWeek === 1 ? '' : 's'} this week
          </Text>
        </View>

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>Reading Skills Overview</Text>
        <View style={styles.currentLessonCard}>
          {childCurrentLesson ? (
            <>
              <View style={styles.skillOverviewRow}>
                <Ionicons name="book" size={18} color={colors.lavenderDark} />
                <Text style={styles.currentLessonTitle}>
                  {childCurrentLesson.status === 'completed' ? 'Completed Lesson: ' : 'Currently on: '}
                  {childCurrentLesson.title}
                </Text>
              </View>
              {!!childCurrentLesson.openedAt && (
                <Text style={styles.skillOverviewMeta}>{formatActivityTime(childCurrentLesson.openedAt)}</Text>
              )}
            </>
          ) : (
            <Text style={styles.skillOverviewEmpty}>No lesson opened yet.</Text>
          )}
        </View>

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>This Week&apos;s Insight</Text>
        <Text style={styles.homeSectionSub}>Practice activity over last 7 days</Text>
        <View style={styles.weeklyInsightCard}>
          {skillMeta.map(({ key, label }) => {
            const group = skillGroups[key];
            const avg = group.count > 0 ? Math.round(group.sum / group.count) : null;
            const status = skillStatus(avg);
            return (
              <View key={key} style={styles.weeklyInsightRow}>
                <Text style={styles.insightRowLabel}>{label}</Text>
                <View style={styles.insightRowTrack}>
                  <View style={[styles.insightRowFill, { width: `${avg ? Math.max(4, avg) : 0}%`, backgroundColor: status.color }]} />
                </View>
                <Text style={[styles.insightRowStatus, { color: status.color }]}>
                  {avg !== null ? `${avg}% • ${status.label}` : status.label}
                </Text>
              </View>
            );
          })}
          <TouchableOpacity onPress={() => setSection('progress')}>
            <Text style={styles.insightSeeMore}>See Recommendations →</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalCardHeader}>
            <Ionicons name="flag" size={18} color={colors.sun} />
            <Text style={[styles.homeSectionTitleInline, sectionTitleInlineA11yStyle]}>Today&apos;s Reading Goal</Text>
          </View>
          <Text style={[styles.goalCardValue, goalCardValueA11yStyle]}>{goalDone}/{DAILY_GOAL} Activities</Text>
          <View style={styles.goalCardTrack}>
            <View style={[styles.goalCardFill, { width: `${goalPct}%` }]} />
          </View>
          <Text style={styles.goalCardSub}>
            {goalDone === 0
              ? `${selectedChild.name.split(' ')[0]} hasn't started today's goal yet.`
              : goalDone >= DAILY_GOAL
              ? `${selectedChild.name.split(' ')[0]} finished today's goal! 🎉`
              : `${selectedChild.name.split(' ')[0]} is almost finished with today's goal!`}
          </Text>
        </View>

        <View style={styles.recentHeaderRow}>
          <Text style={[styles.homeSectionTitleInline, sectionTitleInlineA11yStyle]}>Recent</Text>
          <TouchableOpacity onPress={() => setSection('progress')}>
            <Text style={styles.viewAllLink}>View All Activity →</Text>
          </TouchableOpacity>
        </View>
        {recentActivityItems.length ? (
          recentActivityItems.map((item) => (
            <View key={item.key} style={styles.recentActivityCard}>
              <View style={[styles.recentActivityIconWrap, { backgroundColor: item.kind === 'lesson' ? '#E9F1E2' : '#EFECFB' }]}>
                <Ionicons name={item.kind === 'lesson' ? 'book' : 'mic'} size={16} color={item.kind === 'lesson' ? colors.sage : colors.lavenderDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.currentLessonTitle}>{item.kind === 'lesson' ? 'Lesson Completed' : 'Reading Practice'}</Text>
                <Text style={styles.recentActivityDetail}>{item.title} • {item.detail}</Text>
              </View>
              <Text style={styles.recentActivityTime}>{formatActivityTime(item.timestamp)}</Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No activity yet.</Text>
          </View>
        )}

        <LinearGradient
          colors={[colors.heroGradient[1], colors.heroGradient[2]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.supportBanner}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.supportBannerTitle}>Your Support Matters</Text>
            <Text style={styles.supportBannerText}>Every little bit of encouragement can make a difference.</Text>
            <TouchableOpacity style={styles.supportBannerButton} onPress={() => setSection('progress')}>
              <Text style={styles.supportBannerButtonText}>View Child Progress →</Text>
            </TouchableOpacity>
          </View>
          <Image source={require('../../assets/parentreading.webp')} style={styles.supportBannerImage} resizeMode="contain" />
        </LinearGradient>

        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => setShowEnroll(true)} accessibilityRole="button" accessibilityLabel="Enroll a child">
            <Ionicons name="person-add" size={16} color={colors.lavenderDark} />
            <Text style={styles.quickActionText}>Enroll Child</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('progress')} accessibilityRole="button" accessibilityLabel="View reports">
            <Ionicons name="bar-chart" size={16} color={colors.lavenderDark} />
            <Text style={styles.quickActionText}>View Reports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('settings')} accessibilityRole="button" accessibilityLabel="Manage profile">
            <Ionicons name="person-circle" size={16} color={colors.lavenderDark} />
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
          <Text style={[styles.homeGreeting, heroTitleA11yStyle]}>Child Progress</Text>
          <Text style={[styles.homeGreetingSub, heroSubtitleA11yStyle]}>Track your child&apos;s reading development.</Text>
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
    const periodRingLabel = PERIOD_LABELS.find((p) => p.key === progressPeriod)?.label || 'All Time';
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
    const periodAvg = progressPeriod === 'all' ? selectedChildStats.overallAccuracy : avgOf(inPeriod);
    const priorAvg = avgOf(priorPeriod);
    const periodDelta = periodDays !== null && periodAvg !== null && priorAvg !== null ? periodAvg - priorAvg : null;

    const totalWords = inPeriod.length;
    const tierColor = (pct: number) => (pct >= 80 ? colors.success : pct >= 60 ? colors.warning : colors.danger);
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
        ? { label: 'Not enough data', color: colors.inkSoft }
        : avg >= 80
        ? { label: 'Strong', color: colors.success }
        : avg >= 60
        ? { label: 'Improving', color: colors.warning }
        : { label: 'Needs More Practice', color: colors.danger };

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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Viewing ${selectedChild.name}${children.length > 1 ? '. Tap to switch child' : ''}`}
        >
          <Text style={styles.viewingSelectorText}>Viewing: {selectedChild.name}</Text>
          {children.length > 1 && <Ionicons name={childPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.lavenderDark} />}
        </TouchableOpacity>

        {childPickerOpen && children.length > 1 && (
          <View style={styles.childPickerList}>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.childPickerRow}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${child.name}`}
                onPress={() => {
                  setSelectedChildId(child.id);
                  setChildPickerOpen(false);
                }}
              >
                <Text style={[styles.childPickerRowText, child.id === selectedChild.id && { color: colors.lavenderDark, fontWeight: '800' }]}>
                  {child.name}
                </Text>
                {child.id === selectedChild.id && <Ionicons name="checkmark" size={16} color={colors.lavenderDark} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.childSummaryCard}>
          <View style={styles.childAvatarLg}>
            <Text style={styles.childAvatarLgText}>{selectedChild.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.childSummaryName, childNameA11yStyle]}>{selectedChild.name}</Text>
            <View style={styles.childSummaryBadgeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>Grade {selectedChild.grade_level}</Text>
              </View>
              <View style={[styles.levelBadgeOutline, { borderColor: getLevelColor(level) }]}>
                <Text style={[styles.levelBadgeOutlineText, { color: getLevelColor(level) }]}>{level}</Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.statusDotLg, { backgroundColor: isActivelyLearning ? colors.success : colors.inkSoft }]} />
              <Text style={styles.statusRowText}>{isActivelyLearning ? 'Actively Learning' : 'No activity today'}</Text>
            </View>
          </View>
        </View>

        {childReadingProfile && (
          <View style={styles.readingProgressCard}>
            <View style={styles.readingProgressHeader}>
              <Text style={[styles.readingProgressTitle, cardTitleA11yStyle]}>AI Reading Summary</Text>
              <Ionicons name="sparkles" size={22} color={colors.lavenderDark} />
            </View>
            <View style={styles.overallStatsRow}>
              <View style={styles.overallStatCell}>
                <Text style={[styles.overallStatValue, overallStatValueA11yStyle]}>{childReadingProfile.confidenceScore}%</Text>
                <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>Confidence</Text>
              </View>
              <View style={styles.overallStatCell}>
                <Text style={[styles.overallStatValue, overallStatValueA11yStyle]}>{childReadingProfile.averageAccuracy ?? '--'}{childReadingProfile.averageAccuracy !== null ? '%' : ''}</Text>
                <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>Last 20 Sessions</Text>
              </View>
              <View style={styles.overallStatCell}>
                <Text style={[styles.overallStatValue, overallStatValueA11yStyle]}>{childReadingProfile.weeklyPracticeDays}</Text>
                <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>Days This Week</Text>
              </View>
            </View>
            <Text style={styles.readingProgressMessage}>
              {childReadingProfile.insights[0] || childReadingProfile.confidenceLabel}
            </Text>
            <View style={styles.recommendCard}>
              <View style={styles.recommendIconWrap}>
                <Ionicons name="home" size={18} color={colors.sun} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recommendTitle}>Recommended Home Practice</Text>
                <Text style={styles.recommendText}>{childReadingProfile.recommendedHomePractice}</Text>
                {!!childReadingProfile.weakSounds.length && (
                  <Text style={styles.recommendText}>Needs more practice: {childReadingProfile.weakSounds.map((sound) => sound.unit.toUpperCase()).join(', ')}</Text>
                )}
              </View>
            </View>
          </View>
        )}

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>Progress Overview</Text>
        <Text style={styles.periodFilterLabel}>TIME PERIOD FILTER</Text>
        <View style={styles.periodFilterRow}>
          {PERIOD_LABELS.map((period) => (
            <TouchableOpacity
              key={period.key}
              style={[styles.periodChip, progressPeriod === period.key && styles.periodChipActive]}
              onPress={() => setProgressPeriod(period.key)}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Show progress for ${period.label}`}
            >
              <Text style={[styles.periodChipText, progressPeriod === period.key && styles.periodChipTextActive]}>{period.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.readingProgressCard}>
          <View style={styles.readingProgressHeader}>
            <Text style={[styles.readingProgressTitle, cardTitleA11yStyle]}>
              {progressPeriod === 'all' ? 'All-Time Reading Accuracy' : `${periodRingLabel} Reading Accuracy`}
            </Text>
            <Ionicons name="book" size={24} color={colors.lavender} />
          </View>
          <View style={{ alignItems: 'center', marginVertical: 12 }}>
            <ProgressRing percent={periodAvg ?? 0} color={colors.lavenderDark} trackColor="rgba(124,111,207,0.15)">
              <Text style={styles.readingProgressPct}>{periodAvg !== null ? `${periodAvg}%` : '--'}</Text>
              <Text style={styles.readingProgressPctSub}>{periodRingLabel}</Text>
            </ProgressRing>
          </View>
          {periodDelta !== null && (
            <View style={[styles.improvementBadge, { backgroundColor: periodDelta >= 0 ? '#E9F1E2' : '#FBE7DF' }]}>
              <Ionicons name={periodDelta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={periodDelta >= 0 ? colors.success : colors.danger} />
              <Text style={[styles.improvementBadgeText, { color: periodDelta >= 0 ? colors.success : colors.danger }]}>
                {periodDelta >= 0 ? '+' : ''}{periodDelta}% this period
              </Text>
            </View>
          )}
          <Text style={styles.readingProgressMessage}>{tierMessage(periodAvg)}</Text>
        </View>

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>Reading Performance</Text>
        <View style={styles.trendCard}>
          {bucketsWithData.length >= 2 ? (
            <>
              <TrendLineChart points={bucketPoints} width={chartWidth} color={colors.lavenderDark} />
              <View style={styles.trendMsgRow}>
                <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                <Text style={styles.trendMsgText}>
                  {bucketsWithData[bucketsWithData.length - 1].pct! >= bucketsWithData[0].pct!
                    ? 'Reading accuracy has improved over this period.'
                    : 'Keep practicing to build on recent progress.'}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.trendEmpty}>
              <Ionicons name="analytics-outline" size={28} color={colors.lavender} />
              <Text style={styles.trendEmptyText}>Not enough practice sessions in this period to show a trend.</Text>
            </View>
          )}
        </View>

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>Reading Skills</Text>
        <View style={styles.overallStatsRow}>
          <View style={styles.overallStatCell}>
                <Text style={[styles.overallStatValue, overallStatValueA11yStyle]}>{selectedChildStats.overallAccuracy !== null ? `${selectedChildStats.overallAccuracy}%` : '--'}</Text>
                <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>All-Time Average</Text>
          </View>
          <View style={styles.overallStatCell}>
            <Text style={[styles.overallStatValue, overallStatValueA11yStyle]}>{selectedChildStats.wordsPracticed}</Text>
            <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>Words Practiced</Text>
          </View>
          <View style={styles.overallStatCell}>
            <Text style={[styles.overallStatValue, overallStatValueA11yStyle]}>{selectedChildStats.totalAttempts}</Text>
            <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>Total Attempts</Text>
          </View>
          <View style={styles.overallStatCell}>
            <Text style={[styles.overallStatValue, overallStatValueA11yStyle, { color: colors.coral }]}>{selectedChildStats.streak}</Text>
            <Text style={[styles.overallStatLabel, overallStatLabelA11yStyle]}>Day Streak</Text>
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
              <Ionicons name="bulb" size={18} color={colors.sun} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recommendTitle}>Recommended Next Step</Text>
              <Text style={styles.recommendText}>
                Continue practicing {weakestSkill.label.replace(' (approx.)', '')} - it&apos;s currently {selectedChild.name.split(' ')[0]}&apos;s area with the most room to grow.
              </Text>
              <TouchableOpacity
                style={styles.recommendButton}
                onPress={() => setSection('welcome')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="View recommended activities"
              >
                <Text style={styles.recommendButtonText}>View Recommended Activities</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {periodAvg !== null && (
          <View style={styles.insightCardV2}>
            <Ionicons name="sparkles" size={18} color={colors.lavenderDark} />
            <Text style={styles.insightCardV2Text}>
              {periodDelta !== null && periodDelta > 0
                ? `${selectedChild.name.split(' ')[0]}'s reading accuracy has improved by ${periodDelta}% in this period. Consistent practice is helping build confidence.`
                : `${selectedChild.name.split(' ')[0]} has completed ${totalWords} practice ${totalWords === 1 ? 'session' : 'sessions'} in this period. Keep encouraging regular practice.`}
            </Text>
          </View>
        )}

        <Text style={[styles.homeSectionTitle, sectionTitleA11yStyle]}>Recent Learning History</Text>
        <View style={styles.selectedTasksCard}>
          {visibleHistory.length ? (
            visibleHistory.map((session, i) => (
              <View key={`${session.created_at}-${i}`} style={styles.activityRow}>
                <View style={styles.activityEmoji}>
                  <Ionicons name="mic" size={18} color={colors.lavenderDark} />
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

  const renderCalendar = () => {
    const selectedChild = children.find((child) => child.id === selectedChildId) || children[0];

    if (!selectedChild) {
      return (
        <>
          <View style={styles.homeHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.homeGreeting, heroTitleA11yStyle]}>Calendar</Text>
              <Text style={[styles.homeGreetingSub, heroSubtitleA11yStyle]}>Plan and follow your child&apos;s learning activities.</Text>
            </View>
          </View>
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👨‍👩‍👧</Text>
            <Text style={styles.emptyText}>Wala pang naka-enroll na bata.</Text>
          </View>
        </>
      );
    }

    const progress = selectedChild.child_progress?.[0];
    const level = (progress?.level || 'Beginner') as Level;
    const avgAccuracy = selectedChildStats.overallAccuracy;
    const wordsPracticed = selectedChildStats.wordsPracticed;

    // Scoped to the selected child only - the calendar previously showed
    // every enrolled child's activities merged together with no selector.
    // Matching the Home/Progress tabs' single-child pattern here too.
    const childActivities = activities.filter(
      (activity) => activity.student_id === selectedChild.id || activity.student_id === selectedChild.auth_uid,
    );
    const childScheduled = scheduledActivities.filter((item) => item.child_id === selectedChild.id);

    const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const todayKey = new Date().toISOString().slice(0, 10);

    // Real 4-type day-dot signal, per day - Lesson/Practice reflect genuine
    // activity (lesson_progress, pronunciation sessions, teacher
    // assignments) OR a manually-scheduled plan of that type; Completed is a
    // scheduled plan marked done; Reminder is a pending reminder/appointment.
    const dayTypesForDate = (dateKey: string) => {
      const scheduledThatDay = childScheduled.filter((item) => item.scheduled_date === dateKey);
      const hasRealLesson = childLessonProgressRows.some(
        (p) => (p.opened_at || '').slice(0, 10) === dateKey || (p.completed_at || '').slice(0, 10) === dateKey,
      );
      const hasTeacherAssignment = childActivities.some((a) => getActivityDateKey(a) === dateKey);
      const hasRealPractice = childSessions.some((s) => (s.created_at || '').slice(0, 10) === dateKey);
      return {
        lesson: hasRealLesson || hasTeacherAssignment || scheduledThatDay.some((s) => s.activity_type === 'reading_lesson'),
        practice: hasRealPractice || scheduledThatDay.some((s) => s.activity_type === 'practice'),
        completed: scheduledThatDay.some((s) => s.status === 'completed'),
        reminder: scheduledThatDay.some((s) => (s.activity_type === 'reminder' || s.activity_type === 'appointment') && s.status !== 'completed'),
      };
    };

    // This Week - real counts for the selected child, no fabricated minutes.
    const nowMs = Date.now();
    const dayMs = 86400000;
    const weekSessions = childSessions.filter((s) => nowMs - new Date(s.created_at).getTime() <= 7 * dayMs);
    const weekLessonsCompleted = childLessonProgressRows.filter(
      (p) => p.status === 'completed' && p.completed_at && nowMs - new Date(p.completed_at).getTime() <= 7 * dayMs,
    ).length;
    const activeDaysList = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      const dayKey = d.toISOString().slice(0, 10);
      return childSessions.some((s) => (s.created_at || '').slice(0, 10) === dayKey);
    });
    const activeDaysThisWeek = activeDaysList.filter(Boolean).length;
    const weekCaption =
      activeDaysThisWeek >= 5
        ? `${selectedChild.name.split(' ')[0]} is staying consistent this week!`
        : activeDaysThisWeek >= 2
        ? `${selectedChild.name.split(' ')[0]} is building a good practice habit.`
        : `${selectedChild.name.split(' ')[0]} hasn't practiced much this week yet.`;

    // Parent Insight - rule-based weekday consistency, not generated
    // commentary. Needs a real minimum sample before claiming a pattern.
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
    childSessions.forEach((s) => {
      weekdayCounts[new Date(s.created_at).getDay()] += 1;
    });
    const topWeekdayIndex = weekdayCounts.reduce((best, count, idx) => (count > weekdayCounts[best] ? idx : best), 0);
    const hasEnoughInsightData = childSessions.length >= 3 && weekdayCounts[topWeekdayIndex] >= 2;

    // Upcoming Reminders - reuses the already-loaded scheduledActivities
    // (itself fetched via the real /scheduled-activities GET route), just
    // filtered client-side to this child's future, not-yet-completed items.
    const upcomingReminders = childScheduled
      .filter((item) => item.scheduled_date >= todayKey && item.status !== 'completed')
      .sort((a, b) => `${a.scheduled_date}${a.start_time || ''}`.localeCompare(`${b.scheduled_date}${b.start_time || ''}`))
      .slice(0, 3);

    // Day-detail - one merged, time-sorted list combining real lesson
    // progress, a real aggregated practice summary, teacher assignments, and
    // manually-scheduled plans, instead of the old two-separate-panels split.
    const dateKey = selectedCalendarDate;
    const daySessions = childSessions.filter((s) => (s.created_at || '').slice(0, 10) === dateKey);
    const dayLessonRows = childLessonProgressRows.filter(
      (p) => (p.opened_at || '').slice(0, 10) === dateKey || (p.completed_at || '').slice(0, 10) === dateKey,
    );
    const dayTeacherActivities = childActivities.filter((a) => getActivityDateKey(a) === dateKey);
    const dayScheduledItems = childScheduled.filter((item) => item.scheduled_date === dateKey);

    type DayEntry = {
      key: string;
      sortKey: string;
      pillLabel: string;
      pillColor: string;
      icon: keyof typeof Ionicons.glyphMap;
      title: string;
      meta: string;
      actionLabel?: string;
      onPress?: () => void;
      scheduledItem?: ScheduledActivity;
    };
    const dayEntries: DayEntry[] = [];

    dayLessonRows.forEach((p) => {
      const title = childLessonsList.find((l) => l.id === p.lesson_id)?.title || 'Lesson';
      const timeSource = p.completed_at || p.opened_at;
      const time = timeSource ? new Date(timeSource).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      dayEntries.push({
        key: `lp-${p.id}`,
        sortKey: timeSource || dateKey,
        pillLabel: 'Lesson',
        pillColor: colors.lavenderDark,
        icon: 'book',
        title,
        meta: `${time ? `${time} • ` : ''}${p.status === 'completed' ? 'Completed' : 'In Progress'}`,
        actionLabel: 'View Lesson',
        onPress: () => setSection('progress'),
      });
    });

    dayTeacherActivities.forEach((a) => {
      dayEntries.push({
        key: `act-${a.id}`,
        sortKey: a.deadline,
        pillLabel: 'Lesson',
        pillColor: colors.lavenderDark,
        icon: 'clipboard',
        title: a.title,
        meta: `${new Date(a.deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • ${a.status}`,
        actionLabel: 'View Details',
        onPress: () => setSection('progress'),
      });
    });

    if (daySessions.length) {
      const avgDayAccuracy = Math.round(
        daySessions.reduce((sum, s) => sum + (Number(s.accuracy_percentage) || 0), 0) / daySessions.length,
      );
      const sortedDaySessions = daySessions.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const firstTime = sortedDaySessions[0]?.created_at;
      dayEntries.push({
        key: 'practice-agg',
        sortKey: firstTime || dateKey,
        pillLabel: 'Practice',
        pillColor: CALENDAR_PRACTICE_BLUE,
        icon: 'mic',
        title: `Pronunciation Practice • ${daySessions.length} word${daySessions.length === 1 ? '' : 's'}`,
        meta: `${firstTime ? `${new Date(firstTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • ` : ''}Completed • ${avgDayAccuracy}% Accuracy`,
        actionLabel: 'View Details',
        onPress: () => setSection('progress'),
      });
    }

    dayScheduledItems.forEach((item) => {
      const pillLabel =
        item.activity_type === 'reading_lesson' ? 'Lesson' :
        item.activity_type === 'practice' ? 'Practice' :
        item.activity_type === 'appointment' ? 'Appointment' : 'Reminder';
      const pillColor =
        item.activity_type === 'reading_lesson' ? colors.lavenderDark :
        item.activity_type === 'practice' ? CALENDAR_PRACTICE_BLUE : colors.warning;
      dayEntries.push({
        key: `sched-${item.id}`,
        sortKey: item.start_time ? `${item.scheduled_date}T${item.start_time}` : item.scheduled_date,
        pillLabel: item.created_by === 'teacher' ? 'Teacher Activity' : pillLabel,
        pillColor,
        icon: SCHEDULED_TYPE_ICON[item.activity_type],
        title: item.title,
        meta: `${item.start_time ? `${item.start_time.slice(0, 5)} • ` : ''}${item.status === 'completed' ? 'Completed' : item.status === 'missed' ? 'Missed' : 'Planned'}${item.created_by === 'teacher' ? ' • From teacher' : ''}`,
        scheduledItem: item,
      });
    });

    dayEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return (
      <>
        <LinearGradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroProgressCard}
        >
          <View style={styles.heroDecorCircleLg} />
          <View style={styles.heroDecorCircleSm} />
          <Image source={require('../../assets/calendar.webp')} style={styles.calendarHeroImage} resizeMode="contain" />
          <View style={styles.heroProgressEyebrowRow}>
            <View style={styles.heroProgressIconWrap}>
              <Ionicons name="calendar" size={12} color="#fff" />
            </View>
            <Text style={styles.heroProgressEyebrow}>PLAN & TRACK</Text>
          </View>
          <Text style={[styles.heroProgressTitle, heroCardTitleA11yStyle]}>Calendar</Text>
          <Text style={[styles.heroProgressMessage, { maxWidth: '72%', marginTop: 6, marginBottom: 0 }]}>
            Plan and follow {selectedChild.name.split(' ')[0]}&apos;s learning activities.
          </Text>
        </LinearGradient>

        <View style={styles.childSummaryCard}>
          <View style={styles.childAvatarLg}>
            <Text style={styles.childAvatarLgText}>{selectedChild.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.childSummaryEyebrow}>Viewing Calendar For</Text>
            <Text style={[styles.childSummaryName, childNameA11yStyle]}>{selectedChild.name}</Text>
            <View style={styles.childSummaryBadgeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>Grade {selectedChild.grade_level}</Text>
              </View>
              <View style={[styles.levelBadgeOutline, { borderColor: getLevelColor(level) }]}>
                <Text style={[styles.levelBadgeOutlineText, { color: getLevelColor(level) }]}>{level} Reader</Text>
              </View>
            </View>
          </View>
          {children.length > 1 && (
            <TouchableOpacity
              style={styles.switchChildButton}
              onPress={() => setChildPickerOpen((open) => !open)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={childPickerOpen ? 'Close child switcher' : 'Switch to a different child'}
            >
              <Text style={styles.switchChildButtonText}>Switch Child</Text>
              <Ionicons name={childPickerOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.lavenderDark} />
            </TouchableOpacity>
          )}
        </View>

        {childPickerOpen && children.length > 1 && (
          <View style={styles.childPickerList}>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={styles.childPickerRow}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${child.name}`}
                onPress={() => {
                  setSelectedChildId(child.id);
                  setChildPickerOpen(false);
                }}
              >
                <Text style={[styles.childPickerRowText, child.id === selectedChild.id && { color: colors.lavenderDark, fontWeight: '800' }]}>
                  {child.name}
                </Text>
                {child.id === selectedChild.id && <Ionicons name="checkmark" size={16} color={colors.lavenderDark} />}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.calendarCard}>
          <View style={styles.calendarCardHeader}>
            <TouchableOpacity
              style={styles.monthButton}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => shiftCalendarMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel="Go to previous month"
            >
              <Ionicons name="chevron-back" size={18} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.calendarMonth}>{monthLabel}</Text>
            <TouchableOpacity
              style={styles.todayPill}
              onPress={() => {
                const now = new Date();
                setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                setSelectedCalendarDate(now.toISOString().slice(0, 10));
              }}
              hitSlop={{ top: 7, bottom: 7, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Jump to today"
            >
              <Text style={styles.todayPillText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.monthButton}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => shiftCalendarMonth(1)}
              accessibilityRole="button"
              accessibilityLabel="Go to next month"
            >
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <View style={styles.weekHeader}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <Text key={day} style={styles.weekHeaderText}>{day}</Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {getCalendarDays().map((cell) => {
              if (!cell.date) return <View key={cell.key} style={styles.dayCell} />;
              const key = cell.date.toISOString().slice(0, 10);
              const dayTypes = dayTypesForDate(key);
              const selected = key === selectedCalendarDate;
              const hasAnyDot = dayTypes.lesson || dayTypes.practice || dayTypes.completed || dayTypes.reminder;
              return (
                <TouchableOpacity
                  key={cell.key}
                  style={[styles.dayCell, selected && styles.dayCellSelected]}
                  onPress={() => setSelectedCalendarDate(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${cell.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${hasAnyDot ? ', has activity' : ''}${selected ? ', selected' : ''}`}
                >
                  <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{cell.date.getDate()}</Text>
                  {hasAnyDot && (
                    <View style={styles.dayDots}>
                      {dayTypes.lesson && <View style={[styles.dayDot, { backgroundColor: colors.lavenderDark }]} />}
                      {dayTypes.practice && <View style={[styles.dayDot, { backgroundColor: CALENDAR_PRACTICE_BLUE }]} />}
                      {dayTypes.completed && <View style={[styles.dayDot, { backgroundColor: colors.success }]} />}
                      {dayTypes.reminder && <View style={[styles.dayDot, { backgroundColor: colors.warning }]} />}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.dayLegendRow}>
            <View style={styles.dayLegendItem}><View style={[styles.dayDot, { backgroundColor: colors.lavenderDark }]} /><Text style={styles.dayLegendText}>Lesson</Text></View>
            <View style={styles.dayLegendItem}><View style={[styles.dayDot, { backgroundColor: CALENDAR_PRACTICE_BLUE }]} /><Text style={styles.dayLegendText}>Practice</Text></View>
            <View style={styles.dayLegendItem}><View style={[styles.dayDot, { backgroundColor: colors.success }]} /><Text style={styles.dayLegendText}>Completed</Text></View>
            <View style={styles.dayLegendItem}><View style={[styles.dayDot, { backgroundColor: colors.warning }]} /><Text style={styles.dayLegendText}>Reminder</Text></View>
          </View>
        </View>

        <View style={styles.selectedTasksCard}>
          <View style={styles.selectedTasksHeaderRow}>
            <Text style={styles.selectedTasksTitle}>
              {new Date(`${selectedCalendarDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} • {selectedChild.name.split(' ')[0]}&apos;s Activities
            </Text>
          </View>
          {dayEntries.length ? (
            dayEntries.map((entry) => (
              <TouchableOpacity
                key={entry.key}
                style={styles.dayEntryRow}
                disabled={!entry.scheduledItem || entry.scheduledItem.created_by !== 'parent'}
                onPress={() => {
                  if (entry.scheduledItem?.created_by === 'parent') {
                    setEditingScheduledActivity(entry.scheduledItem);
                    setActivityModalVisible(true);
                  }
                }}
              >
                <View style={[styles.dayEntryIconWrap, { backgroundColor: `${entry.pillColor}1A` }]}>
                  <Ionicons name={entry.icon} size={17} color={entry.pillColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={[styles.dayEntryPill, { backgroundColor: `${entry.pillColor}1A` }]}>
                    <Text style={[styles.dayEntryPillText, { color: entry.pillColor }]}>{entry.pillLabel}</Text>
                  </View>
                  <Text style={styles.dayEntryTitle}>{entry.title}</Text>
                  <Text style={styles.dayEntryMeta}>{entry.meta}</Text>
                </View>
                {entry.actionLabel && entry.onPress ? (
                  <TouchableOpacity
                    style={[styles.dayEntryAction, { borderColor: entry.pillColor }]}
                    onPress={entry.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.actionLabel} for ${entry.title}`}
                  >
                    <Text style={[styles.dayEntryActionText, { color: entry.pillColor }]}>{entry.actionLabel}</Text>
                  </TouchableOpacity>
                ) : entry.scheduledItem?.created_by === 'parent' ? (
                  <TouchableOpacity
                    style={styles.scheduledCompleteButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={(event) => {
                      event.stopPropagation();
                      void toggleScheduledComplete(entry.scheduledItem!);
                    }}
                    disabled={entry.scheduledItem.status === 'completed'}
                    accessibilityRole="button"
                    accessibilityLabel={
                      entry.scheduledItem.status === 'completed'
                        ? `${entry.title} marked complete`
                        : `Mark ${entry.title} as complete`
                    }
                  >
                    <Ionicons
                      name={entry.scheduledItem.status === 'completed' ? 'checkmark-circle' : 'checkmark-circle-outline'}
                      size={22}
                      color={getScheduledStatusColor(entry.scheduledItem.status)}
                    />
                  </TouchableOpacity>
                ) : entry.scheduledItem ? (
                  <Ionicons name="lock-closed" size={18} color={colors.inkSoft} accessibilityLabel="Teacher-owned activity" />
                ) : null}
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.emptyDetail}>No activities on this date.</Text>
          )}
        </View>

        <View style={styles.weekSummaryCard}>
          <View style={styles.weekSummaryHeaderRow}>
            <Ionicons name="bar-chart" size={16} color={colors.sage} />
            <Text style={[styles.homeSectionTitleInline, sectionTitleInlineA11yStyle]}>This Week</Text>
          </View>
          <View style={styles.weekSummaryStatsRow}>
            <View style={styles.weekSummaryStat}>
              <Text style={[styles.weekSummaryStatValue, weekStatValueA11yStyle, { color: colors.lavenderDark }]}>{weekLessonsCompleted}</Text>
              <Text style={[styles.weekSummaryStatLabel, weekStatLabelA11yStyle]}>Lessons</Text>
            </View>
            <View style={styles.weekSummaryStat}>
              <Text style={[styles.weekSummaryStatValue, weekStatValueA11yStyle, { color: CALENDAR_PRACTICE_BLUE }]}>{weekSessions.length}</Text>
              <Text style={[styles.weekSummaryStatLabel, weekStatLabelA11yStyle]}>Practice Sessions</Text>
            </View>
            <View style={styles.weekSummaryStat}>
              <Text style={[styles.weekSummaryStatValue, weekStatValueA11yStyle, { color: colors.sage }]}>{activeDaysThisWeek}</Text>
              <Text style={[styles.weekSummaryStatLabel, weekStatLabelA11yStyle]}>Active Days</Text>
            </View>
          </View>
          <View style={styles.weekProgressTrack}>
            <View style={[styles.weekProgressFill, { width: `${Math.round((activeDaysThisWeek / 7) * 100)}%` }]} />
          </View>
          <Text style={styles.weekSummaryCaption}>{activeDaysThisWeek}/7 days active this week • {weekCaption}</Text>
        </View>

        <View style={styles.upcomingCard}>
          <View style={styles.upcomingHeaderRow}>
            <Ionicons name="alarm" size={16} color={colors.sun} />
            <Text style={[styles.homeSectionTitleInline, sectionTitleInlineA11yStyle]}>Upcoming Reminders</Text>
          </View>
          {upcomingReminders.length ? (
            upcomingReminders.map((item) => (
              <View key={item.id} style={styles.upcomingRow}>
                <Ionicons name={SCHEDULED_TYPE_ICON[item.activity_type]} size={15} color={colors.sun} />
                <Text style={styles.upcomingRowText}>
                  {item.title} • {new Date(`${item.scheduled_date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {item.start_time ? ` ${item.start_time.slice(0, 5)}` : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyDetail}>No upcoming reminders scheduled.</Text>
          )}
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => {
              setEditingScheduledActivity(null);
              setActivityModalVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a reminder"
          >
            <Ionicons name="add-circle" size={16} color={colors.lavenderDark} />
            <Text style={styles.quickActionText}>Add Reminder</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('progress')} accessibilityRole="button" accessibilityLabel="View progress">
            <Ionicons name="bar-chart" size={16} color={colors.lavenderDark} />
            <Text style={styles.quickActionText}>View Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('settings')} accessibilityRole="button" accessibilityLabel="Open notification settings">
            <Ionicons name="settings" size={16} color={colors.lavenderDark} />
            <Text style={styles.quickActionText}>Notification Settings</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.overviewGrid}>
          <View style={[styles.overviewCard, { backgroundColor: '#EAF3FB' }]}>
            <Ionicons name="book" size={20} color={colors.lavenderDark} />
            <Text style={[styles.overviewValue, overviewValueA11yStyle, { color: colors.lavenderDark }]}>{wordsPracticed}</Text>
            <Text style={[styles.overviewLabel, overviewLabelA11yStyle]}>Words Practiced</Text>
          </View>
          <View style={[styles.overviewCard, { backgroundColor: '#E9F1E2' }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.sage} />
            <Text style={[styles.overviewValue, overviewValueA11yStyle, { color: colors.sage }]}>{avgAccuracy !== null ? `${avgAccuracy}%` : '--'}</Text>
            <Text style={[styles.overviewLabel, overviewLabelA11yStyle]}>All-Time Average</Text>
          </View>
        </View>

        <View style={styles.parentInsightCard}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <View style={styles.upcomingHeaderRow}>
              <Ionicons name="bulb" size={16} color={colors.lavenderDark} />
              <Text style={[styles.homeSectionTitleInline, sectionTitleInlineA11yStyle, { fontSize: a11ySize(14) }]}>Parent Insight</Text>
            </View>
            <Text style={styles.parentInsightText}>
              {hasEnoughInsightData
                ? `${selectedChild.name.split(' ')[0]} has been most consistent on ${weekdayNames[topWeekdayIndex]}s. Keeping a short daily routine may help.`
                : `Not enough practice history yet to spot a pattern in ${selectedChild.name.split(' ')[0]}'s routine.`}
            </Text>
            <TouchableOpacity onPress={() => setSection('progress')}>
              <Text style={styles.insightSeeMore}>View Child Progress →</Text>
            </TouchableOpacity>
          </View>
          <Image source={require('../../assets/parentreading.webp')} style={styles.parentInsightImage} resizeMode="contain" />
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
      <Ionicons name={icon} size={20} color={colors.lavenderDark} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>{title}</Text>
        <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>{subtitle}</Text>
      </View>
      <Switch
        value={!!value}
        onValueChange={(next) => updateParentSetting(key, next as any)}
        disabled={savingSettingKey === '__all__'}
        trackColor={{ false: '#cbd5e1', true: 'rgba(95,82,176,0.4)' }}
        thumbColor={value ? colors.lavenderDark : '#f8fafc'}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
      />
    </View>
  );

  const renderSettings = () => (
    <>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionHeaderTitle, settingsHeaderTitleA11yStyle]}>Settings</Text>
          <Text style={[styles.sectionHeaderSub, settingsHeaderSubA11yStyle]}>Manage your account and preferences.</Text>
        </View>
      </View>

      {hasUnsavedParentSettingsChanges && (
        <View style={styles.unsavedSettingsBar}>
          <Text style={[styles.unsavedSettingsBarText, saveDiscardBarTextA11yStyle]}>You have unsaved changes.</Text>
          <View style={styles.unsavedSettingsBarButtons}>
            <TouchableOpacity
              style={styles.discardSettingsButton}
              onPress={discardParentSettingsDraft}
              disabled={savingSettingKey === '__all__'}
              accessibilityRole="button"
              accessibilityLabel="Discard unsaved changes"
            >
              <Text style={[styles.discardSettingsButtonText, saveDiscardButtonTextA11yStyle]}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveSettingsButton}
              onPress={saveParentSettingsDraft}
              disabled={savingSettingKey === '__all__'}
              accessibilityRole="button"
              accessibilityLabel="Save changes"
            >
              {savingSettingKey === '__all__' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.saveSettingsButtonText, saveDiscardButtonTextA11yStyle]}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

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
            <Text style={[styles.accountName, accountNameA11yStyle]}>{parentName}</Text>
            <Text style={[styles.accountEmail, accountSubA11yStyle]}>{parentEmail}</Text>
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
              <Text style={[styles.accountName, accountNameA11yStyle]}>{child.name}</Text>
              <Text style={[styles.accountEmail, accountSubA11yStyle]}>
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
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Manage ${child.name}`}
            >
              <Text style={styles.manageChildButtonText}>Manage Child</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <TouchableOpacity style={styles.enrollChildRow} onPress={() => setShowEnroll(true)}>
        <Ionicons name="add" size={18} color={colors.lavenderDark} />
        <Text style={styles.enrollChildRowText}>Enroll New Child</Text>
      </TouchableOpacity>

      <Text style={styles.settingsGroupTitle}>Account Settings</Text>
      <View style={styles.settingsListCard}>
        <TouchableOpacity style={styles.settingsRow} onPress={() => setEditProfileVisible(true)}>
          <Ionicons name="person-outline" size={20} color={colors.lavenderDark} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>Personal Information</Text>
            <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>Update your name and phone number</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsRow} onPress={openPasswordModal}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.lavenderDark} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>Change Password</Text>
            <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>Update your account password securely</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => {
            setNewEmailInput(parentEmail);
            setEmailModalError('');
            setEmailModalVisible(true);
          }}
        >
          <Ionicons name="mail-outline" size={20} color={colors.lavenderDark} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>Email Address</Text>
            <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>{parentEmail}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
        </TouchableOpacity>

        {!parentSettings ? (
          <ActivityIndicator color={colors.lavenderDark} style={{ marginVertical: 16 }} />
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
          <ActivityIndicator color={colors.lavenderDark} style={{ marginVertical: 16 }} />
        ) : (
          <>
            {renderToggleRow('text-outline', 'Dyslexia-Friendly Font', 'Use a font designed to improve readability', 'dyslexia_font', parentSettings.dyslexia_font)}
            {renderToggleRow('volume-high-outline', 'Text-to-Speech', 'Listen to text read aloud in the app', 'tts_enabled', parentSettings.tts_enabled)}
            <View style={[styles.settingsToggleRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="speedometer-outline" size={20} color={colors.lavenderDark} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>Speech Speed</Text>
                <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>{parentSettings.speech_rate || 'normal'}</Text>
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
          <Ionicons name="headset-outline" size={20} color={colors.lavenderDark} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>Contact Support</Text>
            <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>Get help from our team</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => Linking.openURL('https://linawletra.app/privacy').catch(() => {})}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.lavenderDark} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>Privacy Policy</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
        </TouchableOpacity>
        <View style={[styles.settingsRow, { borderBottomWidth: 0 }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.lavenderDark} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowTitle, toggleTitleA11yStyle]}>App Version</Text>
            <Text style={[styles.settingsRowSub, toggleSubA11yStyle]}>{appVersion} - Up to date</Text>
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
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={openSidebar} style={styles.menuButton} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="menu-outline" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.appTitle}>LinawLetra</Text>
        {/* Balances menuButton's width so appTitle stays centered now that
            the bell (moved into the sidebar's Notifications nav item) is gone. */}
        <View style={styles.topBarSpacer} />
      </View>

      {!!error && (
        <Text style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}

      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {renderSection()}
      </ScrollView>

      <DashboardBottomNav
        items={PARENT_BOTTOM_ITEMS.map((item) => item.key === 'notifications' ? { ...item, badge: unreadNotifications } : item)}
        activeKey={section}
        onSelect={(key) => navigateTo(key as Section)}
      />

      {sidebarOpen && (
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} onTouchEnd={closeSidebar} />
      )}

      {sidebarOpen && (
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}> 
        <ScrollView style={styles.sidebarScroll} contentContainerStyle={styles.sidebarScrollContent} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#F0E9FF', '#FCEAF4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sidebarHero}>
            <TouchableOpacity style={styles.sidebarCloseButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={closeSidebar}>
              <Ionicons name="close" size={20} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.sidebarHeroRow}>
              {parentAvatarUrl ? (
                <Image source={{ uri: parentAvatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
              )}
              <View style={styles.sidebarHeroText}>
                <Text style={styles.sidebarName} numberOfLines={2}>{parentName}</Text>
                <Text style={styles.sidebarEmail} numberOfLines={2}>{parentEmail}</Text>
              </View>
            </View>
            <View style={styles.sidebarHeroFooter}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarHeroMeta}>{enrolledChildrenText}</Text>
                {selectedChild ? <Text style={styles.sidebarHeroSub}>Managing {selectedChild.name}</Text> : null}
              </View>
              <Image source={require('../../assets/parentreading.webp')} style={styles.sidebarHeroImage} resizeMode="contain" />
            </View>
          </LinearGradient>

          <View style={styles.sidebarBody}>
            <Text style={styles.sidebarSectionLabel}>Parent Menu</Text>
            {[
              { key: 'profile', label: 'Profile', icon: 'person-outline', onPress: () => { closeSidebar(); setEditProfileVisible(true); } },
              { key: 'children', label: 'Children', icon: 'people-outline', onPress: () => navigateTo('welcome') },
              { key: 'account', label: 'Account', icon: 'person-circle-outline', onPress: () => navigateTo('settings') },
              { key: 'preferences', label: 'App Preferences', icon: 'options-outline', onPress: () => navigateTo('settings') },
              { key: 'help', label: 'Help', icon: 'help-circle-outline', onPress: contactSupport },
              { key: 'about', label: 'About', icon: 'information-circle-outline', onPress: () => Alert.alert('About LinawLetra', `Version ${appVersion}\nA supportive reading companion for children and families.`) },
              { key: 'privacy', label: 'Privacy', icon: 'shield-checkmark-outline', onPress: () => Linking.openURL('https://linawletra.app/privacy').catch(() => Alert.alert('Unable to open Privacy Policy')) },
            ].map((item) => (
              <TouchableOpacity key={item.key} style={styles.navItem} onPress={item.onPress} activeOpacity={0.78}>
                <View style={styles.navIconWrap}>
                  <Ionicons name={item.icon as any} size={20} color={colors.lavenderDark} />
                </View>
                <Text style={styles.navLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#8B7DAE" />
              </TouchableOpacity>
            ))}

            <Text style={styles.sidebarSectionLabel}>Account</Text>
            <TouchableOpacity style={styles.sidebarLogout} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color={colors.danger} />
              <Text style={styles.sidebarLogoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Animated.View>
      )}

      <EnrollChildModal
        visible={showEnroll}
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
        childOptions={children.map((child) => ({ id: child.id, name: child.name }))}
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

      <Modal visible={passwordModalVisible} animationType="slide" transparent onRequestClose={closePasswordModal}>
        <View style={styles.emailModalBackdrop}>
          <View style={styles.emailModalSheet}>
            <View style={styles.emailModalHeader}>
              <Text style={styles.emailModalTitle}>Change Password</Text>
              <TouchableOpacity onPress={closePasswordModal} disabled={savingPassword}>
                <Ionicons name="close" size={24} color={colors.ink} />
              </TouchableOpacity>
            </View>
            <Text style={styles.passwordModalHint}>Use at least 8 characters for your new password.</Text>
            <TextInput
              style={styles.emailModalInput}
              value={newPasswordInput}
              onChangeText={setNewPasswordInput}
              autoCapitalize="none"
              secureTextEntry
              placeholder="New password"
              placeholderTextColor={colors.inkSoft}
            />
            <TextInput
              style={[styles.emailModalInput, styles.passwordConfirmInput]}
              value={confirmPasswordInput}
              onChangeText={setConfirmPasswordInput}
              autoCapitalize="none"
              secureTextEntry
              placeholder="Confirm new password"
              placeholderTextColor={colors.inkSoft}
              onSubmitEditing={submitPasswordChange}
            />
            {!!passwordModalError && (
              <Text style={styles.emailModalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {passwordModalError}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.emailModalSubmit, savingPassword && { opacity: 0.6 }]}
              onPress={submitPasswordChange}
              disabled={savingPassword}
            >
              {savingPassword ? <ActivityIndicator color="#fff" /> : <Text style={styles.emailModalSubmitText}>Update Password</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={emailModalVisible} animationType="slide" transparent onRequestClose={() => setEmailModalVisible(false)}>
        <View style={styles.emailModalBackdrop}>
          <View style={styles.emailModalSheet}>
            <View style={styles.emailModalHeader}>
              <Text style={styles.emailModalTitle}>Baguhin ang Email</Text>
              <TouchableOpacity onPress={() => setEmailModalVisible(false)} disabled={savingEmail}>
                <Ionicons name="close" size={24} color={colors.ink} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.emailModalInput}
              value={newEmailInput}
              onChangeText={setNewEmailInput}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Bagong email"
              placeholderTextColor={colors.inkSoft}
            />
            {!!emailModalError && (
              <Text style={styles.emailModalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {emailModalError}
              </Text>
            )}
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
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  menuButton: { padding: 6 },
  topBarSpacer: { width: 38 },
  settingsButton: { padding: 6, marginRight: 6 },
  appTitle: { fontSize: 20, fontWeight: '900', color: colors.primary, flex: 1, textAlign: 'center' },
  mainScroll: { flex: 1 },
  errorBanner: { color: colors.danger, marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
  content: { padding: 16, paddingBottom: 40 },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', zIndex: 99 },
  sidebar: {
    position: 'absolute', top: 0, bottom: 0, left: 0, width: SIDEBAR_WIDTH,
    backgroundColor: '#F7F5FC', paddingTop: 0, zIndex: 100,
    shadowColor: '#594B78', shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.14, shadowRadius: 24, elevation: 18,
  },
  sidebarScroll: { flex: 1 },
  sidebarScrollContent: { paddingBottom: 36 },
  sidebarHero: {
    paddingTop: 48, paddingHorizontal: 20, paddingBottom: 20,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
  },
  sidebarCloseButton: { position: 'absolute', top: 20, right: 16, zIndex: 2 },
  sidebarHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 30 },
  sidebarHeroText: { flex: 1, minWidth: 0 },
  sidebarHeroFooter: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 12, paddingLeft: 4 },
  sidebarHeroMeta: { color: '#75658F', fontSize: 12 },
  sidebarHeroSub: { color: '#514466', fontSize: 12, marginTop: 4, fontWeight: '600' },
  sidebarHeroImage: { width: 76, height: 76 },
  sidebarBody: { paddingHorizontal: 20, paddingTop: 20 },
  sidebarSectionLabel: { color: '#69598C', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: 12 },
  avatar: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 29, fontWeight: '900', color: colors.primary },
  sidebarName: { fontSize: 18, lineHeight: 22, fontWeight: '900', color: '#30254D' },
  sidebarEmail: { fontSize: 12, lineHeight: 17, color: '#756A87', marginTop: 4 },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18,
    marginBottom: 8, backgroundColor: '#FFFFFF',
  },
  navItemActive: { backgroundColor: '#E9E2FF' },
  navIconWrap: {
    width: 36, height: 36, borderRadius: 14,
    backgroundColor: '#F0ECFA', alignItems: 'center', justifyContent: 'center',
  },
  navIconWrapActive: { backgroundColor: '#FFFFFF' },
  navLabel: { fontSize: 14, fontWeight: '700', color: '#44375F', flex: 1 },
  navLabelActive: { color: PRIMARY_TEXT },
  navBadge: {
    minWidth: 26, paddingHorizontal: 8, height: 24, borderRadius: 12,
    backgroundColor: colors.vivid.amber, alignItems: 'center', justifyContent: 'center',
  },
  navBadgeText: { color: '#1f2937', fontSize: 12, fontWeight: '800' },
  quickAccessButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', marginBottom: 10,
  },
  quickAccessIconWrap: {
    width: 38, height: 38, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  quickAccessLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: '#44375F' },
  sidebarProgressCard: {
    marginTop: 12, padding: 18, borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
  },
  sidebarProgressTitle: { fontSize: 13, fontWeight: '700', color: '#69598C', marginBottom: 10 },
  sidebarProgressValue: { fontSize: 28, fontWeight: '900', color: '#30254D', marginBottom: 12 },
  sidebarProgressTrack: { height: 8, backgroundColor: '#E9E4F2', borderRadius: 999, overflow: 'hidden', marginBottom: 8 },
  sidebarProgressFill: { height: '100%', backgroundColor: colors.vivid.teal, borderRadius: 999 },
  sidebarProgressStatus: { fontSize: 12, color: '#756A87' },
  sidebarAccessibilityCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderRadius: radius.lg, backgroundColor: '#FFFFFF', marginTop: 16,
  },
  sidebarAccessibilityText: { flex: 1, marginRight: 12 },
  sidebarAccessibilityTitle: { fontSize: 13, fontWeight: '700', color: '#44375F', marginBottom: 4 },
  sidebarAccessibilitySub: { fontSize: 12, color: '#756A87' },
  sidebarLogout: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 20, padding: 16, borderRadius: 18,
    backgroundColor: '#FDEBEC',
  },
  sidebarLogoutText: { color: colors.danger, fontWeight: '800', fontSize: 14 },
  childCard: {
    backgroundColor: SURFACE, borderRadius: 20, padding: 18,
    marginBottom: 14, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  childCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  childAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  childAvatarText: { fontSize: 18, fontWeight: '900', color: colors.primary },
  childName: { fontSize: 17, fontWeight: '900', color: colors.textPrimary },
  childMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  levelBadge: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  levelBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  greeting: { fontSize: 14, color: colors.textSecondary, fontStyle: 'italic', marginBottom: 14, lineHeight: 20 },
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  statChipText: { fontSize: 12, fontWeight: '800', color: PRIMARY_TEXT },
  progressTrack: { height: 8, backgroundColor: colors.border, borderRadius: 999, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 999 },
  progressLabel: { fontSize: 11, color: colors.textSecondary, textAlign: 'right', marginBottom: 10 },
  childDetails: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyDetail: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 8 },
  quickAction: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.lavenderDark, backgroundColor: SURFACE,
  },
  quickActionText: { fontSize: 12, fontWeight: '800', color: colors.lavenderDark },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  // Home tab redesign - shares the Student Dashboard's HOME_* palette for
  // visual identity, kept measured/adult in tone (no display font, minimal
  // emoji) compared to the more playful student-facing screens.
  homeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  homeAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.lavender,
    alignItems: 'center', justifyContent: 'center',
  },
  homeAvatarText: { fontSize: 18, fontWeight: '900', color: '#fff' },
  homeGreeting: { fontSize: 22, fontWeight: '900', color: colors.ink },
  homeGreetingSub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  viewingSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'flex-start',
    backgroundColor: '#EFECFB', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, gap: 6, marginBottom: 12,
  },
  viewingSelectorText: { fontSize: 13, fontWeight: '800', color: colors.lavenderDark },
  childPickerList: {
    backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12, overflow: 'hidden',
  },
  childPickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  childPickerRowText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  childSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: SURFACE, borderRadius: radius.lg, padding: 18, marginBottom: 16,
    ...shadows.card,
  },
  latestReadingCard: { backgroundColor: '#F8F7FF', borderRadius: radius.lg, padding: 16, marginBottom: 16, ...shadows.card },
  latestReadingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  latestReadingEyebrow: { color: colors.lavenderDark, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  latestReadingWord: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 3 },
  latestReadingStats: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, paddingVertical: 10, marginBottom: 12 },
  latestReadingStat: { flex: 1, alignItems: 'center', paddingHorizontal: 3 },
  latestReadingValue: { color: colors.lavenderDark, fontSize: 16, fontWeight: '900' },
  latestReadingLabel: { color: colors.inkSoft, fontSize: 9, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  latestReadingObservation: { color: colors.ink, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  latestReadingPractice: { color: colors.sage, fontSize: 12, fontWeight: '800', lineHeight: 18, marginTop: 6 },
  childAvatarLg: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#EFECFB',
    alignItems: 'center', justifyContent: 'center',
  },
  childAvatarLgText: { fontSize: 22, fontWeight: '900', color: colors.lavenderDark },
  childSummaryName: { fontSize: 18, fontWeight: '900', color: colors.ink, marginBottom: 8 },
  childSummaryBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  gradeBadge: { backgroundColor: '#f3f4f6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  gradeBadgeText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  levelBadgeOutline: { borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4 },
  levelBadgeOutlineText: { fontSize: 11, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDotLg: { width: 8, height: 8, borderRadius: 4 },
  statusRowText: { fontSize: 12, fontWeight: '700', color: colors.inkSoft },
  readingProgressCard: {
    backgroundColor: SURFACE, borderRadius: radius.lg, padding: 20, marginBottom: 16,
    ...shadows.card, alignItems: 'center',
  },
  readingProgressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  readingProgressTitle: { fontSize: 17, fontWeight: '900', color: colors.ink },
  readingProgressPct: { fontSize: 26, fontWeight: '900', color: colors.lavenderDark },
  improvementBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10,
  },
  improvementBadgeText: { fontSize: 12, fontWeight: '800' },
  readingProgressMessage: { fontSize: 13, color: colors.inkSoft, textAlign: 'center' },
  homeSectionTitle: { fontSize: 16, fontWeight: '900', color: colors.ink, marginBottom: 10 },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  overviewCard: { width: '47%', borderRadius: 16, padding: 14, ...shadows.card },
  overviewValue: { fontSize: 20, fontWeight: '900', marginTop: 8 },
  overviewLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontWeight: '700' },
  trendCard: {
    backgroundColor: SURFACE, borderRadius: radius.md, padding: 16, marginBottom: 16,
    ...shadows.card,
  },
  trendMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  trendMsgText: { fontSize: 12, color: colors.inkSoft, flex: 1 },
  trendEmpty: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  trendEmptyText: { fontSize: 13, color: colors.inkSoft, textAlign: 'center' },
  skillCardTrack: { height: 5, backgroundColor: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  skillCardFill: { height: '100%', borderRadius: 999 },
  currentLessonCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 16, marginBottom: 16,
    ...shadows.card, gap: 6,
  },
  currentLessonTitle: { fontSize: 14, fontWeight: '800', color: colors.ink, flex: 1 },

  // Home tab redesign - decor, child card, hero, weekly chart, insight,
  // goal, recent feed, support banner
  homeGreetingDecor: { width: 72, height: 48, marginLeft: 4 },
  childSummaryEyebrow: { fontSize: 11, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.4 },
  switchChildButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EFECFB',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start',
  },
  switchChildButtonText: { fontSize: 12, fontWeight: '800', color: colors.lavenderDark },
  heroProgressCard: {
    borderRadius: 26, padding: 20, marginBottom: 16, overflow: 'hidden',
    ...shadows.hero,
  },
  // Soft translucent circles for depth - purely decorative, sit behind
  // everything, clipped by the card's own overflow:hidden.
  heroDecorCircleLg: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.08)', top: -60, left: -50,
  },
  heroDecorCircleSm: {
    position: 'absolute', width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.07)', bottom: -30, left: 60,
  },
  // Peeks in from the bottom-right corner, below the ring's row and to the
  // right of the left-aligned button/message, so nothing sits on top of it.
  heroProgressImage: { width: 94, height: 125, position: 'absolute', right: 2, bottom: -9, opacity: 0.95 },
  heroProgressTopRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  heroProgressEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  heroProgressIconWrap: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroProgressEyebrow: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.6 },
  heroProgressTitle: { fontSize: 19, fontWeight: '900', color: '#fff', lineHeight: 24 },
  heroDeltaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 10,
  },
  heroDeltaPillText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  heroProgressMessage: {
    fontSize: 13, color: 'rgba(255,255,255,0.92)', fontWeight: '600', marginBottom: 14,
    maxWidth: '68%', lineHeight: 18,
  },
  heroProgressButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff',
    borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18, alignSelf: 'flex-start',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  heroProgressButtonText: { fontSize: 12, fontWeight: '800', color: colors.heroGradient[0] },
  heroProgressRingWrap: {
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  heroProgressPct: { fontSize: 20, fontWeight: '900', color: '#fff' },
  heroProgressPctLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  weekBarRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 90, marginBottom: 10 },
  weekBarCol: { alignItems: 'center', gap: 6, flex: 1 },
  weekBarTrack: { height: 70, width: 16, justifyContent: 'flex-end' },
  weekBarFill: { width: 16, borderRadius: 8, backgroundColor: colors.lavender },
  weekBarLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: '700' },
  weekBarSummary: { fontSize: 12, color: colors.inkSoft, fontWeight: '700', textAlign: 'center' },
  skillOverviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillOverviewMeta: { fontSize: 11, color: colors.inkSoft, fontWeight: '600', marginTop: 4, marginLeft: 26 },
  skillOverviewEmpty: { fontSize: 13, color: colors.inkSoft, fontWeight: '600' },
  homeSectionSub: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', marginTop: -6, marginBottom: 10 },
  weeklyInsightCard: {
    backgroundColor: SURFACE, borderRadius: radius.md, padding: 16, marginBottom: 16,
    ...shadows.card, gap: 10,
  },
  weeklyInsightRow: { gap: 4 },
  insightRowLabel: { fontSize: 13, fontWeight: '800', color: colors.ink },
  insightRowTrack: { height: 6, backgroundColor: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  insightRowFill: { height: '100%', borderRadius: 999 },
  insightRowStatus: { fontSize: 11, fontWeight: '700' },
  insightSeeMore: { fontSize: 12, fontWeight: '800', color: colors.lavenderDark, marginTop: 4 },
  goalCard: {
    backgroundColor: '#FFF3DC', borderRadius: radius.md, padding: 16, marginBottom: 16, gap: 8,
    ...shadows.card,
  },
  goalCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeSectionTitleInline: { fontSize: 15, fontWeight: '900', color: colors.ink },
  goalCardValue: { fontSize: 22, fontWeight: '900', color: colors.sun },
  goalCardTrack: { height: 8, backgroundColor: 'rgba(227,151,26,0.18)', borderRadius: 999, overflow: 'hidden' },
  goalCardFill: { height: '100%', borderRadius: 999, backgroundColor: colors.sun },
  goalCardSub: { fontSize: 12, color: colors.inkSoft, fontWeight: '600' },
  recentHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  viewAllLink: { fontSize: 12, fontWeight: '800', color: colors.lavenderDark },
  recentActivityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: SURFACE, borderRadius: 16,
    padding: 12, marginBottom: 10, ...shadows.card,
  },
  recentActivityIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  recentActivityDetail: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  recentActivityTime: { fontSize: 11, color: colors.inkSoft, fontWeight: '600' },
  supportBanner: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 18, marginBottom: 16, overflow: 'hidden',
    ...shadows.hero,
  },
  supportBannerTitle: { fontSize: 15, fontWeight: '900', color: '#fff', marginBottom: 4 },
  supportBannerText: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '600', marginBottom: 10 },
  supportBannerButton: { backgroundColor: '#111827', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' },
  supportBannerButtonText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  supportBannerImage: { width: 74, height: 98, opacity: 0.95 },

  // Calendar tab
  calendarHeroImage: { width: 86, height: 58, position: 'absolute', right: 12, bottom: 12, opacity: 0.95 },
  weekSummaryCard: { backgroundColor: '#E9F1E2', borderRadius: radius.md, padding: 16, marginBottom: 16, gap: 10, ...shadows.card },
  weekSummaryHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekSummaryStatsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  weekSummaryStat: { alignItems: 'center', gap: 2 },
  weekSummaryStatValue: { fontSize: 20, fontWeight: '900' },
  weekSummaryStatLabel: { fontSize: 10.5, color: colors.inkSoft, fontWeight: '700', textAlign: 'center' },
  weekProgressTrack: { height: 7, backgroundColor: 'rgba(92,128,71,0.16)', borderRadius: 999, overflow: 'hidden' },
  weekProgressFill: { height: '100%', borderRadius: 999, backgroundColor: colors.sage },
  weekSummaryCaption: { fontSize: 11.5, color: colors.inkSoft, fontWeight: '600' },
  upcomingCard: { backgroundColor: '#FFF3DC', borderRadius: radius.md, padding: 16, marginBottom: 16, gap: 8, ...shadows.card },
  upcomingHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  upcomingRowText: { fontSize: 12.5, color: colors.ink, fontWeight: '700', flex: 1 },
  parentInsightCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFECFB', borderRadius: radius.md,
    padding: 16, marginBottom: 16,
    ...shadows.card,
  },
  parentInsightText: { fontSize: 12.5, color: colors.ink, fontWeight: '600', lineHeight: 17, marginTop: 6, marginBottom: 8 },
  parentInsightImage: { width: 80, height: 107 },

  // Child Progress tab
  trendLineLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  trendLineLabelText: { fontSize: 10, color: colors.textSecondary, flex: 1, textAlign: 'center' },
  periodFilterLabel: { fontSize: 10, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 8 },
  periodFilterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodChip: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 999, paddingVertical: 9,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  periodChipActive: { backgroundColor: colors.lavenderDark, borderColor: colors.lavenderDark },
  periodChipText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  periodChipTextActive: { color: '#fff' },
  readingProgressPctSub: { fontSize: 10, color: colors.inkSoft, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  overallStatsRow: {
    flexDirection: 'row', backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: colors.border,
  },
  overallStatCell: { flex: 1, alignItems: 'center' },
  overallStatValue: { fontSize: 17, fontWeight: '900', color: colors.ink },
  overallStatLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 3, fontWeight: '700' },
  skillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  skillGridCard: {
    width: '47%', backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    ...shadows.card, gap: 6,
  },
  skillGridTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },
  skillGridLabel: { fontSize: 12, fontWeight: '800', color: colors.ink, flex: 1 },
  skillGridPct: { fontSize: 15, fontWeight: '900' },
  skillGridStatus: { fontSize: 11, fontWeight: '700' },
  miniChartCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 16, marginBottom: 12,
    ...shadows.card,
  },
  miniChartTitle: { fontSize: 13, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  miniChartBars: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 70 },
  miniBarCol: { alignItems: 'center', gap: 4, flex: 1 },
  miniBar: { width: 14, borderRadius: 4, backgroundColor: colors.lavender },
  miniBarLabel: { fontSize: 9, color: colors.textSecondary },
  miniChartSub: { fontSize: 11, color: colors.inkSoft, marginTop: 10, textAlign: 'center' },
  recommendCard: {
    flexDirection: 'row', gap: 12, backgroundColor: '#FFF3DC', borderRadius: 16,
    padding: 16, marginBottom: 12, alignItems: 'flex-start',
    ...shadows.card,
  },
  recommendIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  recommendTitle: { fontSize: 13, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  recommendText: { fontSize: 12, color: colors.inkSoft, lineHeight: 17, marginBottom: 10 },
  recommendButton: {
    backgroundColor: colors.sun, borderRadius: 999, paddingVertical: 9,
    paddingHorizontal: 14, alignSelf: 'flex-start',
  },
  recommendButtonText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  insightCardV2: {
    flexDirection: 'row', gap: 10, backgroundColor: '#EFECFB', borderRadius: 16,
    padding: 16, marginBottom: 16, alignItems: 'flex-start',
    ...shadows.card,
  },
  insightCardV2Text: { fontSize: 12, color: colors.ink, lineHeight: 18, flex: 1 },
  detailedReportButton: {
    backgroundColor: colors.lavenderDark, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 4, marginBottom: 8,
  },
  detailedReportButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  recentActivityScore: { fontSize: 15, fontWeight: '900' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionHeaderTitle: { fontSize: 18, fontWeight: '900', color: colors.textPrimary, flex: 1 },
  sectionHeaderSub: { fontSize: 12, color: colors.textSecondary },
  monthButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCard: {
    backgroundColor: SURFACE,
    borderRadius: radius.md,
    padding: 14,
    ...shadows.card,
    marginBottom: 16,
  },
  calendarCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  todayPill: { backgroundColor: colors.lavenderDark, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  todayPillText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  dayLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  dayLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dayLegendText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  calendarMonth: { fontSize: 16, fontWeight: '900', color: colors.textPrimary },
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
    backgroundColor: SURFACE,
    borderRadius: radius.md,
    padding: 14,
    ...shadows.card,
    marginBottom: 16,
  },
  dayEntryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  dayEntryIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayEntryPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 3 },
  dayEntryPillText: { fontSize: 9.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  dayEntryTitle: { fontSize: 13.5, fontWeight: '800', color: colors.textPrimary },
  dayEntryMeta: { fontSize: 11.5, color: colors.textSecondary, fontWeight: '600', marginTop: 1 },
  dayEntryAction: { borderWidth: 1.3, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  dayEntryActionText: { fontSize: 10.5, fontWeight: '800' },
  selectedTasksTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 16, marginBottom: 10 },
  selectedTasksHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  scheduledCompleteButton: { padding: 4 },
  insightCard: { backgroundColor: colors.primaryLight, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: colors.primary, padding: 16, marginBottom: 12 },
  insightChildName: { fontSize: 14, fontWeight: '900', color: PRIMARY_TEXT, marginBottom: 10 },
  insightRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#c7d2fe' },
  insightText: { color: colors.textPrimary, lineHeight: 20 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityEmoji: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  activityEmojiText: { fontSize: 22 },
  activityChildName: { fontWeight: '800', color: colors.textPrimary },
  activityTitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  activityDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  rewardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  rewardCell: { width: '47%', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1.5 },
  rewardEmoji: { fontSize: 30, marginBottom: 8 },
  rewardImage: { width: 64, height: 64, marginBottom: 8 },
  rewardTitle: { fontSize: 13, fontWeight: '800', textAlign: 'center', marginBottom: 10, color: colors.textPrimary },
  rewardChildRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  rewardChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999 },
  rewardChipText: { fontSize: 10, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 14 },
  emptyText: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  emptyButton: { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
  emptyButtonText: { color: '#fff', fontWeight: '800' },
  rewardsChip: { backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  rewardsChipText: { color: PRIMARY_TEXT, fontWeight: '800', fontSize: 11 },

  accountCard: {
    backgroundColor: SURFACE, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 20,
  },
  accountCardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accountAvatar: { width: 68, height: 68, borderRadius: 34 },
  accountAvatarPlaceholder: { backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  accountAvatarInitial: { color: colors.lavenderDark, fontSize: 23, fontWeight: '900' },
  accountName: { fontSize: 16, fontWeight: '900', color: colors.ink },
  accountEmail: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  accountBadge: {
    alignSelf: 'flex-start', backgroundColor: '#EFECFB', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3, marginTop: 6,
  },
  accountBadgeText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 11 },
  editProfileButton: {
    borderWidth: 1.5, borderColor: colors.lavenderDark, borderRadius: 999,
    paddingVertical: 11, alignItems: 'center', marginTop: 14,
  },
  editProfileButtonText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 13 },

  unsavedSettingsBar: {
    backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: colors.sun, borderRadius: 16,
    padding: 14, marginBottom: 16, gap: 10,
  },
  unsavedSettingsBarText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  unsavedSettingsBarButtons: { flexDirection: 'row', gap: 10 },
  discardSettingsButton: {
    flex: 1, minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  discardSettingsButtonText: { color: colors.inkSoft, fontWeight: '800', fontSize: 14 },
  saveSettingsButton: {
    flex: 1, minHeight: 44, borderRadius: 999, backgroundColor: colors.lavenderDark,
    alignItems: 'center', justifyContent: 'center',
  },
  saveSettingsButtonText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  settingsGroupTitle: { fontSize: 15, fontWeight: '900', color: colors.ink, marginBottom: 10, marginTop: 4 },
  childSettingsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: SURFACE, borderRadius: 18,
    padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10,
  },
  childAvatarSize: { width: 52, height: 52, borderRadius: 26 },
  manageChildButton: { borderWidth: 1.5, borderColor: colors.lavenderDark, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  manageChildButtonText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12 },
  enrollChildRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.lavenderDark, borderStyle: 'dashed', borderRadius: 16,
    paddingVertical: 14, marginBottom: 20,
  },
  enrollChildRowText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 14 },

  settingsListCard: {
    backgroundColor: SURFACE, borderRadius: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 20, overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  settingsToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  settingsRowTitle: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  settingsRowSub: { color: colors.inkSoft, fontSize: 11, marginTop: 2 },
  speedSegment: { flexDirection: 'row', backgroundColor: '#EFECFB', borderRadius: 999, padding: 3 },
  speedSegmentButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  speedSegmentButtonActive: { backgroundColor: colors.lavenderDark },
  speedSegmentText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 11, textTransform: 'capitalize' },
  speedSegmentTextActive: { color: '#fff' },

  emailModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  emailModalSheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  emailModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  emailModalTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  passwordModalHint: { color: colors.inkSoft, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  emailModalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, color: colors.ink },
  passwordConfirmInput: { marginTop: 10 },
  emailModalError: { color: '#E0574C', marginTop: 10, fontWeight: '600' },
  emailModalSubmit: { backgroundColor: colors.lavenderDark, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16 },
  emailModalSubmitText: { color: '#fff', fontWeight: '800' },
});
