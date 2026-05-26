import React, { useState } from 'react';
import {
  ImageBackground,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resetPassword } from '../services/supabaseService';
import { colors } from '../config/theme';

interface ForgotPasswordProps {
  navigation: any;
}

const ForgotPassword: React.FC<ForgotPasswordProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [emailError, setEmailError] = useState('');

  const validateEmail = (value: string) => {
    setEmail(value);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value.trim()) {
      setEmailError('Please enter your email');
    } else if (!emailRegex.test(value.trim())) {
      setEmailError('Please enter a valid email');
    } else {
      setEmailError('');
    }
  };

  const isEmailValid = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return email.trim() && emailRegex.test(email.trim());
  };

  const handleReset = async () => {
    if (loading) {
      console.log('[ForgotPassword] Already sending reset email...');
      return;
    }

    setTouched(true);

    if (!isEmailValid()) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await resetPassword(email.trim());
      if (error) throw error;

      Alert.alert(
        '📧 Check Your Email',
        'We sent a password reset link. Follow the instructions to create a new password.',
        [
          {
            text: 'Back to Login',
            onPress: () => navigation.goBack(),
          },
        ],
      );
    } catch (error: any) {
      console.error('[ForgotPassword] Reset error:', error);
      let errorMessage = 'Something went wrong. Please try again.';

      if (error?.message?.includes('Invalid email')) {
        errorMessage = 'Please enter a valid email address.';
      } else if (error?.message?.includes('User not found')) {
        errorMessage = 'No account found with this email.';
      }

      Alert.alert('Unable to Send Reset', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground
      source={require('../../assets/bg.jpg')}
      resizeMode="cover"
      style={styles.container}
      imageStyle={styles.backgroundImage}
    >
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={24} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Image source={require('../../assets/Logo.jpg')} style={styles.logo} />

        <Text style={styles.title}>Forgot Password</Text>
        <Text style={styles.subtitle}>Enter your email to receive a reset link.</Text>

        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={[
              styles.inputWrapper,
              touched && emailError ? styles.inputWrapperError : null,
            ]}>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#A6A6A6"
                value={email}
                onChangeText={validateEmail}
                onBlur={() => setTouched(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!loading}
              />
            </View>
            {touched && emailError ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={14} color="#E07A31" />
                <Text style={styles.errorText}>{emailError}</Text>
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.button, (!isEmailValid() || loading) && styles.buttonDisabled]}
            onPress={handleReset}
            disabled={!isEmailValid() || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Send Reset Email</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F7F9',
    paddingTop: 40,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginLeft: 6,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  logo: {
    width: 190,
    height: 88,
    resizeMode: 'contain',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: colors.primary,
    letterSpacing: 0.25,
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 30,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#2B2B2B',
    lineHeight: 22,
    letterSpacing: 0.12,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: '#0f2715',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 10,
    marginBottom: 28,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#1D4030',
    letterSpacing: 0.25,
  },
  inputWrapper: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(61, 77, 85, 0.14)',
    borderRadius: 20,
    paddingHorizontal: 18,
    height: 64,
    justifyContent: 'center',
  },
  inputWrapperError: {
    borderColor: '#F3B269',
    backgroundColor: '#FFF4ED',
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    color: '#1B2730',
    padding: 0,
    minHeight: 46,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  errorText: {
    color: '#E07A31',
    fontSize: 13,
    marginLeft: 8,
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#1D5E2D',
    borderRadius: 18,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#A7BEAB',
    opacity: 0.8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Lexend' : 'sans-serif',
    letterSpacing: 0.25,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
  },
});

export default ForgotPassword;
