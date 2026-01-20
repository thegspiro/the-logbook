/**
 * Error Tracking Service
 *
 * Provides centralized error logging, user-friendly error messages,
 * and troubleshooting guidance for the QR code check-in system.
 */

export interface ErrorLog {
  id: string;
  timestamp: Date;
  errorType: string;
  errorMessage: string;
  userMessage: string;
  troubleshootingSteps: string[];
  context: Record<string, any>;
  userId?: string;
  eventId?: string;
}

class ErrorTrackingService {
  private errors: ErrorLog[] = [];
  private maxErrors = 100; // Keep last 100 errors in memory

  /**
   * Known error types and their user-friendly messages
   */
  private errorMappings: Record<string, {
    userMessage: string;
    troubleshootingSteps: string[];
  }> = {
    'EVENT_NOT_FOUND': {
      userMessage: 'This event could not be found. It may have been deleted or you may not have permission to view it.',
      troubleshootingSteps: [
        'Verify you\'re using the correct QR code for this event',
        'Check if the event has been cancelled or deleted',
        'Contact your organization administrator for assistance',
      ],
    },
    'CHECK_IN_NOT_AVAILABLE': {
      userMessage: 'Check-in is not currently available for this event.',
      troubleshootingSteps: [
        'Check-in opens 1 hour before the event starts',
        'Check-in closes when the event ends',
        'Verify the current time matches the event schedule',
        'Ask an event manager if the event was ended early',
      ],
    },
    'ALREADY_CHECKED_IN': {
      userMessage: 'You have already checked in to this event.',
      troubleshootingSteps: [
        'If you believe this is an error, contact an event manager',
        'Your attendance has been recorded',
      ],
    },
    'EVENT_CANCELLED': {
      userMessage: 'This event has been cancelled.',
      troubleshootingSteps: [
        'Contact the event organizer for more information',
        'Check your email for cancellation details',
        'Look for rescheduled event information',
      ],
    },
    'NETWORK_ERROR': {
      userMessage: 'Unable to connect to the server. Please check your internet connection.',
      troubleshootingSteps: [
        'Check your WiFi or mobile data connection',
        'Try refreshing the page',
        'Wait a moment and try again',
        'Contact IT support if the problem persists',
      ],
    },
    'AUTHENTICATION_REQUIRED': {
      userMessage: 'Please log in to check in to this event.',
      troubleshootingSteps: [
        'Click the login link to sign in',
        'Use your organization email address',
        'Contact your administrator if you don\'t have login credentials',
      ],
    },
    'NOT_ORGANIZATION_MEMBER': {
      userMessage: 'You are not a member of the organization hosting this event.',
      troubleshootingSteps: [
        'Verify you\'re logged in with the correct account',
        'Contact the organization administrator to request membership',
        'Check if you need to complete onboarding first',
      ],
    },
    'CAPACITY_REACHED': {
      userMessage: 'This event has reached its maximum capacity.',
      troubleshootingSteps: [
        'Contact the event organizer about waitlist options',
        'Check for alternative event times or sessions',
      ],
    },
    'QR_CODE_INVALID': {
      userMessage: 'This QR code is not valid or has expired.',
      troubleshootingSteps: [
        'Ask an event manager for a fresh QR code',
        'Verify you\'re scanning the correct code for this event',
        'Check if the event has been rescheduled',
      ],
    },
  };

  /**
   * Log an error with enhanced context
   */
  logError(
    error: Error | string,
    context: {
      errorType?: string;
      eventId?: string;
      userId?: string;
      additionalContext?: Record<string, any>;
    } = {}
  ): ErrorLog {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorType = context.errorType || this.detectErrorType(errorMessage);
    const mapping = this.errorMappings[errorType] || {
      userMessage: errorMessage,
      troubleshootingSteps: ['Please try again or contact support'],
    };

    const errorLog: ErrorLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
        url: window.location.href,
      },
    };

    this.errors.unshift(errorLog);
    if (this.errors.length > this.maxErrors) {
      this.errors.pop();
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[Error Tracking]', errorLog);
    }

    // In production, you would send this to a backend service
    this.sendToBackend(errorLog);

    return errorLog;
  }

  /**
   * Detect error type from error message
   */
  private detectErrorType(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
      return 'EVENT_NOT_FOUND';
    }
    if (lowerMessage.includes('already checked in')) {
      return 'ALREADY_CHECKED_IN';
    }
    if (lowerMessage.includes('cancelled')) {
      return 'EVENT_CANCELLED';
    }
    if (lowerMessage.includes('not available') || lowerMessage.includes('time window')) {
      return 'CHECK_IN_NOT_AVAILABLE';
    }
    if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
      return 'NETWORK_ERROR';
    }
    if (lowerMessage.includes('unauthorized') || lowerMessage.includes('login') || lowerMessage.includes('401')) {
      return 'AUTHENTICATION_REQUIRED';
    }
    if (lowerMessage.includes('not a member') || lowerMessage.includes('organization')) {
      return 'NOT_ORGANIZATION_MEMBER';
    }
    if (lowerMessage.includes('capacity')) {
      return 'CAPACITY_REACHED';
    }
    if (lowerMessage.includes('invalid') || lowerMessage.includes('expired')) {
      return 'QR_CODE_INVALID';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Get all logged errors
   */
  getErrors(): ErrorLog[] {
    return [...this.errors];
  }

  /**
   * Get errors for a specific event
   */
  getErrorsForEvent(eventId: string): ErrorLog[] {
    return this.errors.filter(e => e.context.eventId === eventId);
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats: Record<string, number> = {};

    this.errors.forEach(error => {
      stats[error.errorType] = (stats[error.errorType] || 0) + 1;
    });

    return {
      total: this.errors.length,
      byType: stats,
      recentErrors: this.errors.slice(0, 5),
    };
  }

  /**
   * Clear all errors
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Send error to backend (placeholder for future implementation)
   */
  private async sendToBackend(errorLog: ErrorLog): Promise<void> {
    // TODO: Implement backend error logging
    // This would send errors to your backend for persistent storage and analysis
    /*
    try {
      await fetch('/api/v1/errors/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorLog),
      });
    } catch (err) {
      console.error('Failed to send error to backend:', err);
    }
    */
  }

  /**
   * Export errors for analysis
   */
  exportErrors(): string {
    return JSON.stringify(this.errors, null, 2);
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
export function getEnhancedError(error: string | Error, context?: {
  eventId?: string;
  userId?: string;
}): ErrorLog {
  return errorTracker.logError(error, context);
}
