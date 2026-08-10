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

interface ResendVerificationProps {
  navigation: any;
}

// Same warm "reading journey" identity tokens used across every other auth
// screen (Login/Sign Up/Forgot Password/Reset Password/Email Verification) —
// this screen should feel like a continuation of the same flow.
const HOME_CREAM = '#FBF3E2';
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#5F5044';
const HOME_CORAL = '#E06B4C';
const HOME_LAVENDER_DARK = '#5F52B0';
const SUCCESS = '#10b981';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';

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
        throw new Error(result.message || 'Failed to send verification code.');
      }

      setSuccessMessage('Verification code sent! Check your email. Returning to login...');
      setResendAttempts((prev) => prev + 1);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);

      // Auto-return to login after showing the success banner, same as the
      // previous Alert.alert confirmation flow — just without the popup.
      setTimeout(() => {
        navigation.goBack();
      }, 1800);
    } catch (error: any) {
      console.error('[ResendVerification] Error:', error);
      setErrorMessage(error.message || 'Failed to resend verification code.');
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
          <Text style={styles.tagline}>Clearer Reading. Brighter Learning.</Text>
        </View>

        <View style={styles.iconBadge}>
          <Ionicons name="mail" size={32} color="#fff" />
        </View>

        <Text style={styles.title}>Resend Verification</Text>
        <Text style={styles.subtitle}>Enter your email to resend the verification code.</Text>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={20} color={HOME_LAVENDER_DARK} />
            <Text style={styles.backButtonText}>Back</Text>
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
              <Ionicons name="checkmark-circle" size={20} color={SUCCESS} />
              <Text style={styles.successBannerText}>{successMessage}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={20} color={HOME_LAVENDER_DARK} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={HOME_INK_SOFT}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
                accessibilityLabel="Email input"
                accessibilityHint="Enter your email address to resend the verification code"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, isButtonDisabled && styles.buttonDisabled]}
            onPress={handleResend}
            disabled={isButtonDisabled}
            accessibilityRole="button"
            accessibilityLabel="Resend verification code"
          >
            {loading ? (
              <>
                <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Sending...</Text>
              </>
            ) : resendCooldown > 0 ? (
              <Text style={styles.buttonText}>Wait {resendCooldown}s</Text>
            ) : resendAttempts >= MAX_RESEND_ATTEMPTS ? (
              <Text style={styles.buttonText}>Limit Reached</Text>
            ) : (
              <Text style={styles.buttonText}>Resend Code</Text>
            )}
          </TouchableOpacity>

          {resendAttempts > 0 && (
            <Text style={styles.attemptsText}>
              Attempts: {resendAttempts}/{MAX_RESEND_ATTEMPTS}
            </Text>
          )}
        </View>

        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={HOME_INK_SOFT} />
          <Text style={styles.trustNoteText}>Your information is protected and securely handled.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: HOME_CREAM,
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
    color: HOME_INK_SOFT,
    marginTop: -8,
    marginBottom: 8,
  },
  iconBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: HOME_LAVENDER_DARK,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...Platform.select({
      web: { boxShadow: '0px 10px 24px rgba(95,82,176,0.35)' },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.35, shadowRadius: 24 },
    }),
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: FONT_DISPLAY,
    color: HOME_INK,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: HOME_INK_SOFT,
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
      default: { shadowColor: HOME_INK, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 32,
  },
  backButtonText: {
    color: HOME_LAVENDER_DARK,
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
    borderLeftColor: HOME_CORAL,
  },
  infoBanner: {
    color: HOME_INK,
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 13,
    backgroundColor: 'rgba(124,111,207,0.1)',
    padding: 12,
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: HOME_LAVENDER_DARK,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderLeftWidth: 4,
    borderLeftColor: SUCCESS,
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
    color: HOME_INK,
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
    color: HOME_INK,
    padding: 0,
  },
  button: {
    backgroundColor: HOME_LAVENDER_DARK,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 4,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(95,82,176,0.28)' },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
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
    fontFamily: FONT_DISPLAY_SEMI,
  },
  attemptsText: {
    textAlign: 'center',
    color: HOME_INK_SOFT,
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
    color: HOME_INK_SOFT,
    fontSize: 12,
    textAlign: 'center',
  },
});

export default ResendVerification;
