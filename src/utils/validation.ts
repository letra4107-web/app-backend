/**
 * Validation Utilities
 * Dyslexia-friendly validation for the LinawLetra app
 */

export interface ValidationResult {
  isValid: boolean;
  error: string | null;
}

/**
 * Email validation
 * Regex: ^[^\s@]+@[^\s@]+\.[^\s@]+$
 */
export const validateEmail = (email: string): ValidationResult => {
  const trimmed = email.trim();

  if (!trimmed) {
    return { isValid: false, error: 'Kailangan ang email address' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Hindi wastong format ng email (hal., user@example.com)' };
  }

  return { isValid: true, error: null };
};

/**
 * Phone number validation (10-15 digits)
 */
export const validatePhoneNumber = (phoneNumber: string): ValidationResult => {
  const cleaned = phoneNumber.replace(/\D/g, '');

  if (!cleaned) {
    return { isValid: false, error: 'Kailangan ang numero ng telepono' };
  }

  if (cleaned.length < 10) {
    return { isValid: false, error: 'Masyadong maikli ang numero ng telepono (minimum 10 digit)' };
  }

  if (cleaned.length > 15) {
    return { isValid: false, error: 'Masyadong mahaba ang numero ng telepono (maximum 15 digit)' };
  }

  return { isValid: true, error: null };
};

/**
 * OTP validation (exactly 6 digits)
 */
export const validateOTP = (otp: string): ValidationResult => {
  if (!otp) {
    return { isValid: false, error: 'Kailangan ang OTP' };
  }

  if (!/^\d{6}$/.test(otp)) {
    return { isValid: false, error: 'Dapat eksaktong 6 na digit ang OTP' };
  }

  return { isValid: true, error: null };
};

/**
 * Password validation
 * Requirements:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 number
 */
export const validatePassword = (password: string): ValidationResult => {
  if (!password) {
    return { isValid: false, error: 'Kailangan ang password' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Kailangan ng hindi bababa sa 8 character' };
  }

  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Dapat may hindi bababa sa isang malaking titik (A-Z)' };
  }

  if (!/\d/.test(password)) {
    return { isValid: false, error: 'Dapat may hindi bababa sa isang numero (0-9)' };
  }

  return { isValid: true, error: null };
};

/**
 * Confirm password validation
 */
export const validateConfirmPassword = (password: string, confirmPassword: string): ValidationResult => {
  if (!confirmPassword) {
    return { isValid: false, error: 'Kumpirmahin ang iyong password' };
  }

  if (confirmPassword !== password) {
    return { isValid: false, error: 'Hindi magkatugma ang password' };
  }

  return { isValid: true, error: null };
};

/**
 * Name validation
 */
export const validateName = (name: string, minLength: number = 2): ValidationResult => {
  const trimmed = name.trim();

  if (!trimmed) {
    return { isValid: false, error: 'Kailangan ang pangalan' };
  }

  if (trimmed.length < minLength) {
    return {
      isValid: false,
      error: `Kailangan ng hindi bababa sa ${minLength} character`,
    };
  }

  if (!/^[a-zA-Z\s'-]+$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'Letra, espasyo, gitling, at kudlit lamang ang pwede sa pangalan',
    };
  }

  return { isValid: true, error: null };
};

/**
 * Sanitize name (remove non-alphabetic characters except spaces, hyphens, apostrophes)
 */
export const sanitizeName = (name: string): string => {
  return name.replace(/[^a-zA-Z\s'-]/g, '').trim();
};

/**
 * Sanitize email (convert to lowercase and trim)
 */
export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};

/**
 * Format phone number for display: (555) 123-4567
 */
export const formatPhoneNumberDisplay = (phoneNumber: string): string => {
  const cleaned = phoneNumber.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phoneNumber;
};

/**
 * Clean phone number (remove all non-digits)
 */
export const cleanPhoneNumber = (phoneNumber: string): string => {
  return phoneNumber.replace(/\D/g, '');
};

/**
 * Validate all form fields at once
 */
export interface FormErrors {
  email?: string;
  phoneNumber?: string;
  password?: string;
  confirmPassword?: string;
  otp?: string;
  firstName?: string;
  lastName?: string;
}

export const validateForm = (
  fields: Record<string, any>,
  validations: Record<string, () => ValidationResult>
): FormErrors => {
  const errors: FormErrors = {};

  Object.entries(validations).forEach(([fieldName, validationFn]) => {
    const result = validationFn();
    if (!result.isValid && result.error) {
      errors[fieldName as keyof FormErrors] = result.error;
    }
  });

  return errors;
};

