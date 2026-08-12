import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { speakPhrase, stopSpeaking } from '../services/ttsService';
import { recordReadingContentAttempt } from '../services/readingContentService';
import {
  fetchModuleContent, fetchStudentModulePath, ModuleAssessmentAttempt,
  ModuleAssessmentResult, ModuleContentItem, ReadingModuleContent,
  ReadingModuleSummary, startModuleAssessment, StudentModulePath,
  submitModuleAssessment,
} from '../services/moduleService';

type Props = {
  firstName: string;
  onOpenSidebar: () => void;
  onPracticeItem: (item: ModuleContentItem) => void;
};

const stateMeta = {
  locked: { label: 'Naka-lock', icon: 'lock-closed' as const, color: colors.inkSoft, bg: '#EEEAE5' },
  unlocked: { label: 'Handa na', icon: 'play' as const, color: colors.lavenderDark, bg: '#EFECFB' },
  completed: { label: 'Kumpleto', icon: 'checkmark' as const, color: colors.sage, bg: '#E9F1E2' },
};

const contentTypeLabel = (type: string) => type === 'phonetic' ? 'Mga Tunog' : 'Mga Salita';

export default function StudentModules({ firstName, onOpenSidebar, onPracticeItem }: Props) {
  const [path, setPath] = useState<StudentModulePath | null>(null);
  const [detail, setDetail] = useState<ReadingModuleContent | null>(null);
  const [assessment, setAssessment] = useState<ModuleAssessmentAttempt | null>(null);
  const [result, setResult] = useState<ModuleAssessmentResult | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<Array<{ assessmentItemId: string; contentAttemptId: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadPath = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchStudentModulePath();
      setPath(next);
    } catch (nextError: any) {
      setError(nextError?.message || 'Hindi ma-load ang module path.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPath();
    return () => stopSpeaking();
  }, []);

  const openModule = async (module: ReadingModuleSummary) => {
    if (module.state === 'locked') return;
    setLoading(true);
    setError('');
    try {
      setDetail(await fetchModuleContent(module.id));
      setAssessment(null);
      setResult(null);
    } catch (nextError: any) {
      setError(nextError?.message || 'Hindi mabuksan ang module.');
    } finally {
      setLoading(false);
    }
  };

  const beginAssessment = async () => {
    const assessmentId = detail?.module.assessment_id;
    if (!assessmentId) return;
    setBusy(true);
    setError('');
    try {
      const next = await startModuleAssessment(assessmentId);
      setAssessment(next);
      setQuestionIndex(0);
      setResponses([]);
      setResult(null);
      setTimeout(() => speakPhrase(next.items[0]?.content_text || ''), 250);
    } catch (nextError: any) {
      setError(nextError?.message || 'Hindi masimulan ang pagsusulit.');
    } finally {
      setBusy(false);
    }
  };

  const currentQuestion = assessment?.items[questionIndex] || null;
  const choices = useMemo(() => {
    if (!assessment || !currentQuestion) return [];
    const ordered = [...assessment.items];
    const shift = (questionIndex + 1) % ordered.length;
    return [...ordered.slice(shift), ...ordered.slice(0, shift)];
  }, [assessment, currentQuestion, questionIndex]);

  const chooseAnswer = async (choiceText: string) => {
    if (!assessment || !currentQuestion || busy) return;
    setBusy(true);
    setError('');
    try {
      const correct = choiceText === currentQuestion.content_text;
      const recorded = await recordReadingContentAttempt({
        contentId: currentQuestion.content_id,
        accuracy: correct ? 100 : 0,
        transcript: choiceText,
        source: 'assessment',
      });
      const nextResponses = [...responses, {
        assessmentItemId: currentQuestion.assessment_item_id,
        contentAttemptId: recorded.result.attempt_id,
      }];
      if (questionIndex < assessment.items.length - 1) {
        const nextIndex = questionIndex + 1;
        setResponses(nextResponses);
        setQuestionIndex(nextIndex);
        setTimeout(() => speakPhrase(assessment.items[nextIndex].content_text), 200);
      } else {
        const submitted = await submitModuleAssessment(assessment.attempt_id, nextResponses);
        setResult(submitted);
        setAssessment(null);
        if (submitted.passed) await loadPath();
      }
    } catch (nextError: any) {
      setError(nextError?.message || 'Hindi na-save ang sagot. Subukan muli.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !path && !detail) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.lavenderDark} /></View>;
  }

  if (result) {
    return (
      <View style={styles.screen}>
        <LinearGradient colors={colors.heroGradient} style={styles.detailHero}>
          <Ionicons name={result.passed ? 'trophy' : 'refresh'} size={48} color="#fff" />
          <Text style={styles.resultTitle}>{result.passed ? 'Mahusay!' : 'Subukan muli'}</Text>
          <Text style={styles.resultScore}>{Math.round(result.score)}%</Text>
          <Text style={styles.resultSubtitle}>{result.passed ? 'Kumpleto na ang module at bukas na ang susunod.' : 'Kailangan ng 75% upang makapasa.'}</Text>
        </LinearGradient>
        <View style={styles.resultActions}>
          <TouchableOpacity style={styles.primaryButton} onPress={() => {
            setResult(null); setDetail(null); setAssessment(null); void loadPath();
          }}>
            <Text style={styles.primaryButtonText}>{result.passed ? 'Tingnan ang Susunod' : 'Bumalik sa Module'}</Text>
          </TouchableOpacity>
          {!result.passed && <TouchableOpacity style={styles.secondaryButton} onPress={() => { setResult(null); void beginAssessment(); }}>
            <Text style={styles.secondaryButtonText}>Ulitin ang Pagsusulit</Text>
          </TouchableOpacity>}
        </View>
      </View>
    );
  }

  if (assessment && currentQuestion) {
    return (
      <View style={styles.screen}>
        <LinearGradient colors={colors.heroGradient} style={styles.detailHero}>
          <TouchableOpacity style={styles.backButton} onPress={() => { setAssessment(null); stopSpeaking(); }}>
            <Ionicons name="arrow-back" size={20} color="#fff" /><Text style={styles.backText}>Module</Text>
          </TouchableOpacity>
          <Text style={styles.assessmentEyebrow}>PAGSUSULIT</Text>
          <Text style={styles.detailTitle}>Tanong {questionIndex + 1} sa {assessment.items.length}</Text>
          <Text style={styles.detailSubtitle}>Pakinggan at piliin ang tamang sagot.</Text>
        </LinearGradient>
        <ScrollView contentContainerStyle={styles.assessmentBody}>
          <View style={styles.questionProgress}><View style={[styles.questionProgressFill, { width: `${((questionIndex + 1) / assessment.items.length) * 100}%` }]} /></View>
          <TouchableOpacity style={styles.listenCard} onPress={() => speakPhrase(currentQuestion.content_text)}>
            <View style={styles.listenIcon}><Ionicons name="volume-high" size={30} color="#fff" /></View>
            <Text style={styles.listenTitle}>Pakinggan muli</Text>
            <Text style={styles.listenSubtitle}>I-tap para marinig ang tunog</Text>
          </TouchableOpacity>
          <View style={styles.choiceGrid}>
            {choices.map((choice) => <TouchableOpacity
              key={choice.assessment_item_id}
              style={styles.choiceCard}
              disabled={busy}
              onPress={() => void chooseAnswer(choice.content_text)}
            >
              <Text style={styles.choiceText}>{choice.content_text}</Text>
            </TouchableOpacity>)}
          </View>
          {busy && <ActivityIndicator color={colors.lavenderDark} />}
          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>
      </View>
    );
  }

  if (detail) {
    const completed = detail.items.filter((item) => item.completed).length;
    const ready = completed === detail.items.length;
    return (
      <View style={styles.screen}>
        <LinearGradient colors={colors.heroGradient} style={styles.detailHero}>
          <TouchableOpacity style={styles.backButton} onPress={() => { setDetail(null); setError(''); void loadPath(); }}>
            <Ionicons name="arrow-back" size={20} color="#fff" /><Text style={styles.backText}>Mga Module</Text>
          </TouchableOpacity>
          <Text style={styles.assessmentEyebrow}>MODYUL {detail.module.module_number} · {contentTypeLabel(detail.module.instructional_content_type).toUpperCase()}</Text>
          <Text style={styles.detailTitle}>{detail.module.title}</Text>
          <Text style={styles.detailSubtitle}>{detail.module.description}</Text>
        </LinearGradient>
        <ScrollView contentContainerStyle={styles.detailBody}>
          <View style={styles.progressCard}>
            <View style={styles.rowBetween}><Text style={styles.progressTitle}>Module Progress</Text><Text style={styles.progressCount}>{completed}/{detail.items.length}</Text></View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${detail.items.length ? (completed / detail.items.length) * 100 : 0}%` }]} /></View>
          </View>
          <Text style={styles.sectionTitle}>{contentTypeLabel(detail.module.instructional_content_type)}</Text>
          <View style={styles.contentGrid}>
            {detail.items.map((item) => <View key={item.content_id} style={[styles.contentCard, item.completed && styles.contentCardDone]}>
              <TouchableOpacity style={styles.soundButton} onPress={() => speakPhrase(item.content_text)}>
                <Ionicons name="volume-medium" size={18} color={colors.lavenderDark} />
              </TouchableOpacity>
              <Text style={styles.contentText}>{item.content_text}</Text>
              {!!item.syllable_hyphenation && item.syllable_hyphenation !== item.content_text && <Text style={styles.syllableText}>{item.syllable_hyphenation}</Text>}
              {!!item.definition && <Text style={styles.definitionText} numberOfLines={3}>{item.definition}</Text>}
              {item.completed ? <View style={styles.donePill}><Ionicons name="checkmark" size={12} color="#fff" /><Text style={styles.doneText}>Tapos</Text></View>
                : <TouchableOpacity style={styles.practiceButton} onPress={() => onPracticeItem(item)}><Text style={styles.practiceButtonText}>Bigkasin</Text></TouchableOpacity>}
            </View>)}
          </View>
          <TouchableOpacity style={[styles.primaryButton, !ready && styles.disabledButton]} disabled={!ready || busy} onPress={() => void beginAssessment()}>
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="school" size={18} color="#fff" /><Text style={styles.primaryButtonText}>Simulan ang Pagsusulit</Text></>}
          </TouchableOpacity>
          {!ready && <Text style={styles.helperText}>Tapusin muna ang lahat ng item upang mabuksan ang pagsusulit.</Text>}
          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient colors={colors.heroGradient} style={styles.pathHero}>
        <TouchableOpacity style={styles.menuButton} onPress={onOpenSidebar}><Ionicons name="menu" size={22} color="#fff" /></TouchableOpacity>
        <Text style={styles.heroEyebrow}>BEGINNER · PRESENTATION MVP</Text>
        <Text style={styles.heroTitle}>Tuloy ang pagkatuto, {firstName}!</Text>
        <Text style={styles.heroSubtitle}>Tapusin ang bawat module at pagsusulit upang mabuksan ang susunod.</Text>
      </LinearGradient>
      <ScrollView contentContainerStyle={styles.pathBody}>
        <View style={styles.scopeNote}><Ionicons name="information-circle" size={18} color={colors.lavenderDark} /><Text style={styles.scopeText}>Modules 1–5 are the presentation curriculum. More sounds and levels will follow.</Text></View>
        <Text style={styles.sectionTitle}>Ang Iyong Module Path</Text>
        {path?.modules.map((module, index) => {
          const meta = stateMeta[module.state];
          const pct = module.content_item_count ? Math.round((module.completed_content_item_count / module.content_item_count) * 100) : 0;
          return <View key={module.id} style={styles.moduleRow}>
            <View style={styles.rail}><View style={[styles.moduleNumber, { backgroundColor: meta.color }]}>{module.state === 'completed' ? <Ionicons name="checkmark" size={20} color="#fff" /> : <Text style={styles.moduleNumberText}>{module.module_number}</Text>}</View>{index < (path?.modules.length || 0) - 1 && <View style={[styles.railLine, module.state === 'completed' && { backgroundColor: colors.sage }]} />}</View>
            <TouchableOpacity style={[styles.moduleCard, module.state === 'locked' && styles.moduleCardLocked]} disabled={module.state === 'locked'} onPress={() => void openModule(module)}>
              <View style={styles.rowBetween}><View style={[styles.statePill, { backgroundColor: meta.bg }]}><Ionicons name={meta.icon} size={12} color={meta.color} /><Text style={[styles.stateText, { color: meta.color }]}>{meta.label}</Text></View><Ionicons name={module.state === 'locked' ? 'lock-closed' : 'chevron-forward'} size={20} color={meta.color} /></View>
              <Text style={styles.moduleTitle}>Modyul {module.module_number}: {module.title}</Text>
              <Text style={styles.moduleDescription}>{module.description}</Text>
              <Text style={styles.moduleMeta}>{module.content_item_count} {contentTypeLabel(module.instructional_content_type).toLowerCase()} · Pasa: {module.assessment_pass_percentage}%</Text>
              {module.state !== 'locked' && <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${module.state === 'completed' ? 100 : pct}%` }]} /></View>}
            </TouchableOpacity>
          </View>;
        })}
        {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><TouchableOpacity onPress={() => void loadPath()}><Text style={styles.retryText}>Subukan muli</Text></TouchableOpacity></View>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  pathHero: { paddingTop: 48, paddingHorizontal: spacing.xl, paddingBottom: 28, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  detailHero: { paddingTop: 46, paddingHorizontal: spacing.xl, paddingBottom: 25, minHeight: 190 },
  menuButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 22 },
  backText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  heroEyebrow: { color: '#F6E9FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  heroTitle: { color: '#fff', fontSize: 28, lineHeight: 33, fontFamily: typography.family.display },
  heroSubtitle: { color: '#F8EEFF', fontSize: 14, lineHeight: 20, marginTop: 7, maxWidth: 330 },
  assessmentEyebrow: { color: '#F6E9FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  detailTitle: { color: '#fff', fontSize: 27, fontFamily: typography.family.display, marginTop: 4 },
  detailSubtitle: { color: '#F8EEFF', fontSize: 14, lineHeight: 20, marginTop: 5 },
  pathBody: { padding: spacing.lg, paddingBottom: 36 },
  detailBody: { padding: spacing.lg, paddingBottom: 42 },
  assessmentBody: { padding: spacing.xl, paddingBottom: 42 },
  scopeNote: { flexDirection: 'row', gap: 9, backgroundColor: '#EFECFB', padding: 13, borderRadius: radius.sm, marginBottom: 20 },
  scopeText: { flex: 1, color: colors.inkSoft, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  sectionTitle: { color: colors.ink, fontSize: 18, fontFamily: typography.family.display, marginBottom: 13 },
  moduleRow: { flexDirection: 'row', alignItems: 'stretch' },
  rail: { width: 42, alignItems: 'center' },
  moduleNumber: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  moduleNumberText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  railLine: { flex: 1, width: 3, backgroundColor: '#D8D0C8', minHeight: 25 },
  moduleCard: { flex: 1, backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 15, ...shadows.card },
  moduleCardLocked: { opacity: 0.62, backgroundColor: '#F4F1EC' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  stateText: { fontSize: 10, fontWeight: '900' },
  moduleTitle: { color: colors.ink, fontSize: 16, fontFamily: typography.family.display, marginTop: 10 },
  moduleDescription: { color: colors.inkSoft, fontSize: 12, lineHeight: 17, marginTop: 4 },
  moduleMeta: { color: colors.lavenderDark, fontSize: 11, fontWeight: '800', marginTop: 10 },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#E9E4F2', overflow: 'hidden', marginTop: 11 },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.sage },
  progressCard: { backgroundColor: '#fff', borderRadius: radius.md, padding: 16, marginBottom: 22, ...shadows.card },
  progressTitle: { color: colors.ink, fontWeight: '800' },
  progressCount: { color: colors.lavenderDark, fontWeight: '900' },
  contentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  contentCard: { width: '48%', minHeight: 142, backgroundColor: '#fff', borderRadius: radius.md, padding: 14, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  contentCardDone: { backgroundColor: '#F0F7EC', borderWidth: 1, borderColor: '#CFE0C5' },
  soundButton: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  contentText: { color: colors.ink, fontSize: 25, fontFamily: typography.family.display, textAlign: 'center' },
  syllableText: { color: colors.lavenderDark, fontSize: 12, fontWeight: '800', marginTop: 2 },
  definitionText: { color: colors.inkSoft, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 6 },
  donePill: { flexDirection: 'row', gap: 3, alignItems: 'center', backgroundColor: colors.sage, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8 },
  doneText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  practiceButton: { borderRadius: radius.pill, backgroundColor: '#EFECFB', paddingHorizontal: 12, paddingVertical: 6, marginTop: 9 },
  practiceButtonText: { color: colors.lavenderDark, fontSize: 10, fontWeight: '900' },
  primaryButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.lavenderDark, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, ...shadows.raised },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondaryButton: { minHeight: 50, borderRadius: radius.md, borderWidth: 2, borderColor: colors.lavenderDark, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.lavenderDark, fontWeight: '900' },
  disabledButton: { opacity: 0.45 },
  helperText: { color: colors.inkSoft, fontSize: 11, textAlign: 'center', marginTop: 10 },
  questionProgress: { height: 8, borderRadius: 4, backgroundColor: '#E9E4F2', overflow: 'hidden', marginBottom: 24 },
  questionProgressFill: { height: '100%', backgroundColor: colors.lavenderDark },
  listenCard: { backgroundColor: '#fff', borderRadius: radius.xl, alignItems: 'center', padding: 24, marginBottom: 20, ...shadows.raised },
  listenIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.lavenderDark, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  listenTitle: { color: colors.ink, fontSize: 18, fontFamily: typography.family.display },
  listenSubtitle: { color: colors.inkSoft, fontSize: 12 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  choiceCard: { width: '48%', minHeight: 82, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 10, borderWidth: 2, borderColor: '#E5DDF2', ...shadows.card },
  choiceText: { color: colors.ink, fontSize: 22, fontFamily: typography.family.display, textAlign: 'center' },
  resultTitle: { color: '#fff', fontSize: 31, fontFamily: typography.family.display, marginTop: 10 },
  resultScore: { color: '#fff', fontSize: 52, fontFamily: typography.family.display },
  resultSubtitle: { color: '#F8EEFF', textAlign: 'center', lineHeight: 20 },
  resultActions: { padding: 24, gap: 14 },
  errorBox: { backgroundColor: '#FDECEC', borderRadius: radius.sm, padding: 14 },
  errorText: { color: colors.dangerText, textAlign: 'center', fontSize: 12, marginVertical: 8 },
  retryText: { color: colors.lavenderDark, textAlign: 'center', fontWeight: '900' },
});
