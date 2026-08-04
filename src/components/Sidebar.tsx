import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const items = [
  { key: 'home', label: 'Welcome', icon: 'home' },
  { key: 'progress', label: 'Progress', icon: 'bar-chart' },
  { key: 'practice', label: 'Practice', icon: 'mic' },
  { key: 'lessons', label: 'Lessons', icon: 'book' },
  { key: 'achievements', label: 'Achievements', icon: 'trophy' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export default function Sidebar({ open = false, onClose = () => {}, onSelect = (k: any) => {} }: any) {
  // Lightweight static sidebar — animation can be added later
  if (!open) return null;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>B</Text>
        </View>
        <Text style={styles.name}>Magulang</Text>
      </View>

      <View style={styles.list}>
        {items.map((it) => (
          <TouchableOpacity key={it.key} style={styles.item} onPress={() => onSelect(it.key)}>
            <Ionicons name={it.icon as any} size={18} color="#fff" />
            <Text style={styles.itemLabel}>{it.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.close} onPress={onClose}>
        <Text style={{ color: '#fff' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 280, backgroundColor: '#4f46e5', padding: 16, zIndex: 1000 },
  header: { alignItems: 'center', marginBottom: 12 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  initials: { color: '#4338ca', fontWeight: '900' },
  name: { color: '#fff', fontWeight: '800' },
  list: { marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemLabel: { color: '#fff', marginLeft: 12, fontWeight: '700' },
  close: { marginTop: 'auto', padding: 12, alignItems: 'center', backgroundColor: '#4338ca', borderRadius: 12 },
});
