import { describe, it, expect } from 'vitest';
import { handleStoreError } from './storeHelpers';

describe('storeHelpers', () => {
  describe('handleStoreError', () => {
    it('extracts message from an Error instance', () => {
      const error = new Error('Database connection failed');
      expect(handleStoreError(error, 'Fallback')).toBe('Database connection failed');
    });

    it('extracts message from an Axios-like error', () => {
      const axiosError = {
        response: {
          data: { detail: 'Permission denied' },
          status: 403,
        },
      };
      expect(handleStoreError(axiosError, 'Fallback')).toBe('Permission denied');
    });

    it('returns the string directly for string errors', () => {
      expect(handleStoreError('Something broke', 'Fallback')).toBe('Something broke');
    });

    it('uses fallback for unknown error types', () => {
      expect(handleStoreError(null, 'Could not load data')).toBe('An unknown error occurred');
    });

    it('uses fallback when error message is empty', () => {
      const emptyError = { message: '' };
      expect(handleStoreError(emptyError, 'Failed to save')).toBe('Failed to save');
    });

    it('extracts message from a plain object with message property', () => {
      expect(handleStoreError({ message: 'Custom error' }, 'Fallback')).toBe('Custom error');
    });

    it('handles undefined errors with fallback', () => {
      expect(handleStoreError(undefined, 'Operation failed')).toBe('An unknown error occurred');
    });

    it('handles numeric errors with generic message', () => {
      expect(handleStoreError(42, 'Fallback')).toBe('An unknown error occurred');
    });
  });
});
