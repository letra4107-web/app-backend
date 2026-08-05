import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildApiUrl, postJson } from '../config/api';
import { supabase } from '../config/supabase';

type ReadingDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

type Props = {
  visible: boolean;
  onClose: () => void;
  onEnrolled: () => void;
};

const PRIMARY = '#4A90E2';
const DIFFICULTIES: ReadingDifficulty[] = ['Beginner', 'Intermediate', 'Advanced'];
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

const ageToGrade = (age: number) => {
  if (age <= 6) return 1;
  if (age >= 12) return 7;
  return Math.max(1, Math.min(7, age - 5));
};

const makePassword = () =>
  Array.from({ length: 8 }, () => PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)]).join('');

const makeBaseUsername = (name: string) => {
  const parts = name.trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const first = parts[0] || 'bata';
  const last = parts.length > 1 ? parts[parts.length - 1] : first;
  return `${first[0] || 'b'}${last}`.replace(/\s+/g, '');
};

export default function EnrollChildModal({ visible, onClose, onEnrolled }: Props) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [difficulty, setDifficulty] = useState<ReadingDifficulty>('Beginner');
  const [placementOverrideReason, setPlacementOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');

  const gradeLevel = useMemo(() => {
    const numericAge = Number(age);
    return Number.isFinite(numericAge) ? ageToGrade(numericAge) : 1;
  }, [age]);

  const reset = () => {
    setName('');
    setAge('');
    setDifficulty('Beginner');
    setPlacementOverrideReason('');
    setErrors({});
    setSuccess('');
  };

  const getAvailableUsername = async () => {
    const base = makeBaseUsername(name);
    for (let suffix = 0; suffix < 50; suffix += 1) {
      const username = `${base}${suffix === 0 ? '' : suffix + 1}@linawletra.edu.ph`;
      const { data, error } = await supabase.from('children').select('id').eq('username', username).maybeSingle();
      if (error) throw error;
      if (!data) return username;
    }
    return `${base}${Date.now()}@linawletra.edu.ph`;
  };

  const validate = () => {
    const next: Record<string, string> = {};
    const numericAge = Number(age);
    if (name.trim().length < 2) next.name = 'Ilagay ang buong pangalan.';
    if (!Number.isInteger(numericAge) || numericAge < 4 || numericAge > 18) next.age = 'Edad ay dapat 4 hanggang 18.';
    if (difficulty !== 'Beginner' && placementOverrideReason.trim().length < 10) {
      next.placementOverrideReason = 'Maglagay ng malinaw na dahilan (hindi bababa sa 10 character).';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    setSuccess('');
    setErrors({});
    try {
      const username = await getAvailableUsername();
      const password = makePassword();
      await postJson(buildApiUrl('/auth/enroll-child'), {
        childName: name.trim(),
        age: Number(age),
        readingDifficulty: difficulty,
        placementOverrideReason: difficulty === 'Beginner' ? null : placementOverrideReason.trim(),
        gradeLevel,
        username,
        password,
      }, 30000);
      setSuccess('Naka-enroll na ang bata. Naipadala ang credentials sa email ng magulang.');
      reset();
      onEnrolled();
    } catch (error: any) {
      setErrors({ general: error?.data?.message || 'Hindi naisama ang bata. Subukan muli.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>I-enroll ang Bata</Text>
            <TouchableOpacity onPress={onClose} disabled={saving}>
              <Ionicons name="close" size={24} color="#1F2937" />
            </TouchableOpacity>
          </View>

          {!!success && <Text style={styles.success}>{success}</Text>}
          {!!errors.general && <Text style={styles.error}>{errors.general}</Text>}

          <Text style={styles.label}>Buong Pangalan</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Hal. Ana Maliksi" />
          {!!errors.name && <Text style={styles.error}>{errors.name}</Text>}

          <Text style={styles.label}>Edad</Text>
          <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="number-pad" placeholder="4-18" />
          {!!errors.age && <Text style={styles.error}>{errors.age}</Text>}

          <Text style={styles.label}>Starting Reading Level</Text>
          <View style={styles.segmentRow}>
            {DIFFICULTIES.map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.segment, difficulty === item && styles.segmentActive]}
                onPress={() => setDifficulty(item)}
              >
                <Text style={[styles.segmentText, difficulty === item && styles.segmentTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {difficulty !== 'Beginner' && (
            <>
              <Text style={styles.label}>Placement Override Reason</Text>
              <TextInput
                style={[styles.input, { minHeight: 76, textAlignVertical: 'top' }]}
                value={placementOverrideReason}
                onChangeText={setPlacementOverrideReason}
                placeholder="Hal. Resulta ng teacher-administered placement assessment"
                multiline
              />
              {!!errors.placementOverrideReason && <Text style={styles.error}>{errors.placementOverrideReason}</Text>}
              <Text style={styles.hint}>Ang non-Beginner placement ay ise-save bilang audited override; walang completion na gagawin.</Text>
            </>
          )}

          <Text style={styles.hint}>Grade Level: {gradeLevel}</Text>

          <TouchableOpacity style={[styles.submit, saving && styles.disabled]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>I-save at I-email ang Credentials</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#1F2937' },
  label: { marginTop: 12, marginBottom: 6, fontWeight: '700', color: '#374151' },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, fontSize: 16 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  segmentActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  segmentText: { color: '#374151', fontWeight: '700', fontSize: 12 },
  segmentTextActive: { color: '#fff' },
  hint: { marginTop: 12, color: '#4B5563' },
  error: { color: '#E74C3C', marginTop: 6 },
  success: { color: '#27AE60', marginBottom: 8, fontWeight: '700' },
  submit: { backgroundColor: PRIMARY, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20 },
  submitText: { color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.7 },
});
