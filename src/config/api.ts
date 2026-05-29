const DEFAULT_TIMEOUT_MS = 30000;

export const PRODUCTION_BACKEND_URL =
  'https://app-backend-production-7738.up.railway.app';

/* -------------------------
   CLEAN URL
-------------------------- */
const ensureApiPath = (value: string) => {
  const cleaned = value.trim().replace(/\/+$/g, '');
  return cleaned.endsWith('/api') ? cleaned : `${cleaned}/api`;
};

/* -------------------------
   FINAL BASE URL LOGIC
-------------------------- */
export const getApiBaseUrl = (): string => {
  console.log('[API] Using Railway production backend');
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
   POST JSON
-------------------------- */
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
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[API] GET', url);
  }

  return fetchJson<T>(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    timeoutMs
  );
};
