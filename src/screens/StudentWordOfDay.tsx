import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAudioRecorder, RecordingOptions, IOSOutputFormat, AudioQuality, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import levenshtein from 'fast-levenshtein';
import { buildApiUrl, postJson } from '../config/api';
import { WordOfDayLog } from '../services/wordOfDayService';
import { WordDefinition } from '../services/wordDefinitionsService';
import { speakPhrase, speakWord } from '../services/ttsService';
import { logPhonemeConfusion } from '../services/phonemeService';

const PRIMARY = '#4f46e5';
const BORDER = '#e5e7eb';
const TEXT_SECONDARY = '#6b7280';
const TEXT_PRIMARY = '#111827';
const DANGER = '#ef4444';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';
// Matches the Home tab hero card palette (assets/sdbg.jpg storybook theme)
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

// RecordingPresets.HIGH_QUALITY (AAC-in-M4A) was silently untranscribable:
// Google Cloud Speech-to-Text's encoding enum has no AAC/M4A option at all,
// and the backend's getEncoding() had no case for 'm4a' either, so no
// encoding was ever sent - this is the real "doesn't hear the student" bug,
// not a resurgence of the earlier released-object crash. AMR-NB (8kHz) is a
// real trade-off (narrowband, lower fidelity than AAC) but is one of Google
// STT's natively supported encodings, and is a proven expo-audio preset
// pattern (matches RecordingPresets.LOW_QUALITY's Android config) rather
// than an untested one. iOS is left on its existing AAC settings for now -
// this app has no iOS build yet, so that path is unverified either way.
const WORD_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.3gp',
  sampleRate: 8000,
  numberOfChannels: 1,
  bitRate: 12200,
  android: {
    extension: '.3gp',
    outputFormat: '3gp',
    audioEncoder: 'amr_nb',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MAX,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

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
  definition,
}: {
  log: WordOfDayLog;
  disabled?: boolean;
  onResult: (correct: boolean, attempts: number, score?: number, transcript?: string, completion?: { streak?: number; longest_streak?: number }) => Promise<void>;
  definition?: WordDefinition;
}) {
  // useAudioRecorder gives one persistent AudioRecorder instance for this
  // component's whole lifetime (auto-disposed on unmount) instead of the old
  // expo-av pattern of constructing a fresh `Audio.Recording()` per attempt -
  // that's what made the old "stale Recording object" retry logic necessary
  // in the first place, so it's no longer needed here.
  const recorder = useAudioRecorder(WORD_RECORDING_OPTIONS);
  const [isRecording, setIsRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const pulse = useSharedValue(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Closes the gap between a tap and `starting` state actually re-rendering the
  // disabled button — state updates aren't synchronous, so a fast double-tap can
  // fire startRecording() twice before the button visually disables.
  const isStartingRef = useRef(false);
  // Same reentrancy gap as isStartingRef, but for stop: the mic button's onPress
  // decides stop-vs-start from local `isRecording` state, but stopRecording's own
  // guard checks the native `recorder.isRecording`, which only flips after
  // recorder.stop() resolves. A fast double-tap (or the 5s auto-stop timeout
  // landing at nearly the same instant as a manual tap) can pass that guard twice
  // and call recorder.stop() on the same native object concurrently — the second
  // call then hits an already-released shared object and crashes natively instead
  // of rejecting as a normal JS error.
  const isStoppingRef = useRef(false);
  // Guards every recorder access after an `await` — if the component unmounts
  // (e.g. the student switches tabs) while prepareToRecordAsync/record/stop is
  // still in flight, the resumed continuation must not touch the recorder, which
  // may already be disposed.
  const isMountedRef = useRef(true);

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
  }, [isRecording, pulse]);

  // Unmount-only cleanup: if the screen is left while a recording is active
  // (e.g. the student navigates away mid-recording), stop it so it doesn't
  // hold the audio session and block the next attempt. isMountedRef flips
  // first so any in-flight startRecording/stopRecording continuation that
  // resumes after this point knows not to touch the recorder again.
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      try {
        if (recorder.isRecording) {
          recorder.stop().catch(() => {});
        }
      } catch {
        // recorder may already be released — nothing to clean up
      }
    };
  }, [recorder]);

  const startRecording = async () => {
    const alreadyBusy = isStartingRef.current || isStoppingRef.current || recorder.isRecording || processing;
    if (alreadyBusy) return;
    isStartingRef.current = true;
    setStarting(true);
    setMessage('');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!isMountedRef.current) return;
      if (!permission.granted) {
        setMessage('Kailangan ng mikropono. I-enable ito sa device settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!isMountedRef.current) return;

      await recorder.prepareToRecordAsync();
      if (!isMountedRef.current) return;
      recorder.record();
      setIsRecording(true);
      timeoutRef.current = setTimeout(() => void stopRecording(), 5000);
    } catch {
      if (isMountedRef.current) setMessage('Hindi ma-simulan ang pag-record. Subukan muli.');
    } finally {
      isStartingRef.current = false;
      if (isMountedRef.current) setStarting(false);
    }
  };

  const stopRecording = async () => {
    if (isStoppingRef.current || !recorder.isRecording) return;
    isStoppingRef.current = true;
    setProcessing(true);
    setIsRecording(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await recorder.stop();
      if (!isMountedRef.current) return;
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio URI');
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || !info.size || info.size < 256) {
        throw new Error('The recording is empty. Please hold the microphone and try again.');
      }
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64.trim()) throw new Error('The recording is empty. Please try again.');
      // Must match WORD_RECORDING_OPTIONS per platform - Android now records
      // AMR-NB in a 3gp container (the format Google STT can actually decode
      // for this upload path), while iOS/web are unchanged from before.
      const { mimeType, filename } = Platform.OS === 'android'
        ? { mimeType: 'audio/amr', filename: 'word-of-day.3gp' }
        : Platform.OS === 'web'
          ? { mimeType: 'audio/webm', filename: 'word-of-day.webm' }
          : { mimeType: 'audio/m4a', filename: 'word-of-day.m4a' };
      const response = await postJson<{ success: boolean; transcript: string; accuracy: number; message?: string; alreadyCompleted?: boolean; completion?: { attempts?: number; streak?: number; longest_streak?: number } }>(buildApiUrl('/speech/transcribe'), {
        audioBase64: base64,
        mimeType,
        filename,
        childId: log.child_id,
        completeWordOfDay: true,
        language: 'tl-PH',
      }, 30000);
      if (!isMountedRef.current) return;
      if (response.alreadyCompleted) {
        setMessage(response.message || "You already completed today's Word of the Day. Come back tomorrow!");
        return;
      }
      if (!response.success || !response.transcript) throw new Error(response.message || 'Speech recognition did not return a transcript.');
      logPhonemeConfusion(log.child_id, log.word, response.transcript || '', 'word_of_day');
      // Accuracy is calculated by the server from the transcription. Keep the
      // local fallback solely for compatibility with an older deployed API.
      const score = Number.isFinite(response.accuracy) ? response.accuracy : similarity(response.transcript || '', log.word);
      const correct = score >= 80;
      const attempts = response.completion?.attempts ?? (log.attempts || 0) + 1;
      if (!isMountedRef.current) return;

      const phrase = correct
        ? SUCCESS_PHRASES[Math.floor(Math.random() * SUCCESS_PHRASES.length)]
        : TRY_PHRASES[Math.floor(Math.random() * TRY_PHRASES.length)];
      speakPhrase(phrase, { onError: (errorMessage) => setMessage(errorMessage) });
      if (!correct) {
        // speak the correct word slowly after a short delay
        setTimeout(() => {
          if (isMountedRef.current) speakWord(log.word, { onError: (errorMessage) => setMessage(errorMessage) });
        }, 2000);
      }
      await onResult(correct, attempts, score, response.transcript || '', response.completion);
    } catch (error: any) {
      if (isMountedRef.current) setMessage(error?.data?.message || error?.message || 'Hindi naproseso ang audio. Subukan muli.');
    } finally {
      isStoppingRef.current = false;
      if (isMountedRef.current) setProcessing(false);
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
