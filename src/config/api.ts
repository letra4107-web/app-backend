import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';

const DEFAULT_TIMEOUT_MS = 30000;

export const PRODUCTION_BACKEND_URL =
  'https://app-backend-production-f32c.up.railway.app';

/* -------------------------
   CLEAN URL
-------------------------- */
const ensureApiPath = (value: string) => {
  const cleaned = value.trim().replace(/\/+$/g, '');
  return cleaned.endsWith('/api') ? cleaned : `${cleaned}/api`;
};

/* -------------------------
   LAN HOST DETECTION
   On a physical device, "localhost" points at the phone itself, not the
   dev machine. Expo's Metro bundler host (e.g. 192.168.1.107:8081) is a
   reliable stand-in for the dev machine's LAN IP.
-------------------------- */
const getMetroLanHost = (): string | null => {
  const candidates = new Set<string>();

  const envLanHost = process.env.EXPO_PUBLIC_LOCAL_IP || process.env.EXPO_PUBLIC_LAN_HOST;
  if (envLanHost) {
    candidates.add(String(envLanHost).trim());
  }

  const parseHost = (value: string | null | undefined) => {
    if (!value) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        return parsed.hostname;
      }

      if (/^exp:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        return parsed.hostname;
      }

      const withoutScheme = raw.replace(/^.*:\/\//, '').replace(/^.*@/, '');
      const host = withoutScheme.split(':')[0].split('/')[0].trim();
      return host || null;
    } catch {
      return null;
    }
  };

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any)?.expoGoConfig?.debuggerHost ||
    (Constants as any)?.manifest2?.extra?.expoClient?.hostUri ||
    (Constants as any)?.manifest?.debuggerHost;

  const hostFromUri = parseHost(hostUri);
  if (hostFromUri && hostFromUri !== 'localhost' && hostFromUri !== '127.0.0.1') {
    candidates.add(hostFromUri);
  }

  try {
    const scriptUrl = (NativeModules as any)?.SourceCode?.scriptURL;
    if (typeof scriptUrl === 'string') {
      const parsedHost = parseHost(scriptUrl);
      if (parsedHost && parsedHost !== 'localhost' && parsedHost !== '127.0.0.1') {
        candidates.add(parsedHost);
      }
    }
  } catch {
    // Ignore invalid or unavailable script URLs.
  }

  return Array.from(candidates)[0] || null;
};

/* -------------------------
   FINAL BASE URL LOGIC
-------------------------- */
export const getApiBaseUrl = (): string => {
  // In development (Expo web/localhost), use the local backend to avoid CORS
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const manifestApiUrl =
      (Constants.expoConfig as any)?.extra?.EXPO_PUBLIC_API_URL ||
      (Constants.expoConfig as any)?.extra?.EXPO_PUBLIC_BASE_URL ||
      (Constants as any)?.manifest?.extra?.EXPO_PUBLIC_API_URL ||
      (Constants as any)?.manifest?.extra?.EXPO_PUBLIC_BASE_URL ||
      process.env.EXPO_PUBLIC_API_URL ||
      process.env.EXPO_PUBLIC_BASE_URL;

    let localUrl = manifestApiUrl || 'http://localhost:5002';
    if (localUrl.includes('up.railway.app')) {
      console.warn(
        '[API] DEV mode is pointing at the production Railway API. Set EXPO_PUBLIC_API_URL to http://localhost:5002 in .env and restart with expo start -c.'
      );
    }

    const isLocalhostUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(localUrl);
    if (isLocalhostUrl && Platform.OS !== 'web') {
      const lanHost = getMetroLanHost();
      if (lanHost) {
        const port = localUrl.match(/:(\d+)/)?.[1] || '5002';
        const rewritten = `http://${lanHost}:${port}`;
        console.log('[API] Physical device detected — rewriting localhost to Metro host:', rewritten);
        localUrl = rewritten;
      } else {
        const fallbackHost = process.env.EXPO_PUBLIC_LOCAL_IP || process.env.EXPO_PUBLIC_LAN_HOST;
        if (fallbackHost) {
          const port = localUrl.match(/:(\d+)/)?.[1] || '5002';
          const rewritten = `http://${fallbackHost}:${port}`;
          console.log('[API] Physical device detected — using configured LAN IP:', rewritten);
          localUrl = rewritten;
        } else {
          console.warn(
            '[API] Running on a physical device but could not detect the dev machine LAN IP. ' +
            'If requests fail, set EXPO_PUBLIC_LOCAL_IP in .env to your LAN IP and restart Expo.'
          );
        }
      }
    }

    console.log('[API] DEV mode — using local backend:', localUrl);
    return ensureApiPath(localUrl);
  }
  // Production build always uses Railway
  console.log('[API] PROD mode — using Railway backend');
  return ensureApiPath(PRODUCTION_BACKEND_URL);
};

export const API_BASE_URL = getApiBaseUrl();
export const API_ORIGIN_URL = API_BASE_URL.replace(/\/api$/i, '');

console.log('[API] FINAL BASE URL:', API_BASE_URL);

/* -------------------------
   BUILD API URL
-------------------------- */
export const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

/* -------------------------
   ERROR CLASSES
-------------------------- */
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

export const isRetryableNetworkError = (error: any) =>
  error instanceof ApiNetworkError ||
  error?.retryable === true ||
  error?.name === 'AbortError' ||
  /network|timeout|timed out|failed to fetch|unable to connect/i.test(String(error?.message || error || ''));

/* -------------------------
   NETWORK ERROR HANDLING
-------------------------- */
const normalizeFetchError = (error: any, timeoutMs: number): ApiNetworkError => {
  const raw = String(error?.message || error || '').toLowerCase();
  const isBrowserFetchFailure =
    raw.includes('failed to fetch') ||
    raw.includes('load failed') ||
    raw.includes('network request failed') ||
    raw.includes('err_failed') ||
    raw.includes('cors');

  const isTimeout =
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    error?.name === 'AbortError';

  let message = 'Backend not reachable. Please try again in a moment.';

  if (isTimeout) {
    message = 'Request timed out. Please try again.';
  } else if (isBrowserFetchFailure) {
    message = 'Server blocked request (CORS issue) or backend is not reachable.';
  }

  return new ApiNetworkError(message, error, true, isTimeout);
};

/* -------------------------
   FETCH WITH TIMEOUT
-------------------------- */
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

/* -------------------------
   PARSE RESPONSE
-------------------------- */
const parseResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text || 'Unexpected response format' };
  }
};

/* -------------------------
   FETCH JSON
-------------------------- */
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

/* -------------------------
   GET AUTH HEADERS
-------------------------- */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  try {
    const { supabase } = await import('./supabase');
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (error) {
    console.warn('[API] Failed to get auth token:', error);
    return {};
  }
};

/* -------------------------
   POST JSON
-------------------------- */
export const postJson = async <T = any>(
  url: string,
  body: any,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  const authHeaders = await getAuthHeaders();

  return fetchJson<T>(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
};

/* -------------------------
   GET JSON
-------------------------- */
export const getJson = async <T = any>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  const authHeaders = await getAuthHeaders();

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[API] GET', url);
  }

  return fetchJson<T>(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeaders },
    },
    timeoutMs
  );
};

/* -------------------------
   PATCH JSON
-------------------------- */
export const patchJson = async <T = any>(
  url: string,
  body: any,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  const authHeaders = await getAuthHeaders();

  return fetchJson<T>(
    url,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
};

/* -------------------------
   DELETE JSON
-------------------------- */
export const deleteJson = async <T = any>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  const authHeaders = await getAuthHeaders();

  return fetchJson<T>(
    url,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json', ...authHeaders },
    },
    timeoutMs
  );
};
