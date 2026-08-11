import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { completeAuthSession, completePasswordReset } from '../services/supabaseService';
import { colors, typography } from '../theme';

interface ResetPasswordProps {
  navigation: any;
  route: any;
}

type Stage = 'exchanging' | 'invalid' | 'form' | 'success';

const firstParam = (value: unknown): string => {
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
};

const ResetPassword: React.FC<ResetPasswordProps> = ({ navigation, route }) => {
  const isOtpMode = route?.params?.mode === 'otp';
  const resetEmail = firstParam(route?.params?.email).trim().toLowerCase();
  const [stage, setStage] = useState<Stage>(isOtpMode ? 'form' : 'exchanging');
  const [resetCode, setResetCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // The recovery `code` arrives as a query param on the linawletra://reset-password
  // deep link — React Navigation's linking config (App.tsx) hands it to us as
  // a route param automatically.
  useEffect(() => {
    if (isOtpMode) return;

    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && active) setStage('form');
    });

    const exchange = async () => {
      const params = route?.params || {};
      const code = firstParam(params.code);
      const accessToken = firstParam(params.access_token);
      const refreshToken = firstParam(params.refresh_token);
      const tokenHash = firstParam(params.token_hash);
      const callbackError = firstParam(params.error_description) || firstParam(params.error);

      try {
        if (callbackError) throw new Error(decodeURIComponent(callbackError.replace(/\+/g, ' ')));

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else if (tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          if (verifyError) throw verifyError;
        } else {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session) throw new Error('No recovery session was found.');
        }

        if (active) setStage('form');
      } catch (e: any) {
        console.error('[ResetPassword] recovery session failed:', e?.message || e);
        if (active) {
          setError('For your security, reset links expire and can only be used once. Request a new link below.');
          setStage('invalid');
        }
      }
    };
    exchange();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [isOtpMode, route?.params]);

  const passwordError = (() => {
    if (!password) return '';
    if (password.length < 8) return 'Password needs at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Add one uppercase letter';
    if (!/\d/.test(password)) return 'Add one number';
    return '';
  })();
  const confirmError = confirmPassword && confirmPassword !== password ? 'Passwords do not match' : '';
  const isValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password) && confirmPassword === password
    && (!isOtpMode || /^\d{6}$/.test(resetCode));

  const handleSubmit = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setError('');
    try {
      if (isOtpMode) {
        await completePasswordReset(resetEmail, resetCode, password);
        setStage('success');
        setTimeout(() => navigation.replace('Login'), 1200);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // Password reset leaves the user with a valid session — route them
      // straight into their dashboard the same way a normal login would,
      // instead of bouncing them back to Login to sign in again.
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        setStage('success');
        await completeAuthSession(userData.user, true, navigation);
      } else {
        setStage('success');
      }
    } catch (e: any) {
      console.error('[ResetPassword] updateUser failed:', e?.message || e);
      setError(e?.data?.message || e?.message || 'Hindi na-update ang password. Subukan muli.');
    } finally {
      setLoading(false);
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
        </View>

        <View style={styles.iconBadge}>
          <Ionicons name="lock-closed" size={32} color="#fff" />
        </View>

        {stage === 'exchanging' && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color={colors.lavenderDark} />
            <Text style={[styles.subtitle, { marginTop: 16 }]}>Sinusuri ang iyong reset link...</Text>
          </View>
        )}

        {stage === 'invalid' && (
          <View style={styles.card}>
            <Text style={styles.title}>Link Invalid or Expired</Text>
            <Text style={styles.subtitle}>
              This password reset link is no longer valid. Please request a new one.
            </Text>
            {error ? (
              <Text style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <TouchableOpacity style={styles.button} onPress={() => navigation.replace('ForgotPassword')}>
              <Text style={styles.buttonText}>Request New Link</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'form' && (
          <View style={styles.card}>
            <Text style={styles.title}>Set New Password</Text>
            <Text style={styles.subtitle}>
              {isOtpMode ? `Enter the six-digit code sent to ${resetEmail}, then choose a new password.` : 'Choose a new password for your account.'}
            </Text>

            {error ? (
              <Text style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            {isOtpMode ? (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Reset Code</Text>
                <View style={[styles.inputWrapper, resetCode.length > 0 && !/^\d{6}$/.test(resetCode) && styles.inputWrapperError]}>
                  <Ionicons name="keypad-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter six-digit code"
                    placeholderTextColor={colors.inkSoft}
                    value={resetCode}
                    onChangeText={(value) => setResetCode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!loading}
                    accessibilityLabel="Password reset code"
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Password</Text>
              <View style={[styles.inputWrapper, passwordError && styles.inputWrapperError]}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.inkSoft}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!loading}
                  accessibilityLabel="New password input"
                  accessibilityHint="Enter your new password. Password is hidden by default"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.lavenderDark} />
                </TouchableOpacity>
              </View>
              {passwordError ? <Text style={styles.errorFieldText}>{passwordError}</Text> : null}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm New Password</Text>
              <View style={[styles.inputWrapper, confirmError && styles.inputWrapperError]}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter your new password"
                  placeholderTextColor={colors.inkSoft}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  editable={!loading}
                  accessibilityLabel="Confirm new password input"
                  accessibilityHint="Re-enter your new password. Password is hidden by default"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                  accessibilityRole="button"
                  accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color={colors.lavenderDark} />
                </TouchableOpacity>
              </View>
              {confirmError ? <Text style={styles.errorFieldText}>{confirmError}</Text> : null}
            </View>

            <TouchableOpacity
              style={[styles.button, (!isValid || loading) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={!isValid || loading}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Update Password</Text>}
            </TouchableOpacity>
          </View>
        )}

        {stage === 'success' && (
          <View style={styles.card}>
            <Ionicons name="checkmark-circle" size={40} color={colors.success} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.title}>Password Updated!</Text>
            <Text style={styles.subtitle}>{isOtpMode ? 'Returning you to Login...' : 'Redirecting you to your dashboard...'}</Text>
            <ActivityIndicator size="small" color={colors.lavenderDark} style={{ marginTop: 12 }} />
          </View>
        )}

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
  card: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 420,
    marginHorizontal: 20,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.14)',
    elevation: 10,
    ...Platform.select({
      web: { boxShadow: '0px 20px 40px rgba(59,50,44,0.12)' },
      default: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  title: {
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: typography.family.display,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: colors.inkSoft,
    lineHeight: 20,
    marginBottom: 20,
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
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '800',
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
    color: colors.ink,
    padding: 0,
  },
  eyeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorFieldText: {
    color: '#B3441F',
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
  button: {
    backgroundColor: colors.lavenderDark,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
    marginTop: 8,
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: typography.family.displaySemi,
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
  },
});

export default ResetPassword;
