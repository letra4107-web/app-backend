import React, { useRef, useState, useEffect } from 'react';
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
import {
  signUpUser, upsertUserProfile,
  signInWithOAuthProvider, ensureUserProfileForOAuthUser, completeAuthSession, OAuthProvider,
} from '../services/supabaseService';
import { ensureParentProfile } from '../services/profileService';
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

// Same warm "reading journey" identity tokens used on the Login screen and
// across the redesigned dashboard — this screen should read as a
// continuation of the same flow, not a separate style.
const HOME_CREAM = '#FBF3E2';
const HOME_INK = '#3B322C';
const HOME_INK_SOFT = '#8A7B6C';
const HOME_CORAL = '#E06B4C';
const HOME_LAVENDER_DARK = '#5F52B0';
const SUCCESS = '#10b981';
const FONT_DISPLAY = 'Baloo2_800ExtraBold';
const FONT_DISPLAY_SEMI = 'Baloo2_600SemiBold';

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
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
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
        // Genuinely optional — empty is valid. Only complain if somehow more
        // than one character got in (the input itself already caps at 1).
        if (value.trim().length > 1) error = 'Please use only one letter';
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
      middleInitial.trim().length <= 1 &&
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

      const otpResult = await sendEmailOTP(normalizedEmail, userId);
      console.log('[Signup] Completed successfully:', { ms: Date.now() - startAt });

      setSuccessMessage('✅ Signup successful!');
      setSuccessInfo('Enter the verification code sent to your email, or resend if needed.');
      navigation.replace('EmailVerification', {
        email: normalizedEmail,
        userId,
        otpSent: true,
        expiresAt: otpResult?.expiresAt,
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

  // Same signInWithOAuth flow as the Login screen — Supabase creates the
  // account automatically on first OAuth sign-in, and Google/Facebook already
  // verify the email on their end (user.email_confirmed_at comes back true),
  // so completeAuthSession routes straight to the dashboard and never
  // involves the OTP screen at all. ensureUserProfileForOAuthUser is the same
  // idempotent helper the Login screen uses — not duplicated here.
  const handleOAuthSignUp = async (provider: OAuthProvider) => {
    setErrors((prev) => ({ ...prev, general: '' }));
    setOauthLoading(provider);
    try {
      const { data, error } = await signInWithOAuthProvider(provider);
      if (error) {
        if (error.code === 'auth/oauth-cancelled') return;
        throw error;
      }
      if (!data?.user) return; // web: full-page redirect already in flight
      await ensureUserProfileForOAuthUser(data.user);
      await completeAuthSession(data.user, true, navigation, (message) => setErrors((prev) => ({ ...prev, general: message })));
    } catch (error: any) {
      console.error('[Signup] OAuth signup error:', { provider, message: error?.message, code: error?.code });
      const providerLabel = provider === 'google' ? 'Google' : 'Facebook';
      setErrors((prev) => ({ ...prev, general: `Hindi ma-signup gamit ang ${providerLabel}. Pakisubukang muli.` }));
    } finally {
      setOauthLoading(null);
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

  const isBusy = loading || !!oauthLoading;

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
          <Text style={styles.title}>Create Your Account</Text>
          <Text style={styles.subtitle}>Let&apos;s get started with LinawLetra.</Text>
          <Text style={styles.supportingText}>Create a parent account to support your child&apos;s reading journey.</Text>
        </View>

        <View style={styles.card}>
          {errors.general ? (
            <View style={styles.messageBanner}>
              <Ionicons name="alert-circle" size={20} color={HOME_CORAL} style={styles.messageIcon} />
              <Text style={styles.errorBannerText}>{errors.general}</Text>
            </View>
          ) : null}

          {successMessage ? (
            <View style={[styles.messageBanner, styles.successBanner]}>
              <Ionicons name="checkmark-circle" size={20} color={SUCCESS} style={styles.messageIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.successBannerText}>{successMessage}</Text>
                {successInfo ? <Text style={styles.successInfoText}>{successInfo}</Text> : null}
              </View>
            </View>
          ) : null}

          <View style={styles.nameRow}>
            <View style={[styles.inputGroup, styles.nameField]}>
              <Text style={styles.label}>First Name</Text>
              <View style={[
                styles.inputWrapper,
                (touchedFirstName || submitAttempted) && errors.firstName ? styles.inputWrapperError : null,
              ]}>
                <TextInput
                  style={styles.input}
                  placeholder="First Name"
                  placeholderTextColor={HOME_INK_SOFT}
                  value={firstName}
                  onChangeText={(text) => setFirstName(sanitizeName(text))}
                  onBlur={() => setTouchedFirstName(true)}
                  editable={!isBusy}
                  autoCapitalize="words"
                />
                {valid.firstName && !errors.firstName && (
                  <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                )}
              </View>
              {(touchedFirstName || submitAttempted) && errors.firstName ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
                  <Text style={styles.errorFieldText}>{errors.firstName}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.inputGroup, styles.nameField]}>
              <Text style={styles.label}>Last Name</Text>
              <View style={[
                styles.inputWrapper,
                (touchedLastName || submitAttempted) && errors.lastName ? styles.inputWrapperError : null,
              ]}>
                <TextInput
                  style={styles.input}
                  placeholder="Last Name"
                  placeholderTextColor={HOME_INK_SOFT}
                  value={lastName}
                  onChangeText={(text) => setLastName(sanitizeName(text))}
                  onBlur={() => setTouchedLastName(true)}
                  editable={!isBusy}
                  autoCapitalize="words"
                />
                {valid.lastName && !errors.lastName && (
                  <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                )}
              </View>
              {(touchedLastName || submitAttempted) && errors.lastName ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
                  <Text style={styles.errorFieldText}>{errors.lastName}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Middle Initial is genuinely optional — see validateField/isFormValid,
              neither requires it. Label reflects that instead of showing a
              required asterisk. */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Middle Initial — Optional</Text>
            <View style={[
              styles.inputWrapper,
              (touchedMiddleInitial || submitAttempted) && errors.middleInitial ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="M.I. - Optional"
                placeholderTextColor={HOME_INK_SOFT}
                value={middleInitial}
                onChangeText={(text) => setMiddleInitial(text.toUpperCase().slice(0, 1))}
                onBlur={() => setTouchedMiddleInitial(true)}
                maxLength={1}
                editable={!isBusy}
              />
              {middleInitial.length > 0 && valid.middleInitial && !errors.middleInitial && (
                <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
              )}
            </View>
            {(touchedMiddleInitial || submitAttempted) && errors.middleInitial ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
                <Text style={styles.errorFieldText}>{errors.middleInitial}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={[
              styles.inputWrapper,
              (touchedEmail || submitAttempted) && errors.email ? styles.inputWrapperError : null,
            ]}>
              <Ionicons name="mail-outline" size={20} color={HOME_LAVENDER_DARK} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your email address"
                placeholderTextColor={HOME_INK_SOFT}
                value={email}
                onChangeText={(text) => setEmail(sanitizeEmail(text))}
                onBlur={() => setTouchedEmail(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!isBusy}
              />
              {valid.email && !errors.email && (
                <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
              )}
            </View>
            {(touchedEmail || submitAttempted) && errors.email ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
                <Text style={styles.errorFieldText}>{errors.email}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={[
              styles.inputWrapper,
              (touchedPassword || submitAttempted) && errors.password ? styles.inputWrapperError : null,
            ]}>
              <Ionicons name="lock-closed-outline" size={20} color={HOME_LAVENDER_DARK} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Create a password"
                placeholderTextColor={HOME_INK_SOFT}
                value={password}
                onChangeText={setPassword}
                onBlur={() => setTouchedPassword(true)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!isBusy}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={HOME_LAVENDER_DARK} />
              </TouchableOpacity>
            </View>

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

            {/* Only the 3 requirements validateField/isFormValid actually
                enforce — a "special character" rule was NOT added here since
                it isn't checked anywhere in the validation logic; showing it
                would promise something the form doesn't actually require. */}
            {password && (
              <View style={styles.requirementsContainer}>
                <View style={styles.requirementItem}>
                  <Ionicons
                    name={password.length >= 8 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={14}
                    color={password.length >= 8 ? SUCCESS : HOME_INK_SOFT}
                  />
                  <Text style={[styles.requirementText, password.length >= 8 && styles.requirementMet]}>
                    At least 8 characters
                  </Text>
                </View>
                <View style={styles.requirementItem}>
                  <Ionicons
                    name={/[A-Z]/.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={14}
                    color={/[A-Z]/.test(password) ? SUCCESS : HOME_INK_SOFT}
                  />
                  <Text style={[styles.requirementText, /[A-Z]/.test(password) && styles.requirementMet]}>
                    One uppercase letter (A-Z)
                  </Text>
                </View>
                <View style={styles.requirementItem}>
                  <Ionicons
                    name={/\d/.test(password) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={14}
                    color={/\d/.test(password) ? SUCCESS : HOME_INK_SOFT}
                  />
                  <Text style={[styles.requirementText, /\d/.test(password) && styles.requirementMet]}>
                    One number (0-9)
                  </Text>
                </View>
              </View>
            )}

            {(touchedPassword || submitAttempted) && errors.password ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
                <Text style={styles.errorFieldText}>{errors.password}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={[
              styles.inputWrapper,
              (touchedConfirmPassword || submitAttempted) && errors.confirmPassword ? styles.inputWrapperError : null,
            ]}>
              <Ionicons name="lock-closed-outline" size={20} color={HOME_LAVENDER_DARK} style={styles.inputLeadingIcon} />
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
                placeholderTextColor={HOME_INK_SOFT}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onBlur={() => setTouchedConfirmPassword(true)}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                editable={!isBusy}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                <Ionicons name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color={HOME_LAVENDER_DARK} />
              </TouchableOpacity>
            </View>
            {(touchedConfirmPassword || submitAttempted) && errors.confirmPassword ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
                <Text style={styles.errorFieldText}>{errors.confirmPassword}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.termsContainer}>
            <TouchableOpacity onPress={() => setTermsAccepted(!termsAccepted)} style={styles.checkbox}>
              <Ionicons
                name={termsAccepted ? 'checkbox' : 'square-outline'}
                size={22}
                color={termsAccepted ? HOME_LAVENDER_DARK : HOME_INK_SOFT}
              />
            </TouchableOpacity>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={showTerms}>Terms of Use</Text>
              {' '}and{' '}
              <Text style={styles.link} onPress={showPrivacy}>Privacy Policy</Text>
            </Text>
          </View>
          {(submitAttempted && errors.terms) ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={14} color={HOME_CORAL} />
              <Text style={styles.errorFieldText}>{errors.terms}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.signUpButton, (!isFormValid() || isBusy) && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={!isFormValid() || isBusy}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.signUpButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <View style={styles.oauthDivider}>
            <View style={styles.oauthDividerLine} />
            <Text style={styles.oauthDividerText}>OR</Text>
            <View style={styles.oauthDividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.oauthButton, isBusy && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthSignUp('google')}
            disabled={isBusy}
          >
            <Ionicons name="logo-google" size={20} color="#DB4437" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'google' ? 'Connecting...' : 'Continue with Google'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.oauthButton, { marginBottom: 0 }, isBusy && styles.oauthButtonDisabled]}
            onPress={() => handleOAuthSignUp('facebook')}
            disabled={isBusy}
          >
            <Ionicons name="logo-facebook" size={20} color="#1877F2" />
            <Text style={styles.oauthButtonText}>
              {oauthLoading === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.signInRow}>
          <Text style={styles.signInText}>Already have an account? <Text style={styles.signInLinkBold}>Log In</Text></Text>
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
    width: 200,
    height: 100,
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: FONT_DISPLAY,
    color: HOME_INK,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: HOME_INK_SOFT,
    lineHeight: 22,
  },
  supportingText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 18,
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    color: HOME_INK_SOFT,
    lineHeight: 18,
    paddingHorizontal: 12,
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
    ...Platform.select({
      web: { boxShadow: '0px 20px 40px rgba(59,50,44,0.12)' },
      default: { shadowColor: HOME_INK, shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 40 },
    }),
  },
  messageBanner: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 16,
    marginBottom: 18,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(224,107,76,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: HOME_CORAL,
  },
  successBanner: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderLeftColor: SUCCESS,
  },
  messageIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  errorBannerText: {
    color: '#9A3412',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '500',
  },
  successBannerText: {
    color: '#0f6b4f',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
  },
  successInfoText: {
    color: '#0f6b4f',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameField: {
    flex: 1,
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
  inputWrapperError: {
    borderColor: HOME_CORAL,
    backgroundColor: '#FDF3EF',
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: HOME_INK,
  },
  inputLeadingIcon: {
    marginRight: 10,
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
    color: '#B3441F',
    fontSize: 12,
    marginLeft: 6,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
    fontWeight: '600',
  },
  strengthContainer: {
    marginTop: 10,
  },
  strengthBarBackground: {
    height: 6,
    backgroundColor: '#EEE9DE',
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
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  requirementsContainer: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FAF8F3',
    borderRadius: 12,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  requirementText: {
    fontSize: 12,
    marginLeft: 8,
    color: HOME_INK_SOFT,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  requirementMet: {
    color: SUCCESS,
    fontWeight: '700',
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    marginTop: 4,
  },
  checkbox: {
    marginRight: 10,
    marginTop: 0,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: HOME_INK_SOFT,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  link: {
    color: HOME_LAVENDER_DARK,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  signUpButton: {
    backgroundColor: HOME_LAVENDER_DARK,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 20,
    elevation: 3,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(95,82,176,0.28)' },
      default: { shadowColor: HOME_LAVENDER_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12 },
    }),
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: FONT_DISPLAY_SEMI,
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
  signInRow: {
    marginTop: 20,
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
  },
  signInText: {
    fontSize: 14,
    color: HOME_INK_SOFT,
    fontFamily: Platform.OS === 'ios' ? 'Avenir' : 'sans-serif',
  },
  signInLinkBold: {
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

export default SignUpScreen;
