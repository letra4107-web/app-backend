import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sendEmailOTP, validateEmail } from '../services/otpService';
import { colors, typography } from '../theme';

interface ResendVerificationProps {
  navigation: any;
}

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_RESEND_ATTEMPTS = 3;

const ResendVerification: React.FC<ResendVerificationProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  // Cooldown timer
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => {
          const next = prev - 1;
          if (next <= 0 && timer) {
            clearInterval(timer);
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [resendCooldown]);

  const handleResend = async () => {
    setSuccessMessage('');
    setErrorMessage('');
    setInfoMessage('');

    // Validation
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setErrorMessage(emailValidation.error || 'Please enter a valid email.');
      return;
    }

    // Check attempt limit
    if (resendAttempts >= MAX_RESEND_ATTEMPTS) {
      setErrorMessage('Too many resend attempts. Please wait 60 seconds and try again.');
      return;
    }

    // Check cooldown
    if (resendCooldown > 0) {
      setInfoMessage(`You can resend in ${resendCooldown} second${resendCooldown !== 1 ? 's' : ''}.`);
      return;
    }

    // Prevent double-clicks
    if (loading) {
      console.log('[ResendVerification] Already sending, ignoring duplicate request');
      return;
    }

    setLoading(true);
    try {
      const result = await sendEmailOTP(email);
      if (!result.success) {
        throw new Error(result.message || 'Hindi naipadala ang verification code.');
      }

      setSuccessMessage('Naipadala ang verification code! Tingnan ang iyong email. Babalik sa login...');
      setResendAttempts((prev) => prev + 1);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);

      // Auto-return to login after showing the success banner, same as the
      // previous Alert.alert confirmation flow — just without the popup.
      setTimeout(() => {
        navigation.goBack();
      }, 1800);
    } catch (error: any) {
      console.error('[ResendVerification] Error:', error);
      setErrorMessage(error.message || 'Hindi naipadala muli ang verification code.');
    } finally {
      setLoading(false);
    }
  };

  const isButtonDisabled = loading || resendCooldown > 0 || resendAttempts >= MAX_RESEND_ATTEMPTS;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.backgroundDecor}>
          <View style={styles.circleTopLeft} />
          <View style={styles.circleRight} />
        </View>

        <View style={styles.topHeader}>
          <Image source={require('../../assets/Logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.tagline}>Linaw na Pagbasa. Higit na Pag-unlad.</Text>
        </View>

        <View style={styles.iconBadge}>
          <Ionicons name="mail" size={32} color="#fff" />
        </View>

        <Text style={styles.title}>Ipadala Muli ang Verification</Text>
        <Text style={styles.subtitle}>Ilagay ang iyong email para ipadala muli ang verification code.</Text>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Bumalik"
          >
            <Ionicons name="chevron-back" size={20} color={colors.lavenderDark} />
            <Text style={styles.backButtonText}>Bumalik</Text>
          </TouchableOpacity>

          {errorMessage ? (
            <Text style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {errorMessage}
            </Text>
          ) : null}

          {infoMessage ? (
            <Text style={styles.infoBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {infoMessage}
            </Text>
          ) : null}

          {successMessage ? (
            <View style={styles.successBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.successBannerText}>{successMessage}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Ilagay ang email"
                placeholderTextColor={colors.inkSoft}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
                accessibilityLabel="Field ng email"
                accessibilityHint="Ilagay ang iyong email address para ipadala muli ang verification code"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, isButtonDisabled && styles.buttonDisabled]}
            onPress={handleResend}
            disabled={isButtonDisabled}
            accessibilityRole="button"
            accessibilityLabel="Ipadala muli ang verification code"
          >
            {loading ? (
              <>
                <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Ipinapadala...</Text>
              </>
            ) : resendCooldown > 0 ? (
              <Text style={styles.buttonText}>Maghintay ng {resendCooldown}s</Text>
            ) : resendAttempts >= MAX_RESEND_ATTEMPTS ? (
              <Text style={styles.buttonText}>Naabot na ang Limitasyon</Text>
            ) : (
              <Text style={styles.buttonText}>Ipadala Muli ang Code</Text>
            )}
          </TouchableOpacity>

          {resendAttempts > 0 && (
            <Text style={styles.attemptsText}>
              Beses na sinubukan: {resendAttempts}/{MAX_RESEND_ATTEMPTS}
            </Text>
          )}
        </View>

        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.inkSoft} />
          <Text style={styles.trustNoteText}>Ligtas at pribado ang iyong impormasyon.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: Platform.OS === 'ios' ? 44 : 32,
    paddingBottom: 40,
    alignItems: 'center',
  },
  backgroundDecor: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  circleTopLeft: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(124,111,207,0.14)',
  },
  circleRight: {
    position: 'absolute',
    top: 28,
    right: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(224,107,76,0.12)',
  },
  topHeader: {
    alignItems: 'center',
    marginBottom: 4,
  },
  logo: {
    width: 200,
    height: 100,
  },
  tagline: {
    fontSize: 13,
    color: colors.inkSoft,
    marginTop: -8,
    marginBottom: 8,
  },
  iconBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.lavenderDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...Platform.select({
      web: { boxShadow: '0px 10px 24px rgba(95,82,176,0.35)' },
      default: { shadowColor: colors.lavenderDark, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.35, shadowRadius: 24 },
    }),
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: typography.family.display,
    color: colors.ink,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: colors.inkSoft,
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 28,
  },
  card: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 420,
    marginHorizontal: 20,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.14)',
    elevation: 10,
    ...Platform.select({
      web: { boxShadow: '0px 20px 40px rgba(59,50,44,0.12)' },
      default: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 32,
  },
  backButtonText: {
    color: colors.lavenderDark,
    fontSize: 14,
    marginLeft: 4,
    fontWeight: '700',
  },
  errorBanner: {
    color: '#9A3412',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 13,
    backgroundColor: 'rgba(224,107,76,0.12)',
    padding: 12,
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: colors.coral,
  },
  infoBanner: {
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 13,
    backgroundColor: 'rgba(124,111,207,0.1)',
    padding: 12,
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: colors.lavenderDark,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  successBannerText: {
    flex: 1,
    color: '#0f6b4f',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: colors.ink,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.25)',
    borderRadius: 14,
    backgroundColor: '#FAF8F3',
    paddingHorizontal: 14,
    minHeight: 56,
  },
  inputLeadingIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: colors.ink,
    padding: 0,
  },
  button: {
    backgroundColor: colors.lavenderDark,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 4,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(95,82,176,0.28)' },
      default: { shadowColor: colors.lavenderDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
    }),
  },
  buttonDisabled: {
    backgroundColor: '#C7C2D6',
    opacity: 0.8,
    ...Platform.select({
      web: { boxShadow: 'none' },
      default: { shadowOpacity: 0 },
    }),
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: typography.family.displaySemi,
  },
  attemptsText: {
    textAlign: 'center',
    color: colors.inkSoft,
    fontSize: 12,
    marginTop: 14,
  },
  trustNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  trustNoteText: {
    color: colors.inkSoft,
    fontSize: 12,
    textAlign: 'center',
  },
});

export default ResendVerification;
