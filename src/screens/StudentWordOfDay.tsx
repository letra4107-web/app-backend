import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { colors, typography } from '../theme';

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
  const [completedToday, setCompletedToday] = useState(log.correct === true);
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState<{ accuracy: number; feedback: string } | null>(null);
  const isStartingRef = useRef(false);
  const isListeningRef = useRef(false);
  const processingRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recognitionSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      recognitionSessionRef.current?.dispose();
      if (isListeningRef.current) ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  useEffect(() => {
    setCompletedToday(log.correct === true);
  }, [log.id, log.correct]);

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
        setCompletedToday(true);
        setMessage('');
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
      if (correct) setCompletedToday(true);
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
        // Word of the Day expects one short word. Auto-submit after the child
        // finishes speaking even on recognizers that never emit `speechend`.
        transcriptSilenceMs: 1300,
      });
      recognitionSessionRef.current.start();
      recordingStartedAtRef.current = Date.now();
      ExpoSpeechRecognitionModule.start({
        lang: 'fil-PH',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        // Do not put the expected answer in contextualStrings. Android treats
        // those strings as recognition bias and can "correct" a genuinely
        // wrong pronunciation such as "idsa" into "isda", producing a false
        // pass before the server ever sees what the child actually said.
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

  const isDone = disabled || completedToday || (log.attempts || 0) >= 3;

  const display = definition?.display_word || syllabifyText(log.word || '');
  const attemptCount = log.attempts || 0;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Pakinggan at Basahin</Text>
            <Text style={styles.subtitle}>Salitang Ngayon</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{isDone ? 'Tapos na!' : attemptCount > 0 ? 'Ipagpatuloy!' : 'Subukan Na!'}</Text>
          </View>
        </View>

        <View style={styles.wordCard}>
          <Text style={styles.wordLabel}>Basahin nang malinaw</Text>
          <Text style={styles.word}>{display}</Text>
          {!!definition && <Text style={styles.wordMeaning}>{definition.meaning_fil}</Text>}
        </View>

        {!!log.recommendation_reason && (
          <View style={styles.recommendationBox}>
            <Ionicons name="sparkles" size={15} color={colors.lavenderDark} />
            <Text style={styles.recommendationText}>{log.recommendation_reason}</Text>
          </View>
        )}

        {completedToday ? (
          <View style={styles.completedTodayBanner}>
            <View style={styles.completedTodayTitleRow}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.completedTodayText}>Tapos mo na itong basahin!</Text>
            </View>
            <Text style={styles.completedTodaySubtext}>Bumalik bukas para sa bagong salita.</Text>
          </View>
        ) : (
          <>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.listenButton} onPress={() => speakWordCloud(log.word.replace(/-/g, ' '), { onError: setMessage })}>
                <Ionicons name="volume-high-outline" size={18} color={colors.primary} />
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
                ? 'Naghahanda...'
                : isRecording
                ? 'Nakikinig... Awtomatikong titigil pagkatapos mong magsalita.'
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
                <Text style={styles.analysisTitle}>Pagsusuri ng Bigkas</Text>
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
  // StudentDashboard already provides the outer Word of the Day card. Keep
  // this component edge-to-edge inside it so small Android screens do not
  // lose usable width to a second card/padding layer.
  container: { width: '100%', paddingTop: 10 },
  card: { width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 10 },
  title: { color: colors.lavenderDark, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.inkSoft, fontSize: 13, marginTop: 4 },
  chip: { backgroundColor: '#F4EDFF', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: colors.lavenderDark, fontWeight: '700', fontSize: 12 },
  wordCard: { backgroundColor: '#F7F6FF', borderRadius: 24, padding: 18, alignItems: 'center', marginBottom: 20 },
  wordLabel: { color: colors.lavender, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  word: { fontFamily: typography.family.display, fontSize: 46, color: colors.lavenderDark, letterSpacing: 1.6, textAlign: 'center', lineHeight: 52 },
  wordMeaning: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', marginTop: 10, textAlign: 'center', lineHeight: 18, maxWidth: '85%' },
  recommendationBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFECFB', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  recommendationText: { flex: 1, color: colors.lavenderDark, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  buttonRow: { width: '100%', flexDirection: 'row', gap: 10, alignItems: 'stretch', marginBottom: 14 },
  listenButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.lavender, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 12, backgroundColor: '#fff', justifyContent: 'center' },
  listenText: { color: colors.lavenderDark, fontWeight: '800', marginLeft: 6, fontSize: 14 },
  recordButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 12, backgroundColor: colors.lavender },
  recordText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  disabledButton: { backgroundColor: '#D1D5DB' },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 14 },
  progressDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.border, opacity: 0.35 },
  progressDotFilled: { backgroundColor: colors.lavender, opacity: 1 },
  micHint: { color: colors.inkSoft, fontSize: 13, marginBottom: 8, textAlign: 'center', lineHeight: 18, fontWeight: '600' },
  resultBubble: { marginTop: 8, borderRadius: 16, padding: 16, width: '100%' },
  correctBubble: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: colors.success },
  wrongBubble: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: colors.warning },
  resultText: { textAlign: 'center', fontWeight: '700', fontSize: 15 },
  analysisCard: { marginTop: 14, width: '100%', borderRadius: 20, padding: 18, backgroundColor: '#F8F7FF', borderWidth: 1, borderColor: '#D9D4F4', alignItems: 'center' },
  analysisTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  analysisScore: { color: colors.lavenderDark, fontWeight: '900', fontSize: 24, marginTop: 6 },
  analysisFeedback: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  analysisReward: { color: colors.success, fontWeight: '800', fontSize: 12, marginTop: 8 },
  doneBanner: { marginTop: 18, alignItems: 'center' },
  doneText: { fontWeight: '800', color: colors.textPrimary, fontSize: 15 },
  doneSubtext: { color: colors.textSecondary, marginTop: 4, fontSize: 13, textAlign: 'center' },
  completedTodayBanner: { marginTop: 12, padding: 16, width: '100%', borderRadius: 18, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: colors.success, alignItems: 'center' },
  completedTodayTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  completedTodayText: { color: colors.success, fontWeight: '800', fontSize: 15 },
  completedTodaySubtext: { color: colors.textSecondary, fontWeight: '600', marginTop: 4, textAlign: 'center', fontSize: 13 },
});
