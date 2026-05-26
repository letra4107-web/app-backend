import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchNotifications,
  markNotificationRead,
  NotificationItem,
  subscribeToParentNotifications,
} from '../services/notificationService';

export function NotificationsView({
  userId,
  onUnreadChange,
}: {
  userId: string;
  onUnreadChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadItems = async () => {
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
  };

  useEffect(() => {
    void loadItems();
    const unsubscribe = subscribeToParentNotifications(userId, () => void loadItems());
    return unsubscribe;
  }, [userId]);

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

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Mga Notification</Text>
        {!!items.filter((item) => !(item.is_read ?? item.read)).length && (
          <TouchableOpacity style={styles.markAllButton} onPress={markAllRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>
      {loading && <ActivityIndicator color="#4f46e5" />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        {items.map((item) => {
          const isUnread = !(item.is_read ?? item.read);
          const body = item.message || item.body || '';
          const date = item.created_at ? new Date(item.created_at) : null;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.card, isUnread && styles.unread]}
              onPress={() => void openItem(item)}
              activeOpacity={0.9}
            >
              <Text style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>{item.title}</Text>
              <Text style={styles.body}>{body}</Text>
              <Text style={styles.date}>{date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ''}</Text>
            </TouchableOpacity>
          );
        })}
        {!loading && !items.length && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🔔</Text>
            <Text style={styles.emptyText}>Wala pang notification.</Text>
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
          <Text style={styles.title}>Notifications</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#111827" />
          </TouchableOpacity>
        </View>
        <NotificationsView userId={userId} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 16 },
  modalWrapper: { flex: 1, backgroundColor: '#F8FAFC', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  markAllButton: { backgroundColor: '#4f46e5', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
  markAllText: { color: '#fff', fontWeight: '700' },
  error: { color: '#ef4444', marginBottom: 12 },
  list: { paddingBottom: 20 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 12 },
  unread: { backgroundColor: '#eef2ff', borderColor: '#4f46e5' },
  cardTitle: { fontWeight: '800', color: '#111827', marginBottom: 6 },
  cardTitleUnread: { color: '#111827' },
  body: { color: '#374151', lineHeight: 20 },
  date: { color: '#6B7280', fontSize: 12, marginTop: 10 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 40 },
  emptyEmoji: { fontSize: 40, marginBottom: 14 },
  emptyText: { color: '#6B7280', fontSize: 15 },
  closeButton: { padding: 6 },
});
