import { describe, it, expect } from 'vitest';
import { isAppError, toAppError, getErrorMessage } from './errorHandling';
import type { AppError } from './errorHandling';

describe('errorHandling', () => {
  // ---- isAppError ----

  describe('isAppError', () => {
    it('returns true for a plain object with a message string', () => {
      expect(isAppError({ message: 'Something went wrong' })).toBe(true);
    });

    it('returns true for an AppError with all optional fields', () => {
      const error: AppError = {
        message: 'Forbidden',
        code: 'FORBIDDEN',
        status: 403,
        details: { resource: 'users' },
      };
      expect(isAppError(error)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isAppError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isAppError(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isAppError('error message')).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isAppError(42)).toBe(false);
    });

    it('returns false for an object whose message is not a string', () => {
      expect(isAppError({ message: 123 })).toBe(false);
    });

    it('returns false for an object without a message property', () => {
      expect(isAppError({ code: 'ERR' })).toBe(false);
    });

    it('returns true for an Error instance (has message string)', () => {
      // Error instances have a string `message` property and are objects,
      // so isAppError returns true for them by design.
      expect(isAppError(new Error('fail'))).toBe(true);
    });
  });

  // ---- toAppError ----

  describe('toAppError', () => {
    it('handles Axios-like errors with response.data.detail', () => {
      const axiosError = {
        response: {
          data: { detail: 'Not authenticated' },
          status: 401,
          statusText: 'Unauthorized',
        },
      };

      const result = toAppError(axiosError);

      expect(result.message).toBe('Not authenticated');
      expect(result.status).toBe(401);
    });

    it('handles Axios-like errors with response.data.message', () => {
      const axiosError = {
        response: {
          data: { message: 'Validation failed', code: 'VALIDATION_ERROR', details: { field: 'email' } },
          status: 422,
          statusText: 'Unprocessable Entity',
        },
      };

      const result = toAppError(axiosError);

      expect(result.message).toBe('Validation failed');
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.status).toBe(422);
      expect(result.details).toEqual({ field: 'email' });
    });

    it('uses statusText when no data detail or message', () => {
      const axiosError = {
        response: {
          data: {},
          status: 500,
          statusText: 'Internal Server Error',
        },
      };

      const result = toAppError(axiosError);
      expect(result.message).toBe('Internal Server Error');
    });

    it('defaults to "Request failed" when response has no useful data', () => {
      const axiosError = {
        response: {
          data: {},
          status: 500,
        },
      };

      const result = toAppError(axiosError);
      expect(result.message).toBe('Request failed');
    });

    it('handles standard Error objects', () => {
      const error = new Error('Something broke');
      const result = toAppError(error);

      expect(result.message).toBe('Something broke');
      expect(result.details).toBeDefined();
      expect(result.details!.name).toBe('Error');
      expect(result.details!.stack).toBeDefined();
    });

    it('handles TypeError objects', () => {
      const error = new TypeError('Cannot read property');
      const result = toAppError(error);

      expect(result.message).toBe('Cannot read property');
      expect(result.details!.name).toBe('TypeError');
    });

    it('handles string errors', () => {
      const result = toAppError('Something happened');
      expect(result.message).toBe('Something happened');
    });

    it('handles unknown error types (e.g. number)', () => {
      const result = toAppError(42);
      expect(result.message).toBe('An unknown error occurred');
      expect(result.details).toEqual({ error: '42' });
    });

    it('handles unknown error types (e.g. boolean)', () => {
      const result = toAppError(false);
      expect(result.message).toBe('An unknown error occurred');
      expect(result.details).toEqual({ error: 'false' });
    });

    it('handles null', () => {
      const result = toAppError(null);
      expect(result.message).toBe('An unknown error occurred');
    });

    it('handles undefined', () => {
      const result = toAppError(undefined);
      expect(result.message).toBe('An unknown error occurred');
    });

    it('passes through AppError-like plain objects (not Error, not Axios) as-is', () => {
      // A plain object with message that is NOT an Error and has no response
      // Note: because isAppError is checked after Error, this path only
      // triggers for plain objects that are not Error instances.
      const plainError = { message: 'plain error', code: 'PLAIN' };
      const result = toAppError(plainError);
      expect(result.message).toBe('plain error');
      expect(result.code).toBe('PLAIN');
    });

    it('Axios-like error takes precedence over Error instance check', () => {
      // An object that is both an Error and has a response property
      const hybridError = new Error('Network Error');
      (hybridError as any).response = {
        data: { detail: 'Server unavailable' },
        status: 503,
      };

      const result = toAppError(hybridError);
      // The response branch is checked first, so it wins
      expect(result.message).toBe('Server unavailable');
      expect(result.status).toBe(503);
    });
  });

  // ---- getErrorMessage ----

  describe('getErrorMessage', () => {
    it('extracts message from an Error instance', () => {
      expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
    });

    it('extracts message from an Axios-like error', () => {
      const axiosError = {
        response: { data: { detail: 'Token expired' }, status: 401 },
      };
      expect(getErrorMessage(axiosError)).toBe('Token expired');
    });

    it('extracts message from a string error', () => {
      expect(getErrorMessage('string error')).toBe('string error');
    });

    it('extracts message from an AppError object', () => {
      expect(getErrorMessage({ message: 'App error' })).toBe('App error');
    });

    it('uses default fallback for unknown errors', () => {
      expect(getErrorMessage(null)).toBe('An unknown error occurred');
    });

    it('uses provided fallback when toAppError yields an empty message', () => {
      // Construct an AppError-like object with an empty message string.
      // A plain object with message: '' is not an Error and has no response,
      // so toAppError's isAppError path returns it as-is with an empty message.
      const emptyError = { message: '' };
      expect(getErrorMessage(emptyError, 'Custom fallback')).toBe('Custom fallback');
    });

    it('returns the default fallback string when no custom fallback is provided and message is empty', () => {
      const emptyError = { message: '' };
      expect(getErrorMessage(emptyError)).toBe('An error occurred');
    });

    it('returns "Request failed" for axios-like error with all empty strings', () => {
      // When detail, message, and statusText are all empty strings,
      // the || chain in toAppError falls through to "Request failed".
      const axiosError = {
        response: { data: { detail: '', message: '' }, statusText: '' },
      };
      expect(getErrorMessage(axiosError)).toBe('Request failed');
    });
  });
});
