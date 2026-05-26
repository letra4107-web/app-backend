import React, { useState, useEffect } from 'react';
import { ImageBackground, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../config/theme';
import { API_BASE_URL, postJson } from '../config/api';
import { signInUser, getChildByUsername, getChildByAuthUid, getUserProfileById, mapSupabaseAuthErrorCode, upsertUserProfile } from '../services/supabaseService';

interface LoginScreenProps {
  navigation: any;
}

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
    const data = await postJson(`${API_BASE_URL}/auth/create-student-account`, { username, password, displayName });
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
      let profileRole = 'parent';
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
            // No child record found and no role — default to parent
            profileRole = 'parent';
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
      <ImageBackground
        source={require('../../assets/bg.jpg')}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.backgroundDecor}>
            <View style={styles.circleTopLeft} />
            <View style={styles.circleRight} />
          </View>
          <View style={styles.topHeader}>
            <Image source={require('../../assets/Logo.jpg')} style={styles.logo} />
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Login to continue your learning journey.</Text>
          </View>
          <View style={styles.card}>
        {globalError ? <Text style={styles.globalError}>{globalError}</Text> : null}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email </Text>
          <View style={[
            styles.inputWrapper,
            (touchedIdentifier || submitAttempted) && identifierError && styles.inputError,
            (touchedIdentifier || submitAttempted) && !identifierError && identifier && styles.inputValid,
          ]}>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor="#888"
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
          </View>
          {(touchedIdentifier || submitAttempted) && identifier && !identifierError && (
            <Ionicons name="checkmark-circle" size={20} color="#1D5E2B" style={styles.icon} />
          )}
          {(touchedIdentifier || submitAttempted) && identifierError ? <Text style={styles.errorText}>{identifierError}</Text> : null}
        </View>


        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={[
            styles.inputWrapper,
            (touchedPassword || submitAttempted) && passwordError && styles.inputError,
            (touchedPassword || submitAttempted) && !passwordError && password && styles.inputValid,
          ]}>
            <TextInput
              style={[styles.input, { paddingRight: 48 }]}
              placeholder="Enter your password"
              placeholderTextColor="#888"
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
              <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {(touchedPassword || submitAttempted) && passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
        </View>

        <TouchableOpacity style={[styles.button, isButtonDisabled ? styles.buttonDisabled : {}]} onPress={handleLogin} disabled={!!isButtonDisabled}>
          <Text style={styles.buttonText}>{loading ? 'Logging in...' : 'Login'}</Text>
        </TouchableOpacity>

        <View style={styles.links}>
          <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
            <Text style={styles.link}>Forgot Password?</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('EmailVerification', { email: identifier })}>
            <Text style={styles.link}>Resend Verification Code</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomDividerContainer}>
          <View style={styles.bottomDivider} />
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.signUpLink}>Don't have an account? Create one now</Text>
        </TouchableOpacity>
      </View>
        </ScrollView>
      </ImageBackground>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#EDF6F1',
    paddingVertical: 24,
  },
  backgroundDecor: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  topHeader: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
    paddingTop: 18,
  },
  circleTopLeft: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#EAF2DF',
  },
  circleRight: {
    position: 'absolute',
    top: 28,
    right: -90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#EFF6EA',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    marginHorizontal: 20,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    shadowColor: '#112b17',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 34,
    elevation: 10,
    marginTop: 14,
  },
  title: {
    fontSize: 30,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif-medium',
    fontWeight: '800',
    color: '#163E1F',
    letterSpacing: 0.4,
  },
  logo: {
    width: 165,
    height: 80,
    resizeMode: 'contain',
    alignSelf: 'center',
    marginBottom: 10,
  },
  globalError: {
    color: '#9F411E',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    backgroundColor: 'rgba(255, 239, 230, 0.95)',
    padding: 14,
    borderRadius: 18,
    borderLeftWidth: 4,
    borderLeftColor: '#E57A56',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 18,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: '#4D5D4B',
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 15,
    marginBottom: 8,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#1B5E20',
    letterSpacing: 0.2,
  },
  inputWrapper: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(162, 172, 179, 0.4)',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 60,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#17212b',
    padding: 0,
    minHeight: 44,
  },
  inputValid: {
    borderColor: '#1D7032',
    backgroundColor: '#F2FBF4',
  },
  inputError: {
    borderColor: '#E48C26',
    backgroundColor: '#FFF8E8',
  },
  passwordToggle: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  icon: {
    position: 'absolute',
    right: 16,
    top: 44,
  },
  errorText: {
    color: '#D84315',
    fontSize: 12,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeIcon: {
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeToggleText: {
    display: 'none',
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    marginTop: 16,
    elevation: 3,
    shadowColor: '#163E1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
  },
  buttonDisabled: {
    backgroundColor: '#BEC2C4',
    opacity: 0.7,
    elevation: 0,
    shadowOpacity: 0,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  bottomDividerContainer: {
    marginTop: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  bottomDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#DCE6D7',
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  link: {
    color: '#1D5E2B',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '400',
  },
  signUpLink: {
    textAlign: 'center',
    marginTop: 10,
    color: '#1D5E2B',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '400',
  },
  helpTextContainer: {
    marginBottom: 15,
    paddingHorizontal: 5,
  },
  helpText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    lineHeight: 20,
  },
});

export default LoginScreen;
