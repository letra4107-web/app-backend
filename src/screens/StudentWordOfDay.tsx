import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Ionicons } from '@expo/vector-icons';
import { buildApiUrl, postJson } from '../config/api';
import { syllabifyText } from '../utils/tagalogSyllabification';
import { WordOfDayLog } from '../services/wordOfDayService';
import { WordDefinition } from '../services/wordDefinitionsService';
import { speakPhrase } from '../services/ttsService';
import { speakWordCloud } from '../services/cloudTtsService';
import { logPhonemeConfusion } from '../services/phonemeService';
import { createSpeechRecognitionSession, SpeechRecognitionSession } from '../utils/speechRecognitionSession';

const PRIMARY = '#4f46e5';
const BORDER = '#e5e7eb';
const TEXT_SECONDARY = '#6b7280';
const TEXT_PRIMARY = '#111827';
const DANGER = '#ef4444';
const SUCCESS = '#10b981';
const WARNING = '#f59e0b';
const HOME_INK_SOFT = '#5F5044';
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

type CompletionResult = { attempts?: number; streak?: number; longest_streak?: number };

export default function StudentWordOfDay({
  log,
  disabled,
  onResult,
  definition,
}: {
  log: WordOfDayLog;
  disabled?: boolean;
  onResult: (correct: boolean, attempts: number, score?: number, transcript?: string, completion?: CompletionResult) => Promise<void>;
  definition?: WordDefinition;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState<{ accuracy: number; feedback: string } | null>(null);
  const pulse = useSharedValue(1);
  const isStartingRef = useRef(false);
  const isListeningRef = useRef(false);
  const processingRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recognitionSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const isMountedRef = useRef(true);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  useEffect(() => {
    pulse.value = isRecording
      ? withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), -1)
      : withTiming(1);
  }, [isRecording, pulse]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      recognitionSessionRef.current?.dispose();
      if (isListeningRef.current) ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  const submitTranscript = async (transcript: string) => {
    const normalizedTranscript = transcript.trim();
    if (!normalizedTranscript || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    try {
      const response = await postJson<{
        success: boolean;
        transcript: string;
        accuracy: number;
        message?: string;
        alreadyCompleted?: boolean;
        completion?: CompletionResult;
        feedback?: string;
        sessionId?: string | null;
      }>(buildApiUrl('/speech/word-of-day-result'), {
        transcript: normalizedTranscript,
        childId: log.child_id,
        durationSeconds: recordingStartedAtRef.current
          ? Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
          : null,
      }, 15000);
      recordingStartedAtRef.current = null;
      if (!isMountedRef.current) return;
      if (response.alreadyCompleted) {
        setMessage(response.message || "You already completed today's Word of the Day. Come back tomorrow!");
        return;
      }
      if (!response.success || !response.transcript) throw new Error(response.message || 'Speech recognition did not return a transcript.');

      void logPhonemeConfusion(log.child_id, log.word, response.transcript, 'word_of_day', response.sessionId);
      const score = response.accuracy;
      const correct = score >= 80;
      const attempts = response.completion?.attempts ?? (log.attempts || 0) + 1;
      const phrase = response.feedback || (correct
        ? SUCCESS_PHRASES[Math.floor(Math.random() * SUCCESS_PHRASES.length)]
        : TRY_PHRASES[Math.floor(Math.random() * TRY_PHRASES.length)]);
      setAnalysis({ accuracy: score, feedback: phrase });
      speakPhrase(phrase, { onError: setMessage });
      if (!correct) {
        setTimeout(() => {
          if (isMountedRef.current) speakWordCloud(log.word, { onError: setMessage });
        }, 2000);
      }
      await onResult(correct, attempts, score, response.transcript, response.completion);
    } catch (error: any) {
      if (isMountedRef.current) setMessage(error?.data?.message || error?.message || 'Hindi naproseso ang sinabi mo. Subukan muli.');
    } finally {
      processingRef.current = false;
      if (isMountedRef.current) setProcessing(false);
    }
  };

  useSpeechRecognitionEvent('start', () => {
    if (!isMountedRef.current) return;
    isListeningRef.current = true;
    setIsRecording(true);
    setStarting(false);
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!isMountedRef.current) return;
    const transcript = event.results?.[0]?.transcript?.trim() || '';
    if (!transcript) return;
    recognitionSessionRef.current?.onTranscript(transcript, event.isFinal);
  });

  useSpeechRecognitionEvent('speechend', () => {
    if (!isMountedRef.current || Platform.OS !== 'android') return;
    recognitionSessionRef.current?.onSpeechEnd();
  });

  useSpeechRecognitionEvent('end', () => {
    if (!isMountedRef.current) return;
    isListeningRef.current = false;
    setIsRecording(false);
    const submitted = recognitionSessionRef.current?.onRecognitionEnd() || false;
    if (!submitted && !recognitionSessionRef.current?.hasSubmitted() && !processingRef.current) {
      setProcessing(false);
      setMessage('Hindi ko narinig. Lumapit sa mikropono at subukan muli.');
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!isMountedRef.current) return;
    const alreadySubmitted = recognitionSessionRef.current?.hasSubmitted() === true;
    recognitionSessionRef.current?.cancel();
    isListeningRef.current = false;
    setIsRecording(false);
    // Some Android recognizers emit an aborted/client error after stop() even
    // though a final result was already accepted. Never overwrite or repeat a
    // valid in-flight evaluation with that late terminal event.
    if (alreadySubmitted) return;
    processingRef.current = false;
    setProcessing(false);
    setStarting(false);
    setMessage(event.error === 'no-speech'
      ? 'Hindi ko narinig. Lumapit sa mikropono at subukan muli.'
      : 'May problema sa speech recognition ng device. Subukan muli.');
  });

  const startRecording = async () => {
    if (isStartingRef.current || isListeningRef.current || processingRef.current) return;
    isStartingRef.current = true;
    setStarting(true);
    setMessage('');
    try {
      const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        setMessage('Hindi available ang speech recognition sa device na ito.');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!isMountedRef.current) return;
      if (!permission.granted) {
        setMessage('Kailangan ng mikropono. I-enable ito sa device settings.');
        return;
      }
      recognitionSessionRef.current?.dispose();
      recognitionSessionRef.current = createSpeechRecognitionSession({
        stopRecognition: () => ExpoSpeechRecognitionModule.stop(),
        submitTranscript,
        onStopRequested: () => {
          if (!isMountedRef.current) return;
          setProcessing(true);
          setMessage('Sinusuri ang iyong bigkas...');
        },
        hardTimeoutMs: 12000,
      });
      recognitionSessionRef.current.start();
      recordingStartedAtRef.current = Date.now();
      ExpoSpeechRecognitionModule.start({
        lang: 'fil-PH',
        interimResults: true,
        continuous: false,
        maxAlternatives: 3,
        contextualStrings: [log.word, log.word.replace(/-/g, '')],
        ...(Platform.OS === 'android' ? {
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2300,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2200,
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 900,
            EXTRA_MASK_OFFENSIVE_WORDS: false,
          },
        } : {}),
      });
    } catch (error: any) {
      recognitionSessionRef.current?.cancel();
      if (isMountedRef.current) setMessage(error?.message || 'Hindi ma-simulan ang pakikinig. Subukan muli.');
    } finally {
      isStartingRef.current = false;
      if (isMountedRef.current) setStarting(false);
    }
  };

  const stopRecording = () => {
    if (!isListeningRef.current) return;
    try {
      recognitionSessionRef.current?.manualStop();
    } catch (error: any) {
      setProcessing(false);
      setMessage(error?.message || 'Hindi maihinto ang pakikinig. Subukan muli.');
    }
  };

  const isDone = disabled || log.correct === true || (log.attempts || 0) >= 3;

  const display = definition?.display_word || syllabifyText(log.word || '');
  const attemptCount = log.attempts || 0;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Pakinggan at Basahin</Text>
            <Text style={styles.subtitle}>Salitang Ngayon</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{attemptCount}/3 Subok</Text>
          </View>
        </View>

        <View style={styles.wordCard}>
          <Text style={styles.wordLabel}>Basahin nang malinaw</Text>
          <Text style={styles.word}>{display}</Text>
          {!!definition && <Text style={styles.wordMeaning}>{definition.meaning_fil}</Text>}
        </View>

        {!!log.recommendation_reason && (
          <View style={styles.recommendationBox}>
            <Ionicons name="sparkles" size={15} color={HOME_LAVENDER_DARK} />
            <Text style={styles.recommendationText}>{log.recommendation_reason}</Text>
          </View>
        )}

        {log.correct ? (
          <View style={styles.completedTodayBanner}>
            <Text style={styles.completedTodayText}>✅ Natapos na ngayon</Text>
            <Text style={styles.completedTodaySubtext}>Babalik bukas para sa bagong salita.</Text>
          </View>
        ) : (
          <>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.listenButton} onPress={() => speakWordCloud(log.word.replace(/-/g, ' '), { onError: setMessage })}>
                <Ionicons name="volume-high-outline" size={18} color={PRIMARY} />
                <Text style={styles.listenText}>Pakinggan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.recordButton, (starting || processing || isDone) && styles.disabledButton]}
                disabled={starting || processing || isDone}
                onPress={isRecording ? stopRecording : startRecording}
              >
                {starting || processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name={isRecording ? 'stop' : 'mic'} size={24} color="#fff" />
                )}
                <Text style={styles.recordText}>{isRecording ? 'Itigil' : 'Basahin'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.micHint}>
              {starting
                ? 'Naghahanda sila...'
                : isRecording
                ? 'Nakikinig... Basahin ang salita nang malinaw.'
                : 'Pindutin ang mikropono at basahin ang salita nang malakas.'}
            </Text>

            <View style={styles.progressRow}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.progressDot, i < attemptCount && styles.progressDotFilled]} />
              ))}
            </View>

            {!!message && !isDone && (
              <View style={[styles.resultBubble, (message.startsWith('Tama') || message.includes('Napakagaling')) ? styles.correctBubble : styles.wrongBubble]}>
                <Text style={styles.resultText}>{message}</Text>
              </View>
            )}

            {!!analysis && (
              <View style={styles.analysisCard}>
                <Text style={styles.analysisTitle}>Pronunciation Analysis</Text>
                <Text style={styles.analysisScore}>{analysis.accuracy}% Tama</Text>
                <Text style={styles.analysisFeedback}>{analysis.feedback}</Text>
                <Text style={styles.analysisReward}>{analysis.accuracy >= 80 ? '+50 XP' : 'Practice recorded • Walang XP'}</Text>
              </View>
            )}

            {isDone && !log.correct && (
              <View style={styles.doneBanner}>
                <Text style={styles.doneText}>Tapos na ang pagkakataon ngayon. 💪</Text>
                <Text style={styles.doneSubtext}>Bumalik bukas at subukan muli!</Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  card: { width: '100%', backgroundColor: '#fff', borderRadius: 28, padding: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  title: { color: HOME_LAVENDER_DARK, fontSize: 20, fontWeight: '900' },
  subtitle: { color: HOME_INK_SOFT, fontSize: 13, marginTop: 4 },
  chip: { backgroundColor: '#F4EDFF', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: HOME_LAVENDER_DARK, fontWeight: '700', fontSize: 12 },
  wordCard: { backgroundColor: '#F7F6FF', borderRadius: 24, padding: 18, alignItems: 'center', marginBottom: 20 },
  wordLabel: { color: HOME_LAVENDER, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  word: { fontFamily: FONT_DISPLAY, fontSize: 46, color: HOME_LAVENDER_DARK, letterSpacing: 1.6, textAlign: 'center', lineHeight: 52 },
  wordMeaning: { color: HOME_INK_SOFT, fontSize: 13, fontWeight: '600', marginTop: 10, textAlign: 'center', lineHeight: 18, maxWidth: '85%' },
  recommendationBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFECFB', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  recommendationText: { flex: 1, color: HOME_LAVENDER_DARK, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  buttonRow: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginBottom: 14 },
  listenButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: HOME_LAVENDER, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', minWidth: 140, justifyContent: 'center' },
  listenText: { color: HOME_LAVENDER_DARK, fontWeight: '800', marginLeft: 6, fontSize: 14 },
  recordButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: HOME_LAVENDER, minWidth: 140 },
  recordText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  disabledButton: { backgroundColor: '#D1D5DB' },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 14 },
  progressDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: BORDER, opacity: 0.35 },
  progressDotFilled: { backgroundColor: HOME_LAVENDER, opacity: 1 },
  micHint: { color: HOME_INK_SOFT, fontSize: 13, marginBottom: 8, textAlign: 'center', lineHeight: 18, fontWeight: '600' },
  resultBubble: { marginTop: 8, borderRadius: 16, padding: 16, width: '100%' },
  correctBubble: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: SUCCESS },
  wrongBubble: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: WARNING },
  resultText: { textAlign: 'center', fontWeight: '700', fontSize: 15 },
  analysisCard: { marginTop: 14, width: '100%', borderRadius: 20, padding: 18, backgroundColor: '#F8F7FF', borderWidth: 1, borderColor: '#D9D4F4', alignItems: 'center' },
  analysisTitle: { color: TEXT_PRIMARY, fontWeight: '800', fontSize: 14 },
  analysisScore: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 24, marginTop: 6 },
  analysisFeedback: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  analysisReward: { color: SUCCESS, fontWeight: '800', fontSize: 12, marginTop: 8 },
  doneBanner: { marginTop: 18, alignItems: 'center' },
  doneText: { fontWeight: '800', color: TEXT_PRIMARY, fontSize: 15 },
  doneSubtext: { color: TEXT_SECONDARY, marginTop: 4, fontSize: 13, textAlign: 'center' },
  completedTodayBanner: { marginTop: 12, padding: 16, width: '100%', borderRadius: 18, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: SUCCESS, alignItems: 'center' },
  completedTodayText: { color: SUCCESS, fontWeight: '800', fontSize: 15 },
  completedTodaySubtext: { color: TEXT_SECONDARY, fontWeight: '600', marginTop: 4, textAlign: 'center', fontSize: 13 },
});
