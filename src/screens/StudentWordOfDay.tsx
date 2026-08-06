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

  return (
    <View style={styles.container}>
      <Text style={styles.wordLabel}>Bigkasin ang salitang ito:</Text>
          {
            (() => {
              const display = definition?.display_word || syllabifyText(log.word || '');
              return <Text style={styles.word}>{display}</Text>;
            })()
          }
      {!!log.recommendation_reason && (
        <View style={styles.recommendationBox}>
          <Ionicons name="sparkles" size={15} color={HOME_LAVENDER_DARK} />
          <Text style={styles.recommendationText}>AI recommendation: {log.recommendation_reason}</Text>
        </View>
      )}
      {!!definition && (
        <View style={styles.meaningBox}>
          {definition.is_ambiguous && !!definition.display_word && <Text style={styles.meaningAccented}>{definition.display_word}</Text>}
          <Text style={styles.meaningText}>{definition.meaning_fil}</Text>
        </View>
      )}

      {log.correct ? (
        <View style={styles.completedTodayBanner}>
          <Text style={styles.completedTodayText}>✅ Already completed today.</Text>
          <Text style={styles.completedTodaySubtext}>Come back tomorrow for a new word!</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity style={styles.listenButton} onPress={() => speakWordCloud((definition?.display_word || syllabifyText(log.word || '')).replace(/-/g, ' '), { onError: setMessage })}>
            <Ionicons name="volume-high-outline" size={18} color={PRIMARY} />
            <Text style={styles.listenText}>Pakinggan</Text>
          </TouchableOpacity>

          <View style={styles.dotsRow}>
            {[0, 1, 2].map((i) => <View key={i} style={[styles.dot, i < (log.attempts || 0) && styles.dotFilled]} />)}
          </View>

          <Animated.View style={animatedStyle}>
            <View style={[styles.micGlowOuter, isRecording && styles.micGlowOuterRecording]}>
              <View style={[styles.micGlowInner, isRecording && styles.micGlowInnerRecording]}>
                <TouchableOpacity
                  style={[styles.mic, isRecording && styles.micRecording, isDone && styles.disabled]}
                  disabled={starting || processing || isDone}
                  onPress={isRecording ? stopRecording : startRecording}
                >
                  {(starting || processing) ? <ActivityIndicator color="#fff" /> : <Ionicons name={isRecording ? 'stop' : 'mic'} size={36} color="#fff" />}
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          <Text style={styles.micHint}>
            {starting
              ? 'Naghahanda...'
              : isRecording
              ? 'Nakikinig... Magsalita nang malinaw. Awtomatikong hihinto kapag tapos ka na.'
              : 'Pindutin ang mikropono at bigkasin. Awtomatikong hihinto kapag tapos ka na.'}
          </Text>

          {!!message && !isDone && (
            <View style={[styles.resultBubble, (message.startsWith('Tama') || message.includes('Napakagaling')) ? styles.correctBubble : styles.wrongBubble]}>
              <Text style={styles.resultText}>{message}</Text>
            </View>
          )}

          {!!analysis && (
            <View style={styles.analysisCard}>
              <Text style={styles.analysisTitle}>Pronunciation Analysis</Text>
              <Text style={styles.analysisScore}>{analysis.accuracy}% Accuracy</Text>
              <Text style={styles.analysisFeedback}>{analysis.feedback}</Text>
              <Text style={styles.analysisReward}>{analysis.accuracy >= 80 ? '+50 XP' : 'Practice recorded • No XP yet'}</Text>
            </View>
          )}

          {isDone && !log.correct && (
            <View style={styles.doneBanner}>
              <Text style={styles.doneText}>Tapos na ang mga pagkakataon ngayon. 💪</Text>
              <Text style={styles.doneSubtext}>Bumalik bukas para subukan muli!</Text>
            </View>
          )}
        </>
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
  recommendationBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFECFB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: -8, marginBottom: 14, maxWidth: '100%' },
  recommendationText: { flex: 1, color: HOME_LAVENDER_DARK, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  listenButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: HOME_LAVENDER, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 20, backgroundColor: '#fff' },
  listenText: { color: HOME_LAVENDER_DARK, fontWeight: '700', marginLeft: 8 },
  dotsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: BORDER },
  dotFilled: { backgroundColor: HOME_LAVENDER },
  micGlowOuter: { width: 118, height: 118, borderRadius: 59, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,111,207,0.12)' },
  micGlowOuterRecording: { backgroundColor: 'rgba(239,68,68,0.12)' },
  micGlowInner: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,111,207,0.22)' },
  micGlowInnerRecording: { backgroundColor: 'rgba(239,68,68,0.22)' },
  mic: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: HOME_LAVENDER, alignItems: 'center', justifyContent: 'center', elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0px 0px 14px rgba(95,82,176,0.35)' },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOpacity: 0.35, shadowRadius: 14 },
    }),
  },
  micRecording: {
    backgroundColor: DANGER,
    ...Platform.select({ web: { boxShadow: '0px 0px 14px rgba(239,68,68,0.35)' }, default: { shadowColor: DANGER } }),
  },
  disabled: { backgroundColor: '#D1D5DB' },
  micHint: { color: HOME_INK_SOFT, fontSize: 12, marginTop: 12, marginBottom: 8, fontWeight: '600' },
  resultBubble: { marginTop: 16, borderRadius: 14, padding: 14, width: '100%' },
  correctBubble: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: SUCCESS },
  wrongBubble: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: WARNING },
  resultText: { textAlign: 'center', fontWeight: '700', fontSize: 15 },
  analysisCard: { marginTop: 16, width: '100%', borderRadius: 14, padding: 14, backgroundColor: '#F8F7FF', borderWidth: 1, borderColor: '#D9D4F4', alignItems: 'center' },
  analysisTitle: { color: TEXT_PRIMARY, fontWeight: '800', fontSize: 14 },
  analysisScore: { color: HOME_LAVENDER_DARK, fontWeight: '900', fontSize: 22, marginTop: 4 },
  analysisFeedback: { color: HOME_INK_SOFT, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 5, lineHeight: 18 },
  analysisReward: { color: SUCCESS, fontWeight: '800', fontSize: 12, marginTop: 8 },
  doneBanner: { marginTop: 20, alignItems: 'center' },
  doneText: { fontWeight: '800', color: TEXT_PRIMARY, fontSize: 15 },
  doneSubtext: { color: TEXT_SECONDARY, marginTop: 4 },
  completedTodayBanner: { marginTop: 12, padding: 14, width: '100%', borderRadius: 14, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: SUCCESS, alignItems: 'center' },
  completedTodayText: { color: SUCCESS, fontWeight: '800', fontSize: 15 },
  completedTodaySubtext: { color: TEXT_SECONDARY, fontWeight: '600', marginTop: 4, textAlign: 'center' },
});
