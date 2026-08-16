import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import {
  fetchNotifications,
  markNotificationRead,
  NotificationItem,
  subscribeToParentNotifications,
} from '../services/notificationService';
import { useAccessibility } from '../contexts/AccessibilityContext';
import { colors, radius, shadows } from '../theme';

// SURFACE/BORDER/DANGER are intentionally NOT theme.colors equivalents -
// one-off hex values kept local rather than coerced onto a nearby color.
const SURFACE = '#FFFFFF';
const BORDER = '#E7DFD0';
const DANGER = '#E0574C';

type Section = 'welcome' | 'progress' | 'calendar' | 'notifications' | 'settings';
type ChildOption = { id: string; name: string };
type FilterKey = 'all' | 'unread' | 'learning' | 'progress';

// Grouped from the real notification `type` values actually created in the
// app today (StudentDashboard.tsx / achievementService.ts) - there is no
// backend-generated "reminder" type yet, so that category is omitted rather
// than shown empty.
const LEARNING_TYPES = ['lesson', 'assignment', 'word'];
const PROGRESS_TYPES = ['xp', 'streak', 'achievement', 'practice'];

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'learning', label: 'Learning' },
  { key: 'progress', label: 'Progress' },
];

const TYPE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; actionLabel: string; section: Section }> = {
  lesson: { icon: 'book-outline', color: colors.lavenderDark, actionLabel: 'View Progress', section: 'progress' },
  assignment: { icon: 'clipboard-outline', color: colors.sun, actionLabel: 'View Calendar', section: 'calendar' },
  word: { icon: 'text-outline', color: colors.coral, actionLabel: 'View Progress', section: 'progress' },
  xp: { icon: 'flash-outline', color: colors.sun, actionLabel: 'View Progress', section: 'progress' },
  streak: { icon: 'flame-outline', color: colors.coral, actionLabel: 'View Progress', section: 'progress' },
  achievement: { icon: 'ribbon-outline', color: colors.sage, actionLabel: 'View Progress', section: 'progress' },
  practice: { icon: 'mic-outline', color: colors.lavenderDark, actionLabel: 'View Progress', section: 'progress' },
};
const DEFAULT_META = {
  icon: 'notifications-outline' as keyof typeof Ionicons.glyphMap,
  color: colors.lavenderDark,
  actionLabel: 'View Progress',
  section: 'progress' as Section,
};

type WeeklyStats = { avgLast7: number | null; avgPrior7: number | null; sessionsLast7: number };

export function NotificationsView({
  userId,
  childList = [],
  onUnreadChange,
  onNavigate,
  hideHeader = false,
}: {
  userId: string;
  childList?: ChildOption[];
  onUnreadChange?: (count: number) => void;
  onNavigate?: (section: Section) => void;
  // The Parent dashboard now renders its own TabHeroHeader above this
  // component (matching every other tab) - this suppresses the component's
  // own title/subtitle/mark-all-read row so the two don't stack.
  hideHeader?: boolean;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null);

  // This screen previously had zero a11y wiring - grouped scaled style
  // objects (same pattern as ParentDashboardEnhanced.tsx) so the
  // dyslexia-font/text-size settings reach the notification title, card
  // text, spotlight card, and filter chips too, each scaled from that
  // group's own current base fontSize.
  const { a11yFont, a11ySize } = useAccessibility();
  const titleA11yStyle = {
    fontSize: a11ySize(20),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const subtitleA11yStyle = {
    fontSize: a11ySize(13),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const filterChipTextA11yStyle = {
    fontSize: a11ySize(12),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const cardTitleA11yStyle = {
    fontSize: a11ySize(14),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const cardBodyA11yStyle = {
    fontSize: a11ySize(13),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const spotlightTitleA11yStyle = {
    fontSize: a11ySize(17),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };
  const spotlightSubA11yStyle = {
    fontSize: a11ySize(12),
    ...(a11yFont('medium') ? { fontFamily: a11yFont('medium') } : {}),
  };
  const spotlightStatValueA11yStyle = {
    fontSize: a11ySize(22),
    ...(a11yFont('bold') ? { fontFamily: a11yFont('bold') } : {}),
  };

  const loadItems = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const rows = await fetchNotifications(userId);
      setItems(rows);
      onUnreadChange?.(rows.filter((item) => !(item.is_read ?? item.read)).length);
    } catch {
      setError('Hindi ma-load ang notifications.');
    } finally {
      setLoading(false);
    }
  }, [userId, onUnreadChange]);

  const childIdsKey = childList.map((child) => child.id).filter(Boolean).join(',');

  useEffect(() => {
    void loadItems();
    const unsubscribe = subscribeToParentNotifications(userId, () => void loadItems());
    return unsubscribe;
  }, [userId, loadItems]);

  useEffect(() => {
    const childIds = childIdsKey ? childIdsKey.split(',') : [];
    if (!childIds.length) {
      setWeeklyStats(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('pronunciation_practice_sessions')
          .select('accuracy_percentage, created_at')
          .in('student_id', childIds)
          .order('created_at', { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (queryError || !data) {
          setWeeklyStats(null);
          return;
        }
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const last7 = data.filter((row: any) => now - new Date(row.created_at).getTime() <= 7 * day);
        const prior7 = data.filter((row: any) => {
          const age = now - new Date(row.created_at).getTime();
          return age > 7 * day && age <= 14 * day;
        });
        const avg = (rows: any[]) =>
          rows.length ? rows.reduce((sum, row) => sum + (row.accuracy_percentage || 0), 0) / rows.length : null;
        setWeeklyStats({ avgLast7: avg(last7), avgPrior7: avg(prior7), sessionsLast7: last7.length });
      } catch {
        if (!cancelled) setWeeklyStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childIdsKey]);

  const openItem = async (item: NotificationItem) => {
    if (!(item.is_read ?? item.read)) {
      try {
        await markNotificationRead(item.id);
        setItems((prev) => {
          const nextItems = prev.map((next) => (next.id === item.id ? { ...next, read: true, is_read: true } : next));
          onUnreadChange?.(nextItems.filter((next) => !(next.is_read ?? next.read)).length);
          return nextItems;
        });
      } catch {
        setError('Hindi ma-update ang notification. Subukan muli mamaya.');
      }
    }
  };

  const markAllRead = async () => {
    const unread = items.filter((item) => !(item.is_read ?? item.read));
    try {
      await Promise.all(unread.map((item) => markNotificationRead(item.id)));
      setItems((prev) => prev.map((item) => ({ ...item, read: true, is_read: true })));
      onUnreadChange?.(0);
    } catch {
      setError('Hindi ma-update ang notifications. Subukan muli mamaya.');
    }
  };

  const unreadCount = items.filter((item) => !(item.is_read ?? item.read)).length;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'unread') return !(item.is_read ?? item.read);
      if (filter === 'learning') return LEARNING_TYPES.includes(item.type || '');
      if (filter === 'progress') return PROGRESS_TYPES.includes(item.type || '');
      return true;
    });
  }, [items, filter]);

  const grouped = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayItems: NotificationItem[] = [];
    const earlierItems: NotificationItem[] = [];
    filteredItems.forEach((item) => {
      const dateKey = item.created_at ? item.created_at.slice(0, 10) : '';
      (dateKey === today ? todayItems : earlierItems).push(item);
    });
    return { todayItems, earlierItems };
  }, [filteredItems]);

  const getChildName = (item: NotificationItem) =>
    childList.find((child) => child.id === item.student_id)?.name || null;

  const renderCard = (item: NotificationItem) => {
    const isUnread = !(item.is_read ?? item.read);
    const meta = TYPE_META[item.type || ''] || DEFAULT_META;
    const body = item.message || item.body || '';
    const date = item.created_at ? new Date(item.created_at) : null;
    const childName = childList.length > 1 ? getChildName(item) : null;
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.card}
        onPress={() => void openItem(item)}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${item.title}. ${childName ? `${childName}: ${body}` : body}`}
      >
        <View style={[styles.cardIconWrap, { backgroundColor: `${meta.color}1A` }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, cardTitleA11yStyle]}>{item.title}</Text>
            {isUnread && <View style={styles.unreadDot} />}
          </View>
          <Text style={[styles.cardBody, cardBodyA11yStyle]}>{childName ? `${childName}: ${body}` : body}</Text>
          <View style={styles.cardFooterRow}>
            <Text style={styles.cardDate}>{date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ''}</Text>
            {!!onNavigate && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onNavigate(meta.section)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`${meta.actionLabel} for ${item.title}`}
              >
                <Text style={styles.actionButtonText}>{meta.actionLabel}</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.lavenderDark} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const showSpotlight = !!weeklyStats && weeklyStats.avgLast7 !== null;
  const delta =
    showSpotlight && weeklyStats!.avgPrior7 !== null ? weeklyStats!.avgLast7! - weeklyStats!.avgPrior7! : null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {!hideHeader && (
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, titleA11yStyle]}>Mga Abiso</Text>
            <Text style={[styles.subtitle, subtitleA11yStyle]}>Manatiling updated sa paglalakbay ng iyong anak sa pag-aaral.</Text>
          </View>
        )}
        {!!unreadCount && (
          <TouchableOpacity
            style={[styles.markAllButton, hideHeader && { marginLeft: 'auto' }]}
            onPress={markAllRead}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Mark all ${unreadCount} notification${unreadCount === 1 ? '' : 's'} as read`}
          >
            <Text style={styles.markAllText}>Markahan lahat bilang nabasa</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!unreadCount && (
        <View style={styles.summaryBanner}>
          <View style={styles.summaryIconWrap}>
            <Ionicons name="notifications" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryTitle}>
              You have {unreadCount} new notification{unreadCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.summarySub}>Narito ang pinakabagong update tungkol sa progreso ng iyong anak sa pag-aaral.</Text>
          </View>
        </View>
      )}

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${f.label}`}
            accessibilityState={{ selected: filter === f.key }}
          >
            <Text style={[styles.filterChipText, filterChipTextA11yStyle, filter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && <ActivityIndicator color={colors.lavenderDark} style={{ marginVertical: 12 }} />}
      {!!error && (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {!!grouped.todayItems.length && (
          <>
            <Text style={styles.groupLabel}>Ngayon</Text>
            {grouped.todayItems.map(renderCard)}
          </>
        )}
        {!!grouped.earlierItems.length && (
          <>
            <Text style={styles.groupLabel}>Kanina</Text>
            {grouped.earlierItems.map(renderCard)}
          </>
        )}
        {!loading && !filteredItems.length && (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={40} color={colors.inkSoft} />
            <Text style={styles.emptyText}>
              {items.length === 0
                ? childList.length === 1
                  ? `Wala ka pang notifications. Makikita mo dito ang mga update tungkol sa progress ni ${childList[0].name}.`
                  : 'Wala ka pang notifications. Makikita mo dito ang mga update tungkol sa progress ng iyong (mga) anak.'
                : 'Walang notification na tumutugma sa filter na ito.'}
            </Text>
          </View>
        )}

        {showSpotlight && (
          <View style={styles.spotlightCard}>
            <View style={styles.spotlightBadge}>
              <Text style={styles.spotlightBadgeText}>NGAYONG LINGGO</Text>
            </View>
            <Text style={[styles.spotlightTitle, spotlightTitleA11yStyle]}>Lingguhang Progreso</Text>
            <Text style={[styles.spotlightSub, spotlightSubA11yStyle]}>
              {weeklyStats!.sessionsLast7} practice session{weeklyStats!.sessionsLast7 === 1 ? '' : 's'} in the last 7
              days.
            </Text>
            <View style={styles.spotlightStatsRow}>
              {weeklyStats!.avgPrior7 !== null && (
                <View style={styles.spotlightStatCell}>
                  <Text style={[styles.spotlightStatLabel, spotlightSubA11yStyle]}>Dating kawastuhan</Text>
                  <Text style={[styles.spotlightStatValue, spotlightStatValueA11yStyle]}>{Math.round(weeklyStats!.avgPrior7)}%</Text>
                </View>
              )}
              <View style={styles.spotlightStatCell}>
                <Text style={[styles.spotlightStatLabel, spotlightSubA11yStyle]}>Kasalukuyang kawastuhan</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.spotlightStatValue, spotlightStatValueA11yStyle]}>{Math.round(weeklyStats!.avgLast7!)}%</Text>
                  {delta !== null && (
                    <Text style={[styles.spotlightDelta, { color: delta >= 0 ? colors.sage : DANGER }]}>
                      {delta >= 0 ? '+' : ''}
                      {Math.round(delta)}%
                    </Text>
                  )}
                </View>
              </View>
            </View>
            {!!onNavigate && (
              <TouchableOpacity
                style={styles.spotlightButton}
                onPress={() => onNavigate('progress')}
                accessibilityRole="button"
                accessibilityLabel="View full progress"
              >
                <Text style={styles.spotlightButtonText}>Tingnan ang Buong Progreso</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export default function ParentNotifications({ visible, userId, onClose }: { visible: boolean; userId: string; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.modalWrapper}>
        <View style={styles.modalHeader}>
          <Text style={styles.title}>Mga Abiso</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.ink} />
          </TouchableOpacity>
        </View>
        <NotificationsView userId={userId} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modalWrapper: { flex: 1, backgroundColor: '#F8FAFC', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '900', color: colors.ink },
  subtitle: { fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  markAllButton: {
    borderWidth: 1.5, borderColor: colors.lavenderDark, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
  },
  markAllText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12 },
  error: { color: DANGER, marginBottom: 12 },

  summaryBanner: {
    flexDirection: 'row', gap: 12, backgroundColor: SURFACE, borderRadius: radius.md, padding: 14,
    marginBottom: 14, alignItems: 'center', ...shadows.card,
  },
  summaryIconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.lavenderDark,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryTitle: { fontWeight: '900', color: colors.ink, fontSize: 14 },
  summarySub: { color: colors.inkSoft, fontSize: 12, marginTop: 2 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  filterChip: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14,
    backgroundColor: SURFACE,
  },
  filterChipActive: { backgroundColor: colors.lavenderDark, borderColor: colors.lavenderDark },
  filterChipText: { color: colors.ink, fontWeight: '700', fontSize: 12 },
  filterChipTextActive: { color: '#fff' },

  list: { paddingBottom: 20 },
  groupLabel: { fontWeight: '900', color: colors.ink, fontSize: 13, marginBottom: 8, marginTop: 4 },
  card: {
    flexDirection: 'row', gap: 12, backgroundColor: SURFACE, padding: 14, borderRadius: radius.md,
    marginBottom: 10, ...shadows.card,
  },
  cardIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontWeight: '800', color: colors.ink, flexShrink: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.lavenderDark },
  cardBody: { color: colors.inkSoft, marginTop: 3, lineHeight: 19, fontSize: 13 },
  cardFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  cardDate: { color: colors.inkSoft, fontSize: 11 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionButtonText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12 },

  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 40, gap: 10 },
  emptyText: { color: colors.inkSoft, fontSize: 14 },
  closeButton: { padding: 6 },

  spotlightCard: {
    backgroundColor: colors.lavenderDark, borderRadius: radius.lg, padding: 18, marginTop: 8, ...shadows.raised,
  },
  spotlightBadge: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 12,
    paddingVertical: 3, paddingHorizontal: 10, marginBottom: 8,
  },
  spotlightBadgeText: { color: '#fff', fontWeight: '900', fontSize: 10, letterSpacing: 0.5 },
  spotlightTitle: { color: '#fff', fontWeight: '900', fontSize: 17 },
  spotlightSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4, marginBottom: 14 },
  spotlightStatsRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  spotlightStatCell: {},
  spotlightStatLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginBottom: 4 },
  spotlightStatValue: { color: '#fff', fontWeight: '900', fontSize: 22 },
  spotlightDelta: { fontWeight: '900', fontSize: 13 },
  spotlightButton: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  spotlightButtonText: { color: colors.lavenderDark, fontWeight: '900', fontSize: 14 },
});
