import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Ionicons } from '@expo/vector-icons';
import { buildApiUrl, postJson } from '../config/api';
import { syllabifyText } from '../utils/tagalogSyllabification';
import { WordOfDayLog } from '../services/wordOfDayService';
import { WordDefinition } from '../services/wordDefinitionsService';
import { speakPhrase } from '../services/ttsService';
import { speakWordCloud } from '../services/cloudTtsService';
import { FILIPINO_TTS_RATES } from '../services/filipinoTts';
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
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
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
      speakPhrase(phrase, {
        rate: FILIPINO_TTS_RATES.feedback,
        onError: setMessage,
        onDone: () => {
          if (!correct) {
            const target = log.word.replace(/-/g, ' ');
            speakWordCloud(target, {
              rate: FILIPINO_TTS_RATES.repeatCorrectWord,
              onError: setMessage,
              onDone: () => speakWordCloud(target, { rate: FILIPINO_TTS_RATES.repeatCorrectWord, onError: setMessage }),
            });
          }
        },
      });
      if (!correct) {
        // The two slow target-word repeats start only after the Filipino
        // encouragement finishes; see the onDone callback above.
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

  const beginRecording = async () => {
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

  const startRecording = async () => {
    if (isStartingRef.current || isListeningRef.current || processingRef.current) return;
    if (Platform.OS === 'web') {
      await beginRecording();
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (permission.granted) {
      const seenWalkthrough = await AsyncStorage.getItem('linawletra.voice-walkthrough-seen');
      if (seenWalkthrough) await beginRecording();
      else setShowWalkthrough(true);
      return;
    }
    setPermissionBlocked(permission.canAskAgain === false);
    setShowPermissionGuide(true);
  };

  const requestMicrophone = async () => {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!isMountedRef.current) return;
    if (!permission.granted) {
      setPermissionBlocked(permission.canAskAgain === false);
      setShowPermissionGuide(false);
      setMessage('Hindi magamit ang mikropono. Payagan ito para makapagsanay sa pagbasa.');
      return;
    }
    setShowPermissionGuide(false);
    const seenWalkthrough = await AsyncStorage.getItem('linawletra.voice-walkthrough-seen');
    if (seenWalkthrough) await beginRecording();
    else setShowWalkthrough(true);
  };

  const startFirstPractice = async () => {
    await AsyncStorage.setItem('linawletra.voice-walkthrough-seen', 'true');
    setShowWalkthrough(false);
    await beginRecording();
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
      <Modal transparent visible={showPermissionGuide} animationType="fade" onRequestClose={() => setShowPermissionGuide(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEmoji}>🎙️</Text>
            <Text style={styles.modalTitle}>{permissionBlocked ? 'Hindi magamit ang mikropono' : 'Kailangan namin ang mikropono'}</Text>
            <Text style={styles.modalText}>Ginagamit ang mikropono para marinig ang pagbasa mo at mabigyan ka ng feedback.</Text>
            {permissionBlocked ? (
              <TouchableOpacity style={styles.modalPrimaryButton} onPress={() => void Linking.openSettings()}>
                <Text style={styles.modalPrimaryText}>Buksan ang Settings</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.modalPrimaryButton} onPress={() => void requestMicrophone()}>
                <Text style={styles.modalPrimaryText}>Payagan ang Mikropono</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.modalSecondaryButton} onPress={() => setShowPermissionGuide(false)}>
              <Text style={styles.modalSecondaryText}>Mamaya na</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={showWalkthrough} animationType="fade" onRequestClose={() => setShowWalkthrough(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ganito lang kadali!</Text>
            <Text style={styles.walkthroughStep}>🎙️  1. Payagan ang mikropono</Text>
            <Text style={styles.walkthroughText}>Kailangan ito para marinig ang iyong pagbasa.</Text>
            <Text style={styles.walkthroughStep}>🗣️  2. Sabihin ang salita</Text>
            <Text style={styles.walkthroughText}>Basahin nang malinaw at dahan-dahan.</Text>
            <Text style={styles.walkthroughStep}>✨  3. Tingnan ang feedback</Text>
            <Text style={styles.walkthroughText}>Makikita mo kung paano pa mapapaganda ang iyong pagbasa.</Text>
            <TouchableOpacity style={styles.modalPrimaryButton} onPress={() => void startFirstPractice()}>
              <Text style={styles.modalPrimaryText}>Simulan ang Pagsasanay</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
          {!!definition && (
            <View style={styles.wordMeaningRow}>
              <Text style={styles.wordMeaning}>{definition.meaning_fil}</Text>
              <TouchableOpacity
                style={styles.meaningPlayButton}
                onPress={() => speakPhrase([definition.meaning_fil, definition.example_sentence].filter(Boolean).join(' '), {
                  bypassToggle: true,
                  rate: FILIPINO_TTS_RATES.meaning,
                  onError: setMessage,
                })}
                accessibilityRole="button"
                accessibilityLabel="Pakinggan ang kahulugan"
              >
                <Ionicons name="volume-high" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
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

            {!!message && message.startsWith('Hindi magamit ang mikropono') && (
              <TouchableOpacity style={styles.settingsButton} onPress={() => setShowPermissionGuide(true)}>
                <Text style={styles.settingsButtonText}>Subukan Muli</Text>
              </TouchableOpacity>
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
  chip: { backgroundColor: '#E5F1EF', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: colors.lavenderDark, fontWeight: '700', fontSize: 12 },
  wordCard: { backgroundColor: '#E5F1EF', borderRadius: 24, padding: 18, alignItems: 'center', marginBottom: 20 },
  wordLabel: { color: colors.lavender, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  word: { fontFamily: typography.family.display, fontSize: 46, color: colors.lavenderDark, letterSpacing: 1.6, textAlign: 'center', lineHeight: 52 },
  wordMeaningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  wordMeaning: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18, maxWidth: '78%' },
  meaningPlayButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  recommendationBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E5F1EF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
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
  analysisCard: { marginTop: 14, width: '100%', borderRadius: 20, padding: 18, backgroundColor: '#E5F1EF', borderWidth: 1, borderColor: '#DDDCD5', alignItems: 'center' },
  analysisTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  analysisScore: { color: colors.lavenderDark, fontWeight: '900', fontSize: 24, marginTop: 6 },
  analysisFeedback: { color: colors.inkSoft, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  analysisReward: { color: colors.success, fontWeight: '800', fontSize: 12, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(43, 35, 57, 0.48)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 28, padding: 24, alignItems: 'center' },
  modalEmoji: { fontSize: 38, marginBottom: 8 },
  modalTitle: { color: colors.ink, fontFamily: typography.family.display, fontSize: 22, textAlign: 'center', marginBottom: 10 },
  modalText: { color: colors.inkSoft, fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  modalPrimaryButton: { width: '100%', minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.lavenderDark, borderRadius: 16, paddingHorizontal: 14, marginTop: 12 },
  modalPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  modalSecondaryButton: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  modalSecondaryText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 14 },
  walkthroughStep: { alignSelf: 'stretch', color: colors.ink, fontWeight: '900', fontSize: 15, marginTop: 10 },
  walkthroughText: { alignSelf: 'stretch', color: colors.inkSoft, fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 3 },
  settingsButton: { alignSelf: 'center', minHeight: 42, justifyContent: 'center', marginTop: 8, paddingHorizontal: 12 },
  settingsButtonText: { color: colors.lavenderDark, fontWeight: '900', textDecorationLine: 'underline' },
  doneBanner: { marginTop: 18, alignItems: 'center' },
  doneText: { fontWeight: '800', color: colors.textPrimary, fontSize: 15 },
  doneSubtext: { color: colors.textSecondary, marginTop: 4, fontSize: 13, textAlign: 'center' },
  completedTodayBanner: { marginTop: 12, padding: 16, width: '100%', borderRadius: 18, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: colors.success, alignItems: 'center' },
  completedTodayTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  completedTodayText: { color: colors.success, fontWeight: '800', fontSize: 15 },
  completedTodaySubtext: { color: colors.textSecondary, fontWeight: '600', marginTop: 4, textAlign: 'center', fontSize: 13 },
});
