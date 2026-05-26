import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type Props = {
  icon?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
};

export default function SettingRow({ icon = 'settings', title, subtitle, onPress, right }: Props) {
  const scheme = useColorScheme();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={onPress ? 0.7 : 1} style={styles.row}>
      <View style={[styles.left, scheme === 'dark' && { opacity: 0.9 }]}> 
        <MaterialIcons name={icon as any} size={20} color="#4f46e5" />
      </View>
      <View style={styles.center}>
        <Text style={[styles.title, scheme === 'dark' && styles.titleDark]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, scheme === 'dark' && styles.subtitleDark]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.right}>{right}</View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  left: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    paddingHorizontal: 8,
  },
  right: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  titleDark: { color: '#e6eef8' },
  subtitleDark: { color: '#94a3b8' },
});
