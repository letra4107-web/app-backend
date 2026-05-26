import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function LessonCard({ title, date, type = 'pdf', onOpen }: any) {
  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <Ionicons name={type === 'pdf' ? 'document-text' : 'image'} size={26} color="#4f46e5" />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
      <TouchableOpacity style={styles.open} onPress={onOpen}>
        <Text style={styles.openText}>Buksan</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 12, marginTop: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  left: { width: 48, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: 8 },
  title: { fontWeight: '800', color: '#111827' },
  date: { color: '#6b7280', marginTop: 4, fontSize: 12 },
  open: { backgroundColor: '#4f46e5', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  openText: { color: '#fff', fontWeight: '800' },
});
