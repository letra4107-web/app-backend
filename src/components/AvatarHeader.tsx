import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  onEdit?: () => void;
};

export default function AvatarHeader({ name, email, avatarUrl, onEdit }: Props) {
  const scheme = useColorScheme();
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}> 
            <Text style={styles.avatarInitial}>{name?.[0] ?? 'L'}</Text>
          </View>
        )}
      </View>
      <View style={styles.center}>
        <Text style={[styles.name, scheme === 'dark' && { color: '#fff' }]}>{name}</Text>
        <Text style={[styles.email, scheme === 'dark' && { color: '#cbd5e1' }]}>{email}</Text>
      </View>
      <TouchableOpacity onPress={onEdit} style={styles.editButton} accessibilityLabel="Edit profile">
        <Ionicons name="pencil" size={18} color="#4f46e5" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  left: { marginRight: 12 },
  avatar: { width: 64, height: 64, borderRadius: 16 },
  avatarPlaceholder: { backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#4f46e5', fontWeight: '700', fontSize: 28 },
  center: { flex: 1 },
  name: { fontSize: 18, fontWeight: '700', color: '#111827' },
  email: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  editButton: { padding: 8, borderRadius: 8 },
});
