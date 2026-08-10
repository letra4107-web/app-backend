import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createScheduledActivity,
  updateScheduledActivity,
  deleteScheduledActivity,
  ScheduledActivity,
  ScheduledActivityType,
  ScheduledActivityStatus,
} from '../services/scheduledActivityService';
import { colors } from '../theme';

// BORDER/DANGER are intentionally NOT theme.colors.border/danger - both are
// slightly different one-off hex values, kept local rather than silently
// coerced onto a nearby-but-different color.
const BORDER = '#E7DFD0';
const DANGER = '#E0574C';

type ChildOption = { id: string; name: string };

type Props = {
  visible: boolean;
  date: string;
  childOptions: ChildOption[];
  defaultChildId?: string | null;
  editing: ScheduledActivity | null;
  onClose: () => void;
  onSaved: () => void;
};

const TYPE_OPTIONS: { key: ScheduledActivityType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'reading_lesson', label: 'Reading Lesson', icon: 'book-outline' },
  { key: 'practice', label: 'Practice', icon: 'mic-outline' },
  { key: 'reminder', label: 'Reminder', icon: 'alarm-outline' },
  { key: 'appointment', label: 'Appointment', icon: 'medical-outline' },
];

const TIME_OPTIONS: { key: string; label: string; value: string | null }[] = [
  { key: 'anytime', label: 'Anytime', value: null },
  { key: 'morning', label: 'Umaga', value: '08:00' },
  { key: 'afternoon', label: 'Tanghali', value: '13:00' },
  { key: 'evening', label: 'Gabi', value: '18:00' },
];

const STATUS_OPTIONS: { key: ScheduledActivityStatus; label: string }[] = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'missed', label: 'Missed' },
];

const timeValueToKey = (value: string | null | undefined) => {
  if (!value) return 'anytime';
  const hour = value.slice(0, 2);
  if (hour === '08') return 'morning';
  if (hour === '13') return 'afternoon';
  if (hour === '18') return 'evening';
  return 'anytime';
};

export default function AddScheduledActivityModal({
  visible,
  date,
  childOptions,
  defaultChildId,
  editing,
  onClose,
  onSaved,
}: Props) {
  const [childId, setChildId] = useState('');
  const [activityType, setActivityType] = useState<ScheduledActivityType>('reminder');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeKey, setTimeKey] = useState('anytime');
  const [status, setStatus] = useState<ScheduledActivityStatus>('scheduled');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setChildId(editing.child_id);
      setActivityType(editing.activity_type);
      setTitle(editing.title);
      setDescription(editing.description || '');
      setTimeKey(timeValueToKey(editing.start_time));
      setStatus(editing.status);
    } else {
      setChildId(defaultChildId || childOptions[0]?.id || '');
      setActivityType('reminder');
      setTitle('');
      setDescription('');
      setTimeKey('anytime');
      setStatus('scheduled');
    }
    setError('');
  }, [visible, editing, defaultChildId, childOptions]);

  const dateLabel = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  const busy = saving || deleting;

  const submit = async () => {
    if (!childId) {
      setError('Pumili muna ng bata.');
      return;
    }
    if (title.trim().length < 2) {
      setError('Ilagay ang pamagat ng activity.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const startTime = TIME_OPTIONS.find((option) => option.key === timeKey)?.value ?? null;
      if (editing) {
        await updateScheduledActivity(editing.id, {
          title: title.trim(),
          description: description.trim() || null,
          activityType,
          startTime,
          status,
        });
      } else {
        await createScheduledActivity({
          childId,
          activityType,
          title: title.trim(),
          description: description.trim() || undefined,
          scheduledDate: date,
          startTime: startTime || undefined,
          status: 'scheduled',
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Hindi ma-save ang activity.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setError('');
    setDeleting(true);
    try {
      await deleteScheduledActivity(editing.id);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Hindi ma-delete ang activity.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{editing ? 'I-edit ang Activity' : 'Magdagdag ng Activity'}</Text>
            <TouchableOpacity onPress={onClose} disabled={busy}>
              <Ionicons name="close" size={24} color={colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollArea}>
            {!!dateLabel && <Text style={styles.dateLabel}>{dateLabel}</Text>}

            {childOptions.length > 1 && (
              <>
                <Text style={styles.label}>Para kanino</Text>
                <View style={styles.chipRow}>
                  {childOptions.map((child) => (
                    <TouchableOpacity
                      key={child.id}
                      style={[styles.chip, childId === child.id && styles.chipActive]}
                      onPress={() => setChildId(child.id)}
                      disabled={!!editing}
                    >
                      <Text style={[styles.chipText, childId === child.id && styles.chipTextActive]}>
                        {child.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.label}>Uri</Text>
            <View style={styles.chipRow}>
              {TYPE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.typeChip, activityType === option.key && styles.chipActive]}
                  onPress={() => setActivityType(option.key)}
                >
                  <Ionicons
                    name={option.icon}
                    size={16}
                    color={activityType === option.key ? '#fff' : colors.lavenderDark}
                  />
                  <Text style={[styles.chipText, activityType === option.key && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Pamagat</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Hal. Magbasa ng 10 minuto"
              placeholderTextColor={colors.inkSoft}
            />

            <Text style={styles.label}>Tala (opsyonal)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Karagdagang detalye..."
              placeholderTextColor={colors.inkSoft}
              multiline
            />

            <Text style={styles.label}>Oras</Text>
            <View style={styles.chipRow}>
              {TIME_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.chip, timeKey === option.key && styles.chipActive]}
                  onPress={() => setTimeKey(option.key)}
                >
                  <Text style={[styles.chipText, timeKey === option.key && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!!editing && (
              <>
                <Text style={styles.label}>Status</Text>
                <View style={styles.chipRow}>
                  {STATUS_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.chip, status === option.key && styles.chipActive]}
                      onPress={() => setStatus(option.key)}
                    >
                      <Text style={[styles.chipText, status === option.key && styles.chipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <TouchableOpacity style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>{editing ? 'I-save ang Pagbabago' : 'Idagdag'}</Text>
            )}
          </TouchableOpacity>

          {!!editing && (
            <TouchableOpacity style={[styles.deleteButton, busy && styles.disabled]} onPress={remove} disabled={busy}>
              {deleting ? (
                <ActivityIndicator color={DANGER} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color={DANGER} />
                  <Text style={styles.deleteText}>Alisin</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  scrollArea: { maxHeight: 440 },
  dateLabel: { color: colors.inkSoft, fontWeight: '700', marginBottom: 10 },
  label: { marginTop: 14, marginBottom: 6, fontWeight: '700', color: colors.ink },
  input: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, fontSize: 15, color: colors.ink },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: colors.lavenderDark, borderColor: colors.lavenderDark },
  chipText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  error: { color: DANGER, marginTop: 10, fontWeight: '600' },
  submit: { backgroundColor: colors.lavenderDark, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16 },
  submitText: { color: '#fff', fontWeight: '800' },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
  },
  deleteText: { color: DANGER, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
