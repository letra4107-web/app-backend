import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildApiUrl, postJson } from '../config/api';
import {
  signInUser, getChildByUsername, mapSupabaseAuthErrorCode,
  signInWithOAuthProvider, ensureUserProfileForOAuthUser, completeAuthSession, OAuthProvider,
} from '../services/supabaseService';

interface LoginScreenProps {
  navigation: any;
}

// Same warm "reading journey" identity tokens used across the redesigned
// dashboard (Home/Practice/Badges/Settings) — extended here so the auth flow
// feels like the same app instead of its own separate green theme.
const HOME_CREAM = '#FBF3E2';
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#8A7B6C';
const HOME_CORAL = '#E06B4C';
const HOME_LAVENDER_DARK = '#5F52B0';
const SUCCESS = '#10b981';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [lastErrorCode, setLastErrorCode] = useState('');
  const [identifierError, setIdentifierError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [touchedIdentifier, setTouchedIdentifier] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    loadAttempts();
  }, []);

  const loadAttempts = async () => {
    const storedAttempts = await AsyncStorage.getItem('loginAttempts');
    const storedBlocked = await AsyncStorage.getItem('blockedUntil');
    if (storedAttempts) setAttempts(parseInt(storedAttempts));
    if (storedBlocked) {
      const blockedTime = parseInt(storedBlocked);
      if (Date.now() < blockedTime) {
        setBlockedUntil(blockedTime);
      } else {
        resetAttempts();
      }
    }
  };

  const saveAttempts = async () => {
    await AsyncStorage.setItem('loginAttempts', attempts.toString());
    if (blockedUntil) await AsyncStorage.setItem('blockedUntil', blockedUntil.toString());
  };

  const resetAttempts = async () => {
    setAttempts(0);
    setBlockedUntil(null);
    await AsyncStorage.removeItem('loginAttempts');
    await AsyncStorage.removeItem('blockedUntil');
  };

  const validateIdentifier = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setIdentifierError('Please enter your email or username');
      return false;
    }

    if (trimmed.includes('@')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        setIdentifierError('Please enter a valid email address');
        return false;
      }
    }

    setIdentifierError('');
    return true;
  };

  const validatePassword = (value: string) => {
    if (!value) {
      setPasswordError('Please enter your password');
      return false;
    }
    setPasswordError('');
    return true;
  };

  const clearErrors = () => {
    setGlobalError('');
    setLastErrorCode('');
    setIdentifierError('');
    setPasswordError('');
  };

  const buildStudentAuthEmail = (username: string) => {
    return `${username.toLowerCase()}@student.linawletra.app`;
  };

  const createStudentAuthAccount = async (username: string, password: string, displayName: string) => {
    const data = await postJson(buildApiUrl('/auth/create-student-account'), { username, password, displayName });
    if (!data?.success) {
      throw new Error(data?.message || 'Unable to create student auth account');
    }
    return { authUid: data.authUid, authEmail: data.authEmail || buildStudentAuthEmail(username) };
  };

  const mapAuthError = (error: string) => {
    switch (error) {
      case 'auth/user-not-found':
        return 'No account found with this email or username';
      case 'auth/wrong-password':
        return 'Incorrect password';
      case 'auth/too-many-requests':
        return 'Too many login attempts. Please try again later.';
      case 'auth/user-disabled':
        return 'This account has been disabled';
      case 'auth/invalid-email':
        return 'Please enter a valid email address';
      case 'auth/invalid-credential':
        return 'Invalid credentials. Please verify your email and password.';
      case 'auth/email-not-confirmed':
        return 'Please verify your email before logging in.';
      default:
        return 'Invalid email or username or password';
    }
  };

  const throwSupabaseLoginError = (error: any) => {
    const authError: any = new Error(error?.message || 'Invalid login credentials');
    authError.code = mapSupabaseAuthErrorCode(error);
    authError.status = error?.status;
    authError.supabaseError = error;
    throw authError;
  };

  const handleLogin = async () => {
    clearErrors();
    setSubmitAttempted(true);
    setTouchedIdentifier(true);
    setTouchedPassword(true);

    if (blockedUntil && Date.now() < blockedUntil) {
      setGlobalError('Too many login attempts. Try again in 1 hour.');
      return;
    }
    const identifierValid = validateIdentifier(identifier);
    const passwordValid = validatePassword(password);
    if (!identifierValid || !passwordValid) {
      setGlobalError('Please fix the errors below');
      return;
    }

    setLoading(true);
    try {
      const identifierValue = identifier.trim();
      const isEmail = identifierValue.includes('@');
      let user: any;

      if (isEmail) {
        const loginEmail = identifierValue.toLowerCase();
        console.log('[Login] Attempting email/password login:', {
          email: loginEmail,
          identifierChangedByTrim: identifier !== identifier.trim(),
          passwordLength: password.length,
          passwordTrimmedLength: password.trim().length,
          passwordHasOuterWhitespace: password !== password.trim(),
        });
        const { data, error } = await signInUser(loginEmail, password);
        if (error || !data?.user) {
          throwSupabaseLoginError(error);
        }
        user = data.user;
      } else {
        console.log('Attempting login for username:', identifierValue.toLowerCase());
        const childResult = await getChildByUsername(identifierValue.toLowerCase());
        if (childResult.error || !childResult.data) {
          const notFoundError: any = new Error('Student account not found');
          notFoundError.code = 'auth/user-not-found';
          throw notFoundError;
        }
        const studentData = childResult.data;
        const loginEmail = studentData.auth_email || buildStudentAuthEmail(identifierValue.toLowerCase());

        const { data, error } = await signInUser(loginEmail, password);
        if (error || !data?.user) {
          if (error?.status === 404 || error?.message?.includes('user not found')) {
            console.log('Student auth user not found, creating auth account on login');
            await createStudentAuthAccount(identifierValue.toLowerCase(), password, studentData.name || identifierValue);
            const createResult = await signInUser(loginEmail, password);
            if (createResult.error || !createResult.data?.user) {
              throw new Error('Unable to sign in after creating student account.');
            }
            user = createResult.data.user;
          } else {
            throwSupabaseLoginError(error);
          }
        } else {
          user = data.user;
        }
      }

      await completeAuthSession(user, isEmail, navigation, (message) => setGlobalError(message));
      resetAttempts();
    } catch (error: any) {
      console.error('[Login] Login error:', {
        code: error.code,
        status: error.status,
        message: error.message,
        supabaseError: error.supabaseError
          ? {
              name: error.supabaseError.name,
              message: error.supabaseError.message,
              status: error.supabaseError.status,
              code: error.supabaseError.code,
            }
          : null,
      });
      const friendlyError = mapAuthError(error.code || 'default');
      setGlobalError(friendlyError);
      setLastErrorCode(error.code || 'default');
      setPassword('');
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 5) {
        const blockTime = Date.now() + 60 * 60 * 1000; // 1 hour
        setBlockedUntil(blockTime);
      }
      saveAttempts();
    } finally {
      setLoading(false);
    }
  };

  // Google/Facebook are not subject to the password-guessing lockout above —
  // that mechanism exists specifically to slow down password brute-forcing,
  // which doesn't apply here, so no attempts/blockedUntil bookkeeping.
  const handleOAuthLogin = async (provider: OAuthProvider) => {
    clearErrors();
    setOauthLoading(provider);
    try {
      const { data, error } = await signInWithOAuthProvider(provider);
      if (error) {
        if (error.code === 'auth/oauth-cancelled') return;
        throw error;
      }
      if (!data?.user) return; // web: full-page redirect already in flight
      await ensureUserProfileForOAuthUser(data.user);
      await completeAuthSession(data.user, true, navigation, (message) => setGlobalError(message));
      resetAttempts();
    } catch (error: any) {
      console.error('[Login] OAuth login error:', { provider, message: error?.message, code: error?.code });
      const providerLabel = provider === 'google' ? 'Google' : 'Facebook';
      setGlobalError(`Hindi ma-login gamit ang ${providerLabel}. Pakisubukang muli.`);
    } finally {
      setOauthLoading(null);
    }
  };

  const isBusy = loading || !!oauthLoading;
  const isRateLimited = !!blockedUntil && Date.now() < blockedUntil;
  // Only look "disabled" once the user has actually tried to submit with a
  // problem, or while something is genuinely in flight — not merely because
  // the form is untouched on first load.
  const hasValidationBlock = submitAttempted && (!!identifierError || !!passwordError || !identifier || !password);
  const isButtonDisabled = isBusy || isRateLimited || hasValidationBlock;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.backgroundDecor}>
          <View style={styles.circleTopLeft} />
          <View style={styles.circleRight} />
          <View style={styles.circleBottom} />
        </View>

        <View style={styles.topHeader}>
          <Image source={require('../../assets/Logo.jpg')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Welcome back!</Text>
          <Text style={styles.subtitle}>Login to continue your reading journey.</Text>
        </View>

        <View style={styles.card}>
          {globalError ? <Text style={styles.globalError}>{globalError}</Text> : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={[
              styles.inputWrapper,
              (touchedIdentifier || submitAttempted) && identifierError && styles.inputError,
              (touchedIdentifier || submitAttempted) && !identifierError && identifier && styles.inputValid,
            ]}>
              <Ionicons name="mail-outline" size={20} color={HOME_LAVENDER_DARK} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor={HOME_INK_SOFT}
                value={identifier}
                onChangeText={(text) => {
                  setIdentifier(text);
                  validateIdentifier(text);
                }}
                onBlur={() => setTouchedIdentifier(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
                accessible={true}
                accessibilityLabel="Email input"
                accessibilityHint="Enter your email address to log in"
              />
              {(touchedIdentifier || submitAttempted) && identifier && !identifierError && (
                <Ionicons name="checkmark-circle" size={20} color={SUCCESS} />
              )}
            </View>
            {(touchedIdentifier || submitAttempted) && identifierError ? <Text style={styles.errorText}>{identifierError}</Text> : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={[
              styles.inputWrapper,
              (touchedPassword || submitAttempted) && passwordError && styles.inputError,
              (touchedPassword || submitAttempted) && !passwordError && password && styles.inputValid,
            ]}>
              <Ionicons name="lock-closed-outline" size={20} color={HOME_LAVENDER_DARK} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={HOME_INK_SOFT}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  validatePassword(text);
                }}
                onBlur={() => setTouchedPassword(true)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
                accessible={true}
                accessibilityLabel="Password input"
                accessibilityHint="Enter your password. Password is hidden by default"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.passwordToggle}
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={HOME_LAVENDER_DARK} />
              </TouchableOpacity>
            </View>
            {(touchedPassword || submitAttempted) && passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          </View>

          <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotPasswordRow}>
            <Text style={styles.link}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, isButtonDisabled ? styles.buttonDisabled : {}]} onPress={handleLogin} disabled={!!isButtonDisabled}>
            <Text style={styles.buttonText}>{loading ? 'Logging in...' : 'Log In'}</Text>
          </TouchableOpacity>

          {/* Only after a login attempt failed specifically because the email
              isn't verified yet — not a permanent link on every visit. The
              post-signup case is already handled by EmailVerification's own
              resend flow, which the user is redirected to automatically. */}
          {lastErrorCode === 'auth/email-not-confirmed' && (
            <TouchableOpacity onPress={() => navigation.navigate('EmailVerification', { email: identifier })} style={styles.resendRow}>
              <Text style={styles.resendLink}>Resend Verification Code</Text>
            </TouchableOpacity>
          )}

          <View style={styles.oauthDivider}>
            <View style={styles.oauthDividerLine} />
            <Text style={styles.oauthDividerText}>OR</Text>
            <View style={styles.oauthDividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.oauthButton, (isBusy) && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthLogin('google')}
            disabled={isBusy}
          >
            <Ionicons name="logo-google" size={20} color="#DB4437" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'google' ? 'Connecting...' : 'Continue with Google'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.oauthButton, { marginBottom: 0 }, (isBusy) && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthLogin('facebook')}
            disabled={isBusy}
          >
            <Ionicons name="logo-facebook" size={20} color="#1877F2" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')} style={styles.signUpRow}>
          <Text style={styles.signUpLink}>Don&apos;t have an account? <Text style={styles.signUpLinkBold}>Sign Up</Text></Text>
        </TouchableOpacity>

        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={HOME_INK_SOFT} />
          <Text style={styles.trustNoteText}>Ligtas at pribado ang iyong impormasyon.</Text>
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
  circleBottom: {
    position: 'absolute',
    bottom: -100,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(92,128,71,0.08)',
  },
  topHeader: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
  },
  logo: {
    width: 220,
    height: 110,
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 26,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: FONT_DISPLAY,
    color: HOME_INK,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 18,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: HOME_INK_SOFT,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.14)',
    elevation: 10,
    marginTop: 14,
    // "shadow*" props are deprecated on web in favor of a real CSS boxShadow
    // string, but remain the correct (and only) cross-platform way to draw a
    // shadow on native iOS/Android, so the two are split per-platform here.
    ...Platform.select({
      web: { boxShadow: '0px 20px 40px rgba(59,50,44,0.12)' },
      default: { shadowColor: HOME_INK, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  globalError: {
    color: '#9A3412',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    backgroundColor: 'rgba(224,107,76,0.12)',
    padding: 14,
    borderRadius: 18,
    borderLeftWidth: 4,
    borderLeftColor: HOME_CORAL,
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
    backgroundColor: '#FAF8F3',
    borderWidth: 1,
    borderColor: 'rgba(124,111,207,0.25)',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 60,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  inputLeadingIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: HOME_INK,
    padding: 0,
    minHeight: 44,
  },
  inputValid: {
    borderColor: SUCCESS,
    backgroundColor: '#F2FBF4',
  },
  inputError: {
    borderColor: HOME_CORAL,
    backgroundColor: '#FDF3EF',
  },
  passwordToggle: {
    paddingLeft: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#B3441F',
    fontSize: 12,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
  },
  forgotPasswordRow: {
    alignSelf: 'flex-end',
    marginBottom: 18,
    minHeight: 32,
    justifyContent: 'center',
  },
  button: {
    backgroundColor: HOME_LAVENDER_DARK,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    elevation: 3,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(95,82,176,0.28)' },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
    }),
  },
  buttonDisabled: {
    backgroundColor: '#C7C2D6',
    opacity: 0.8,
    elevation: 0,
    ...Platform.select({
      web: { boxShadow: 'none' },
      default: { shadowOpacity: 0 },
    }),
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: FONT_DISPLAY_SEMI,
  },
  resendRow: {
    alignSelf: 'center',
    marginTop: 16,
    minHeight: 32,
    justifyContent: 'center',
  },
  resendLink: {
    color: HOME_INK_SOFT,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  link: {
    color: HOME_LAVENDER_DARK,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '700',
  },
  oauthDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 16,
  },
  oauthDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(59,50,44,0.14)',
  },
  oauthDividerText: {
    color: HOME_INK_SOFT,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(59,50,44,0.14)',
    borderRadius: 16,
    paddingVertical: 14,
    minHeight: 52,
    marginBottom: 12,
  },
  oauthButtonDisabled: {
    opacity: 0.6,
  },
  oauthButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: HOME_INK,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  signUpRow: {
    marginTop: 20,
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
  },
  signUpLink: {
    textAlign: 'center',
    color: HOME_INK_SOFT,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '500',
  },
  signUpLinkBold: {
    color: HOME_LAVENDER_DARK,
    fontWeight: '800',
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
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
});

export default LoginScreen;
