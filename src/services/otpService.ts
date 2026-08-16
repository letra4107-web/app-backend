/**
 * OTP Service
 * Stable OTP handling with retry protection and request locking.
 */

import {
  buildApiUrl,
  postJson,
  isRetryableNetworkError,
} from '../config/api';

export interface OTPResponse {
  success: boolean;
  message: string;
  data?: any;
  expiresAt?: string;
  expiresInSeconds?: number;
  emailStatus?: string;
  jobId?: string;
  userId?: string;
  email?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2; // allow up to 3 attempts total
const RETRY_DELAY_MS = 1500;
const LOCK_TIMEOUT_MS = 10000;

const requestLocks = new Map<string, boolean>();

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const makeLockKey = (email: string, action: string) =>
  `${action}:${email.trim().toLowerCase()}`;

const makeClientRequestId = (action: string, email: string, attempt: number) =>
  `${action}-${attempt}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}-${email}`;

const releaseLock = (key: string) => {
  requestLocks.delete(key);
};

const acquireLock = (key: string) => {
  if (requestLocks.has(key)) {
    return false;
  }
  requestLocks.set(key, true);
  setTimeout(() => requestLocks.delete(key), LOCK_TIMEOUT_MS);
  return true;
};

const isRetryableError = (error: any) => {
  if (isRetryableNetworkError(error)) return true;

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network request failed') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network changed') ||
    message.includes('quic') ||
    message.includes('protocol error')
  );
};

const getFriendlyErrorMessage = (error: any): string => {
  const message = String(error?.message || '').toLowerCase();

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'Naabot ang time limit ng request, subukang muli.';
  }
  if (message.includes('network changed')) {
    return 'Nagbago ang network. Ipadala muli ang OTP.';
  }
  if (message.includes('quic') || message.includes('protocol')) {
    return 'Nabigo ang koneksyon ng browser. Ipadala muli ang OTP.';
  }
  if (message.includes('failed to fetch')) {
    return 'Nabigo ang network request. Ipadala muli ang OTP.';
  }
  if (error?.status === 429) {
    return 'Sobra na sa dami ng request. Maghintay bago subukang muli.';
  }
  if (error?.status >= 500) {
    return 'May problema sa server. Subukang muli mamaya.';
  }

  return error?.message || 'Hindi naproseso ang OTP request.';
};

const postJsonWithRetry = async (
  url: string,
  body: any,
  action: string
): Promise<OTPResponse> => {
  let lastError: any;
  // Reuse one idempotency key for every network retry. A new key per retry
  // can create and email a replacement OTP while the first email is in flight.
  const clientRequestId = makeClientRequestId(action, body.email || 'unknown', 0);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[OTP] ${action} attempt ${attempt + 1}`, {
        url,
        clientRequestId,
      });

      const result: any = await postJson(
        url,
        { ...body, clientRequestId },
        REQUEST_TIMEOUT_MS
      );

      return {
        success: result?.success !== false,
        message: result?.message || 'OTP request successful.',
        data: result,
        expiresAt: result?.expiresAt,
        expiresInSeconds: result?.expiresInSeconds,
        emailStatus: result?.emailStatus,
        jobId: result?.jobId,
        userId: result?.userId,
        email: result?.email,
      };
    } catch (error: any) {
      lastError = error;
      console.warn(`[OTP] ${action} failed`, {
        attempt: attempt + 1,
        message: error?.message,
      });

      if (!isRetryableError(error) || attempt >= MAX_RETRIES) break;

      await delay(RETRY_DELAY_MS * (attempt + 1)); // exponential backoff
    }
  }

  return {
    success: false,
    message: getFriendlyErrorMessage(lastError),
  };
};

export const validateEmail = (email: string): ValidationResult => {
  const trimmed = email.trim();
  if (!trimmed) return { isValid: false, error: 'Email is required.' };

  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(trimmed)) {
    return { isValid: false, error: 'Please enter a valid email.' };
  }
  return { isValid: true };
};

export const validateOTP = (otp: string): ValidationResult => {
  const trimmed = otp.trim();
  if (!trimmed) return { isValid: false, error: 'Verification code is required.' };

  const OTP_REGEX = /^\d{6}$/; // configurable later
  if (!OTP_REGEX.test(trimmed)) {
    return { isValid: false, error: 'OTP must be 6 digits.' };
  }
  return { isValid: true };
};

export const sendEmailOTP = async (
  email: string,
  userId = ''
): Promise<OTPResponse> => {
  const normalizedEmail = email.trim().toLowerCase();
  const lockKey = makeLockKey(normalizedEmail, 'send');

  if (!acquireLock(lockKey)) {
    return { success: false, message: 'OTP request already in progress.' };
  }

  try {
    return await postJsonWithRetry(
      buildApiUrl('/auth/send-otp'),
      { email: normalizedEmail, userId },
      'send-otp'
    );
  } finally {
    releaseLock(lockKey);
  }
};

export const resendOTP = async (
  email: string,
  userId = ''
): Promise<OTPResponse> => {
  const normalizedEmail = email.trim().toLowerCase();
  const lockKey = makeLockKey(normalizedEmail, 'resend');

  if (!acquireLock(lockKey)) {
    return { success: false, message: 'Resend request already in progress.' };
  }

  try {
    return await postJsonWithRetry(
      buildApiUrl('/auth/resend-otp'),
      { email: normalizedEmail, userId },
      'resend-otp'
    );
  } finally {
    releaseLock(lockKey);
  }
};

export const verifyOTP = async (
  otp: string,
  userId: string,
  email: string
): Promise<OTPResponse> => {
  const normalizedEmail = email.trim().toLowerCase();
  return postJsonWithRetry(
    buildApiUrl('/auth/verify-otp'),
    { code: otp.trim(), userId, email: normalizedEmail },
    'verify-otp'
  );
};

export const clearOtpLocks = () => {
  requestLocks.clear();
  console.log('[OTP] all request locks cleared');
};
