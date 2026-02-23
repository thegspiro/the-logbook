/**
 * API Error Handler Utilities
 *
 * Standardizes error messages across the application to provide
 * consistent, user-friendly feedback for common error scenarios.
 */

/**
 * API Error type
 */
export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

/**
 * Parse and standardize API errors into user-friendly messages
 *
 * @param error - The error object from try/catch
 * @param context - Optional context for more specific messages
 * @returns User-friendly error message
 */
export function handleApiError(error: unknown, context?: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as Record<string, any>;
  // Network errors (no response from server)
  if (err.message === 'Failed to fetch' || err.name === 'NetworkError') {
    return 'Cannot connect to server. Please check your internet connection and try again.';
  }

  // Timeout errors
  if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
    return 'Request timed out. The server is taking too long to respond. Please try again.';
  }

  // CORS errors
  if (err.message?.includes('CORS')) {
    return 'Connection blocked by security policy. Please contact your administrator.';
  }

  // Parse HTTP status codes
  if (err.response) {
    const status = err.response.status;

    switch (status) {
      case 400:
        // Bad request - use backend message if available
        return err.response.data?.detail || err.response.data?.message || 'Invalid request. Please check your input and try again.';

      case 401:
        return 'Session expired. Please log in again.';

      case 403:
        return 'Access denied. You don\'t have permission to perform this action.';

      case 404:
        return context
          ? `${context} not found. It may have been deleted or moved.`
          : 'The requested resource was not found.';

      case 409:
        // Conflict - usually duplicate entry
        return err.response.data?.detail || 'This item already exists. Please use a different value.';

      case 422:
        // Validation error - use backend message
        return err.response.data?.detail || 'Validation failed. Please check your input.';

      case 429:
        return 'Too many requests. Please wait a moment and try again.';

      case 500:
        return 'Server error occurred. Please try again later or contact support if the problem persists.';

      case 502:
      case 503:
      case 504:
        return 'Server is temporarily unavailable. Please try again in a few moments.';

      default:
        // Use backend error message if available
        if (err.response.data?.detail) {
          return err.response.data.detail;
        }
        if (err.response.data?.message) {
          return err.response.data.message;
        }
        return `Request failed with status ${status}. Please try again.`;
    }
  }

  // Extract backend error message if present
  if (err.detail) {
    return err.detail;
  }

  if (err.message) {
    // Clean up common error messages
    const message = err.message;

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
    const error = validationErrors[0]!;
    const field = error.loc?.[error.loc.length - 1] || 'field';
    return `${capitalizeFirst(field)}: ${error.msg ?? ''}`;
  }

  // Multiple errors
  const errorMessages = validationErrors.map(error => {
    const field = error.loc?.[error.loc.length - 1] || 'field';
    return `• ${capitalizeFirst(field)}: ${error.msg}`;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as Record<string, any>;
  return (
    err.message === 'Failed to fetch' ||
    err.name === 'NetworkError' ||
    err.name === 'TypeError' && err.message?.includes('fetch')
  );
}

/**
 * Check if an error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as Record<string, any>;
  return err.response?.status === 401 || err.response?.status === 403;
}

/**
 * Check if an error is a validation error
 */
export function isValidationError(error: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as Record<string, any>;
  return err.response?.status === 422 || err.response?.status === 400;
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
