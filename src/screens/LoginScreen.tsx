import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildApiUrl, postJson } from '../config/api';
import { signInUser, getChildByUsername, getChildByAuthUid, getUserProfileById, mapSupabaseAuthErrorCode, upsertUserProfile } from '../services/supabaseService';
import { supabase } from '../config/supabase';

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
const HOME_LAVENDER = '#7C6FCF';
const HOME_LAVENDER_DARK = '#5F52B0';
const SUCCESS = '#10b981';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');
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
    setIdentifierError('');
    setPasswordError('');
  };

  const buildStudentAuthEmail = (username: string) => {
    return `${username.toLowerCase()}@student.linawletra.app`;
  };

  const normalizeRole = (role?: string) => {
    return typeof role === 'string' ? role.trim().toLowerCase() : '';
  };

  const determineUserRole = (loginIsUsername: boolean, profileRole?: string, email?: string) => {
    // Username login is always a student
    if (loginIsUsername) {
      return 'student';
    }

    const normalizedRole = normalizeRole(profileRole);

    // Explicit role set — trust it
    if (normalizedRole === 'student') {
      return 'student';
    }
    if (normalizedRole === 'teacher') {
      return 'teacher';
    }
    if (normalizedRole === 'parent') {
      return 'parent';
    }

    // Email pattern fallback
    if (
      email?.toLowerCase().endsWith('@student.linawletra.app') ||
      email?.toLowerCase().includes('@student.')
    ) {
      return 'student';
    }

    // No role set yet — return null to trigger child lookup
    return null;
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
      const loginIsUsername = !isEmail;
      let user: any;
      let profileData: any = null;
      let profileRole = '';
      let loginEmail = '';

      if (isEmail) {
        loginEmail = identifierValue.toLowerCase();
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
        loginEmail = studentData.auth_email || buildStudentAuthEmail(identifierValue.toLowerCase());

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

      console.log('Login successful for user:', user.email);
      try {
        const sessionRes = await supabase.auth.getSession();
        console.log('[Login] supabase.getSession after signIn:', { session: sessionRes?.data?.session });
      } catch (sessionErr) {
        console.error('[Login] supabase.getSession error:', sessionErr);
      }
      // We'll check Supabase Auth first, then fall back to our public.users.email_verified flag
      let emailVerified = !!user.email_confirmed_at;

      if (isEmail) {
        const profileResult = await getUserProfileById(user.id);
        console.log('[Login] Profile lookup after auth:', {
          userId: user.id,
          hasProfile: !!profileResult.data,
          profileRole: profileResult.data?.role,
          profileEmail: profileResult.data?.email,
          profileError: profileResult.error
            ? {
                message: profileResult.error.message,
                code: profileResult.error.code,
                details: profileResult.error.details,
              }
            : null,
        });
        profileData = profileResult.data;

        // Try to determine role from profile
        const determinedRole = determineUserRole(loginIsUsername, profileData?.role, user.email || undefined);

        // If role is null OR role might be wrong (no explicit role set), ALWAYS check children table
        // This handles web-enrolled students who have a users row but no role set
        if (!determinedRole || determinedRole === null) {
          const childLookup = await getChildByAuthUid(user.id);
          if (childLookup.data) {
            console.log('[Login] Found child record — setting role to student');
            profileRole = 'student';
            profileData = { ...(profileData || {}), name: childLookup.data.name };
          } else {
            profileRole = '';
          }
        } else {
          profileRole = determinedRole;

          // Even if profile says parent/teacher, double-check children table
          // (web enrollments sometimes create users with wrong role)
          if (profileRole !== 'student') {
            const childLookup = await getChildByAuthUid(user.id);
            if (childLookup.data) {
              console.log('[Login] Profile role was', profileRole, 'but found child record — overriding to student');
              profileRole = 'student';
              profileData = { ...(profileData || {}), name: childLookup.data.name };
            }
          }
        }

        // If auth hasn't marked email confirmed for some reason, use profile.email_verified
        if (!emailVerified && profileData?.email_verified) {
          emailVerified = true;
        }
      } else {
        profileRole = 'student';
        profileData = { name: user.user_metadata?.full_name || user.email };
      }

      if (isEmail && !emailVerified) {
        console.log('User email not verified, redirecting to verification screen');
        navigation.replace('EmailVerification', {
          email: user.email,
          userId: user.id,
          message: 'Your email is not verified. Enter the 6-digit code sent to your email to continue.',
        });
      } else {
        await upsertUserProfile({ id: user.id, lastLoginAt: new Date().toISOString() });
        resetAttempts();

        if (profileRole === 'parent') {
          console.log('[Login] → ParentDashboard');
          navigation.replace('ParentDashboard');
        } else if (profileRole === 'student') {
          console.log('[Login] → StudentDashboard');
          navigation.replace('StudentDashboard');
        } else if (profileRole === 'teacher') {
          console.log('[Login] → ParentDashboard (teacher placeholder)');
          // TODO: navigation.replace('TeacherDashboard') once built
          navigation.replace('ParentDashboard');
        } else {
          console.error('[Login] Could not determine role for user:', user.id);
          setGlobalError(`Hindi kilala ang account type. Makipag-ugnayan sa admin.`);
          setLoading(false);
        }
      }
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

  const isButtonDisabled = !identifier || !password || loading || (blockedUntil && Date.now() < blockedUntil);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.backgroundDecor}>
          <View style={styles.circleTopLeft} />
          <View style={styles.circleRight} />
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

          <TouchableOpacity onPress={() => navigation.navigate('EmailVerification', { email: identifier })} style={styles.resendRow}>
            <Text style={styles.resendLink}>Resend Verification Code</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')} style={styles.signUpRow}>
          <Text style={styles.signUpLink}>Don't have an account? <Text style={styles.signUpLinkBold}>Sign Up</Text></Text>
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
    justifyContent: 'center',
    backgroundColor: HOME_CREAM,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
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
    backgroundColor: 'rgba(124,111,207,0.12)',
  },
  circleRight: {
    position: 'absolute',
    top: 28,
    right: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(224,107,76,0.10)',
  },
  topHeader: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
    paddingTop: 18,
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
      web: { boxShadow: '0px 16px 34px rgba(59,50,44,0.10)' },
      default: { shadowColor: HOME_INK, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.08, shadowRadius: 34 },
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
