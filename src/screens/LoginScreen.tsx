import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ScrollView, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildApiUrl, postJson } from '../config/api';
import {
  signInUser, getChildByUsername, mapSupabaseAuthErrorCode,
  signInWithOAuthProvider, ensureUserProfileForOAuthUser, completeAuthSession, OAuthProvider,
} from '../services/supabaseService';
import { colors, typography } from '../theme';

interface LoginScreenProps {
  navigation: any;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const identifierInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [lastErrorCode, setLastErrorCode] = useState('');
  const [identifierError, setIdentifierError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [touchedIdentifier, setTouchedIdentifier] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

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

    const identifierValid = validateIdentifier(identifier);
    const passwordValid = validatePassword(password);
    if (!identifierValid || !passwordValid) {
      setGlobalError('Please fix the errors below');
      if (!identifierValid) identifierInputRef.current?.focus();
      else passwordInputRef.current?.focus();
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    try {
      const identifierValue = identifier.trim();
      // Credentials are frequently copy-pasted out of the enrollment email
      // (Gmail in particular tends to carry a trailing space or newline
      // along with a selected password), so trim before authenticating -
      // otherwise a byte-for-byte correct password silently fails to match.
      const passwordValue = password.trim();
      const isEmail = identifierValue.includes('@');
      let user: any;

      if (isEmail) {
        const loginEmail = identifierValue.toLowerCase();
        const { data, error } = await signInUser(loginEmail, passwordValue);
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

        const { data, error } = await signInUser(loginEmail, passwordValue);
        if (error || !data?.user) {
          if (error?.status === 404 || error?.message?.includes('user not found')) {
            console.log('Student auth user not found, creating auth account on login');
            await createStudentAuthAccount(identifierValue.toLowerCase(), passwordValue, studentData.name || identifierValue);
            const createResult = await signInUser(loginEmail, passwordValue);
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
    } catch (error: any) {
      const expectedAuthCodes = new Set([
        'auth/user-not-found',
        'auth/wrong-password',
        'auth/invalid-credential',
        'auth/invalid-email',
        'auth/email-not-confirmed',
        'auth/user-disabled',
        'auth/too-many-requests',
      ]);
      const errorDetails = {
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
      };
      if (expectedAuthCodes.has(error.code)) {
        // Invalid credentials are an expected form response. Logging them as
        // errors opens React Native's red LogBox in development mode.
        console.info('[Login] Login rejected:', errorDetails);
      } else {
        console.error('[Login] Unexpected login error:', errorDetails);
      }
      const friendlyError = mapAuthError(error.code || 'default');
      setGlobalError(friendlyError);
      setLastErrorCode(error.code || 'default');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

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
    } catch (error: any) {
      console.error('[Login] OAuth login error:', { provider, message: error?.message, code: error?.code });
      const providerLabel = provider === 'google' ? 'Google' : 'Facebook';
      setGlobalError(`Hindi ma-login gamit ang ${providerLabel}. Pakisubukang muli.`);
    } finally {
      setOauthLoading(null);
    }
  };

  const isBusy = loading || !!oauthLoading;
  // Supabase/backend authentication already applies server-side throttling.
  // A persistent client-only lockout was both bypassable and could strand a
  // legitimate user for an hour, so only an in-flight request disables taps.
  const isButtonDisabled = isBusy;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.backgroundDecor}>
          <View style={styles.circleTopLeft} />
          <View style={styles.circleRight} />
          <View style={styles.circleBottom} />
        </View>

        <View style={styles.topHeader}>
          <Image source={require('../../assets/Logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Maligayang pagbabalik!</Text>
          <Text style={styles.subtitle}>Mag-login para ipagpatuloy ang iyong paglalakbay sa pagbasa.</Text>
        </View>

        <View style={styles.card}>
          {globalError ? (
            <Text style={styles.globalError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {globalError}
            </Text>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={[
              styles.inputWrapper,
              (touchedIdentifier || submitAttempted) && identifierError && styles.inputError,
              (touchedIdentifier || submitAttempted) && !identifierError && identifier && styles.inputValid,
            ]}>
              <Ionicons name="mail-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
              <TextInput
                ref={identifierInputRef}
                style={styles.input}
                placeholder="Ilagay ang iyong email"
                placeholderTextColor={colors.inkSoft}
                value={identifier}
                onChangeText={(text) => {
                  setIdentifier(text);
                  validateIdentifier(text);
                }}
                onBlur={() => setTouchedIdentifier(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                editable={!loading}
                accessible={true}
                accessibilityLabel="Email input"
                accessibilityHint="Enter your email address to log in"
              />
              {(touchedIdentifier || submitAttempted) && identifier && !identifierError && (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
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
              <Ionicons name="lock-closed-outline" size={20} color={colors.lavenderDark} style={styles.inputLeadingIcon} />
              <TextInput
                ref={passwordInputRef}
                style={styles.input}
                placeholder="Ilagay ang iyong password"
                placeholderTextColor={colors.inkSoft}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  validatePassword(text);
                }}
                onBlur={() => setTouchedPassword(true)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={() => void handleLogin()}
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
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={colors.lavenderDark} />
              </TouchableOpacity>
            </View>
            {(touchedPassword || submitAttempted) && passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          </View>

          <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotPasswordRow}>
            <Text style={styles.link}>Nakalimutan ang Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, isButtonDisabled ? styles.buttonDisabled : {}]}
            onPress={() => void handleLogin()}
            disabled={isButtonDisabled}
            accessibilityRole="button"
            accessibilityLabel="Log In"
            accessibilityState={{ disabled: isButtonDisabled, busy: loading }}
          >
            <Text style={styles.buttonText}>{loading ? 'Nag-lo-log in...' : 'Mag-log In'}</Text>
          </TouchableOpacity>

          {/* Only after a login attempt failed specifically because the email
              isn't verified yet — not a permanent link on every visit. The
              post-signup case is already handled by EmailVerification's own
              resend flow, which the user is redirected to automatically. */}
          {lastErrorCode === 'auth/email-not-confirmed' && (
            <TouchableOpacity onPress={() => navigation.navigate('EmailVerification', { email: identifier })} style={styles.resendRow}>
              <Text style={styles.resendLink}>Ipadala Muli ang Verification Code</Text>
            </TouchableOpacity>
          )}

          <View style={styles.oauthDivider}>
            <View style={styles.oauthDividerLine} />
            <Text style={styles.oauthDividerText}>O</Text>
            <View style={styles.oauthDividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.oauthButton, (isBusy) && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthLogin('google')}
            disabled={isBusy}
          >
            <Ionicons name="logo-google" size={20} color="#DB4437" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'google' ? 'Kumokonekta...' : 'Magpatuloy gamit ang Google'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.oauthButton, { marginBottom: 0 }, (isBusy) && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthLogin('facebook')}
            disabled={isBusy}
          >
            <Ionicons name="logo-facebook" size={20} color="#1877F2" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'facebook' ? 'Kumokonekta...' : 'Magpatuloy gamit ang Facebook'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')} style={styles.signUpRow}>
          <Text style={styles.signUpLink}>Wala ka pang account? <Text style={styles.signUpLinkBold}>Mag-sign Up</Text></Text>
        </TouchableOpacity>

        {/* Standalone re-entry point for a user who signed up, closed the app
            before verifying, and has no active OTP session/route params to
            resume from — distinct from the resendRow above, which only
            appears right after a failed login tells us the email exists. */}
        <TouchableOpacity onPress={() => navigation.navigate('ResendVerification')} style={styles.signUpRow}>
          <Text style={styles.signUpLink}>Kailangan i-verify ang email mo? <Text style={styles.signUpLinkBold}>Ipadala Muli</Text></Text>
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
    fontFamily: typography.family.display,
    color: colors.ink,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 18,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: colors.inkSoft,
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
      default: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
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
    borderLeftColor: colors.coral,
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
    color: colors.ink,
    padding: 0,
    minHeight: 44,
  },
  inputValid: {
    borderColor: colors.success,
    backgroundColor: '#F2FBF4',
  },
  inputError: {
    borderColor: colors.coral,
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
    backgroundColor: colors.lavenderDark,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    elevation: 3,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(95,82,176,0.28)' },
      default: { shadowColor: colors.lavenderDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
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
    fontFamily: typography.family.displaySemi,
  },
  resendRow: {
    alignSelf: 'center',
    marginTop: 16,
    minHeight: 32,
    justifyContent: 'center',
  },
  resendLink: {
    color: colors.inkSoft,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  link: {
    color: colors.lavenderDark,
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
    color: colors.inkSoft,
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
    color: colors.ink,
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
    color: colors.inkSoft,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '500',
  },
  signUpLinkBold: {
    color: colors.lavenderDark,
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
    color: colors.inkSoft,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
});

export default LoginScreen;
