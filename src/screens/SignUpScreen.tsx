import React, { useRef, useState, useEffect } from 'react';
import {
  ImageBackground,
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
import { signUpUser, upsertUserProfile } from '../services/supabaseService';
import { ensureParentProfile } from '../services/profileService';
import { colors } from '../config/theme';
import { sendEmailOTP } from '../services/otpService';

interface SignUpScreenProps {
  navigation: any;
}

interface FormErrors {
  firstName: string;
  lastName: string;
  middleInitial: string;
  email: string;
  password: string;
  confirmPassword: string;
  terms: string;
  general: string;
  phoneNumber?: string;
  otp?: string;
}

interface FormValid {
  firstName: boolean;
  lastName: boolean;
  middleInitial: boolean;
  email: boolean;
  password: boolean;
  confirmPassword: boolean;
  terms: boolean;
}

type DeliveryMethod = 'email' | 'sms' | null;
type SignUpStep = 'form' | 'otp';

const SignUpScreen: React.FC<SignUpScreenProps> = ({ navigation }) => {
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleInitial, setMiddleInitial] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // OTP fields
  const [otp, setOtp] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>(null);

  const [resendCooldown, setResendCooldown] = useState(0);

  // UI states
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successInfo, setSuccessInfo] = useState('');
  const [step, setStep] = useState<SignUpStep>('form');

  const [errors, setErrors] = useState<FormErrors>({
    firstName: '',
    lastName: '',
    middleInitial: '',
    email: '',
    password: '',
    confirmPassword: '',
    terms: '',
    general: '',
    phoneNumber: '',
    otp: '',
  });

  const [valid, setValid] = useState<FormValid>({
    firstName: false,
    lastName: false,
    middleInitial: false,
    email: false,
    password: false,
    confirmPassword: false,
    terms: false,
  });

  const [touchedFirstName, setTouchedFirstName] = useState(false);
  const [touchedLastName, setTouchedLastName] = useState(false);
  const [touchedMiddleInitial, setTouchedMiddleInitial] = useState(false);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirmPassword, setTouchedConfirmPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const signupInFlightRef = useRef(false);

  const sanitizeName = (name: string) => name.replace(/[^a-zA-Z\s'-]/g, '').trim();
  const sanitizeEmail = (email: string) => email.toLowerCase().trim();

  // Cooldown timer for resend
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (resendCooldown > 0) {
      interval = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [resendCooldown]);

  useEffect(() => {
    validateField('firstName', firstName);
  }, [firstName]);

  useEffect(() => {
    validateField('lastName', lastName);
  }, [lastName]);

  useEffect(() => {
    validateField('middleInitial', middleInitial);
  }, [middleInitial]);

  useEffect(() => {
    validateField('email', email);
  }, [email]);

  useEffect(() => {
    validateField('password', password);
  }, [password]);

  useEffect(() => {
    validateField('confirmPassword', confirmPassword);
  }, [confirmPassword]);

  useEffect(() => {
    validateField('terms', termsAccepted);
  }, [termsAccepted]);

  const validateField = (field: string, value: any) => {
    let error = '';
    let isValid = false;

    switch (field) {
      case 'firstName':
        if (!value || value.trim().length < 2) error = 'Please enter your first name';
        else isValid = true;
        break;
      case 'lastName':
        if (!value || value.trim().length < 2) error = 'Please enter your last name';
        else isValid = true;
        break;
      case 'middleInitial':
        if (!value.trim()) error = 'Please enter your middle initial';
        else if (value.trim().length > 1) error = 'Please use only one letter';
        else isValid = true;
        break;
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!value) error = 'Please enter your email';
        else if (!emailRegex.test(value)) error = 'Please enter a valid email';
        else isValid = true;
        break;
      case 'password':
        if (!value) error = 'Please enter your password';
        else if (value.length < 8) error = 'Password needs at least 8 characters';
        else if (!/[A-Z]/.test(value)) error = 'Add one uppercase letter';
        else if (!/\d/.test(value)) error = 'Add one number';
        else isValid = true;
        break;
      case 'confirmPassword':
        if (!value) error = 'Please confirm your password';
        else if (value !== password) error = 'Passwords do not match';
        else isValid = true;
        break;
      case 'terms':
        if (!value) error = 'Please accept the terms to continue';
        else isValid = true;
        break;
    }

    setErrors((prev) => ({ ...prev, [field]: error }));
    setValid((prev) => ({ ...prev, [field]: isValid }));
  };

  const getPasswordStrength = () => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;

    if (score <= 2) return { label: 'Weak', color: '#d32f2f', width: 0.33 };
    if (score <= 3) return { label: 'Medium', color: '#f57c00', width: 0.66 };
    return { label: 'Strong', color: '#388e3c', width: 1 };
  };

  const isFormValid = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return (
      firstName.trim().length >= 2 &&
      lastName.trim().length >= 2 &&
      middleInitial.trim().length === 1 &&
      emailRegex.test(email.trim()) &&
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /\d/.test(password) &&
      confirmPassword === password &&
      termsAccepted
    );
  };

  const handleSignUp = async () => {
    if (signupInFlightRef.current) {
      console.log('[Signup] Duplicate signup submit ignored.');
      return;
    }

    // Clear previous messages
    setSuccessMessage('');
    setSuccessInfo('');
    setErrors((prev) => ({ ...prev, general: '' }));
    setSubmitAttempted(true);
    setTouchedFirstName(true);
    setTouchedLastName(true);
    setTouchedMiddleInitial(true);
    setTouchedEmail(true);
    setTouchedPassword(true);
    setTouchedConfirmPassword(true);

    const startAt = Date.now();


    validateField('firstName', firstName);
    validateField('lastName', lastName);
    validateField('middleInitial', middleInitial);
    validateField('email', email);
    validateField('password', password);
    validateField('confirmPassword', confirmPassword);
    validateField('terms', termsAccepted);

    if (!isFormValid()) {
      setErrors((prev) => ({ ...prev, general: 'Please fix all errors before submitting' }));
      return; // no setLoading here — loading was never set to true yet
    }

    signupInFlightRef.current = true;
    setLoading(true);
    try {
      const normalizedEmail = sanitizeEmail(email);
      console.log('[Signup] Starting signup for:', normalizedEmail);

      const { data: signUpData, error: signUpError } = await signUpUser(normalizedEmail, password, {

        firstName: sanitizeName(firstName),
        lastName: sanitizeName(lastName),
        middleInitial: middleInitial.toUpperCase() || '',
        role: 'parent',
        display_name: `${sanitizeName(firstName)} ${sanitizeName(lastName)}`,
      });

      if (signUpError || !signUpData?.user) {
        const status = signUpError?.status;
        const rawMessage = signUpError?.message || JSON.stringify(signUpError) || 'Unable to create account. Please try again.';

        console.error('[Signup] signUp returned error:', {
          ms: Date.now() - startAt,
          status,
          message: rawMessage,
          rawError: signUpError,
        });

        let errorMsg = rawMessage;
        const lower = String(rawMessage).toLowerCase();
        if (status === 504 || lower.includes('504') || lower.includes('gateway timeout')) {
          errorMsg = 'Supabase signup gateway timed out (504). This usually means your Supabase project is unable to send the verification email. Verify your SMTP/email auth settings in the Supabase dashboard.';
        } else if (lower.includes('already')) {
          errorMsg = 'This email is already registered. Please log in or use another email.';
        } else if (lower.includes('invalid')) {
          errorMsg = 'Invalid signup details. Please check your email and password.';
        }

        setErrors((prev) => ({ ...prev, general: errorMsg }));
        return;
      }

      const userId = signUpData.user.id;
      const fullName = `${sanitizeName(firstName)} ${sanitizeName(lastName)}`;

      console.log('[Signup] Creating user profile row:', { userId });
      const { error: userProfileError } = await upsertUserProfile({
        id: userId,
        name: fullName,
        email: normalizedEmail,
        role: 'parent',
        email_verified: false,
      });
      if (userProfileError) throw userProfileError;

      console.log('[Signup] Creating parent profile row:', { userId });
      try {
        await ensureParentProfile({
          id: userId,
          auth_uid: userId,
          full_name: fullName,
          name: fullName,
          email: normalizedEmail,
          phone_number: phoneNumber.trim() || undefined,
        });
      } catch (parentProfileError) {
        console.error('[Signup] Failed to create parent profile row:', parentProfileError);
      }

      await sendEmailOTP(normalizedEmail, userId);
      console.log('[Signup] Completed successfully:', { ms: Date.now() - startAt });

      setSuccessMessage('✅ Signup successful!');
      setSuccessInfo('Enter the verification code sent to your email, or resend if needed.');
      navigation.replace('EmailVerification', {
        email: normalizedEmail,
        userId,
        otpSent: true,
        message: 'Naipadala na ang OTP sa iyong email.',
      });
    } catch (error: any) {
      const rawMessage = error?.message || 'An error occurred during signup.';
      console.error('[Signup] signup flow threw:', {
        ms: Date.now() - startAt,
        status: error?.status,
        name: error?.name,
        message: rawMessage,
      });

      let errorMessage = 'An error occurred during signup.';
      const lower = String(rawMessage).toLowerCase();

      if (lower.includes('timed out') || lower.includes('timeout')) {
        errorMessage =
          'Signup timed out. Please check your internet connection — if you\'re on mobile data, ' +
          'try moving to a stronger signal or switching to Wi-Fi, then try again.';
      } else if (error?.status === 504 || lower.includes('504') || lower.includes('gateway timeout')) {
        errorMessage = 'Signup timed out (server timeout). Please verify your Supabase email verification settings and try again.';
      } else if (lower.includes('already exists') || lower.includes('already') || error?.status === 400) {
        errorMessage = 'This email is already registered. Please log in or use another email.';
      } else if (lower.includes('invalid email') || lower.includes('invalid')) {
        errorMessage = 'Invalid email format.';
      } else if (lower.includes('password')) {
        errorMessage = 'Password is too weak. Use 8+ characters, uppercase, and numbers.';
      } else if (rawMessage) {
        errorMessage = rawMessage;
      }

      setErrors((prev) => ({ ...prev, general: errorMessage }));
    } finally {
      signupInFlightRef.current = false;
      setLoading(false);
    }
  };

  const showTerms = () => {
    // In a real app, this would navigate to a Terms screen
    // For now, we'll just show a placeholder
  };

  const showPrivacy = () => {
    // In a real app, this would navigate to a Privacy screen
    // For now, we'll just show a placeholder
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ImageBackground
        source={require('../../assets/bg.jpg')}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contentWrapper}>
            <View style={styles.card}>
              <Image source={require('../../assets/Logo.jpg')} style={styles.logo} />

              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Join LinawLetra for personalized reading</Text>

          {/* General Error Message */}
              {errors.general ? (
                <View style={[styles.messageBanner, styles.errorBanner]}>
                  <Ionicons name="alert-circle" size={20} color="#d32f2f" style={styles.messageIcon} />
                  <Text style={styles.errorBannerText}>{errors.general}</Text>
                </View>
              ) : null}

              {/* Success Message */}
              {successMessage ? (
                <View style={[styles.messageBanner, styles.successBanner]}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={styles.messageIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.successBannerText}>{successMessage}</Text>
                    {successInfo ? (
                      <Text style={styles.successInfoText}>{successInfo}</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

          {/* First Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>First Name *</Text>
            <View style={[
              styles.inputWrapper,
              (touchedFirstName || submitAttempted) && errors.firstName ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="Enter first name"
                placeholderTextColor="#999"
                value={firstName}
                onChangeText={(text) => setFirstName(sanitizeName(text))}
                onBlur={() => setTouchedFirstName(true)}
                editable={!loading}
                autoCapitalize="words"
              />
              {valid.firstName && !errors.firstName && (
                <Ionicons name="checkmark-circle" size={20} color="#388e3c" style={styles.inputIcon} />
              )}
            </View>
            {(touchedFirstName || submitAttempted) && errors.firstName ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                <Text style={styles.errorFieldText}>{errors.firstName}</Text>
              </View>
            ) : null}
          </View>

          {/* Last Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last Name *</Text>
            <View style={[
              styles.inputWrapper,
              (touchedLastName || submitAttempted) && errors.lastName ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="Enter last name"
                placeholderTextColor="#999"
                value={lastName}
                onChangeText={(text) => setLastName(sanitizeName(text))}
                onBlur={() => setTouchedLastName(true)}
                editable={!loading}
                autoCapitalize="words"
              />
              {valid.lastName && !errors.lastName && (
                <Ionicons name="checkmark-circle" size={20} color="#388e3c" style={styles.inputIcon} />
              )}
            </View>
            {(touchedLastName || submitAttempted) && errors.lastName ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                <Text style={styles.errorFieldText}>{errors.lastName}</Text>
              </View>
            ) : null}
          </View>

          {/* Middle Initial */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Middle Initial *</Text>
            <View style={[
              styles.inputWrapper,
              (touchedMiddleInitial || submitAttempted) && errors.middleInitial ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="M"
                placeholderTextColor="#999"
                value={middleInitial}
                onChangeText={(text) => setMiddleInitial(text.toUpperCase().slice(0, 1))}
                onBlur={() => setTouchedMiddleInitial(true)}
                maxLength={1}
                editable={!loading}
              />
              {valid.middleInitial && !errors.middleInitial && (
                <Ionicons name="checkmark-circle" size={20} color="#388e3c" style={styles.inputIcon} />
              )}
            </View>
            {(touchedMiddleInitial || submitAttempted) && errors.middleInitial ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                <Text style={styles.errorFieldText}>{errors.middleInitial}</Text>
              </View>
            ) : null}
          </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address *</Text>
            <View style={[
              styles.inputWrapper,
              (touchedEmail || submitAttempted) && errors.email ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor="#999"
                value={email}
                onChangeText={(text) => setEmail(sanitizeEmail(text))}
                onBlur={() => setTouchedEmail(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
              />
              {valid.email && !errors.email && (
                <Ionicons name="checkmark-circle" size={20} color="#388e3c" style={styles.inputIcon} />
              )}
            </View>
            {(touchedEmail || submitAttempted) && errors.email ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                <Text style={styles.errorFieldText}>{errors.email}</Text>
              </View>
            ) : null}
          </View>

          {/* Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password *</Text>
            <View style={[
              styles.inputWrapper,
              (touchedPassword || submitAttempted) && errors.password ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="At least 8 characters"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                onBlur={() => setTouchedPassword(true)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                <Ionicons name={showPassword ? 'eye' : 'eye-off'} size={20} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Password Strength Indicator */}
            {password ? (
              <View style={styles.strengthContainer}>
                <View style={styles.strengthBarBackground}>
                  <View
                    style={[
                      styles.strengthBar,
                      { flex: getPasswordStrength().width, backgroundColor: getPasswordStrength().color },
                    ]}
                  />
                </View>
                <Text style={[styles.strengthText, { color: getPasswordStrength().color }]}>
                  {getPasswordStrength().label} password
                </Text>
              </View>
            ) : null}

            {/* Password Requirements */}
            {password && (
              <View style={styles.requirementsContainer}>
                <View style={styles.requirementItem}>
                  <Ionicons
                    name={password.length >= 8 ? 'checkmark-circle' : 'ellipse'}
                    size={14}
                    color={password.length >= 8 ? '#388e3c' : '#999'}
                  />
                  <Text style={[styles.requirementText, password.length >= 8 && styles.requirementMet]}>
                    At least 8 characters
                  </Text>
                </View>
                <View style={styles.requirementItem}>
                  <Ionicons
                    name={/[A-Z]/.test(password) ? 'checkmark-circle' : 'ellipse'}
                    size={14}
                    color={/[A-Z]/.test(password) ? '#388e3c' : '#999'}
                  />
                  <Text style={[styles.requirementText, /[A-Z]/.test(password) && styles.requirementMet]}>
                    One uppercase letter (A-Z)
                  </Text>
                </View>
                <View style={styles.requirementItem}>
                  <Ionicons
                    name={/\d/.test(password) ? 'checkmark-circle' : 'ellipse'}
                    size={14}
                    color={/\d/.test(password) ? '#388e3c' : '#999'}
                  />
                  <Text style={[styles.requirementText, /\d/.test(password) && styles.requirementMet]}>
                    One number (0-9)
                  </Text>
                </View>
              </View>
            )}

            {(touchedPassword || submitAttempted) && errors.password ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                <Text style={styles.errorFieldText}>{errors.password}</Text>
              </View>
            ) : null}
          </View>

          {/* Confirm Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password *</Text>
            <View style={[
              styles.inputWrapper,
              (touchedConfirmPassword || submitAttempted) && errors.confirmPassword ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
                placeholderTextColor="#999"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onBlur={() => setTouchedConfirmPassword(true)}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                <Ionicons name={showConfirmPassword ? 'eye' : 'eye-off'} size={20} color="#666" />
              </TouchableOpacity>
            </View>
            {(touchedConfirmPassword || submitAttempted) && errors.confirmPassword ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                <Text style={styles.errorFieldText}>{errors.confirmPassword}</Text>
              </View>
            ) : null}
          </View>

          {/* Terms and Conditions */}
              <View style={styles.termsContainer}>
                <TouchableOpacity onPress={() => setTermsAccepted(!termsAccepted)} style={styles.checkbox}>
                  <Ionicons
                    name={termsAccepted ? 'checkbox' : 'square-outline'}
                    size={24}
                    color={termsAccepted ? colors.primary : '#999'}
                  />
                </TouchableOpacity>
                <Text style={styles.termsText}>
                  I agree to the{' '}
                  <Text style={styles.link} onPress={showTerms}>
                    Terms and Conditions
                  </Text>
                  {' '}and{' '}
                  <Text style={styles.link} onPress={showPrivacy}>
                    Privacy Policy
                  </Text>
                </Text>
              </View>
              {(submitAttempted && errors.terms) ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color="#d32f2f" />
                  <Text style={styles.errorFieldText}>{errors.terms}</Text>
                </View>
              ) : null}

              {/* Sign Up Button */}
              <TouchableOpacity
                style={[styles.signUpButton, (!isFormValid() || loading) && styles.buttonDisabled]}
                onPress={handleSignUp}
                disabled={!isFormValid() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : (
                  <>
                    <Ionicons name="person-add" size={20} color="#fff" style={styles.buttonIcon} />
                    <Text style={styles.signUpButtonText}>Sign Up</Text>
                  </>
                )}
              </TouchableOpacity>

          {/* Sign In Link */}
              <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.signInContainer}>
                <Text style={styles.signInText}>Already have an account? </Text>
                <Text style={styles.signInLink}>Log in</Text>
              </TouchableOpacity>
            </View>
          </View>
      </ScrollView>
      </ImageBackground>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
  },
  scrollContainer: {
    flexGrow: 1,
    minHeight: '100%',
  },
  contentWrapper: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    marginHorizontal: 20,
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    shadowColor: '#122d18',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 34,
    elevation: 10,
    marginTop: 16,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  logo: {
    width: 150,
    height: 75,
    resizeMode: 'contain',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#1a1a1a',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#222',
    lineHeight: 24,
  },
  messageBanner: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  errorBanner: {
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  successBanner: {
    backgroundColor: '#e8f5e9',
    borderLeftWidth: 4,
    borderLeftColor: '#388e3c',
  },
  messageIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  errorBannerText: {
    color: '#FF9800',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    fontWeight: '500',
  },
  successBannerText: {
    color: colors.primary,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    fontWeight: '600',
  },
  successInfoText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#111',
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(153, 163, 173, 0.35)',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.86)',
    paddingHorizontal: 14,
    minHeight: 60,
  },
  inputWrapperError: {
    borderColor: '#FF9800',
    backgroundColor: '#FFF8E1',
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#111',
  },
  inputIcon: {
    marginLeft: 8,
  },
  eyeButton: {
    padding: 10,
    marginRight: -4,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  errorFieldText: {
    color: '#FF9800',
    fontSize: 12,
    marginLeft: 6,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    fontWeight: '500',
  },
  strengthContainer: {
    marginTop: 10,
  },
  strengthBarBackground: {
    height: 6,
    backgroundColor: '#eee',
    borderRadius: 3,
    flexDirection: 'row',
    marginBottom: 6,
  },
  strengthBar: {
    height: 6,
    borderRadius: 3,
  },
  strengthText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  requirementsContainer: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  requirementText: {
    fontSize: 12,
    marginLeft: 8,
    color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  requirementMet: {
    color: '#388e3c',
    fontWeight: '600',
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    marginTop: 8,
  },
  checkbox: {
    marginRight: 12,
    marginTop: 0,
    paddingRight: 0,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  link: {
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  signUpButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 24,
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  buttonIcon: {
    marginRight: 10,
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
    elevation: 0,
    shadowOpacity: 0,
  },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  signInText: {
    fontSize: 14,
    color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  signInLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
});

export default SignUpScreen;
