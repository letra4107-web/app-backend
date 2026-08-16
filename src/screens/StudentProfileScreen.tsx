import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { fetchStudentProfile, setStudentAvatar, updateStudentProfile } from '../services/profileService';
import { fetchStudentModulePath, ReadingModuleSummary } from '../services/moduleService';
import { ACHIEVEMENTS } from '../services/achievementService';
import { DEFAULT_STUDENT_AVATARS, STUDENT_MODULE_AVATARS, studentAvatarSource } from '../utils/studentAvatar';
import { colors, radius, typography } from '../theme';
import TabHeroHeader from '../components/TabHeroHeader';

type Props = {
  navigation: any;
  onGoBack: () => void;
  gradeLevel?: number;
  readingLevel?: string;
  onProfileChanged?: (profile: { full_name?: string; avatar_url?: string | null; avatar_key?: string | null }) => void;
};

type ProfileState = {
  full_name?: string;
  phone_number?: string;
  avatar_url?: string | null;
  avatar_key?: string | null;
  achievements?: { id: string; unlockedAt?: string }[];
};

export default function StudentProfileScreen({ navigation, onGoBack, gradeLevel, readingLevel, onProfileChanged }: Props) {
  const [authUid, setAuthUid] = useState('');
  const [profile, setProfile] = useState<ProfileState>({});
  const [completedModules, setCompletedModules] = useState<ReadingModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const user = data.user;
        if (!user) {
          navigation.replace('Login');
          return;
        }
        const [profileData, modulePath] = await Promise.all([
          fetchStudentProfile(user.id, user),
          fetchStudentModulePath().catch((moduleError) => {
            console.warn('Could not load completed modules:', moduleError);
            return null;
          }),
        ]);
        if (!mounted) return;
        setAuthUid(user.id);
        setProfile({
          full_name: profileData?.full_name || profileData?.name || user.user_metadata?.display_name || '',
          phone_number: profileData?.phone_number || profileData?.phone || '',
          avatar_url: profileData?.avatar_url || null,
          avatar_key: profileData?.avatar_key || null,
          achievements: profileData?.achievements || [],
        });
        setCompletedModules(
          (modulePath?.modules || []).filter(
            (module) => module.state === 'completed' && !!STUDENT_MODULE_AVATARS[module.module_number],
          ),
        );
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Could not load profile. Please check your connection.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [navigation]);

  const initials = useMemo(() => {
    const name = profile.full_name || 'Student';
    return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  }, [profile.full_name]);
  const avatarSource = useMemo(
    () => studentAvatarSource(profile.avatar_key, profile.avatar_url),
    [profile.avatar_key, profile.avatar_url],
  );
  const unlockedBadges = useMemo(() => {
    const unlocked = new Set((profile.achievements || []).map((item) => item.id));
    return ACHIEVEMENTS.filter((badge) => unlocked.has(badge.id));
  }, [profile.achievements]);

  const showSuccess = (text: string) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 2400);
  };
  const showError = (text: string) => {
    setError(text);
    setMessage('');
  };

  const chooseAvatar = async (avatarKey: string) => {
    if (saving || avatarKey === profile.avatar_key) return;
    setSaving(true);
    try {
      await setStudentAvatar(avatarKey);
      const updatedProfile = { ...profile, avatar_key: avatarKey, avatar_url: null };
      setProfile(updatedProfile);
      onProfileChanged?.(updatedProfile);
      showSuccess('Avatar updated.');
    } catch (e: any) {
      showError(e?.message || 'Could not save avatar.');
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!authUid) return;
    if (!profile.full_name?.trim()) {
      showError('Full name is required.');
      return;
    }
    setSaving(true);
    try {
      await updateStudentProfile(authUid, {
        full_name: profile.full_name.trim(),
        phone: profile.phone_number,
        phone_number: profile.phone_number,
      });
      onProfileChanged?.({ ...profile, full_name: profile.full_name.trim() });
      showSuccess('Profile saved.');
    } catch (e: any) {
      showError(e?.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={colors.lavenderDark} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <TabHeroHeader
        onBackPress={onGoBack}
        title="Aking Profile"
        subtitle="Ipakita ang mga natapos mong parangal!"
        illustration={require('../../assets/trophy.webp')}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!!message && <Text style={styles.successBanner}>{message}</Text>}
        {!!error && <Text style={styles.errorBanner}>{error}</Text>}

        <View style={styles.summaryCard}>
          <View style={styles.profileTop}>
            {avatarSource ? (
              <Image source={avatarSource} style={styles.avatar} resizeMode="contain" />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{profile.full_name || 'Unnamed student'}</Text>
              <View style={styles.summaryBadgeRow}>
                {!!gradeLevel && (
                  <View style={styles.gradeBadge}><Text style={styles.gradeBadgeText}>Baitang {gradeLevel}</Text></View>
                )}
                {!!readingLevel && (
                  <View style={styles.levelBadge}><Text style={styles.levelBadgeText}>{readingLevel}</Text></View>
                )}
              </View>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Pumili ng icon</Text>
          <View style={styles.avatarGrid}>
            {DEFAULT_STUDENT_AVATARS.map((item) => {
              const selected = profile.avatar_key === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.avatarOption, selected && styles.avatarOptionSelected]}
                  onPress={() => void chooseAvatar(item.key)}
                  disabled={saving}
                  accessibilityLabel={`${item.label} avatar`}
                  accessibilityState={{ selected }}
                >
                  <Image source={item.image} style={styles.avatarOptionImage} resizeMode="contain" />
                  {selected && <View style={styles.avatarOptionCheck}><MaterialIcons name="check" size={12} color="#fff" /></View>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mga Nakuhang Badge</Text>
          <Text style={styles.cardHint}>Ipinapakita dito ang lahat ng natapos mong parangal.</Text>
          {unlockedBadges.length ? (
            <View style={styles.showcaseGrid}>
              {unlockedBadges.map((badge) => (
                <View key={badge.id} style={styles.showcaseItem}>
                  <View style={styles.showcaseImageWrap}>
                    <Image source={badge.image} style={styles.showcaseImage} resizeMode="contain" />
                  </View>
                  <Text style={styles.showcaseLabel} numberOfLines={2}>{badge.title}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Wala ka pang nakukuhang badge. Magpatuloy sa pagsasanay!</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mga Natapos na Modyul</Text>
          <Text style={styles.cardHint}>Ipinapakita dito ang lahat ng modyul na natapos mo.</Text>
          {completedModules.length ? (
            <View style={styles.showcaseGrid}>
              {completedModules.map((module) => (
                <View key={module.id} style={styles.showcaseItem}>
                  <View style={styles.showcaseImageWrap}>
                    <Image source={STUDENT_MODULE_AVATARS[module.module_number]} style={styles.showcaseImage} resizeMode="contain" />
                  </View>
                  <Text style={styles.showcaseLabel} numberOfLines={2}>Modyul {module.module_number}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Wala ka pang natapos na modyul. Simulan sa tab na Aralin!</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personal na Detalye</Text>
          <TextInput
            style={styles.input}
            value={profile.full_name || ''}
            onChangeText={(full_name) => setProfile((prev) => ({ ...prev, full_name }))}
            placeholder="Buong pangalan"
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            style={styles.input}
            value={profile.phone_number || ''}
            onChangeText={(phone_number) => setProfile((prev) => ({ ...prev, phone_number }))}
            keyboardType="phone-pad"
            placeholder="Numero ng telepono"
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={saveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>I-save ang Profile</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F1FB' },
  content: { padding: 16, paddingBottom: 40 },
  successBanner: {
    color: '#166534', backgroundColor: 'rgba(34,197,94,0.10)', padding: 12, borderRadius: 14,
    marginBottom: 12, fontWeight: '700', borderLeftWidth: 4, borderLeftColor: colors.success,
  },
  errorBanner: {
    color: colors.dangerText, backgroundColor: '#FDECEC', padding: 12, borderRadius: 14,
    marginBottom: 12, fontWeight: '700', borderLeftWidth: 4, borderLeftColor: colors.coral,
  },
  card: {
    backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 16,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  avatarPlaceholder: { backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.lavender, fontSize: 24, fontWeight: '900' },
  profileName: { fontSize: 18, fontWeight: '900', color: colors.ink },
  summaryBadgeRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  gradeBadge: { backgroundColor: '#EFECFB', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  gradeBadgeText: { color: colors.lavenderDark, fontWeight: '800', fontSize: 12 },
  levelBadge: { backgroundColor: '#E9F1E2', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  levelBadgeText: { color: colors.sage, fontWeight: '800', fontSize: 12 },
  sectionLabel: { color: colors.ink, fontSize: 12, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  avatarOption: {
    width: 58, height: 58, borderRadius: 18, backgroundColor: '#F8F7FC', borderWidth: 1.5,
    borderColor: '#E5DDF2', alignItems: 'center', justifyContent: 'center',
  },
  avatarOptionSelected: { borderColor: colors.lavenderDark, backgroundColor: '#EFECFB' },
  avatarOptionImage: { width: 46, height: 46 },
  avatarOptionCheck: {
    position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.lavenderDark, alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontFamily: typography.family.displaySemi, color: colors.ink, fontSize: 16 },
  cardHint: { color: colors.inkSoft, fontSize: 12, marginTop: 2, marginBottom: 12 },
  emptyText: { color: colors.inkSoft, fontSize: 12, fontStyle: 'italic' },
  showcaseGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  showcaseItem: { width: 78, alignItems: 'center' },
  showcaseImageWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: '#F8F7FC', borderWidth: 1.5,
    borderColor: '#E5DDF2', alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  showcaseImage: { width: 50, height: 50 },
  showcaseLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: '#E5DDF2', borderRadius: radius.sm,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.lavenderDark, borderRadius: radius.md, paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '900' },
});
