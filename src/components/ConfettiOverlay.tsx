import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';

const { width, height } = Dimensions.get('window');

const CONFETTI_PIECES = ['🎊', '🎉', '✨', '⭐', '🌟', '🎈', '💛', '💜', '💙', '🟡', '🔵', '🟣'];
const NUM_PIECES = 20;

interface Piece {
  emoji: string;
  startX: number;
  startY: number;
  anim: Animated.Value;
  drift: Animated.Value;
  rotate: Animated.Value;
}

export default function ConfettiOverlay({ visible }: { visible: boolean }) {
  const pieces = useRef<Piece[]>(
    Array.from({ length: NUM_PIECES }, (_, i) => ({
      emoji: CONFETTI_PIECES[i % CONFETTI_PIECES.length],
      startX: Math.random() * width,
      startY: -40 - Math.random() * 100,
      anim: new Animated.Value(0),
      drift: new Animated.Value(0),
      rotate: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    if (!visible) return;
    const animations = pieces.map((p) => {
      p.anim.setValue(0);
      p.drift.setValue(0);
      p.rotate.setValue(0);
      return Animated.parallel([
        Animated.timing(p.anim, {
          toValue: height + 60,
          duration: 1800 + Math.random() * 1200,
          delay: Math.random() * 600,
          useNativeDriver: true,
        }),
        Animated.timing(p.drift, {
          toValue: (Math.random() - 0.5) * 120,
          duration: 2000 + Math.random() * 1000,
          delay: Math.random() * 400,
          useNativeDriver: true,
        }),
        Animated.timing(p.rotate, {
          toValue: Math.random() > 0.5 ? 360 : -360,
          duration: 1600 + Math.random() * 800,
          useNativeDriver: true,
        }),
      ]);
    });
    Animated.stagger(60, animations).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}>
      {pieces.map((p, i) => (
        <Animated.Text
          key={i}
          style={[
            styles.piece,
            {
              left: p.startX,
              top: p.startY,
              transform: [
                { translateY: p.anim },
                { translateX: p.drift },
                {
                  rotate: p.rotate.interpolate({
                    inputRange: [-360, 360],
                    outputRange: ['-360deg', '360deg'],
                  }),
                },
              ],
            },
          ]}
        >
          {p.emoji}
        </Animated.Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', fontSize: 22 },
});
