import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { getUserProfileById, onAuthStateChanged, signOutUser } from '../services/supabaseService';
import { fetchParentProfile } from '../services/profileService';
import { ACHIEVEMENTS } from '../services/achievementService';
import { fetchNotifications, subscribeToParentNotifications } from '../services/notificationService';
import { NotificationsView } from './ParentNotifications';
import EnrollChildModal from './EnrollChildModal';
import DashboardSettingsScreen from './DashboardSettingsScreen';
import { StudentActivity } from '../services/activityService';

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
  const [parentId, setParentId] = useState('');
  const [parentName, setParentName] = useState('Magulang');
  const [parentEmail, setParentEmail] = useState('');
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [activities, setActivities] = useState<StudentActivity[]>([]);
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

  const loadActivitiesForChildren = async (rows: ChildRow[]) => {
    const studentIds = Array.from(
      new Set(rows.flatMap((child) => [child.id, child.auth_uid]).filter(Boolean) as string[]),
    );

    if (!studentIds.length) {
      setActivities([]);
      return;
    }

    const { data, error: activityError } = await supabase
      .from('activities')
      .select('id,title,description,deadline,subject,status,student_id')
      .in('student_id', studentIds)
      .order('deadline', { ascending: true });

    if (activityError) {
      console.warn('[ParentDashboard] activities load failed:', activityError.message || activityError);
      setActivities([]);
      return;
    }

    setActivities((data || []) as StudentActivity[]);
  };

  const loadPracticeSessionsForChildren = async (rows: ChildRow[]) => {
    const childIds = rows.map((child) => child.id).filter(Boolean);
    if (!childIds.length) {
      setPracticeSessions([]);
      return;
    }

    const { data, error: sessionError } = await supabase
      .from('pronunciation_practice_sessions')
      .select('id,student_id,word,spoken_text,accuracy_percentage,created_at')
      .in('student_id', childIds)
      .order('created_at', { ascending: false })
      .limit(20);

    if (sessionError) {
      console.warn('[ParentDashboard] practice sessions load failed:', sessionError.message || sessionError);
      setPracticeSessions([]);
      return;
    }

    setPracticeSessions((data || []) as PracticeSessionRow[]);
  };

  const refreshNotifications = async (id: string) => {
    const rows = await fetchNotifications(id);
    setUnreadNotifications(rows.filter((item) => !(item.is_read ?? item.read)).length);
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
        const rows = await loadChildren(id);
        await Promise.all([loadActivitiesForChildren(rows), loadPracticeSessionsForChildren(rows), refreshNotifications(id)]);
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
      await Promise.all([loadActivitiesForChildren(rows), loadPracticeSessionsForChildren(rows), refreshNotifications(id)]);
      loadedParentRef.current = id;
    } catch (err) {
      console.error('Failed to load parent dashboard:', err);
      setError('Hindi ma-load ang parent profile.');
      try {
        const rows = await loadChildren(id);
        await Promise.all([loadActivitiesForChildren(rows), loadPracticeSessionsForChildren(rows), refreshNotifications(id)]);
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

  useEffect(() => {
    if (!parentId) return undefined;
    return subscribeToParentNotifications(parentId, () => {
      void refreshNotifications(parentId);
      void loadChildren(parentId).then((rows) => {
        void loadActivitiesForChildren(rows);
        void loadPracticeSessionsForChildren(rows);
      });
    });
  }, [parentId]);

  const totals = useMemo(
    () =>
      children.reduce(
        (acc, child) => {
          const progress = child.child_progress?.[0];
          acc.xp += progress?.xp || 0;
          acc.words += progress?.word_count ?? progress?.completed_words?.length ?? 0;
          acc.streak = Math.max(acc.streak, progress?.streak || 0);
          return acc;
        },
        { xp: 0, words: 0, streak: 0 },
      ),
    [children],
  );

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

  const renderWelcome = () => (
    <>
      <View style={styles.welcomeBanner}>
        <Text style={styles.welcomeGreeting}>Good Day! {parentName || 'Loading...'}</Text>
        <Text style={styles.welcomeEmail}>{parentEmail}</Text>
        <Text style={styles.welcomeSubtitle}>Subaybayan ang pagbasa ng inyong mga anak.</Text>
      </View>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{totals.xp}</Text>
          <Text style={styles.summaryLabel}>Total XP</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{totals.words}</Text>
          <Text style={styles.summaryLabel}>Words Learned</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{totals.streak}</Text>
          <Text style={styles.summaryLabel}>Best Streak</Text>
        </View>
      </View>

      {children.length ? (
        children.map((child) => {
          const progress = child.child_progress?.[0];
          const level = progress?.level || 'Beginner';
          const xp = progress?.xp || 0;
          const nextTarget = level === 'Beginner' ? 100 : level === 'Intermediate' ? 250 : Math.max(300, xp);
          const pct = Math.min(100, Math.round((xp / nextTarget) * 100));
          return (
            <View key={child.id} style={styles.childCard}>
              <View style={styles.childCardHeader}>
                <View style={styles.childAvatar}>
                  <Text style={styles.childAvatarText}>{child.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>{child.name}</Text>
                  <Text style={styles.childMeta}>@{child.username} · Grade {child.grade_level}</Text>
                </View>
                <View style={[styles.levelBadge, { backgroundColor: getLevelColor(level as Level) }]}> 
                  <Text style={styles.levelBadgeText}>{level}</Text>
                </View>
              </View>
              <Text style={styles.greeting}>{getGreeting(child)}</Text>
              <View style={styles.statsRow}>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>XP: {xp}</Text>
                </View>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>🔥 Streak: {progress?.streak || 0}</Text>
                </View>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>📖 Words: {progress?.word_count ?? progress?.completed_words?.length ?? 0}</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{pct}% hanggang {getNextLevel(level as Level)}</Text>
            </View>
          );
        })
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>👨‍👩‍👧</Text>
          <Text style={styles.emptyText}>Wala pang naka-enroll na bata.</Text>
          <TouchableOpacity style={styles.emptyButton} onPress={() => setShowEnroll(true)}>
            <Text style={styles.emptyButtonText}>+ I-enroll ang Iyong Unang Bata</Text>
          </TouchableOpacity>
        </View>
      )}

      {!!children.length && (
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => setShowEnroll(true)}>
            <Ionicons name="person-add" size={16} color={PRIMARY} />
            <Text style={styles.quickActionText}>I-enroll ang Bata</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('progress')}>
            <Ionicons name="bar-chart" size={16} color={PRIMARY} />
            <Text style={styles.quickActionText}>Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => setSection('calendar')}>
            <Ionicons name="calendar" size={16} color={PRIMARY} />
            <Text style={styles.quickActionText}>Calendar</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.deadlinePreview}>
        <View style={styles.deadlineHeader}>
          <Text style={styles.sectionHeaderTitle}>Upcoming Deadlines</Text>
          <TouchableOpacity onPress={() => setSection('calendar')}>
            <Text style={styles.previewLink}>View Calendar</Text>
          </TouchableOpacity>
        </View>
        {upcomingActivities.length ? (
          upcomingActivities.map((activity) => (
            <TouchableOpacity
              key={activity.id}
              style={styles.deadlineRow}
              onPress={() => {
                setSelectedCalendarDate(getActivityDateKey(activity));
                setSection('calendar');
              }}
            >
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(activity.status) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityChildName}>{activity.title}</Text>
                <Text style={styles.activityDate}>
                  {getChildNameForActivity(activity)} - {new Date(activity.deadline).toLocaleDateString()}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyDetail}>No upcoming deadlines yet.</Text>
        )}
      </View>
    </>
  );

  const renderProgress = () => (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>Progress ng mga Anak</Text>
        <Text style={styles.sectionHeaderSub}>{new Date().toLocaleDateString()}</Text>
      </View>
      {children.length ? (
        children.map((child) => {
          const progress = child.child_progress?.[0];
          const xp = progress?.xp || 0;
          const attempts = progress?.total_attempts || 0;
          const words = progress?.word_count ?? progress?.completed_words?.length ?? 0;
          const accuracy = attempts ? Math.round((words / attempts) * 100) : 0;
          const level = progress?.level || 'Beginner';
          const nextTarget = level === 'Beginner' ? 100 : level === 'Intermediate' ? 250 : Math.max(300, xp);
          const percent = Math.min(100, Math.round((xp / nextTarget) * 100));
          const expanded = expandedChildId === child.id;

          return (
            <TouchableOpacity key={child.id} style={styles.childCard} onPress={() => setExpandedChildId(expanded ? null : child.id)}>
              <View style={styles.childCardHeader}>
                <View>
                  <Text style={styles.childName}>{child.name}</Text>
                  <Text style={styles.childMeta}>@{child.username} · Grade {child.grade_level}</Text>
                </View>
                <View style={[styles.levelBadge, { backgroundColor: getLevelColor(level as Level) }]}> 
                  <Text style={styles.levelBadgeText}>{level}</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>Attempts: {attempts || 'N/A'}</Text>
                </View>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>Accuracy: {attempts ? `${accuracy}%` : 'N/A'}</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>XP: {xp}</Text>
                </View>
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>Last Practice: {progress?.last_practice_date ? new Date(progress.last_practice_date).toLocaleDateString() : 'Wala'}</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${percent}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{percent}% hanggang {getNextLevel(level as Level)}</Text>
              <Text style={styles.greeting}>Completed Words: {words}</Text>
              {expanded && (
                <View style={styles.childDetails}>
                  {progress?.completed_words?.length ? (
                    progress.completed_words.map((word) => (
                      <View key={word} style={styles.rewardsChip}>
                        <Text style={styles.rewardsChipText}>{word}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyDetail}>Wala pang salita na naitala.</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📝</Text>
          <Text style={styles.emptyText}>Wala pang anak na may progress.</Text>
        </View>
      )}
    </>
  );

  const renderRecentPractice = () => (
    <View style={styles.selectedTasksCard}>
      <Text style={styles.selectedTasksTitle}>Recent Practice Results</Text>
      {practiceSessions.length ? (
        practiceSessions.slice(0, 6).map((session) => (
          <View key={session.id} style={styles.activityRow}>
            <View style={styles.activityEmoji}>
              <Text style={styles.activityEmojiText}>🎤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityChildName}>{children.find((child) => child.id === session.student_id)?.name || 'Student'}</Text>
              <Text style={styles.activityTitle}>
                {session.word} - {session.accuracy_percentage}% accuracy
              </Text>
              <Text style={styles.activityDate}>{new Date(session.created_at).toLocaleString()}</Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyDetail}>No speech practice yet.</Text>
      )}
    </View>
  );

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
              <Text style={styles.rewardEmoji}>{achievement.emoji || '🏅'}</Text>
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
      </>
    );
  };

  const renderSettings = () => (
    <DashboardSettingsScreen role="parent" navigation={navigation} embedded />
  );

  const renderSection = () => {
    switch (section) {
      case 'welcome':
        return renderWelcome();
      case 'progress':
        return (
          <>
            {renderProgress()}
            {renderRecentPractice()}
          </>
        );
      case 'calendar':
        return renderCalendar();
      case 'notifications':
        return <NotificationsView userId={parentId} onUnreadChange={setUnreadNotifications} />;
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
        <TouchableOpacity onPress={() => setSection('notifications')} style={styles.bellButton}>
          <Ionicons name="notifications-outline" size={24} color={TEXT_PRIMARY} />
          {unreadNotifications > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadNotifications}</Text>
            </View>
          )}
        </TouchableOpacity>
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
        }}
      />
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
  settingsButton: { padding: 6, marginRight: 6 },
  appTitle: { fontSize: 20, fontWeight: '900', color: PRIMARY },
  bellButton: { padding: 6, position: 'relative' },
  bellBadge: {
    position: 'absolute', top: 2, right: 2,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: DANGER, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
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
  welcomeBanner: { backgroundColor: PRIMARY, borderRadius: 24, padding: 24, marginBottom: 20 },
  welcomeGreeting: { fontSize: 15, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  welcomeName: { fontSize: 28, fontWeight: '900', color: '#fff', marginTop: 4 },
  welcomeEmail: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  welcomeSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 12 },
  summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  summaryValue: { fontSize: 20, fontWeight: '900', color: PRIMARY },
  summaryLabel: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 4, fontWeight: '700' },
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
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  quickAction: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: PRIMARY, backgroundColor: SURFACE,
  },
  quickActionText: { fontSize: 12, fontWeight: '800', color: PRIMARY },
  deadlinePreview: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  deadlineHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  previewLink: { color: PRIMARY, fontWeight: '800', fontSize: 12 },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
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
});
