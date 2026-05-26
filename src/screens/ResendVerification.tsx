import React, { useState, useEffect } from 'react';
import { ImageBackground, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../config/theme';
import { sendEmailOTP, validateEmail } from '../services/otpService';

interface ResendVerificationProps {
  navigation: any;
}

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_RESEND_ATTEMPTS = 3;

const ResendVerification: React.FC<ResendVerificationProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');

  // Cooldown timer
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => {
          const next = prev - 1;
          if (next <= 0 && timer) {
            clearInterval(timer);
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [resendCooldown]);

  const handleResend = async () => {
    setSuccessMessage('');

    // Validation
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      Alert.alert('Error', emailValidation.error || 'Please enter a valid email.');
      return;
    }

    // Check attempt limit
    if (resendAttempts >= MAX_RESEND_ATTEMPTS) {
      Alert.alert(
        'Limit Reached',
        'Too many resend attempts. Please wait 60 seconds and try again.'
      );
      return;
    }

    // Check cooldown
    if (resendCooldown > 0) {
      Alert.alert(
        'Please Wait',
        `You can resend in ${resendCooldown} second${resendCooldown !== 1 ? 's' : ''}.`
      );
      return;
    }

    // Prevent double-clicks
    if (loading) {
      console.log('[ResendVerification] Already sending, ignoring duplicate request');
      return;
    }

    setLoading(true);
    try {
      const result = await sendEmailOTP(email);
      if (!result.success) {
        throw new Error(result.message || 'Failed to send verification code.');
      }

      setSuccessMessage('✅ Verification code sent! Check your email.');
      setResendAttempts((prev) => prev + 1);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);

      // Auto-close after 2 seconds on success
      setTimeout(() => {
        Alert.alert('Success', 'Verification code sent. Returning to login...', [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]);
      }, 1500);
    } catch (error: any) {
      console.error('[ResendVerification] Error:', error);
      Alert.alert('Error', error.message || 'Failed to resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const isButtonDisabled = loading || resendCooldown > 0 || resendAttempts >= MAX_RESEND_ATTEMPTS;

  return (
    <ImageBackground source={require('../../assets/bg.jpg')} style={styles.backgroundImage} resizeMode="cover">
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Resend Verification</Text>
        <Text style={styles.subtitle}>Enter your email to resend the verification code</Text>

        {successMessage ? (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{successMessage}</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor="#999"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, isButtonDisabled && styles.buttonDisabled]}
          onPress={handleResend}
          disabled={isButtonDisabled}
        >
        {loading ? (
          <>
            <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Sending...</Text>
          </>
        ) : resendCooldown > 0 ? (
          <Text style={styles.buttonText}>Wait {resendCooldown}s</Text>
        ) : resendAttempts >= MAX_RESEND_ATTEMPTS ? (
          <Text style={styles.buttonText}>Limit Reached</Text>
        ) : (
          <Text style={styles.buttonText}>Resend Code</Text>
        )}
      </TouchableOpacity>

      {resendAttempts > 0 && (
        <Text style={styles.attemptsText}>
          Attempts: {resendAttempts}/{MAX_RESEND_ATTEMPTS}
        </Text>
      )}

    </View>
  </ImageBackground>
  );
};

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  title: {
    fontSize: 32,
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '800',
    color: colors.primary,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  successBanner: {
    backgroundColor: '#f5f0ff',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  successText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(157, 172, 186, 0.4)',
    padding: 18,
    borderRadius: 16,
    fontSize: 17,
    marginBottom: 24,
    backgroundColor: 'rgba(255,255,255,0.78)',
    color: '#111',
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginBottom: 20,
    shadowColor: '#0b2a16',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  attemptsText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 26,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: 16,
    marginLeft: 8,
    fontWeight: '700',
  },
  link: {
    textAlign: 'center',
    color: colors.primary,
    fontWeight: '700',
    fontSize: 15,
  },
});

export default ResendVerification;
