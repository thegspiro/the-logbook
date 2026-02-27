/**
 * API Error Handler Utilities
 *
 * Standardizes error messages across the application to provide
 * consistent, user-friendly feedback for common error scenarios.
 */

import { isAxiosError } from 'axios';

/**
 * API Error type
 */
export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

/**
 * Type guard: checks if value is an object with a string `message` property
 */
function hasMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

/**
 * Type guard: checks if value is an object with a string `name` property
 */
function hasName(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

/**
 * Type guard: checks if value is an object with a string `detail` property
 */
function hasDetail(value: unknown): value is { detail: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'detail' in value &&
    typeof (value as { detail: unknown }).detail === 'string'
  );
}

/**
 * Type guard for Axios-like error with response.status and response.data
 */
interface AxiosLikeResponse {
  status: number;
  data?: {
    detail?: string;
    message?: string;
  };
}

function hasResponse(value: unknown): value is { response: AxiosLikeResponse } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'response' in value &&
    typeof (value as { response: unknown }).response === 'object' &&
    (value as { response: { status: unknown } }).response !== null &&
    typeof (value as { response: { status: unknown } }).response.status === 'number'
  );
}

/**
 * Safely extract response data fields
 */
function getResponseDetail(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record['detail'] === 'string') return record['detail'];
  }
  return undefined;
}

function getResponseMessage(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record['message'] === 'string') return record['message'];
  }
  return undefined;
}

/**
 * Parse and standardize API errors into user-friendly messages
 *
 * @param error - The error object from try/catch
 * @param context - Optional context for more specific messages
 * @returns User-friendly error message
 */
export function handleApiError(error: unknown, context?: string): string {
  const message = hasMessage(error) ? error.message : '';
  const name = hasName(error) ? error.name : '';

  // Network errors (no response from server)
  if (message === 'Failed to fetch' || name === 'NetworkError') {
    return 'Cannot connect to server. Please check your internet connection and try again.';
  }

  // Timeout errors
  if (name === 'TimeoutError' || message.includes('timeout')) {
    return 'Request timed out. The server is taking too long to respond. Please try again.';
  }

  // CORS errors
  if (message.includes('CORS')) {
    return 'Connection blocked by security policy. Please contact your administrator.';
  }

  // Parse HTTP status codes (supports both Axios errors and Axios-like structures)
  if (isAxiosError(error) && error.response) {
    const status = error.response.status;
    const data: unknown = error.response.data;
    const detail = getResponseDetail(data);
    const msg = getResponseMessage(data);

    switch (status) {
      case 400:
        return detail ?? msg ?? 'Invalid request. Please check your input and try again.';
      case 401:
        return 'Session expired. Please log in again.';
      case 403:
        return 'Access denied. You don\'t have permission to perform this action.';
      case 404:
        return context
          ? `${context} not found. It may have been deleted or moved.`
          : 'The requested resource was not found.';
      case 409:
        return detail ?? 'This item already exists. Please use a different value.';
      case 422:
        return detail ?? 'Validation failed. Please check your input.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
        return 'Server error occurred. Please try again later or contact support if the problem persists.';
      case 502:
      case 503:
      case 504:
        return 'Server is temporarily unavailable. Please try again in a few moments.';
      default:
        if (detail) return detail;
        if (msg) return msg;
        return `Request failed with status ${String(status)}. Please try again.`;
    }
  }

  // Handle non-Axios objects that have a response-like shape (e.g., fetch wrappers)
  if (hasResponse(error)) {
    const { response } = error;
    const status = response.status;
    const data: unknown = response.data;
    const detail = getResponseDetail(data);
    const msg = getResponseMessage(data);

    switch (status) {
      case 400:
        return detail ?? msg ?? 'Invalid request. Please check your input and try again.';
      case 401:
        return 'Session expired. Please log in again.';
      case 403:
        return 'Access denied. You don\'t have permission to perform this action.';
      case 404:
        return context
          ? `${context} not found. It may have been deleted or moved.`
          : 'The requested resource was not found.';
      case 409:
        return detail ?? 'This item already exists. Please use a different value.';
      case 422:
        return detail ?? 'Validation failed. Please check your input.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
        return 'Server error occurred. Please try again later or contact support if the problem persists.';
      case 502:
      case 503:
      case 504:
        return 'Server is temporarily unavailable. Please try again in a few moments.';
      default:
        if (detail) return detail;
        if (msg) return msg;
        return `Request failed with status ${String(status)}. Please try again.`;
    }
  }

  // Extract backend error message if present
  if (hasDetail(error)) {
    return error.detail;
  }

  if (message) {
    // Database connection errors
    if (message.includes('database') || message.includes('connection pool')) {
      return 'Database connection error. Please try again in a moment.';
    }

    // Generic errors - try to make them more friendly
    if (message.toLowerCase().includes('internal server error')) {
      return 'An unexpected error occurred. Please try again or contact support.';
    }

    // Return the original message if it seems user-friendly
    // (doesn't contain technical jargon)
    if (!containsTechnicalJargon(message)) {
      return message;
    }
  }

  // Fallback with context if available
  if (context) {
    return `Failed to ${context}. Please try again.`;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Check if a message contains technical jargon that users shouldn't see
 */
function containsTechnicalJargon(message: string): boolean {
  const technicalTerms = [
    'stack trace',
    'exception',
    'null pointer',
    'undefined is not',
    'cannot read property',
    'traceback',
    'errno',
    'syscall',
    'econnrefused',
    'enotfound',
    'getaddrinfo',
  ];

  const lowerMessage = message.toLowerCase();
  return technicalTerms.some(term => lowerMessage.includes(term));
}

/**
 * Format validation errors from FastAPI/Pydantic
 *
 * @param validationErrors - Array of validation error objects
 * @returns User-friendly error message
 */
export function formatValidationErrors(validationErrors: Array<{ loc?: string[]; msg?: string }>): string {
  if (!validationErrors || validationErrors.length === 0) {
    return 'Validation failed. Please check your input.';
  }

  if (validationErrors.length === 1) {
    const error = validationErrors[0];
    if (!error) {
      return 'Validation failed. Please check your input.';
    }
    const field = error.loc?.[error.loc.length - 1] ?? 'field';
    return `${capitalizeFirst(field)}: ${error.msg ?? ''}`;
  }

  // Multiple errors
  const errorMessages = validationErrors.map(error => {
    const field = error.loc?.[error.loc.length - 1] ?? 'field';
    return `• ${capitalizeFirst(field)}: ${error.msg ?? ''}`;
  });

  return `Please fix the following errors:\n${errorMessages.join('\n')}`;
}

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Check if an error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message === 'Failed to fetch' ||
      error.name === 'NetworkError' ||
      (error.name === 'TypeError' && error.message.includes('fetch'))
    );
  }
  return false;
}

/**
 * Check if an error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  if (isAxiosError(error)) {
    return error.response?.status === 401 || error.response?.status === 403;
  }
  if (hasResponse(error)) {
    return error.response.status === 401 || error.response.status === 403;
  }
  return false;
}

/**
 * Check if an error is a validation error
 */
export function isValidationError(error: unknown): boolean {
  if (isAxiosError(error)) {
    return error.response?.status === 422 || error.response?.status === 400;
  }
  if (hasResponse(error)) {
    return error.response.status === 422 || error.response.status === 400;
  }
  return false;
}

/**
 * Get a user-friendly message for common onboarding errors
 */
export function getOnboardingErrorMessage(error: unknown, step?: string): string {
  const baseMessage = handleApiError(error, step);

  // Add step-specific guidance
  if (step) {
    switch (step.toLowerCase()) {
      case 'email':
      case 'smtp':
        if (baseMessage.includes('authentication')) {
          return `${baseMessage}\n\nTip: Gmail and Outlook require app-specific passwords. Check your email provider's documentation.`;
        }
        break;

      case 'organization':
        if (baseMessage.includes('already exists')) {
          return `${baseMessage}\n\nTip: Try adding your location or year (e.g., "FCVFD 2024" or "FCVFD West").`;
        }
        break;

      case 'admin':
      case 'user':
        if (baseMessage.includes('already')) {
          return `${baseMessage}\n\nTip: Try variations like adding numbers or your organization name.`;
        }
        break;
    }
  }

  return baseMessage;
}
