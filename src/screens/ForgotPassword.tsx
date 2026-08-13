import React, { useState } from 'react';
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
import { resetPassword } from '../services/supabaseService';
import { colors, typography } from '../theme';

interface ForgotPasswordProps {
  navigation: any;
}

const REASSURANCE_TEXT = "If an account exists with this email, you'll receive a six-digit reset code shortly. Check your inbox and spam folder.";

const ForgotPassword: React.FC<ForgotPasswordProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const validateEmail = (value: string) => {
    setEmail(value);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value.trim()) {
      setEmailError('Please enter your email');
    } else if (!emailRegex.test(value.trim())) {
      setEmailError('Please enter a valid email');
    } else {
      setEmailError('');
    }
  };

  const isEmailValid = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return email.trim() && emailRegex.test(email.trim());
  };

  const handleReset = async () => {
    if (loading) {
      console.log('[ForgotPassword] Already sending reset email...');
      return;
    }

    setTouched(true);
    setGeneralError('');
    setSubmitted(false);

    if (!isEmailValid()) {
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { error } = await resetPassword(normalizedEmail);

      // The backend is designed not to reveal whether an account exists for
      // this email. Even so, we must never
      // let a "user not found"-style error surface as a distinct message here
      // (account enumeration). Only genuinely account-agnostic failures
      // (rate limiting, malformed email, network) get their own message;
      // anything else — including any account-existence-related error —
      // collapses into the same generic confirmation as a real success.
      if (error) {
        const message = String(error.message || '').toLowerCase();
        const status = (error as any)?.status;
        console.warn('[ForgotPassword] reset-code request returned an error:', {
          status,
          message: error.message,
        });

        if (status === 429 || message.includes('rate limit') || message.includes('too many')) {
          setGeneralError('Too many requests. Please wait a few minutes and try again.');
          return;
        }
        if (message.includes('invalid email') || message.includes('unable to validate email')) {
          setGeneralError('Please enter a valid email address.');
          return;
        }
        if (message.includes('network') || message.includes('fetch failed') || message.includes('timed out')) {
          setGeneralError('Network error. Please check your connection and try again.');
          return;
        }
        if (status >= 500 || message.includes('could not send') || message.includes('unable to send')) {
          setGeneralError('We could not send the reset email right now. Please try again in a moment.');
          return;
        }
        // Deliberately no other branches — anything else (including account
        // existence) falls through to the generic confirmation below.
      }

      setSubmitted(true);
      navigation.navigate('ResetPassword', { mode: 'otp', email: normalizedEmail });
    } catch (error: any) {
      console.error('[ForgotPassword] Reset error:', error);
      setGeneralError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.replace('Login');
    }
  };

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
          <Ionicons name="lock-closed" size={32} color="#fff" />
        </View>

        <Text style={styles.title}>Forgot Your Password?</Text>
        <Text style={styles.subtitle}>No worries. Enter your email and we&apos;ll send you a six-digit code to reset your password.</Text>

        <View style={styles.card}>
          {generalError ? (
            <Text style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {generalError}
            </Text>
          ) : null}

          {submitted ? (
            <View style={styles.successBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.successBannerText}>{REASSURANCE_TEXT}</Text>
            </View>
          ) : (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={[
                  styles.inputWrapper,
                  touched && emailError ? styles.inputWrapperError : null,
                ]}>
                  <Ionicons name="mail-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your registered email address"
                    placeholderTextColor={colors.inkSoft}
                    value={email}
                    onChangeText={validateEmail}
                    onBlur={() => setTouched(true)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    editable={!loading}
                    accessibilityLabel="Email input"
                  />
                </View>
                {touched && emailError ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={14} color={colors.coral} />
                    <Text style={styles.errorFieldText}>{emailError}</Text>
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={[styles.button, (!isEmailValid() || loading) && styles.buttonDisabled]}
                onPress={handleReset}
                disabled={!isEmailValid() || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Send Reset Code</Text>
                )}
              </TouchableOpacity>

              <Text style={styles.reassuranceText}>{REASSURANCE_TEXT}</Text>
            </>
          )}
        </View>

        <TouchableOpacity onPress={handleBackToLogin} style={styles.backRow}>
          <Ionicons name="chevron-back" size={18} color={colors.lavenderDark} />
          <Text style={styles.backText}>Back to Login</Text>
        </TouchableOpacity>

        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.inkSoft} />
          <Text style={styles.trustNoteText}>Your information is protected and securely handled.</Text>
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
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    borderRadius: 16,
    padding: 16,
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
  inputWrapperError: {
    borderColor: colors.coral,
    backgroundColor: '#FDF3EF',
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
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  errorFieldText: {
    color: '#B3441F',
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '600',
  },
  button: {
    backgroundColor: colors.lavenderDark,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
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
  reassuranceText: {
    fontSize: 12,
    textAlign: 'center',
    color: colors.inkSoft,
    lineHeight: 17,
    marginTop: 14,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    gap: 4,
  },
  backText: {
    fontSize: 15,
    color: colors.lavenderDark,
    fontWeight: '700',
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

export default ForgotPassword;
