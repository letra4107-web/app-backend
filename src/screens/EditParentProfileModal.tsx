import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { updateProfile, uploadAvatar } from '../services/profileService';

const LAVENDER = '#7C6FCF';
const LAVENDER_DARK = '#5F52B0';
const INK = '#3B322C';
const INK_SOFT = '#8A8078';
const BORDER = '#E7DFD0';
const DANGER = '#E0574C';

type Props = {
  visible: boolean;
  parentId: string;
  initialName: string;
  initialPhone: string;
  initialAvatarUrl: string | null;
  onClose: () => void;
  onSaved: (profile: { full_name: string; phone_number: string; avatar_url: string | null }) => void;
};

export default function EditParentProfileModal({
  visible,
  parentId,
  initialName,
  initialPhone,
  initialAvatarUrl,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setPhone(initialPhone);
    setAvatarUrl(initialAvatarUrl);
    setError('');
  }, [visible, initialName, initialPhone, initialAvatarUrl]);

  const initials = (name || 'Magulang')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const pickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Kailangan ng photo library permission.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.75,
        allowsEditing: true,
        aspect: [1, 1],
      });
      const canceled = 'canceled' in result ? result.canceled : (result as any).cancelled;
      const uri = result.assets?.[0]?.uri || (result as any).uri;
      const mimeType = result.assets?.[0]?.mimeType;
      if (canceled || !uri) return;
      setUploadingAvatar(true);
      const publicUrl = await uploadAvatar(parentId, uri, mimeType);
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      setError(err?.message || 'Hindi na-upload ang photo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      setError('Ilagay ang buong pangalan.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await updateProfile({
        id: parentId,
        full_name: name.trim(),
        phone_number: phone.trim(),
        avatar_url: avatarUrl,
      });
      onSaved({ full_name: name.trim(), phone_number: phone.trim(), avatar_url: avatarUrl });
    } catch (err: any) {
      setError(err?.message || 'Hindi ma-save ang profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>I-edit ang Profile</Text>
            <TouchableOpacity onPress={onClose} disabled={saving}>
              <Ionicons name="close" size={24} color={INK} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} disabled={uploadingAvatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
            <View style={styles.avatarEdit}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera" size={14} color="#fff" />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.label}>Buong Pangalan</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Hal. Maria Dela Cruz" placeholderTextColor={INK_SOFT} />

          <Text style={styles.label}>Numero ng Telepono</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="Opsyonal"
            placeholderTextColor={INK_SOFT}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={[styles.submit, saving && styles.disabled]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>I-save</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: INK },
  avatarWrap: { alignSelf: 'center', marginBottom: 16 },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarPlaceholder: { backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: LAVENDER, fontSize: 30, fontWeight: '900' },
  avatarEdit: {
    position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15,
    backgroundColor: LAVENDER_DARK, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
  },
  label: { marginTop: 12, marginBottom: 6, fontWeight: '700', color: INK },
  input: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, fontSize: 15, color: INK },
  error: { color: DANGER, marginTop: 10, fontWeight: '600' },
  submit: { backgroundColor: LAVENDER_DARK, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 18 },
  submitText: { color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.6 },
});
