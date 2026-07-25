import React, { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import BadgeConfettiBurst from '../components/BadgeConfettiBurst';
import type { AchievementCategory } from '../services/achievementService';

// Duplicated locally since this file doesn't share module scope with
// StudentDashboard.tsx - same HOME_* palette used everywhere else.
const HOME_SUN = '#E3971A';
const HOME_CORAL = '#E06B4C';
const HOME_SAGE = '#5C8047';
const HOME_LAVENDER = '#7C6FCF';
const HOME_LAVENDER_DARK = '#5F52B0';
const XP_GOLD = '#f59e0b';

const CONFETTI_COLORS = [HOME_SUN, HOME_CORAL, HOME_SAGE, HOME_LAVENDER, XP_GOLD];

export default function AchievementModal({
  visible,
  image,
  title,
  category,
  xp,
  onClose,
}: {
  visible: boolean;
  image?: any;
  title: string;
  category?: AchievementCategory;
  xp?: number;
  onClose: () => void;
}) {
  const isMeta = category === 'meta';
  const [confettiActive, setConfettiActive] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);

  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const rotation = useSharedValue(0);
  const glow = useSharedValue(0.35);
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(12);

  useEffect(() => {
    if (!visible) return;

    scale.value = 0;
    opacity.value = 0;
    rotation.value = 0;
    contentOpacity.value = 0;
    contentTranslateY.value = 12;
    setConfettiActive(false);
    setContentVisible(false);

    const peakScale = isMeta ? 1.22 : 1.15;
    const dipScale = isMeta ? 0.93 : 0.95;

    opacity.value = withTiming(1, { duration: 180 });

    rotation.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(-5, { duration: 90 }),
      withTiming(5, { duration: 120 }),
      withTiming(0, { duration: 100 }),
    );

    scale.value = withSequence(
      withTiming(0, { duration: 0 }),
      withSpring(peakScale, { damping: 9, stiffness: 220, mass: 0.8 }, (finished) => {
        'worklet';
        if (finished) runOnJS(setConfettiActive)(true);
      }),
      withSpring(dipScale, { damping: 10, stiffness: 220, mass: 0.8 }),
      withSpring(1.0, { damping: 14, stiffness: 200, mass: 0.8 }, (finished) => {
        'worklet';
        if (finished) runOnJS(setContentVisible)(true);
      }),
    );
  }, [visible, title, isMeta]);

  useEffect(() => {
    if (!contentVisible) return;
    contentOpacity.value = withDelay(80, withTiming(1, { duration: 260 }));
    contentTranslateY.value = withDelay(80, withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) }));
  }, [contentVisible]);

  useEffect(() => {
    if (!visible || !isMeta) {
      glow.value = withTiming(0.35, { duration: 200 });
      return;
    }
    glow.value = withRepeat(withSequence(withTiming(0.85, { duration: 700 }), withTiming(0.35, { duration: 700 })), -1, true);
  }, [visible, isMeta]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: `${rotation.value}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  const accentColor = isMeta ? HOME_LAVENDER_DARK : XP_GOLD;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={[styles.card, isMeta && styles.cardMeta]}>
          <View style={styles.badgeAnchor}>
            {isMeta && <Animated.View style={[styles.glow, glowStyle]} />}
            <Animated.View style={badgeStyle}>
              <Image source={image} style={styles.badgeImage} resizeMode="contain" />
            </Animated.View>
            <BadgeConfettiBurst active={confettiActive} particleCount={isMeta ? 30 : 22} colors={CONFETTI_COLORS} />
          </View>

          <Animated.View style={contentStyle}>
            <Text style={styles.title}>{isMeta ? 'Dakilang Tagumpay! 🏆' : 'Bagong Badge! 🎉'}</Text>
            <Text style={[styles.badgeName, { color: accentColor }]}>{title}</Text>

            {!!xp && (
              <View style={[styles.xpPill, { backgroundColor: accentColor }]}>
                <Text style={styles.xpText}>+{xp} XP 🌟</Text>
              </View>
            )}

            <TouchableOpacity style={[styles.button, { backgroundColor: accentColor }]} onPress={onClose}>
              <Text style={styles.buttonText}>Ayos, salamat! 🙌</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  card: {
    width: '100%', backgroundColor: '#ffffff', borderRadius: 28, paddingHorizontal: 32, paddingTop: 40, paddingBottom: 32, alignItems: 'center',
    shadowColor: '#4f46e5', shadowOpacity: 0.2, shadowRadius: 30, elevation: 20,
  },
  cardMeta: {
    shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.35, shadowRadius: 40,
  },
  badgeAnchor: {
    width: 128, height: 128, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  glow: {
    position: 'absolute', width: 168, height: 168, borderRadius: 84, backgroundColor: HOME_LAVENDER,
  },
  badgeImage: { width: 128, height: 128 },
  title: { fontSize: 26, fontWeight: '900', color: '#111827', marginBottom: 4, textAlign: 'center' },
  badgeName: { fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  xpPill: {
    borderRadius: 999, paddingHorizontal: 20, paddingVertical: 8, marginBottom: 20, alignSelf: 'center',
  },
  xpText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  button: {
    borderRadius: 16, paddingHorizontal: 28, paddingVertical: 14, width: '100%', alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
