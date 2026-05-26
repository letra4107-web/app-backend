import React, { useEffect, useRef, useState } from 'react';
import {
  ImageBackground,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../config/theme';
import { validateEmail, validateOTP } from '../utils/validation';
import { sendEmailOTP, resendOTP, verifyOTP } from '../services/otpService';
import { onAuthStateChanged, getCurrentUser, getUserProfileByEmail, getUserProfileById, upsertUserProfile } from '../services/supabaseService';

interface EmailVerificationProps {
  navigation: any;
  route: any;
}

const MAX_RESEND_ATTEMPTS = 3;
const RESEND_COOLDOWN_SECONDS = 60;
const autoSendStartedKeys = new Set<string>();

const getAutoSendStorageKey = (email: string, userId: string) => `otp-auto-send:${email.toLowerCase()}:${userId || 'anonymous'}`;

const hasAutoSendStarted = (key: string) => {
  if (autoSendStartedKeys.has(key)) return true;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.sessionStorage.getItem(key) === 'started';
  }
  return false;
};

const markAutoSendStarted = (key: string) => {
  autoSendStartedKeys.add(key);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.setItem(key, 'started');
  }
};

const EmailVerification: React.FC<EmailVerificationProps> = ({ navigation, route }) => {
  const routeEmail = route.params?.email || '';
  const routeMessage = route.params?.message || '';
  const routeUserId = route.params?.userId || '';

  const [email, setEmail] = useState(routeEmail);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState(routeMessage);
  const [timeoutSendError, setTimeoutSendError] = useState(false);
  const [otpQueued, setOtpQueued] = useState(Boolean(route.params?.otpSent));
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const autoSendInFlightRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const otpRefs = useRef<Array<TextInput | null>>([]);

  const getVerificationUserId = () => currentUser?.id || routeUserId || '';
  const applyOtpQueuedState = (message = 'OTP queued for delivery. Please check your email shortly.') => {
    setSuccessMessage(message);
    setInfoMessage('The code expires in 5 minutes. Resend is available after 60 seconds.');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setTimeoutSendError(false);
    setOtpQueued(true);
  };

  // Subscribe to auth state changes
  useEffect(() => {
    const { data } = onAuthStateChanged((_event, session) => {
      setCurrentUser(session?.user || null);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Auto-send OTP on screen open if not already sent
  useEffect(() => {
    const autoSendOTP = async () => {
      if (!email) return; // No email available

      const verificationUserId = getVerificationUserId();
      const autoSendKey = getAutoSendStorageKey(email, verificationUserId);

      const otpSentFlag = route.params?.otpSent;

      // If OTP was already sent from signup, just show the UI state
      if (otpSentFlag) {
        setSuccessMessage('OTP sent! Please check your email.');
        setInfoMessage('The code expires in 5 minutes. Resend is available after 60 seconds.');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setOtpQueued(true);
        markAutoSendStarted(autoSendKey);
        return;
      }

      if (autoSendInFlightRef.current || hasAutoSendStarted(autoSendKey)) {
        console.log('[EmailVerification] Auto-send skipped; request already started for this verification session');
        return;
      }

      // Auto-send OTP if coming from login or verification screen
      console.log('[EmailVerification] Auto-sending OTP on screen mount for:', email);
      autoSendInFlightRef.current = true;
      setLoading(true);
      setErrorMessage('');
      setSuccessMessage('');
      setInfoMessage('');

      try {
        const result = await sendEmailOTP(email, verificationUserId);

        if (!result.success) {
          throw new Error(result.message);
        }

        applyOtpQueuedState(result.emailStatus === 'queued' ? 'OTP queued for delivery. Please check your email shortly.' : 'OTP sent! Please check your email.');
        markAutoSendStarted(autoSendKey);
      } catch (error: any) {
        console.error('[EmailVerification] Auto-send OTP error:', error);
        const message = error?.message || 'Failed to send verification code. Please try again.';
        const isTimeout = /timed out|timeout/i.test(message);
        setErrorMessage(isTimeout ? 'Request timed out, please try again.' : message);
        setTimeoutSendError(isTimeout);
      } finally {
        autoSendInFlightRef.current = false;
        setLoading(false);
      }
    };

    // Small delay to ensure state is settled before auto-send
    const timer = setTimeout(autoSendOTP, 500);
    return () => clearTimeout(timer);
  }, [email, route.params?.otpSent, routeUserId]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => {
          const next = prev - 1;
          if (next <= 0) {
            return 0;
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [resendCooldown]);

  const handleSendOTP = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setInfoMessage('');
    setTimeoutSendError(false);

    // Validation
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setErrorMessage(emailValidation.error || 'Please enter a valid email address.');
      return;
    }
    const shouldResend = otpQueued;
    if (shouldResend && resendAttempts >= MAX_RESEND_ATTEMPTS) {
      setErrorMessage('Too many resend attempts. Wait one minute before trying again.');
      return;
    }

    // Prevent button mashing: disable button immediately
    if (loading || sendInFlightRef.current) {
      console.log('[EmailVerification] Already sending OTP, ignoring duplicate request');
      return;
    }

    sendInFlightRef.current = true;
    setLoading(true);
    try {
      const verificationUserId = getVerificationUserId();

      // Use resendOTP once a code already exists for this verification session.
      const result = shouldResend
        ? await resendOTP(email, verificationUserId)
        : await sendEmailOTP(email, verificationUserId);
      
      if (!result.success) {
        throw new Error(result.message);
      }

      applyOtpQueuedState(result.emailStatus === 'queued' ? 'OTP queued for delivery. Please check your email shortly.' : 'OTP sent! Please check your email.');
      if (shouldResend) {
        setResendAttempts((prev) => prev + 1);
      }
    } catch (error: any) {
      console.error('[EmailVerification] Send OTP error:', error);
      const message = error?.message || 'Failed to send verification code. Please try again later.';
      const isTimeout = /timed out|timeout/i.test(message);
      setErrorMessage(isTimeout ? 'Request timed out, please try again.' : message);
      setTimeoutSendError(isTimeout);
    } finally {
      sendInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setInfoMessage('');

    const otpValidation = validateOTP(otp);
    if (!otpValidation.isValid) {
      setErrorMessage(otpValidation.error || 'Enter the 6-digit code from your email.');
      return;
    }

    // Prevent button mashing
    if (verifying) {
      console.log('[EmailVerification] Already verifying, ignoring duplicate request');
      return;
    }

    const verificationUserId = getVerificationUserId();

    setVerifying(true);
    try {
      const result = await verifyOTP(otp, verificationUserId, email);
      if (!result.success) {
        throw new Error(result.message);
      }

      let userIdToUpdate = result.userId || verificationUserId;
      if (!userIdToUpdate) {
        const currentUser = await getCurrentUser();
        userIdToUpdate = currentUser?.id || undefined;
      }

      if (!userIdToUpdate) {
        const profileResult = await getUserProfileByEmail(email.toLowerCase());
        if (profileResult.data) {
          userIdToUpdate = profileResult.data.id;
        }
      }

      if (userIdToUpdate) {
        await upsertUserProfile({
          id: userIdToUpdate,
          email_verified: true,
        });
      }

      setSuccessMessage('✅ Email verified successfully!');
      setInfoMessage('Setting up your account...');

      // Determine user role and navigate to appropriate dashboard
      const delay = setTimeout(async () => {
        try {
          let userRole = 'parent';
          let userName = '';

          if (userIdToUpdate) {
            const profileResult = await getUserProfileById(userIdToUpdate);
            if (profileResult.data) {
              userRole = (profileResult.data.role || 'parent').toLowerCase();
              userName = profileResult.data.name || '';
            }
          }

          if (userRole === 'student') {
            navigation.replace('Welcome', {
              studentId: userIdToUpdate,
              studentName: userName || 'Mag-aaral',
            });
          } else if (userRole === 'teacher') {
            // Teacher dashboard not implemented yet, go to Login
            navigation.replace('Login', { verifiedEmail: email });
          } else {
            // Default to parent dashboard
            navigation.replace('ParentDashboard');
          }
        } catch (navError) {
          console.error('[EmailVerification] Error navigating after verification:', navError);
          navigation.replace('Login', { verifiedEmail: email });
        }
      }, 1400);

      return () => clearTimeout(delay);
    } catch (error: any) {
      console.error('[EmailVerification] Verify OTP error:', error);
      setErrorMessage(error.message || 'Invalid code. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    if (!/^[0-9]*$/.test(value)) {
      return;
    }

    const digits = otp.split('');
    digits[index] = value ? value.slice(-1) : '';
    const nextOtp = digits.join('');
    setOtp(nextOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (event: any, index: number) => {
    if (event.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ImageBackground
        source={require('../../assets/background.png')}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.backNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <Image source={require('../../assets/Logo.jpg')} style={styles.logo} />
          <Text style={styles.mainTitle}>LinawLetra</Text>
          <Text style={styles.heading}>Account Verification</Text>
          <Text style={styles.description}>
            Enter the verification code sent to your email to continue.
          </Text>
        </View>

        {errorMessage ? (
          <View style={[styles.banner, styles.errorBanner]}>
            <Ionicons name="alert-circle" size={18} color="#b71c1c" style={styles.bannerIcon} />
            <Text style={styles.bannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {successMessage ? (
          <View style={[styles.banner, styles.successBanner]}>
            <Ionicons name="checkmark-circle" size={18} color="#1b5e20" style={styles.bannerIcon} />
            <Text style={styles.bannerText}>{successMessage}</Text>
          </View>
        ) : null}

        {infoMessage ? (
          <View style={[styles.banner, styles.infoBanner]}>
            <Ionicons name="information-circle" size={18} color="#0d47a1" style={styles.bannerIcon} />
            <Text style={styles.bannerText}>{infoMessage}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.group}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputCard}>
              <TextInput
                style={styles.input}
                placeholder="perri.moises@gmail.com"
                placeholderTextColor="#9E9E9E"
                value={email}
                keyboardType="email-address"
                autoCapitalize="none"
                onChangeText={setEmail}
                editable={!routeEmail && !loading && !verifying}
              />
            </View>
          </View>

          {routeEmail && (
            <Text style={{ fontSize: 12, color: '#666', marginTop: 8, marginBottom: 12 }}>
              ✓ Email is locked from signup
            </Text>
          )}

          <TouchableOpacity
            style={[styles.button, (loading || resendCooldown > 0) && styles.buttonDisabled]}
            disabled={loading || resendCooldown > 0}
            onPress={handleSendOTP}
          >
            {loading ? (
              <>
                <ActivityIndicator color="#fff" style={{ marginRight: 10 }} />
                <Text style={styles.buttonText}>Sending OTP...</Text>
              </>
            ) : (
              <Text style={styles.buttonText}>
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : otpQueued
                  ? 'Resend Verification Code'
                  : 'Send Verification Code'}
              </Text>
            )}
          </TouchableOpacity>
          {(timeoutSendError || (!loading && errorMessage)) ? (
            <TouchableOpacity
              style={[styles.secondaryButton, loading && styles.buttonDisabled]}
              disabled={loading}
              onPress={handleSendOTP}
            >
              <Text style={styles.secondaryButtonText}>Resend OTP</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>6-digit OTP</Text>
          <View style={styles.otpRow}>
            {Array.from({ length: 6 }).map((_, index) => (
              <TextInput
                key={index}
                value={otp[index] || ''}
                style={styles.otpInput}
                keyboardType="number-pad"
                maxLength={1}
                onChangeText={(value) => handleOtpChange(value, index)}
                onKeyPress={(event) => handleOtpKeyPress(event, index)}
                editable={!verifying}
                ref={(ref) => {
                  otpRefs.current[index] = ref;
                }}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, (verifying || otp.length !== 6) && styles.buttonDisabled]}
            disabled={verifying || otp.length !== 6}
            onPress={handleVerifyOTP}
          >
            {verifying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify Code</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.backLink} onPress={() => navigation.replace('Login')}>
          <Ionicons name="arrow-back-outline" size={18} color={colors.primary} />
          <Text style={styles.backLinkText}>Back to Login</Text>
        </TouchableOpacity>
      </ScrollView>
      </ImageBackground>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  backNav: {
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginLeft: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 22,
  },
  logo: {
    width: 210,
    height: 90,
    resizeMode: 'contain',
    marginBottom: 12,
  },
  mainTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2C3E2F',
    marginBottom: 10,
  },
  description: {
    fontSize: 15,
    color: '#4B4B4B',
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.15,
    maxWidth: '88%',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E5E9EA',
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 5,
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1b5e20',
    marginTop: 16,
    marginBottom: 6,
    fontFamily: Platform.OS === 'ios' ? 'Comic Sans MS' : 'Comic Sans MS',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#4f4f4f',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
  },
  errorBanner: {
    backgroundColor: '#fdecea',
    borderColor: '#f8c7c5',
    borderWidth: 1,
  },
  successBanner: {
    backgroundColor: '#e8f5e9',
    borderColor: '#c8e6c9',
    borderWidth: 1,
  },
  infoBanner: {
    backgroundColor: '#e3f2fd',
    borderColor: '#bbdefb',
    borderWidth: 1,
  },
  bannerIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  bannerText: {
    color: '#1e1e1e',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  group: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    color: '#2E3B30',
  },
  inputCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D8DEE2',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputCardError: {
    borderColor: '#F3B269',
    backgroundColor: '#FFF4ED',
  },
  input: {
    fontSize: 16,
    color: '#1F2D2B',
    padding: 0,
    minHeight: 44,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    marginTop: 6,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D8DEE2',
    backgroundColor: '#F6F7F9',
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#1C2F2C',
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
    marginBottom: 0,
    marginTop: 4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  buttonDisabled: {
    opacity: 0.65,
    backgroundColor: '#9BB3A0',
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: 'rgba(29, 94, 45, 0.12)',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e7ff',
  },
  dividerText: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 12,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  backLinkText: {
    color: colors.primary,
    fontWeight: '700',
    marginLeft: 8,
    fontSize: 15,
  },
});

export default EmailVerification;
