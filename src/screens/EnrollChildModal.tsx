import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildApiUrl, postJson } from '../config/api';
import { colors, radius, typography } from '../theme';

type ReadingDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

type Props = {
  visible: boolean;
  onClose: () => void;
  onEnrolled: () => void;
};

const GRADES = [1, 2, 3, 4, 5, 6] as const;

export const difficultyForGrade = (grade: number): ReadingDifficulty => {
  if (grade <= 2) return 'Beginner';
  if (grade <= 4) return 'Intermediate';
  return 'Advanced';
};

export default function EnrollChildModal({ visible, onClose, onEnrolled }: Props) {
  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const difficulty = useMemo(
    () => gradeLevel == null ? null : difficultyForGrade(gradeLevel),
    [gradeLevel],
  );

  const reset = () => {
    setName('');
    setGradeLevel(null);
    setErrors({});
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Ilagay ang buong pangalan.';
    if (gradeLevel == null) next.gradeLevel = 'Pumili ng grade level.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate() || gradeLevel == null) return;
    setSaving(true);
    setErrors({});
    try {
      await postJson(buildApiUrl('/auth/enroll-child'), {
        childName: name.trim(),
        gradeLevel,
      }, 30000);
      reset();
      onEnrolled();
      onClose();
    } catch (error: any) {
      setErrors({ general: error?.data?.message || error?.message || 'Hindi naisama ang bata. Subukan muli.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>I-enroll ang Bata</Text>
              <Text style={styles.subtitle}>Pangalan at grade level lang ang kailangan.</Text>
            </View>
            <TouchableOpacity onPress={close} disabled={saving} accessibilityLabel="Isara">
              <Ionicons name="close" size={24} color={colors.ink} />
            </TouchableOpacity>
          </View>

          {!!errors.general && <Text style={styles.errorBanner}>{errors.general}</Text>}

          <Text style={styles.label}>Pangalan ng Estudyante</Text>
          <TextInput
            style={[styles.input, !!errors.name && styles.inputError]}
            value={name}
            onChangeText={setName}
            placeholder="Hal. Ana Maliksi"
            placeholderTextColor={colors.inkSoft}
            autoCapitalize="words"
          />
          {!!errors.name && <Text style={styles.error}>{errors.name}</Text>}

          <Text style={styles.label}>Antas ng Baitang</Text>
          <View style={styles.gradeGrid}>
            {GRADES.map((grade) => {
              const selected = gradeLevel === grade;
              return (
                <TouchableOpacity
                  key={grade}
                  style={[styles.gradeButton, selected && styles.gradeButtonActive]}
                  onPress={() => setGradeLevel(grade)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.gradeText, selected && styles.gradeTextActive]}>Baitang {grade}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!!errors.gradeLevel && <Text style={styles.error}>{errors.gradeLevel}</Text>}

          {difficulty && (
            <View style={styles.levelCard}>
              <Ionicons name="sparkles" size={20} color={colors.lavenderDark} />
              <View style={{ flex: 1 }}>
                <Text style={styles.levelLabel}>Awtomatikong reading level</Text>
                <Text style={styles.levelValue}>{difficulty}</Text>
              </View>
            </View>
          )}

          <TouchableOpacity style={[styles.submit, saving && styles.disabled]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>I-enroll ang Bata</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>Awtomatikong gagawin at ipapadala sa email ang student login credentials.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,23,66,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 20, paddingBottom: 28, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  title: { fontSize: typography.size.title, fontFamily: typography.family.display, color: colors.ink },
  subtitle: { color: colors.inkSoft, fontSize: typography.size.small, marginTop: 2 },
  label: { marginTop: 12, marginBottom: 6, fontWeight: '800', color: colors.ink },
  input: { borderWidth: 1.5, borderColor: '#DDD6EB', borderRadius: radius.sm, padding: 12, fontSize: 15, color: colors.ink },
  inputError: { borderColor: colors.danger },
  gradeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gradeButton: { width: '31%', borderWidth: 1.5, borderColor: '#DDD6EB', borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
  gradeButtonActive: { backgroundColor: colors.lavenderDark, borderColor: colors.lavenderDark },
  gradeText: { color: colors.ink, fontWeight: '800', fontSize: 12 },
  gradeTextActive: { color: '#fff' },
  levelCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EFECFB', borderRadius: radius.sm, padding: 13, marginTop: 16 },
  levelLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '700' },
  levelValue: { color: colors.lavenderDark, fontWeight: '900', fontSize: 15, marginTop: 1 },
  error: { color: colors.dangerText, marginTop: 5, fontSize: 12 },
  errorBanner: { color: colors.dangerText, backgroundColor: '#FDECEC', borderRadius: radius.sm, padding: 11, fontWeight: '700' },
  submit: { backgroundColor: colors.lavenderDark, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontWeight: '900' },
  hint: { color: colors.inkSoft, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 9 },
  disabled: { opacity: 0.65 },
});
