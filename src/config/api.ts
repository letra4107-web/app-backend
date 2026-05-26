import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_LOCAL_PORT = 5002;

type ExpoExtra = {
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_BASE_URL?: string;
  API_BASE_URL?: string;
  BACKEND_PORT?: string | number;
  LOCAL_PORT?: string | number;
};

const getExpoExtra = (): ExpoExtra => {
  return (
    (Constants.expoConfig?.extra as ExpoExtra | undefined) ||
    ((Constants as any).manifest?.extra as ExpoExtra | undefined) ||
    {}
  );
};

const getLocalPort = (): number => {
  const extra = getExpoExtra();
  const configuredPort =
    extra.BACKEND_PORT ??
    extra.LOCAL_PORT ??
    DEFAULT_LOCAL_PORT;

  return typeof configuredPort === 'string'
    ? Number(configuredPort)
    : configuredPort;
};

const makeLocalUrl = (host: string) =>
  `http://${host}:${getLocalPort()}/api`;

const ANDROID_EMULATOR_URL = makeLocalUrl('10.0.2.2');
const IOS_SIMULATOR_URL = makeLocalUrl('localhost');
const LOCALHOST_URL = makeLocalUrl('localhost');

const ensureApiPath = (value: string) => {
  const cleaned = value.trim().replace(/\/+$/g, '');
  return cleaned.endsWith('/api') ? cleaned : `${cleaned}/api`;
};

const getConfiguredApiUrl = (): string | null => {
  const extra = getExpoExtra();

  const envUrl =
    extra.EXPO_PUBLIC_API_URL ||
    extra.EXPO_PUBLIC_BASE_URL ||
    extra.API_BASE_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_BASE_URL ||
    process.env.API_BASE_URL;

  if (!envUrl) return null;
  return ensureApiPath(envUrl);
};

const isAndroidEmulator = Platform.OS === 'android' && !Constants.isDevice;
const isIosSimulator = Platform.OS === 'ios' && !Constants.isDevice;
const isWeb = Platform.OS === 'web';

export const getApiBaseUrl = (): string => {
  const configuredUrl = getConfiguredApiUrl();

  if (isWeb) {
    const webUrl = configuredUrl && (configuredUrl.includes('localhost') || configuredUrl.includes('127.0.0.1'))
      ? configuredUrl
      : LOCALHOST_URL;
    console.log('[API] Web: using API URL:', webUrl);
    return webUrl;
  }

  if (configuredUrl) {
    console.log('[API] Using configured URL:', configuredUrl);
    return configuredUrl;
  }

  if (isAndroidEmulator) return ANDROID_EMULATOR_URL;
  if (isIosSimulator) return IOS_SIMULATOR_URL;

  console.warn('[API] No API URL configured; using localhost fallback:', LOCALHOST_URL);
  return LOCALHOST_URL;
};

export const API_BASE_URL = getApiBaseUrl();
console.log('[API] API_BASE_URL:', API_BASE_URL);

export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(status: number, statusText: string, data: any) {
    super(`${status} ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export class ApiNetworkError extends Error {
  public originalError: any;
  public retryable: boolean;
  public isTimeout: boolean;

  constructor(
    message: string,
    originalError: any,
    retryable = true,
    isTimeout = false
  ) {
    super(message);
    this.name = 'ApiNetworkError';
    this.originalError = originalError;
    this.retryable = retryable;
    this.isTimeout = isTimeout;
  }
}

export const isRetryableNetworkError = (error: any) => {
  return error instanceof ApiNetworkError || error?.retryable === true || error?.isTimeout === true;
};

const normalizeFetchError = (error: any, timeoutMs: number): ApiNetworkError => {
  const raw = String(error?.message || error || '').toLowerCase();

  const isTimeout =
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    error?.name === 'AbortError';

  let message = 'Network request failed';

  if (isTimeout) {
    message = `Request timed out after ${timeoutMs}ms`;
  } else if (raw.includes('err_network_changed')) {
    message = 'Network changed while contacting server';
  } else if (raw.includes('quic') || raw.includes('http3')) {
    message = 'Browser protocol/network error occurred';
  } else if (raw.includes('failed to fetch')) {
    message = 'Failed to fetch';
  }

  return new ApiNetworkError(message, error, true, isTimeout);
};

export const fetchWithTimeout = async (
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    return response;
  } catch (error: any) {
    throw normalizeFetchError(error, timeoutMs);
  } finally {
    clearTimeout(timeout);
  }
};

const parseResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text || 'Unexpected response format' };
  }
};

export const fetchJson = async <T = any>(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  try {
    const response = await fetchWithTimeout(url, init, timeoutMs);
    const data = await parseResponse(response);

    if (!response.ok) {
      throw new ApiError(response.status, response.statusText, data);
    }

    return data as T;
  } catch (error: any) {
    console.error(`[API] fetchJson error for ${init.method || 'GET'} ${url}`, {
      message: error?.message,
      timeoutMs,
    });
    throw error;
  }
};

export const postJson = async <T = any>(
  url: string,
  body: any,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  return fetchJson<T>(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      mode: isWeb ? 'cors' : undefined,
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    },
    timeoutMs
  );
};

export const getJson = async <T = any>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  return fetchJson<T>(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      mode: isWeb ? 'cors' : undefined,
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    },
    timeoutMs
  );
};
