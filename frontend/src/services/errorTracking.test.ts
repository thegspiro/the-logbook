import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the errorLogsService from ./api BEFORE importing errorTracking
const mockLogError = vi.fn();
const mockGetErrors = vi.fn();
const mockGetStats = vi.fn();
const mockClearErrors = vi.fn();
const mockExportErrors = vi.fn();

vi.mock('./api', () => ({
  errorLogsService: {
    logError: (...args: unknown[]) => mockLogError(...args) as unknown,
    getErrors: (...args: unknown[]) => mockGetErrors(...args) as unknown,
    getStats: (...args: unknown[]) => mockGetStats(...args) as unknown,
    clearErrors: (...args: unknown[]) => mockClearErrors(...args) as unknown,
    exportErrors: (...args: unknown[]) => mockExportErrors(...args) as unknown,
  },
}));

// Import AFTER mocks
import { errorTracker, getEnhancedError } from './errorTracking';
import type { ErrorLog } from './errorTracking';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ErrorTrackingService', () => {
  // ── logError ─────────────────────────────────────────────────────────
  describe('logError', () => {
    it('should log an error with a known error type and return enriched ErrorLog', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Event not found', {
        errorType: 'EVENT_NOT_FOUND',
        eventId: 'evt-1',
        userId: 'usr-1',
      });

      expect(result.errorType).toBe('EVENT_NOT_FOUND');
      expect(result.errorMessage).toBe('Event not found');
      expect(result.userMessage).toBe(
        'This event could not be found. It may have been deleted or you may not have permission to view it.',
      );
      expect(result.troubleshootingSteps.length).toBeGreaterThan(0);
      expect(result.context).toMatchObject({
        eventId: 'evt-1',
        userId: 'usr-1',
      });
      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should accept an Error object instead of a string', () => {
      mockLogError.mockResolvedValue(undefined);

      const error = new Error('Network failure');
      const result = errorTracker.logError(error, { errorType: 'NETWORK_ERROR' });

      expect(result.errorMessage).toBe('Network failure');
      expect(result.errorType).toBe('NETWORK_ERROR');
      expect(result.userMessage).toBe(
        'Unable to connect to the server. Please check your internet connection.',
      );
    });

    it('should auto-detect error type from error message when not provided', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Event not found or 404 error');

      expect(result.errorType).toBe('EVENT_NOT_FOUND');
    });

    it('should detect ALREADY_CHECKED_IN from message', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('You have already checked in');

      expect(result.errorType).toBe('ALREADY_CHECKED_IN');
    });

    it('should detect EVENT_CANCELLED from message', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('This event has been cancelled');

      expect(result.errorType).toBe('EVENT_CANCELLED');
    });

    it('should detect CHECK_IN_NOT_AVAILABLE from message', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Check-in not available outside time window');

      expect(result.errorType).toBe('CHECK_IN_NOT_AVAILABLE');
    });

    it('should detect NETWORK_ERROR from message', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('network connection lost');

      expect(result.errorType).toBe('NETWORK_ERROR');
    });

    it('should detect AUTHENTICATION_REQUIRED from message containing "unauthorized"', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Unauthorized access');

      expect(result.errorType).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should detect AUTHENTICATION_REQUIRED from message containing "401"', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Request failed with status 401');

      expect(result.errorType).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should detect NOT_ORGANIZATION_MEMBER from message', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('You are not a member of this organization');

      expect(result.errorType).toBe('NOT_ORGANIZATION_MEMBER');
    });

    it('should detect CAPACITY_REACHED from message', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Event capacity reached');

      expect(result.errorType).toBe('CAPACITY_REACHED');
    });

    it('should detect QR_CODE_INVALID from message containing "invalid"', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('QR code is invalid');

      expect(result.errorType).toBe('QR_CODE_INVALID');
    });

    it('should detect QR_CODE_INVALID from message containing "expired"', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('This code has expired');

      expect(result.errorType).toBe('QR_CODE_INVALID');
    });

    it('should fall back to UNKNOWN_ERROR for unrecognized messages', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Something completely unexpected happened');

      expect(result.errorType).toBe('UNKNOWN_ERROR');
      expect(result.userMessage).toBe('Something completely unexpected happened');
      expect(result.troubleshootingSteps).toEqual(['Please try again or contact support']);
    });

    it('should persist error to backend via errorLogsService.logError', () => {
      mockLogError.mockResolvedValue(undefined);

      errorTracker.logError('Test error', {
        errorType: 'NETWORK_ERROR',
        eventId: 'evt-42',
      });

      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({
          error_type: 'NETWORK_ERROR',
          error_message: 'Test error',
          user_message: 'Unable to connect to the server. Please check your internet connection.',
          event_id: 'evt-42',
          context: expect.objectContaining({ eventId: 'evt-42' }) as unknown,
        }),
      );
    });

    it('should not throw when backend persistence fails', () => {
      mockLogError.mockRejectedValue(new Error('Backend unavailable'));

      // This should not throw
      const result = errorTracker.logError('Some error');

      expect(result).toBeDefined();
      expect(result.errorMessage).toBe('Some error');
    });

    it('should include additional context in the error log', () => {
      mockLogError.mockResolvedValue(undefined);

      const result = errorTracker.logError('Test error', {
        additionalContext: { customField: 'value', retryCount: 3 },
      });

      expect(result.context).toMatchObject({
        customField: 'value',
        retryCount: 3,
      });
    });
  });

  // ── getErrors ────────────────────────────────────────────────────────
  describe('getErrors', () => {
    it('should fetch errors from backend and map to ErrorLog format', async () => {
      const apiErrors = {
        errors: [
          {
            id: 'e1',
            error_type: 'NETWORK_ERROR',
            error_message: 'Connection lost',
            user_message: 'Unable to connect',
            troubleshooting_steps: ['Check WiFi'],
            context: { url: '/api/v1/events' },
            user_id: 'u1',
            event_id: 'evt-1',
            created_at: '2024-06-15T12:00:00Z',
          },
        ],
        total: 1,
      };
      mockGetErrors.mockResolvedValue(apiErrors);

      const result = await errorTracker.getErrors();

      expect(mockGetErrors).toHaveBeenCalledWith({ limit: 100 });
      expect(result).toHaveLength(1);
      const first = result[0] as ErrorLog;
      expect(first.id).toBe('e1');
      expect(first.errorType).toBe('NETWORK_ERROR');
      expect(first.errorMessage).toBe('Connection lost');
      expect(first.userMessage).toBe('Unable to connect');
      expect(first.troubleshootingSteps).toEqual(['Check WiFi']);
      expect(first.context).toEqual({ url: '/api/v1/events' });
      expect(first.userId).toBe('u1');
      expect(first.eventId).toBe('evt-1');
      expect(first.timestamp).toBeInstanceOf(Date);
    });

    it('should pass filter params to the backend', async () => {
      mockGetErrors.mockResolvedValue({ errors: [], total: 0 });

      await errorTracker.getErrors({ error_type: 'NETWORK_ERROR', event_id: 'evt-1' });

      expect(mockGetErrors).toHaveBeenCalledWith({
        error_type: 'NETWORK_ERROR',
        event_id: 'evt-1',
        limit: 100,
      });
    });

    it('should return empty array when backend call fails', async () => {
      mockGetErrors.mockRejectedValue(new Error('Server error'));

      const result = await errorTracker.getErrors();

      expect(result).toEqual([]);
    });
  });

  // ── getErrorsForEvent ────────────────────────────────────────────────
  describe('getErrorsForEvent', () => {
    it('should delegate to getErrors with event_id filter', async () => {
      mockGetErrors.mockResolvedValue({ errors: [], total: 0 });

      await errorTracker.getErrorsForEvent('evt-42');

      expect(mockGetErrors).toHaveBeenCalledWith({ event_id: 'evt-42', limit: 100 });
    });
  });

  // ── getErrorStats ────────────────────────────────────────────────────
  describe('getErrorStats', () => {
    it('should fetch stats from backend and transform the response', async () => {
      const apiStats = {
        total: 15,
        by_type: { NETWORK_ERROR: 10, EVENT_NOT_FOUND: 5 },
        recent_errors: [
          {
            id: 'e1',
            error_type: 'NETWORK_ERROR',
            error_message: 'Timeout',
            user_message: 'Connection issue',
            troubleshooting_steps: [],
            context: {},
            created_at: '2024-06-15T10:00:00Z',
          },
        ],
      };
      mockGetStats.mockResolvedValue(apiStats);

      const result = await errorTracker.getErrorStats();

      expect(mockGetStats).toHaveBeenCalled();
      expect(result.total).toBe(15);
      expect(result.byType).toEqual({ NETWORK_ERROR: 10, EVENT_NOT_FOUND: 5 });
      expect(result.recentErrors).toHaveLength(1);
      expect(result.recentErrors[0]?.errorType).toBe('NETWORK_ERROR');
      expect(result.recentErrors[0]?.timestamp).toBeInstanceOf(Date);
    });

    it('should return empty stats when backend call fails', async () => {
      mockGetStats.mockRejectedValue(new Error('Server error'));

      const result = await errorTracker.getErrorStats();

      expect(result).toEqual({ total: 0, byType: {}, recentErrors: [] });
    });
  });

  // ── clearErrors ──────────────────────────────────────────────────────
  describe('clearErrors', () => {
    it('should call errorLogsService.clearErrors', async () => {
      mockClearErrors.mockResolvedValue(undefined);

      await errorTracker.clearErrors();

      expect(mockClearErrors).toHaveBeenCalled();
    });

    it('should silently fail when backend call fails', async () => {
      mockClearErrors.mockRejectedValue(new Error('Server error'));

      // Should not throw
      await expect(errorTracker.clearErrors()).resolves.toBeUndefined();
    });
  });

  // ── exportErrors ─────────────────────────────────────────────────────
  describe('exportErrors', () => {
    it('should return JSON string from backend', async () => {
      const exported = '[{"id":"e1","error_type":"NETWORK_ERROR"}]';
      mockExportErrors.mockResolvedValue(exported);

      const result = await errorTracker.exportErrors();

      expect(mockExportErrors).toHaveBeenCalledWith(undefined);
      expect(result).toBe(exported);
    });

    it('should pass event_id filter to backend', async () => {
      mockExportErrors.mockResolvedValue('[]');

      await errorTracker.exportErrors({ event_id: 'evt-1' });

      expect(mockExportErrors).toHaveBeenCalledWith({ event_id: 'evt-1' });
    });

    it('should return empty JSON array when backend call fails', async () => {
      mockExportErrors.mockRejectedValue(new Error('Server error'));

      const result = await errorTracker.exportErrors();

      expect(result).toBe(JSON.stringify([], null, 2));
    });
  });
});

// ============================================================================
// getEnhancedError (exported helper function)
// ============================================================================
describe('getEnhancedError', () => {
  it('should return an enriched ErrorLog by delegating to errorTracker.logError', () => {
    mockLogError.mockResolvedValue(undefined);

    const result = getEnhancedError('Test failure', { eventId: 'evt-1', userId: 'usr-1' });

    expect(result).toBeDefined();
    expect(result.errorMessage).toBe('Test failure');
    expect(result.context).toMatchObject({ eventId: 'evt-1', userId: 'usr-1' });
  });

  it('should accept an Error object', () => {
    mockLogError.mockResolvedValue(undefined);

    const error = new Error('Something broke');
    const result = getEnhancedError(error);

    expect(result.errorMessage).toBe('Something broke');
  });

  it('should work without context', () => {
    mockLogError.mockResolvedValue(undefined);

    const result = getEnhancedError('No context error');

    expect(result).toBeDefined();
    expect(result.errorType).toBe('UNKNOWN_ERROR');
  });
});
