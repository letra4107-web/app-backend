import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type ParticleProps = {
  index: number;
  particleCount: number;
  colors: string[];
};

function Particle({ index, particleCount, colors }: ParticleProps) {
  const progress = useSharedValue(0);

  const angle = useMemo(() => (index / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.7, [index, particleCount]);
  const distance = useMemo(() => 90 + Math.random() * 150, []);
  const size = useMemo(() => 6 + Math.random() * 6, []);
  const isCircle = useMemo(() => Math.random() > 0.5, []);
  const rotationDir = useMemo(() => (Math.random() > 0.5 ? 1 : -1), []);
  const fallExtra = useMemo(() => 90 + Math.random() * 130, []);
  const duration = useMemo(() => 1100 + Math.random() * 500, []);
  const color = colors[index % colors.length];

  useEffect(() => {
    progress.value = withTiming(1, { duration, easing: Easing.out(Easing.quad) });
  }, []);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const dx = Math.cos(angle) * distance * p;
    const dy = Math.sin(angle) * distance * p * 0.6 + p * p * fallExtra;
    const fadeStart = 0.8;
    const opacity = p < fadeStart ? 1 : Math.max(0, 1 - (p - fadeStart) / (1 - fadeStart));
    return {
      opacity,
      transform: [
        { translateX: dx },
        { translateY: dy },
        { rotate: `${p * 360 * rotationDir}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: size,
          height: size,
          backgroundColor: color,
          borderRadius: isCircle ? size / 2 : 2,
        },
        style,
      ]}
    />
  );
}

export default function BadgeConfettiBurst({
  active,
  particleCount,
  colors,
}: {
  active: boolean;
  particleCount: number;
  colors: string[];
}) {
  if (!active) return null;

  return (
    <View style={styles.anchor} pointerEvents="none">
      {Array.from({ length: particleCount }, (_, i) => (
        <Particle key={i} index={i} particleCount={particleCount} colors={colors} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
  },
  particle: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
