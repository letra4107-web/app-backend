import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { supabase } from '../config/supabase';
import { fetchProfile, updateProfile, uploadAvatar } from '../services/profileService';
import {
  changeEmail,
  changePassword,
  DashboardSettings,
  fetchDashboardSettings,
  FontSize,
  ReadingTheme,
  SpeechRate,
  SettingsRole,
  signOut,
  updateDashboardSettings,
} from '../services/settingsService';
import { setTtsEnabled, setSpeechRateSetting } from '../services/ttsService';

const BG = '#F4F1FB';
const SURFACE = '#ffffff';
const MUTED = '#6b7280';
// Shared token set — matches the palette established across the Home/Learn/
// Practice/Progress/Badges tabs, so Settings doesn't feel like a different app.
const INK = '#3B322C';
const INK_SOFT = '#8A7B6C';
const LAVENDER = '#7C6FCF';
const LAVENDER_DARK = '#5F52B0';
const CORAL = '#E06B4C';
const SUN = '#E3971A';
const SAGE = '#5C8047';
const DANGER = '#ef4444';
const SUCCESS = '#10b981';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';
// Cycled per-section (never per-row) so adjacent sections read as visually
// distinct while staying inside the same 4-color family used elsewhere.
const SECTION_ACCENTS = [LAVENDER, CORAL, SUN, SAGE];

type Props = {
  role: SettingsRole;
  navigation: any;
  embedded?: boolean;
  gradeLevel?: number;
  readingLevel?: string;
};

type MicPermissionState = 'checking' | 'granted' | 'denied';

type ProfileState = {
  id?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  avatar_url?: string | null;
};

type AccountModal = 'password' | 'email' | null;

export default function DashboardSettingsScreen({ role, navigation, embedded = false, gradeLevel, readingLevel }: Props) {
  const [authUid, setAuthUid] = useState('');
  const [profile, setProfile] = useState<ProfileState>({});
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<AccountModal>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [micPermission, setMicPermission] = useState<MicPermissionState>('checking');
  const fade = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const profileSectionY = useRef(0);

  const isParent = role === 'parent';
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const systemScheme = useColorScheme();
  const theme: ReadingTheme = settings?.reading_theme === 'sepia' ? 'light' : (settings?.reading_theme || 'light');
  const dark = theme === 'system' ? systemScheme === 'dark' : theme === 'dark';

  useEffect(() => {
    let mounted = true;
    ExpoSpeechRecognitionModule.getPermissionsAsync()
      .then((res) => {
        if (mounted) setMicPermission(res.granted ? 'granted' : 'denied');
      })
      .catch(() => {
        if (mounted) setMicPermission('denied');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const requestMicPermission = async () => {
    try {
      const res = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      setMicPermission(res.granted ? 'granted' : 'denied');
    } catch {
      setMicPermission('denied');
    }
  };

  const scrollToProfile = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, profileSectionY.current - 12), animated: true });
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
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
        const [profileData, settingsData] = await Promise.all([
          fetchProfile(user.id),
          fetchDashboardSettings(user.id, role),
        ]);
        if (!mounted) return;
        setAuthUid(user.id);
        setProfile({
          id: user.id,
          full_name: profileData?.full_name || profileData?.name || user.user_metadata?.display_name || '',
          email: profileData?.email || user.email || '',
          phone: profileData?.phone || profileData?.phone_number || '',
          phone_number: profileData?.phone_number || profileData?.phone || '',
          avatar_url: profileData?.avatar_url || null,
        });
        setSettings(settingsData);
        setTtsEnabled(settingsData.tts_enabled);
        setSpeechRateSetting(settingsData.speech_rate || 'normal');
        setNewEmail(user.email || '');
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Could not load settings. Please check your connection.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [fade, navigation, role]);

  const initials = useMemo(() => {
    const name = profile.full_name || (isParent ? 'Parent' : 'Student');
    return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  }, [isParent, profile.full_name]);

  const showSuccess = (text: string) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 2400);
  };

  const showError = (text: string) => {
    setError(text);
    setMessage('');
  };

  const saveProfile = async () => {
    if (!authUid) return;
    if (!profile.full_name?.trim()) {
      showError('Full name is required.');
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({
        id: authUid,
        full_name: profile.full_name.trim(),
        name: profile.full_name.trim(),
        email: profile.email,
        phone: profile.phone_number || profile.phone,
        phone_number: profile.phone_number || profile.phone,
        avatar_url: profile.avatar_url,
      });
      showSuccess('Profile saved.');
    } catch (e: any) {
      showError(e?.message || 'Could not save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const pickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showError('Photo library permission is required.');
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
      setSavingProfile(true);
      const publicUrl = await uploadAvatar(authUid, uri, mimeType);
      setProfile((prev) => ({ ...prev, avatar_url: publicUrl }));
      showSuccess('Profile photo updated.');
    } catch (e: any) {
      showError(e?.message || 'Could not upload profile photo.');
    } finally {
      setSavingProfile(false);
    }
  };

  const updateSetting = async <K extends keyof DashboardSettings>(key: K, value: DashboardSettings[K]) => {
    if (!authUid || !settings) return;
    const previous = settings;
    setSettings({ ...settings, [key]: value });
    if (key === 'tts_enabled') setTtsEnabled(!!value);
    if (key === 'speech_rate') setSpeechRateSetting(value as SpeechRate);
    setSavingKey(String(key));
    try {
      const saved = await updateDashboardSettings(authUid, role, { [key]: value } as Partial<DashboardSettings>);
      setSettings(saved);
      showSuccess('Setting saved.');
    } catch (e: any) {
      setSettings(previous);
      showError(e?.message || 'Could not save setting. Changes were reverted.');
      if (key === 'tts_enabled') setTtsEnabled(!!previous.tts_enabled);
      if (key === 'speech_rate') setSpeechRateSetting((previous.speech_rate || 'normal') as SpeechRate);
    } finally {
      setSavingKey(null);
    }
  };

  const submitPassword = async () => {
    if (newPassword.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }
    setSavingKey('password');
    try {
      await changePassword(newPassword);
      setNewPassword('');
      setModal(null);
      showSuccess('Password updated.');
    } catch (e: any) {
      showError(e?.message || 'Could not update password.');
    } finally {
      setSavingKey(null);
    }
  };

  const submitEmail = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      showError('Enter a valid email address.');
      return;
    }
    setSavingKey('email');
    try {
      await changeEmail(trimmed);
      setProfile((prev) => ({ ...prev, email: trimmed }));
      setModal(null);
      showSuccess('Check your inbox to confirm the new email.');
    } catch (e: any) {
      showError(e?.message || 'Could not update email.');
    } finally {
      setSavingKey(null);
    }
  };

  const logout = async () => {
    try {
      await signOut();
      navigation.replace('Login');
    } catch (e: any) {
      showError(e?.message || 'Could not log out.');
    }
  };

  const contactSupport = async () => {
    const subject = encodeURIComponent(`LinawLetra support - ${isParent ? 'Parent' : 'Student'} account`);
    const body = encodeURIComponent(`User ID: ${authUid}\n\nHow can we help?`);
    const url = `mailto:support@linawletra.app?subject=${subject}&body=${body}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
    else showError('No email app is available on this device.');
  };

  const confirmLogout = () => {
    if (Platform.OS === 'web') {
      void logout();
      return;
    }
    Alert.alert('Log out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: logout },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete account',
      'Account deletion needs a secure server-side admin endpoint. Contact support to request deletion.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Contact support', onPress: contactSupport },
      ],
    );
  };

  const renderSwitch = (key: keyof DashboardSettings, value?: boolean) => (
    <Switch
      value={!!value}
      onValueChange={(next) => updateSetting(key, next as any)}
      disabled={savingKey === String(key)}
      trackColor={{ false: '#cbd5e1', true: 'rgba(124,111,207,0.4)' }}
      thumbColor={value ? LAVENDER : '#f8fafc'}
    />
  );

  const renderSegment = <T extends string>(key: keyof DashboardSettings, value: T, options: T[]) => (
    <View style={styles.segment}>
      {options.map((item) => {
        const active = item === value;
        return (
          <TouchableOpacity
            key={item}
            style={[styles.segmentButton, active && styles.segmentButtonActive]}
            onPress={() => updateSetting(key, item as any)}
            disabled={savingKey === String(key)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{item}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  let sectionAccentIndex = -1;

  const Section = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => {
    sectionAccentIndex += 1;
    const accent = SECTION_ACCENTS[sectionAccentIndex % SECTION_ACCENTS.length];
    return (
      <View style={[styles.card, dark && styles.cardDark]}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIcon, { backgroundColor: `${accent}22` }]}>
            <MaterialIcons name={icon as any} size={20} color={accent} />
          </View>
          <Text style={[styles.sectionTitle, dark && styles.textDark]}>{title}</Text>
        </View>
        {children}
      </View>
    );
  };

  const Row = ({
    icon,
    title,
    subtitle,
    right,
    onPress,
    danger,
  }: {
    icon: string;
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
    onPress?: () => void;
    danger?: boolean;
  }) => (
    <TouchableOpacity style={styles.row} activeOpacity={onPress ? 0.72 : 1} onPress={onPress}>
      <MaterialIcons name={icon as any} size={22} color={danger ? DANGER : LAVENDER_DARK} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, dark && styles.textDark, danger && { color: DANGER }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.rowSubtitle, dark && styles.mutedDark]}>{subtitle}</Text>}
      </View>
      {right}
    </TouchableOpacity>
  );

  if (loading || !settings) {
    return (
      <View style={[styles.center, dark && styles.containerDark]}>
        <ActivityIndicator size="large" color={LAVENDER} />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, dark && styles.containerDark, { opacity: fade }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          {!embedded && (
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={22} color={LAVENDER} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, dark && styles.textDark]}>{isParent ? 'Parent Settings' : 'Settings'}</Text>
            <Text style={[styles.subtitle, dark && styles.mutedDark]}>Make LinawLetra work best for you.</Text>
          </View>
          <TouchableOpacity onPress={scrollToProfile}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, styles.avatarPlaceholder]}>
                <Text style={styles.headerAvatarInitial}>{initials}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {!!message && <Text style={styles.successBanner}>{message}</Text>}
        {!!error && <Text style={styles.errorBanner}>{error}</Text>}

        <View style={[styles.card, dark && styles.cardDark, styles.summaryCard]}>
          <View style={styles.profileTop}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.profileName, dark && styles.textDark]}>{profile.full_name || 'Unnamed user'}</Text>
              <View style={styles.summaryBadgeRow}>
                {!!gradeLevel && (
                  <View style={styles.gradeBadge}>
                    <Text style={styles.gradeBadgeText}>Grade {gradeLevel}</Text>
                  </View>
                )}
                {!!readingLevel && (
                  <View style={styles.levelBadge}>
                    <Text style={styles.levelBadgeText}>{readingLevel}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.viewProfileButton} onPress={scrollToProfile}>
            <Text style={styles.viewProfileButtonText}>View Profile</Text>
          </TouchableOpacity>
        </View>

        {!isParent && (
          <>
            <Section title="Reading Accessibility" icon="accessibility-new">
              <Row icon="text-fields" title="Dyslexia-friendly font" subtitle="Use an easier-to-read font" right={renderSwitch('dyslexia_font', settings.dyslexia_font)} />
              <Row icon="format-size" title="Text Size" subtitle={settings.font_size} right={renderSegment<FontSize>('font_size', settings.font_size, ['small', 'medium', 'large'])} />
              <Row icon="contrast" title="High contrast mode" right={renderSwitch('high_contrast', settings.high_contrast)} />
              <Row icon="view-day" title="Reading guide overlay" right={renderSwitch('reading_guide', settings.reading_guide)} />
            </Section>

            <Section title="Reading & Audio" icon="volume-up">
              <Row icon="record-voice-over" title="Text-to-Speech" subtitle="Listen to words and lessons being read aloud" right={renderSwitch('tts_enabled', settings.tts_enabled)} />
              <Row icon="speed" title="Speech Speed" subtitle={settings.speech_rate || 'normal'} right={renderSegment<SpeechRate>('speech_rate', settings.speech_rate || 'normal', ['slow', 'normal', 'fast'])} />
              <Row icon="repeat" title="Auto Read Words" subtitle="Automatically speak a word when selected" right={renderSwitch('auto_read_words', settings.auto_read_words)} />
            </Section>

            <Section title="Speech Practice" icon="mic">
              <Row
                icon="mic"
                title="Microphone Access"
                subtitle={micPermission === 'granted' ? 'Enabled for speech practice' : micPermission === 'checking' ? 'Checking...' : 'Not yet allowed'}
                right={
                  micPermission === 'granted' ? (
                    <View style={styles.grantedPill}>
                      <MaterialIcons name="check-circle" size={13} color={SUCCESS} />
                      <Text style={styles.grantedPillText}>Enabled</Text>
                    </View>
                  ) : micPermission === 'checking' ? (
                    <ActivityIndicator size="small" color={LAVENDER} />
                  ) : (
                    <TouchableOpacity style={styles.permissionButton} onPress={requestMicPermission}>
                      <Text style={styles.permissionButtonText}>Allow</Text>
                    </TouchableOpacity>
                  )
                }
              />
              <Row icon="translate" title="Language" subtitle="Tagalog (Filipino)" />
              <Row icon="feedback" title="Pronunciation Feedback" subtitle="Get feedback on spoken pronunciation" />
              <Row icon="pie-chart" title="Show Accuracy Score" subtitle="Display score after each practice" right={renderSwitch('show_accuracy_score', settings.show_accuracy_score)} />
            </Section>
          </>
        )}

        <Section title="Notifications" icon="notifications-active">
          <Row icon="notifications" title="Notifications enabled" right={renderSwitch('notifications_enabled', settings.notifications_enabled)} />
          <Row icon="assignment" title="Assignment notifications" right={renderSwitch('assignment_notifications', settings.assignment_notifications)} />
          <Row icon="cloud-upload" title="Lesson notifications" right={renderSwitch('lesson_notifications', settings.lesson_notifications)} />
          {isParent ? (
            <>
              <Row icon="insert-chart" title="Progress notifications" right={renderSwitch('progress_notifications', settings.progress_notifications)} />
              <Row icon="notifications" title="Push notifications" right={renderSwitch('push_notifications', settings.push_notifications)} />
            </>
          ) : (
            <Row icon="event" title="Deadline reminders" right={renderSwitch('deadline_notifications', settings.deadline_notifications)} />
          )}
        </Section>

        <Section title="Appearance" icon="brightness-6">
          <View style={styles.themeRow}>
            {(['light', 'system', 'dark'] as ReadingTheme[]).map((opt) => {
              const active = theme === opt;
              const iconName = opt === 'light' ? 'wb-sunny' : opt === 'dark' ? 'nightlight-round' : 'smartphone';
              const label = opt === 'light' ? 'Light' : opt === 'dark' ? 'Dark' : 'System';
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.themeCard, active && styles.themeCardActive]}
                  onPress={() => updateSetting('reading_theme', opt)}
                >
                  {active && (
                    <View style={styles.themeCheck}>
                      <MaterialIcons name="check" size={11} color="#fff" />
                    </View>
                  )}
                  <MaterialIcons name={iconName as any} size={22} color={active ? LAVENDER_DARK : INK_SOFT} />
                  <Text style={[styles.themeCardText, active && { color: LAVENDER_DARK }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.themeNote, dark && styles.mutedDark]}>* Light mode is recommended for comfortable reading.</Text>
        </Section>

        <Section title="Account" icon="manage-accounts">
          <Row icon="lock" title="Change password" subtitle="Update your Supabase Auth password" onPress={() => setModal('password')} />
          <Row icon="email" title="Change email" subtitle="Requires email confirmation" onPress={() => setModal('email')} />
          <Row icon="delete-outline" title="Delete account" subtitle="Requires secure confirmation" onPress={confirmDelete} danger />
        </Section>

        <Section title="Security" icon="verified-user">
          <Row icon="devices" title="Active sessions" subtitle="Current device session managed by Supabase Auth" />
          <Row icon="security" title="Two-factor authentication" subtitle="Preference saved for future verification flow" right={renderSwitch('two_factor_enabled', settings.two_factor_enabled)} />
        </Section>

        {isParent && (
          <Section title="Child Monitoring" icon="supervisor-account">
            <Row icon="calendar-month" title="Weekly progress reports" right={renderSwitch('weekly_progress_reports', settings.weekly_progress_reports)} />
            <Row icon="summarize" title="Daily activity summary" right={renderSwitch('daily_activity_summary', settings.daily_activity_summary)} />
            <Row icon="campaign" title="Teacher updates" right={renderSwitch('teacher_updates', settings.teacher_updates)} />
            <Row icon="emoji-events" title="Learning milestone alerts" right={renderSwitch('milestone_alerts', settings.milestone_alerts)} />
          </Section>
        )}

        <View
          onLayout={(e) => {
            profileSectionY.current = e.nativeEvent.layout.y;
          }}
        >
          <Section title="Profile" icon="person">
            <View style={styles.profileTop}>
              <TouchableOpacity onPress={pickAvatar} style={styles.avatarWrap} disabled={savingProfile}>
                {profile.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarInitial}>{initials}</Text>
                  </View>
                )}
                <View style={styles.avatarEdit}>
                  <MaterialIcons name="photo-camera" size={16} color="#fff" />
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileName, dark && styles.textDark]}>{profile.full_name || 'Unnamed user'}</Text>
                <Text style={[styles.rowSubtitle, dark && styles.mutedDark]}>{profile.email}</Text>
              </View>
            </View>

            <TextInput
              style={[styles.input, dark && styles.inputDark]}
              value={profile.full_name || ''}
              onChangeText={(full_name) => setProfile((prev) => ({ ...prev, full_name }))}
              placeholder="Full name"
              placeholderTextColor="#94a3b8"
            />
            <TextInput
              style={[styles.input, styles.readOnlyInput, dark && styles.inputDark]}
              value={profile.email || ''}
              editable={false}
              placeholder="Email"
              placeholderTextColor="#94a3b8"
            />
            <TextInput
              style={[styles.input, dark && styles.inputDark]}
              value={profile.phone_number || profile.phone || ''}
              onChangeText={(phone_number) => setProfile((prev) => ({ ...prev, phone_number, phone: phone_number }))}
              keyboardType="phone-pad"
              placeholder="Phone number"
              placeholderTextColor="#94a3b8"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={saveProfile} disabled={savingProfile}>
              {savingProfile ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save Profile</Text>}
            </TouchableOpacity>
          </Section>
        </View>

        <View style={[styles.card, dark && styles.cardDark]}>
          <Row icon="person" title="My Profile" subtitle="Manage your personal details" onPress={scrollToProfile} />
          <Row icon="support-agent" title="Help & Support" subtitle="Contact us for assistance" onPress={contactSupport} />
          <Row icon="info" title="About LinawLetra" subtitle={`Version ${appVersion}`} />
          <Row icon="gavel" title="Privacy & Safety" subtitle="View LinawLetra policies" onPress={() => Linking.openURL('https://linawletra.app/privacy').catch(() => showError('Could not open link.'))} />
          <Row icon="logout" title="Log Out" onPress={confirmLogout} danger />
        </View>

        <Text style={[styles.versionFooter, dark && styles.mutedDark]}>LinawLetra Version {appVersion}</Text>
      </ScrollView>

      <Modal visible={!!modal} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, dark && styles.cardDark]}>
            <Text style={[styles.modalTitle, dark && styles.textDark]}>{modal === 'password' ? 'Change Password' : 'Change Email'}</Text>
            {modal === 'password' ? (
              <TextInput
                style={[styles.input, dark && styles.inputDark]}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="New password"
                placeholderTextColor="#94a3b8"
              />
            ) : (
              <TextInput
                style={[styles.input, dark && styles.inputDark]}
                value={newEmail}
                onChangeText={setNewEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="New email"
                placeholderTextColor="#94a3b8"
              />
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setModal(null)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButtonSmall}
                onPress={modal === 'password' ? submitPassword : submitEmail}
                disabled={savingKey === 'password' || savingKey === 'email'}
              >
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  containerDark: { backgroundColor: '#030712' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  loadingText: { marginTop: 12, color: MUTED, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 18, paddingBottom: 10 },
  backButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 24, color: INK },
  subtitle: { fontSize: 13, color: INK_SOFT, fontWeight: '600', marginTop: 2 },
  headerAvatar: { width: 44, height: 44, borderRadius: 22 },
  headerAvatarInitial: { color: LAVENDER, fontSize: 16, fontWeight: '900' },
  summaryCard: { flexDirection: 'column' },
  summaryBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  gradeBadge: { backgroundColor: '#F1F0F4', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  gradeBadgeText: { color: INK_SOFT, fontWeight: '800', fontSize: 12 },
  levelBadge: { backgroundColor: LAVENDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  levelBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  viewProfileButton: {
    minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: LAVENDER,
    alignItems: 'center', justifyContent: 'center', marginTop: 14,
  },
  viewProfileButtonText: { color: LAVENDER_DARK, fontWeight: '900', fontSize: 14 },
  grantedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E9F7F1',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  grantedPillText: { color: SUCCESS, fontWeight: '800', fontSize: 11 },
  permissionButton: { backgroundColor: LAVENDER, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, minHeight: 32 },
  permissionButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeCard: {
    flex: 1, borderRadius: 16, borderWidth: 1.5, borderColor: '#EEE9F9', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 6, minHeight: 76,
  },
  themeCardActive: { borderColor: LAVENDER, backgroundColor: '#F5F3FC' },
  themeCheck: {
    position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderRadius: 8,
    backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center',
  },
  themeCardText: { color: INK_SOFT, fontWeight: '800', fontSize: 13 },
  themeNote: { color: INK_SOFT, fontSize: 11, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  versionFooter: { textAlign: 'center', color: INK_SOFT, fontSize: 12, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 16,
    marginTop: 14,
    shadowColor: LAVENDER_DARK,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardDark: { backgroundColor: '#0b1220', borderColor: '#1f2937' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sectionIcon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: FONT_DISPLAY_SEMI, fontSize: 16, color: INK },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowText: { flex: 1 },
  rowTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  rowSubtitle: { color: INK_SOFT, fontSize: 12, marginTop: 3 },
  textDark: { color: '#f8fafc' },
  mutedDark: { color: '#94a3b8' },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarPlaceholder: { backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: LAVENDER, fontSize: 28, fontWeight: '900' },
  avatarEdit: { position: 'absolute', right: -4, bottom: -4, width: 28, height: 28, borderRadius: 14, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center' },
  profileName: { fontSize: 18, fontWeight: '900', color: INK },
  input: {
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: '#EEE9F9',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 10,
    backgroundColor: '#fff',
    color: INK,
  },
  inputDark: { backgroundColor: '#111827', borderColor: '#334155', color: '#f8fafc' },
  readOnlyInput: { backgroundColor: '#F8F7FC' },
  primaryButton: { minHeight: 48, borderRadius: 999, marginTop: 12, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center' },
  primaryButtonSmall: { minHeight: 44, borderRadius: 999, paddingHorizontal: 18, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', flex: 1 },
  primaryButtonText: { color: '#fff', fontWeight: '900' },
  secondaryButton: { minHeight: 44, borderRadius: 999, paddingHorizontal: 18, backgroundColor: '#EFECFB', alignItems: 'center', justifyContent: 'center', flex: 1 },
  secondaryButtonText: { color: LAVENDER_DARK, fontWeight: '900' },
  successBanner: { color: SUCCESS, backgroundColor: '#E9F7F1', borderRadius: 999, padding: 12, marginTop: 8, fontWeight: '800', textAlign: 'center' },
  errorBanner: { color: DANGER, backgroundColor: 'rgba(224,107,76,0.12)', borderRadius: 999, padding: 12, marginTop: 8, fontWeight: '800', textAlign: 'center' },
  segment: { flexDirection: 'row', backgroundColor: '#EFECFB', borderRadius: 999, padding: 3, maxWidth: 210 },
  segmentButton: { minHeight: 34, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  segmentButtonActive: { backgroundColor: LAVENDER },
  segmentText: { color: LAVENDER_DARK, fontWeight: '800', fontSize: 12, textTransform: 'capitalize' },
  segmentTextActive: { color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(30,23,66,0.55)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20 },
  modalTitle: { fontFamily: FONT_DISPLAY_SEMI, color: INK, fontSize: 18, marginBottom: 4 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
