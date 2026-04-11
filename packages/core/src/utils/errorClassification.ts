/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Categories of API errors with specific handling strategies.
 */
export enum ErrorCategory {
  /** Transient server error — retry with backoff */
  RETRYABLE_SERVER = 'retryable_server',
  /** Rate limited — retry with respect for Retry-After header */
  RATE_LIMITED = 'rate_limited',
  /** Context window exceeded — compress and retry */
  CONTEXT_OVERFLOW = 'context_overflow',
  /** Stale TCP connection — reconnect without retry penalty */
  STALE_CONNECTION = 'stale_connection',
  /** Authentication failure — refresh credentials */
  AUTH_FAILURE = 'auth_failure',
  /** Quota exhausted — fallback to lighter model */
  QUOTA_EXCEEDED = 'quota_exceeded',
  /** Client error that won't resolve with retries (e.g. bad request) */
  NON_RETRYABLE = 'non_retryable',
  /** Unclassified / unknown error */
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  category: ErrorCategory;
  status?: number;
  retryable: boolean;
  shouldFallbackModel: boolean;
  shouldCompressAndRetry: boolean;
  shouldReconnect: boolean;
  shouldRefreshAuth: boolean;
}

/**
 * Context overflow patterns from Gemini API responses.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  'token limit',
  'context length',
  'context window',
  'maximum context',
  'too many tokens',
  'exceeds the model',
  'prompt is too long',
  'request too large',
];

/**
 * Stale connection error codes/messages.
 */
const STALE_CONNECTION_PATTERNS = [
  'ECONNRESET',
  'EPIPE',
  'conn reset',
  'connection reset by peer',
  'broken pipe',
  'socket hang up',
  'ETIMEDOUT',
  'ECONNREFUSED',
];

/**
 * Extracts HTTP status code from an error object.
 */
function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }
    if (
      'response' in error &&
      typeof (error as { response?: unknown }).response === 'object' &&
      (error as { response?: unknown }).response !== null
    ) {
      const response = (error as { response: { status?: unknown } }).response;
      if ('status' in response && typeof response.status === 'number') {
        return response.status;
      }
    }
    if ('error' in error) {
      const errObj = (error as { error: unknown }).error;
      if (typeof errObj === 'object' && errObj !== null && 'code' in errObj) {
        return typeof (errObj as { code: unknown }).code === 'number'
          ? (errObj as { code: number }).code
          : undefined;
      }
    }
  }
  return undefined;
}

/**
 * Extracts error message from various error shapes.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    if ('message' in error) return String((error as { message: unknown }).message);
    if ('error' in error) {
      const e = (error as { error: unknown }).error;
      if (typeof e === 'string') return e;
      if (typeof e === 'object' && e !== null && 'message' in e) {
        return String((e as { message: unknown }).message);
      }
    }
  }
  return String(error);
}

/**
 * Checks if an error matches any of the given patterns (case-insensitive).
 */
function matchesPattern(message: string, patterns: string[]): boolean {
  const lower = message.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Classifies an API error into a specific category with handling guidance.
 *
 * This function examines the error's status code, message content, and
 * structure to determine the appropriate recovery strategy.
 */
export function classifyApiError(error: unknown): ClassifiedError {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);

  // Check for stale connections first — these are network-level, not HTTP-level
  if (matchesPattern(message, STALE_CONNECTION_PATTERNS)) {
    return {
      category: ErrorCategory.STALE_CONNECTION,
      status,
      retryable: true,
      shouldFallbackModel: false,
      shouldCompressAndRetry: false,
      shouldReconnect: true,
      shouldRefreshAuth: false,
    };
  }

  // HTTP status-based classification
  switch (status) {
    case 429:
      return {
        category: ErrorCategory.RATE_LIMITED,
        status,
        retryable: true,
        shouldFallbackModel: true,
        shouldCompressAndRetry: false,
        shouldReconnect: false,
        shouldRefreshAuth: false,
      };

    case 400: {
      // 400 can mean context overflow OR bad request
      if (matchesPattern(message, CONTEXT_OVERFLOW_PATTERNS)) {
        return {
          category: ErrorCategory.CONTEXT_OVERFLOW,
          status,
          retryable: true,
          shouldFallbackModel: false,
          shouldCompressAndRetry: true,
          shouldReconnect: false,
          shouldRefreshAuth: false,
        };
      }
      return {
        category: ErrorCategory.NON_RETRYABLE,
        status,
        retryable: false,
        shouldFallbackModel: false,
        shouldCompressAndRetry: false,
        shouldReconnect: false,
        shouldRefreshAuth: false,
      };
    }

    case 401:
    case 403:
      return {
        category: ErrorCategory.AUTH_FAILURE,
        status,
        retryable: true,
        shouldFallbackModel: false,
        shouldCompressAndRetry: false,
        shouldReconnect: false,
        shouldRefreshAuth: true,
      };

    default:
      break;
  }

  // Message-based classification for errors without clear status codes
  if (matchesPattern(message, CONTEXT_OVERFLOW_PATTERNS)) {
    return {
      category: ErrorCategory.CONTEXT_OVERFLOW,
      status,
      retryable: true,
      shouldFallbackModel: false,
      shouldCompressAndRetry: true,
      shouldReconnect: false,
      shouldRefreshAuth: false,
    };
  }

  // Check for quota errors in message content
  if (
    message.includes('Quota exceeded') ||
    message.includes('RESOURCE_EXHAUSTED')
  ) {
    return {
      category: ErrorCategory.QUOTA_EXCEEDED,
      status,
      retryable: true,
      shouldFallbackModel: true,
      shouldCompressAndRetry: false,
      shouldReconnect: false,
      shouldRefreshAuth: false,
    };
  }

  // 5xx errors
  if (status !== undefined && status >= 500 && status < 600) {
    return {
      category: ErrorCategory.RETRYABLE_SERVER,
      status,
      retryable: true,
      shouldFallbackModel: false,
      shouldCompressAndRetry: false,
      shouldReconnect: false,
      shouldRefreshAuth: false,
    };
  }

  // Fallback: check message for status codes embedded in text
  if (message.includes('429')) {
    return {
      category: ErrorCategory.RATE_LIMITED,
      status: status ?? 429,
      retryable: true,
      shouldFallbackModel: true,
      shouldCompressAndRetry: false,
      shouldReconnect: false,
      shouldRefreshAuth: false,
    };
  }
  if (message.match(/5\d{2}/)) {
    return {
      category: ErrorCategory.RETRYABLE_SERVER,
      status,
      retryable: true,
      shouldFallbackModel: false,
      shouldCompressAndRetry: false,
      shouldReconnect: false,
      shouldRefreshAuth: false,
    };
  }

  return {
    category: ErrorCategory.UNKNOWN,
    status,
    retryable: false,
    shouldFallbackModel: false,
    shouldCompressAndRetry: false,
    shouldReconnect: false,
    shouldRefreshAuth: false,
  };
}

/**
 * Returns true if the error is something that can be resolved by retrying.
 */
export function isRetryableError(error: unknown): boolean {
  return classifyApiError(error).retryable;
}
