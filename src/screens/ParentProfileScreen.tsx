import React, { useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { updateProfile, uploadAvatar } from '../services/profileService';
import { colors, radius, typography } from '../theme';
import TabHeroHeader from '../components/TabHeroHeader';

type Props = {
  onGoBack: () => void;
  parentId: string;
  initialName: string;
  initialEmail: string;
  initialPhone: string;
  initialAvatarUrl: string | null;
  onProfileChanged: (profile: { full_name: string; phone_number: string; avatar_url: string | null }) => void;
};

export default function ParentProfileScreen({
  onGoBack, parentId, initialName, initialEmail, initialPhone, initialAvatarUrl, onProfileChanged,
}: Props) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const initials = (name || 'Magulang')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const showSuccess = (text: string) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 2400);
  };
  const showError = (text: string) => {
    setError(text);
    setMessage('');
  };

  const pickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showError('Kailangan ng photo library permission.');
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
      onProfileChanged({ full_name: name, phone_number: phone, avatar_url: publicUrl });
      showSuccess('Avatar updated.');
    } catch (e: any) {
      showError(e?.message || 'Hindi na-upload ang photo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    if (name.trim().length < 2) {
      showError('Ilagay ang buong pangalan.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        id: parentId,
        full_name: name.trim(),
        phone_number: phone.trim(),
        avatar_url: avatarUrl,
      });
      onProfileChanged({ full_name: name.trim(), phone_number: phone.trim(), avatar_url: avatarUrl });
      showSuccess('Profile saved.');
    } catch (e: any) {
      showError(e?.message || 'Hindi ma-save ang profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <TabHeroHeader
        onBackPress={onGoBack}
        title="My Profile"
        subtitle="I-manage ang iyong personal na detalye."
        illustration={require('../../assets/parentprofile.png')}
        illustrationStyle={styles.heroIllustrationSquare}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!!message && <Text style={styles.successBanner}>{message}</Text>}
        {!!error && <Text style={styles.errorBanner}>{error}</Text>}

        <View style={styles.card}>
          <View style={styles.profileTop}>
            <TouchableOpacity onPress={pickAvatar} style={styles.avatarWrap} disabled={uploadingAvatar}>
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
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{name || 'Unnamed user'}</Text>
              <Text style={styles.profileEmail}>{initialEmail}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personal na Detalye</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Buong pangalan"
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            style={[styles.input, styles.readOnlyInput]}
            value={initialEmail}
            editable={false}
            placeholder="Email"
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="Numero ng telepono (opsyonal)"
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={saveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save Profile</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroIllustrationSquare: { position: 'absolute', right: -4, bottom: -10, width: 128, height: 128 },
  content: { padding: 16, paddingBottom: 40 },
  successBanner: {
    color: '#166534', backgroundColor: 'rgba(34,197,94,0.10)', padding: 12, borderRadius: 14,
    marginBottom: 12, fontWeight: '700', borderLeftWidth: 4, borderLeftColor: colors.success,
  },
  errorBanner: {
    color: colors.dangerText, backgroundColor: '#FDECEC', padding: 12, borderRadius: 14,
    marginBottom: 12, fontWeight: '700', borderLeftWidth: 4, borderLeftColor: colors.coral,
  },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 16 },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  avatarPlaceholder: { backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.lavender, fontSize: 24, fontWeight: '900' },
  avatarEdit: {
    position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.lavenderDark, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
  },
  profileName: { fontSize: 18, fontWeight: '900', color: colors.ink },
  profileEmail: { color: colors.inkSoft, fontSize: 12, marginTop: 4 },
  cardTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 16, marginBottom: 12 },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: '#E5DDF2', borderRadius: radius.sm,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 12,
  },
  readOnlyInput: { backgroundColor: '#F8F7FC' },
  primaryButton: {
    backgroundColor: colors.lavenderDark, borderRadius: radius.md, paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '900' },
});
