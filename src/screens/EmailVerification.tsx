import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { validateEmail, validateOTP } from '../utils/validation';
import { sendEmailOTP, resendOTP, verifyOTP } from '../services/otpService';
import { onAuthStateChanged, getCurrentUser, getUserProfileByEmail, getUserProfileById, upsertUserProfile } from '../services/supabaseService';
import { colors, typography } from '../theme';

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

const formatCountdown = (totalSeconds: number) => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const getLocalExpiry = (expiresAt?: string, expiresInSeconds?: number): string | null => {
  // Railway is the source of truth for remaining lifetime. Converting that
  // duration to a local deadline avoids immediate expiry when a phone clock is
  // a few minutes ahead or behind the server.
  if (Number.isFinite(expiresInSeconds) && Number(expiresInSeconds) > 0) {
    return new Date(Date.now() + Number(expiresInSeconds) * 1000).toISOString();
  }
  return expiresAt || null;
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
  const [otpQueued, setOtpQueued] = useState(Boolean(route.params?.otpSent));
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  // Real expiry from the backend's otpSession.expiresAt (backend/models/otp.js,
  // OTP_EXPIRY_MS = 10 min) — NOT OTP_REQUEST_CACHE_TTL_MS (backend/routes/auth.js,
  // 2 min), which is just an anti-duplicate-request cache for the send endpoint
  // and has nothing to do with how long the code the user types is actually valid.
  const [expiresAt, setExpiresAt] = useState<string | null>(() =>
    getLocalExpiry(route.params?.expiresAt, route.params?.expiresInSeconds)
  );
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const autoSendInFlightRef = useRef(false);
  const autoSendStartedRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  const getVerificationUserId = useCallback(() => currentUser?.id || routeUserId || '', [currentUser, routeUserId]);
  const applyOtpQueuedState = (message: string, newExpiresAt?: string, expiresInSeconds?: number) => {
    setSuccessMessage(message);
    setInfoMessage('');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setOtpQueued(true);
    setOtp('');
    const localExpiry = getLocalExpiry(newExpiresAt, expiresInSeconds);
    if (localExpiry) setExpiresAt(localExpiry);
    otpRefs.current[0]?.focus();
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

      if (autoSendStartedRef.current) {
        console.log('[EmailVerification] Auto-send skipped; already started on this screen instance');
        return;
      }
      autoSendStartedRef.current = true;

      const verificationUserId = getVerificationUserId();
      const autoSendKey = getAutoSendStorageKey(email, verificationUserId);

      const otpSentFlag = route.params?.otpSent;

      // If OTP was already sent from signup, just show the UI state
      if (otpSentFlag) {
        setSuccessMessage('OTP sent! Please check your email.');
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

        applyOtpQueuedState(
          result.emailStatus === 'queued' ? 'OTP queued for delivery. Please check your email shortly.' : 'OTP sent! Please check your email.',
          result.expiresAt,
          result.expiresInSeconds,
        );
        markAutoSendStarted(autoSendKey);
      } catch (error: any) {
        console.error('[EmailVerification] Auto-send OTP error:', error);
        const message = error?.message || 'Failed to send verification code. Please try again.';
        const isTimeout = /timed out|timeout/i.test(message);
        setErrorMessage(isTimeout ? 'Request timed out, please try again.' : message);
      } finally {
        autoSendInFlightRef.current = false;
        setLoading(false);
      }
    };

    // Small delay to ensure state is settled before auto-send
    const timer = setTimeout(autoSendOTP, 500);
    return () => clearTimeout(timer);
  }, [email, route.params?.otpSent, routeUserId, getVerificationUserId]);

  // Resend-button cooldown (60s) — separate from the code's own 5-minute
  // validity window below.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => {
          const next = prev - 1;
          return next <= 0 ? 0 : next;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [resendCooldown]);

  // The actual code-expiry countdown, driven by the real expiresAt timestamp
  // the backend returned when the OTP was created — not a hardcoded display.
  useEffect(() => {
    if (!expiresAt) {
      setSecondsRemaining(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isCodeExpired = expiresAt !== null && secondsRemaining === 0;

  const handleSendOTP = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setInfoMessage('');

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

      applyOtpQueuedState(
        result.emailStatus === 'queued' ? 'OTP queued for delivery. Please check your email shortly.' : 'A new code has been sent! Please check your email.',
        result.expiresAt,
        result.expiresInSeconds,
      );
      if (shouldResend) {
        setResendAttempts((prev) => prev + 1);
      }
    } catch (error: any) {
      console.error('[EmailVerification] Send OTP error:', error);
      const message = error?.message || 'Failed to send verification code. Please try again later.';
      const isTimeout = /timed out|timeout/i.test(message);
      setErrorMessage(isTimeout ? 'Request timed out, please try again.' : message);
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.backgroundDecor}>
          <View style={styles.circleTopLeft} />
          <View style={styles.circleRight} />
        </View>

        <View style={styles.topHeader}>
          <Image source={require('../../assets/Logo.png')} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.iconBadgeWrap}>
          <View style={styles.iconBadge}>
            <Ionicons name="mail" size={30} color="#fff" />
          </View>
          <View style={styles.iconBadgeSmall}>
            <Ionicons name="lock-closed" size={14} color="#fff" />
          </View>
        </View>

        <Text style={styles.title}>Ilagay ang Verification Code</Text>
        <Text style={styles.subtitle}>Nagpadala kami ng 6-digit na code sa iyong email</Text>

        {routeEmail ? (
          <Text style={styles.emailHighlight}>{email}</Text>
        ) : (
          <View style={[styles.inputGroup, { width: '100%', maxWidth: 380, paddingHorizontal: 20 }]}>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color={colors.lavenderDark} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.emailInput}
                placeholder="Ilagay ang iyong email"
                placeholderTextColor={colors.inkSoft}
                value={email}
                keyboardType="email-address"
                autoCapitalize="none"
                onChangeText={setEmail}
                editable={!loading && !verifying}
                accessibilityLabel="Field ng email"
              />
            </View>
          </View>
        )}

        <Text style={styles.supportingText}>Pakitingnan ang iyong inbox at ilagay ang code sa ibaba.</Text>

        {errorMessage ? (
          <View style={[styles.banner, styles.errorBanner]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={18} color={colors.coral} />
            <Text style={styles.bannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {successMessage ? (
          <View style={[styles.banner, styles.successBanner]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.bannerText}>{successMessage}</Text>
          </View>
        ) : null}

        {infoMessage ? (
          <View style={[styles.banner, styles.infoBanner]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="information-circle" size={18} color={colors.lavenderDark} />
            <Text style={styles.bannerText}>{infoMessage}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.otpRow}>
            {Array.from({ length: 6 }).map((_, index) => (
              <TextInput
                key={index}
                value={otp[index] || ''}
                style={[styles.otpInput, otp[index] && styles.otpInputFilled]}
                keyboardType="number-pad"
                maxLength={1}
                onChangeText={(value) => handleOtpChange(value, index)}
                onKeyPress={(event) => handleOtpKeyPress(event, index)}
                editable={!verifying && !isCodeExpired}
                selectionColor={colors.lavenderDark}
                accessibilityLabel={`Digit ${index + 1} ng 6 sa verification code`}
                ref={(ref) => {
                  otpRefs.current[index] = ref;
                }}
              />
            ))}
          </View>

          {secondsRemaining !== null && !isCodeExpired && (
            <Text style={styles.countdownText} accessibilityLiveRegion="polite">
              Mag-eexpire ang code sa <Text style={[styles.countdownValue, secondsRemaining <= 30 && { color: colors.coral }]}>{formatCountdown(secondsRemaining)}</Text>
            </Text>
          )}
          {isCodeExpired && (
            <Text style={[styles.countdownText, { color: colors.coral, fontWeight: '700' }]} accessibilityLiveRegion="polite">
              Nag-expire na ang code na ito. Pakipadala muli para makakuha ng bago.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.button, (verifying || otp.length !== 6 || isCodeExpired) && styles.buttonDisabled]}
            disabled={verifying || otp.length !== 6 || isCodeExpired}
            onPress={handleVerifyOTP}
          >
            {verifying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>I-verify ang Code</Text>
            )}
          </TouchableOpacity>

          <View style={styles.resendRow}>
            <Text style={styles.resendPrompt}>Hindi natanggap ang code? </Text>
            <TouchableOpacity
              onPress={handleSendOTP}
              disabled={loading || resendCooldown > 0}
            >
              <Text style={[styles.resendLink, (loading || resendCooldown > 0) && styles.resendLinkDisabled]}>
                {loading ? 'Ipinapadala...' : 'Ipadala Muli'}
              </Text>
            </TouchableOpacity>
          </View>
          {resendCooldown > 0 && (
            <Text style={styles.resendCooldownText}>Puwede nang ipadala muli sa {resendCooldown}s</Text>
          )}
        </View>

        <TouchableOpacity style={styles.backLink} onPress={() => navigation.replace('Login')}>
          <Ionicons name="arrow-back" size={16} color={colors.lavenderDark} />
          <Text style={styles.backLinkText}>Bumalik sa Login</Text>
        </TouchableOpacity>

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
  iconBadgeWrap: {
    marginBottom: 16,
  },
  iconBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.lavenderDark,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 10px 24px rgba(95,82,176,0.35)' },
      default: { shadowColor: colors.lavenderDark, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.35, shadowRadius: 24 },
    }),
  },
  iconBadgeSmall: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.cream,
  },
  title: {
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 6,
    fontFamily: typography.family.display,
    color: colors.ink,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: colors.inkSoft,
    marginBottom: 4,
  },
  emailHighlight: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.lavenderDark,
    textAlign: 'center',
    marginBottom: 8,
  },
  supportingText: {
    fontSize: 13,
    textAlign: 'center',
    color: colors.inkSoft,
    marginBottom: 16,
    paddingHorizontal: 28,
  },
  inputGroup: {
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.25)',
    borderRadius: 14,
    backgroundColor: '#FAF8F3',
    paddingHorizontal: 14,
    minHeight: 52,
  },
  emailInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    padding: 0,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 12,
    width: '100%',
    maxWidth: 420,
    marginHorizontal: 20,
  },
  errorBanner: {
    backgroundColor: 'rgba(224,107,76,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: colors.coral,
  },
  successBanner: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  infoBanner: {
    backgroundColor: 'rgba(124,111,207,0.1)',
    borderLeftWidth: 4,
    borderLeftColor: colors.lavenderDark,
  },
  bannerText: {
    flex: 1,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
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
    marginTop: 8,
    ...Platform.select({
      web: { boxShadow: '0px 20px 40px rgba(59,50,44,0.12)' },
      default: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  otpInput: {
    width: 44,
    height: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(124,111,207,0.3)',
    backgroundColor: '#FAF8F3',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  otpInputFilled: {
    borderColor: colors.lavenderDark,
    backgroundColor: '#F5F3FC',
  },
  countdownText: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.inkSoft,
    marginBottom: 18,
  },
  countdownValue: {
    fontWeight: '800',
    color: colors.lavenderDark,
  },
  button: {
    backgroundColor: colors.lavenderDark,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
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
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    flexWrap: 'wrap',
  },
  resendPrompt: {
    fontSize: 13,
    color: colors.inkSoft,
  },
  resendLink: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.lavenderDark,
  },
  resendLinkDisabled: {
    color: colors.inkSoft,
  },
  resendCooldownText: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: 4,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 22,
    paddingVertical: 8,
  },
  backLinkText: {
    color: colors.lavenderDark,
    fontWeight: '700',
    fontSize: 15,
  },
  trustNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 20,
  },
  trustNoteText: {
    color: colors.inkSoft,
    fontSize: 12,
    textAlign: 'center',
  },
});

export default EmailVerification;
