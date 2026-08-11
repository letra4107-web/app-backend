import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadows } from '../theme';

export type BottomNavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

export default function DashboardBottomNav({
  items,
  activeKey,
  onSelect,
}: {
  items: BottomNavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.container} accessibilityRole="tablist">
      {items.map((item) => {
        const active = activeKey === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={styles.item}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.78}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
          >
            <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
              <Ionicons
                name={active ? (item.icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap) : item.icon}
                size={25}
                color={active ? '#FFFFFF' : colors.inkSoft}
              />
              {!!item.badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.badge > 9 ? '9+' : item.badge}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E9E4F2',
    paddingTop: 8,
    paddingBottom: 9,
    paddingHorizontal: 6,
    minHeight: 76,
    zIndex: 80,
    ...shadows.card,
  },
  item: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  iconWrap: {
    width: 42,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconWrapActive: {
    backgroundColor: colors.lavenderDark,
    shadowColor: colors.lavenderDark,
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  label: { color: colors.inkSoft, fontSize: 11, fontWeight: '700', marginTop: 3 },
  labelActive: { color: colors.lavenderDark, fontWeight: '900' },
  badge: {
    position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18,
    paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.coral,
    borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
});
