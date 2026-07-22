import React from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

export default function AchievementModal({
  visible,
  emoji,
  image,
  title,
  xp = 50,
  onClose,
}: {
  visible: boolean;
  emoji?: string;
  image?: any;
  title: string;
  xp?: number;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <Animated.View entering={ZoomIn.duration(300)} style={styles.card}>

          <View style={styles.confettiRow}>
            {['🎊','🎉','✨','⭐','🎊','✨'].map((e, i) => (
              <Text key={i} style={styles.confetti}>{e}</Text>
            ))}
          </View>

          {image ? (
            <Image source={image} style={styles.badgeImage} resizeMode="contain" />
          ) : (
            <Text style={styles.bigEmoji}>{emoji}</Text>
          )}
          <Text style={styles.title}>Bagong Badge! 🎉</Text>
          <Text style={styles.badgeName}>{title}</Text>

          <View style={styles.xpPill}><Text style={styles.xpText}>+{xp} XP 🌟</Text></View>

          <TouchableOpacity style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Ayos, salamat! 🙌</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  card: {
    width: '100%', backgroundColor: '#ffffff', borderRadius: 28, padding: 32, alignItems: 'center',
    shadowColor: '#4f46e5', shadowOpacity: 0.2, shadowRadius: 30, elevation: 20,
  },
  confettiRow: { flexDirection: 'row', gap: 4, marginBottom: 12, flexWrap: 'wrap', justifyContent: 'center' },
  confetti: { fontSize: 22 },
  bigEmoji: { fontSize: 80, marginBottom: 8 },
  badgeImage: { width: 128, height: 128, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '900', color: '#111827', marginBottom: 4 },
  badgeName: { fontSize: 18, color: '#4f46e5', fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  xpPill: {
    backgroundColor: '#f59e0b', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 8, marginBottom: 20,
  },
  xpText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  button: {
    backgroundColor: '#4f46e5', borderRadius: 16, paddingHorizontal: 28, paddingVertical: 14, width: '100%', alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
