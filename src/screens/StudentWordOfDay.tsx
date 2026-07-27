import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import levenshtein from 'fast-levenshtein';
import { buildApiUrl, postJson } from '../config/api';
import { WordOfDayLog, updateWordOfDayLog } from '../services/wordOfDayService';
import { WordDefinition } from '../services/wordDefinitionsService';
import { speakPhrase, speakWord } from '../services/ttsService';

const PRIMARY = '#4f46e5';
const BORDER = '#e5e7eb';
const TEXT_SECONDARY = '#6b7280';
const TEXT_PRIMARY = '#111827';
const DANGER = '#ef4444';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';
// Matches the Home tab hero card palette (assets/sdbg.jpg storybook theme)
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#8A7B6C';
const HOME_LAVENDER = '#7C6FCF';
const HOME_LAVENDER_DARK = '#5F52B0';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';

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
  definition,
}: {
  log: WordOfDayLog;
  disabled?: boolean;
  onResult: (correct: boolean, attempts: number, score?: number, transcript?: string) => Promise<void>;
  updateDailyLog?: boolean;
  definition?: WordDefinition;
}) {
  // useAudioRecorder gives one persistent AudioRecorder instance for this
  // component's whole lifetime (auto-disposed on unmount) instead of the old
  // expo-av pattern of constructing a fresh `Audio.Recording()` per attempt -
  // that's what made the old "stale Recording object" retry logic necessary
  // in the first place, so it's no longer needed here.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const pulse = useSharedValue(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Closes the gap between a tap and `starting` state actually re-rendering the
  // disabled button — state updates aren't synchronous, so a fast double-tap can
  // fire startRecording() twice before the button visually disables.
  const isStartingRef = useRef(false);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  useEffect(() => {
    if (isRecording) {
      pulse.value = withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    } else {
      pulse.value = withTiming(1);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isRecording]);

  // Unmount-only cleanup: if the screen is left while a recording is active
  // (e.g. the student navigates away mid-recording), stop it so it doesn't
  // hold the audio session and block the next attempt.
  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        recorder.stop().catch(() => {});
      }
    };
  }, []);

  const startRecording = async () => {
    const alreadyBusy = isStartingRef.current || recorder.isRecording || processing;
    if (alreadyBusy) return;
    isStartingRef.current = true;
    setStarting(true);
    setMessage('');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMessage('Kailangan ng mikropono. I-enable ito sa device settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      timeoutRef.current = setTimeout(() => void stopRecording(), 5000);
    } catch {
      setMessage('Hindi ma-simulan ang pag-record. Subukan muli.');
    } finally {
      isStartingRef.current = false;
      setStarting(false);
    }
  };

  const stopRecording = async () => {
    if (!recorder.isRecording) return;
    setProcessing(true);
    setIsRecording(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio URI');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const response = await postJson<{ transcript: string }>(buildApiUrl('/speech/transcribe'), {
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
      speakPhrase(phrase, { onError: (errorMessage) => setMessage(errorMessage) });
      if (!correct) {
        // speak the correct word slowly after a short delay
        setTimeout(() => {
          speakWord(log.word, { onError: (errorMessage) => setMessage(errorMessage) });
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
      {!!definition && (
        <View style={styles.meaningBox}>
          {definition.is_ambiguous && !!definition.display_word && (
            <Text style={styles.meaningAccented}>{definition.display_word}</Text>
          )}
          <Text style={styles.meaningText}>{definition.meaning_fil}</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.listenButton}
        onPress={() => speakWord(log.word, { onError: (errorMessage) => setMessage(errorMessage) })}
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
        <View style={[styles.micGlowOuter, isRecording && styles.micGlowOuterRecording]}>
          <View style={[styles.micGlowInner, isRecording && styles.micGlowInnerRecording]}>
            <TouchableOpacity
              style={[styles.mic, isRecording && styles.micRecording, isDone && styles.disabled]}
              disabled={starting || processing || isDone}
              onPress={() => isRecording ? stopRecording() : startRecording()}
            >
              {(starting || processing) ? <ActivityIndicator color="#fff" /> : <Ionicons name={isRecording ? 'stop' : 'mic'} size={36} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      <Text style={styles.micHint}>
        {starting ? 'Naghahanda...' : isRecording ? 'Pindutin muli para ihinto...' : 'Pindutin ang mikropono at bigkasin'}
      </Text>

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
  wordLabel: { color: HOME_INK_SOFT, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  word: { fontFamily: FONT_DISPLAY, fontSize: 46, color: HOME_LAVENDER_DARK, letterSpacing: 2, marginBottom: 16 },
  meaningBox: { alignItems: 'center', marginTop: -8, marginBottom: 16, paddingHorizontal: 12 },
  meaningAccented: { color: HOME_LAVENDER_DARK, fontSize: 13, fontWeight: '800', marginBottom: 2, textAlign: 'center' },
  meaningText: { color: HOME_INK_SOFT, fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 16 },
  listenButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: HOME_LAVENDER, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 8, marginBottom: 20,
    backgroundColor: '#fff',
  },
  listenText: { color: HOME_LAVENDER_DARK, fontWeight: '700', marginLeft: 8 },
  dotsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: BORDER },
  dotFilled: { backgroundColor: HOME_LAVENDER },
  micGlowOuter: {
    width: 118, height: 118, borderRadius: 59, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124,111,207,0.12)',
  },
  micGlowOuterRecording: { backgroundColor: 'rgba(239,68,68,0.12)' },
  micGlowInner: {
    width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(124,111,207,0.22)',
  },
  micGlowInnerRecording: { backgroundColor: 'rgba(239,68,68,0.22)' },
  mic: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: HOME_LAVENDER, alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    // "shadow*" props are deprecated on web (react-native-web wants a real
    // CSS boxShadow string) but are still the correct/only cross-platform
    // way to draw a shadow on native iOS/Android, so the two are split here
    // rather than picking one at the cost of the other platform.
    ...Platform.select({
      web: { boxShadow: `0px 0px 14px rgba(95,82,176,0.35)` },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.35, shadowRadius: 14 },
    }),
  },
  micRecording: {
    backgroundColor: DANGER,
    ...Platform.select({
      web: { boxShadow: `0px 0px 14px rgba(239,68,68,0.35)` },
      default: { shadowColor: DANGER },
    }),
  },
  disabled: { backgroundColor: '#D1D5DB' },
  micHint: { color: HOME_INK_SOFT, fontSize: 12, marginTop: 12, marginBottom: 8, fontWeight: '600' },
  resultBubble: { marginTop: 16, borderRadius: 14, padding: 14, width: '100%' },
  correctBubble: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: SUCCESS },
  wrongBubble: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: WARNING },
  resultText: { textAlign: 'center', fontWeight: '700', fontSize: 15 },
  doneBanner: { marginTop: 20, alignItems: 'center' },
  doneText: { fontWeight: '800', color: TEXT_PRIMARY, fontSize: 15 },
  doneSubtext: { color: TEXT_SECONDARY, marginTop: 4 },
});
