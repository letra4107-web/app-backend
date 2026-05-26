import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function StatCard({ label, value, color = '#4f46e5', accent }: any) {
  return (
    <View style={[styles.card, { borderColor: color }]}> 
      <Text style={[styles.value]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '48%', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1 },
  value: { fontSize: 16, fontWeight: '900', color: '#111827' },
  label: { color: '#6b7280', marginTop: 6, fontSize: 12 },
});
