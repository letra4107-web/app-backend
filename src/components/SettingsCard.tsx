import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';

type Props = {
  children: React.ReactNode;
};

export default function SettingsCard({ children }: Props) {
  const scheme = useColorScheme();
  return <View style={[styles.card, scheme === 'dark' && styles.cardDark]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: '#0b1220',
  },
});
