import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import levenshtein from 'fast-levenshtein';
import { API_BASE_URL, postJson } from '../config/api';
import { WordOfDayLog, updateWordOfDayLog } from '../services/wordOfDayService';

const PRIMARY = '#4f46e5';
const BORDER = '#e5e7eb';
const TEXT_SECONDARY = '#6b7280';
const TEXT_PRIMARY = '#111827';
const DANGER = '#ef4444';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';

const SUCCESS_PHRASES = [
  'Napakagaling! Tama ang bigkas mo!',
  'Excellent! Magaling ka!',
  'Wow, mahusay! Tama!',
  'Ang galing mo! Bigkas na bigkas!',
];
const TRY_PHRASES = [
  'Okay lang! Subukan nating muli.',
  'Huwag mag-alala, practice ulit!',
  'Kaya mo yan! Subukan mo ulit.',
];

const similarity = (a: string, b: string) => {
  const left = a.toLowerCase().replace(/[^a-z]/g, '');
  const right = b.toLowerCase().replace(/[^a-z]/g, '');
  if (!left || !right) return 0;
  if (left === right) return 100;
  const distance = levenshtein.get(left, right);
  return Math.round(((Math.max(left.length, right.length) - distance) / Math.max(left.length, right.length)) * 100);
};

export default function StudentWordOfDay({
  log,
  disabled,
  onResult,
  updateDailyLog = true,
}: {
  log: WordOfDayLog;
  disabled?: boolean;
  onResult: (correct: boolean, attempts: number, score?: number, transcript?: string) => Promise<void>;
  updateDailyLog?: boolean;
}) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const pulse = useSharedValue(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  useEffect(() => {
    if (recording) {
      pulse.value = withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    } else {
      pulse.value = withTiming(1);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [recording]);

  const startRecording = async () => {
    setMessage('');
    const permission = await Audio.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      setMessage('Kailangan ng mikropono. I-enable ito sa device settings.');
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const nextRecording = new Audio.Recording();
    await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await nextRecording.startAsync();
    setRecording(nextRecording);
    timeoutRef.current = setTimeout(() => void stopRecording(nextRecording), 5000);
  };

  const stopRecording = async (active = recording) => {
    if (!active) return;
    setProcessing(true);
    setRecording(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await active.stopAndUnloadAsync();
      const uri = active.getURI();
      if (!uri) throw new Error('No audio URI');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const response = await postJson<{ transcript: string }>(`${API_BASE_URL}/speech/transcribe`, {
        audioBase64: base64,
        mimeType: 'audio/m4a',
        filename: 'word-of-day.m4a',
        target: log.word,
        language: 'tl-PH',
      }, 30000);
      const score = similarity(response.transcript || '', log.word);
      const correct = score >= 80;
      const attempts = (log.attempts || 0) + 1;
      if (updateDailyLog && log.id) {
        await updateWordOfDayLog(log.id, attempts, correct || attempts >= 3 ? correct : false);
      }
      // store last result locally so parent can read it if needed
      setLastScore(score);
      setLastTranscript(response.transcript || '');
      setLastCorrect(correct);

      const phrase = correct
        ? SUCCESS_PHRASES[Math.floor(Math.random() * SUCCESS_PHRASES.length)]
        : TRY_PHRASES[Math.floor(Math.random() * TRY_PHRASES.length)];
      Speech.speak(phrase, { language: 'fil-PH' });
      if (!correct) {
        // speak the correct word slowly after a short delay
        setTimeout(() => {
          Speech.speak(log.word, { language: 'tl-PH', rate: 0.75 });
        }, 2000);
      }
      await onResult(correct, attempts, score, response.transcript || '');
    } catch {
      setMessage('Hindi naproseso ang audio. Subukan muli.');
    } finally {
      setProcessing(false);
    }
  };

  const isDone = disabled || log.correct === true || (log.attempts || 0) >= 3;

  return (
    <View style={styles.container}>
      <Text style={styles.wordLabel}>Bigkasin ang salitang ito:</Text>
      <Text style={styles.word}>{log.word}</Text>

      <TouchableOpacity
        style={styles.listenButton}
        onPress={() => Speech.speak(log.word, { language: 'tl-PH', rate: 0.85 })}
      >
        <Ionicons name="volume-high-outline" size={18} color={PRIMARY} />
        <Text style={styles.listenText}>Pakinggan</Text>
      </TouchableOpacity>

      <View style={styles.dotsRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, i < (log.attempts || 0) && styles.dotFilled]} />
        ))}
      </View>

      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={[styles.mic, recording && styles.micRecording, isDone && styles.disabled]}
          disabled={processing || isDone}
          onPress={() => recording ? stopRecording() : startRecording()}
        >
          {processing ? <ActivityIndicator color="#fff" /> : <Ionicons name={recording ? 'stop' : 'mic'} size={36} color="#fff" />}
        </TouchableOpacity>
      </Animated.View>

      <Text style={styles.micHint}>{recording ? 'Pindutin muli para ihinto...' : 'Pindutin ang mikropono at bigkasin'}</Text>

      {!!message && !isDone && (
        <View style={[styles.resultBubble, (message.startsWith('Tama') || message.includes('Napakagaling')) ? styles.correctBubble : styles.wrongBubble]}>
          <Text style={styles.resultText}>{message}</Text>
        </View>
      )}

      {isDone && !log.correct && (
        <View style={styles.doneBanner}>
          <Text style={styles.doneText}>Tapos na ang mga pagkakataon ngayon. 💪</Text>
          <Text style={styles.doneSubtext}>Bumalik bukas para subukan muli!</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 8 },
  wordLabel: { color: TEXT_SECONDARY, fontSize: 14, marginBottom: 8 },
  word: { fontSize: 42, fontWeight: '900', color: PRIMARY, letterSpacing: 4, marginBottom: 16 },
  listenButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: PRIMARY, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 8, marginBottom: 20,
  },
  listenText: { color: PRIMARY, fontWeight: '700', marginLeft: 8 },
  dotsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: BORDER },
  dotFilled: { backgroundColor: PRIMARY },
  mic: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  micRecording: { backgroundColor: DANGER, shadowColor: DANGER },
  disabled: { backgroundColor: '#D1D5DB' },
  micHint: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 12, marginBottom: 8 },
  resultBubble: { marginTop: 16, borderRadius: 14, padding: 14, width: '100%' },
  correctBubble: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: SUCCESS },
  wrongBubble: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: WARNING },
  resultText: { textAlign: 'center', fontWeight: '700', fontSize: 15 },
  doneBanner: { marginTop: 20, alignItems: 'center' },
  doneText: { fontWeight: '800', color: TEXT_PRIMARY, fontSize: 15 },
  doneSubtext: { color: TEXT_SECONDARY, marginTop: 4 },
});
