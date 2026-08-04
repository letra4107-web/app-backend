import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';

type Message = {
  id: string;
  teacher_id: string;
  message: string;
  read: boolean;
  created_at: string;
  users?: { name?: string | null } | null;
};

export default function ParentMessagesTab({ parentId, onUnreadChange }: { parentId: string; onUnreadChange?: (count: number) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('teacher_messages')
        .select('*, users:teacher_id(name)')
        .eq('parent_id', parentId)
        .order('created_at', { ascending: false });
      if (loadError) throw loadError;
      const rows = (data || []) as Message[];
      setMessages(rows);
      onUnreadChange?.(rows.filter((message) => !message.read).length);
    } catch {
      setError('Hindi ma-load ang mensahe.');
    } finally {
      setLoading(false);
    }
  }, [parentId, onUnreadChange]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const openMessage = async (message: Message) => {
    if (!message.read) {
      await supabase.from('teacher_messages').update({ read: true }).eq('id', message.id);
      void loadMessages();
    }
  };

  if (loading) return <ActivityIndicator color="#4f46e5" />;

  return (
    <ScrollView>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {messages.map((message) => (
        <TouchableOpacity key={message.id} style={[styles.card, !message.read && styles.unread]} onPress={() => openMessage(message)}>
          <View style={styles.row}>
            <Ionicons name="mail-outline" size={18} color="#4f46e5" />
            <Text style={styles.teacher}>{message.users?.name || 'Teacher'}</Text>
          </View>
          <Text style={styles.date}>{new Date(message.created_at).toLocaleString()}</Text>
          <Text style={styles.body}>{message.message}</Text>
        </TouchableOpacity>
      ))}
      {!messages.length && !error && <Text style={styles.empty}>Wala pang mensahe.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  unread: { borderColor: '#4f46e5', backgroundColor: '#F4F9FF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teacher: { fontWeight: '800', color: '#111827' },
  date: { color: '#6B7280', fontSize: 12, marginTop: 6 },
  body: { color: '#374151', marginTop: 8, lineHeight: 20 },
  error: { color: '#E74C3C', marginBottom: 12 },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 30 },
});
