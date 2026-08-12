/**
 * Error Tracking Service
 *
 * Provides centralized error logging, user-friendly error messages, and
 * troubleshooting guidance for explicitly reported failures anywhere in the
 * app, plus the read side of the Error Monitoring page.
 *
 * Errors are persisted to the backend API for persistent storage and analysis.
 * Automatic reporting (failed API calls, uncaught exceptions) goes through
 * `errorReporting.ts` directly rather than through this service.
 */

import { errorLogsService, type ErrorLogRecord, type ErrorLogStats } from './api';
import { detectErrorType, getErrorMapping } from './errorCatalog';
import { reportError } from './errorReporting';

export interface ErrorLog {
  id: string;
  timestamp: Date;
  errorType: string;
  errorMessage: string;
  userMessage: string;
  troubleshootingSteps: string[];
  context: Record<string, unknown>;
  userId?: string | undefined;
  eventId?: string | undefined;
}

function mapApiError(record: ErrorLogRecord): ErrorLog {
  return {
    id: record.id,
    timestamp: new Date(record.created_at),
    errorType: record.error_type,
    errorMessage: record.error_message,
    userMessage: record.user_message || record.error_message,
    troubleshootingSteps: record.troubleshooting_steps || [],
    context: record.context || {},
    userId: record.user_id,
    eventId: record.event_id,
  };
}

class ErrorTrackingService {
  /**
   * Log an error with enhanced context - persists to backend
   */
  logError(
    error: Error | string,
    context: {
      errorType?: string;
      eventId?: string;
      userId?: string;
      additionalContext?: Record<string, unknown>;
    } = {}
  ): ErrorLog {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorType = context.errorType || detectErrorType(errorMessage);
    const mapping = getErrorMapping(errorType, errorMessage);

    const errorLog: ErrorLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      timestamp: new Date(),
      errorType,
      errorMessage,
      userMessage: mapping.userMessage,
      troubleshootingSteps: mapping.troubleshootingSteps,
      context: {
        ...context.additionalContext,
        eventId: context.eventId,
        userId: context.userId,
        userAgent: navigator.userAgent,
        url: window.location.origin + window.location.pathname,
      },
    };

    // Log to console in development
    if (import.meta.env.DEV) {
      console.error('[Error Tracking]', errorLog);
    }

    // Persist through the shared transport, which applies the same
    // de-duplication and rate cap as automatically reported failures and keeps
    // the report off the instrumented axios instance.
    reportError({
      errorType,
      errorMessage,
      userMessage: mapping.userMessage,
      troubleshootingSteps: mapping.troubleshootingSteps,
      context: errorLog.context,
      eventId: context.eventId,
    });

    return errorLog;
  }

  /**
   * Get all logged errors (from backend)
   */
  async getErrors(params?: { error_type?: string; event_id?: string }): Promise<ErrorLog[]> {
    const result = await errorLogsService.getErrors({ ...params, limit: 100 });
    return result.errors.map(mapApiError);
  }

  /**
   * Get errors for a specific event (from backend)
   */
  async getErrorsForEvent(eventId: string): Promise<ErrorLog[]> {
    return this.getErrors({ event_id: eventId });
  }

  /**
   * Get error statistics (from backend)
   */
  async getErrorStats(): Promise<{ total: number; byType: Record<string, number>; recentErrors: ErrorLog[] }> {
    const stats: ErrorLogStats = await errorLogsService.getStats();
    return {
      total: stats.total,
      byType: stats.by_type,
      recentErrors: stats.recent_errors.map(mapApiError),
    };
  }

  /**
   * Clear all errors (via backend)
   */
  async clearErrors(): Promise<void> {
    await errorLogsService.clearErrors();
  }

  /**
   * Export errors for analysis (from backend)
   */
  async exportErrors(params?: { event_id?: string }): Promise<string> {
    return errorLogsService.exportErrors(params);
  }
}

// Export singleton instance
export const errorTracker = new ErrorTrackingService();

/**
 * Enhanced error component props
 */
export interface EnhancedErrorProps {
  error: string | Error;
  eventId?: string;
  userId?: string;
  onRetry?: () => void;
}

/**
 * Get enhanced error information
 */
export function getEnhancedError(
  error: string | Error,
  context?: {
    eventId?: string;
    userId?: string;
  }
): ErrorLog {
  return errorTracker.logError(error, context);
}
