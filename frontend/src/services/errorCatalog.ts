/**
 * Error Catalog
 *
 * Maps machine error types to the user-facing message and troubleshooting
 * steps stored alongside every error log.
 *
 * This lives apart from `errorTracking.ts` because two layers need it: the
 * tracking service (explicit `logError` calls) and the transport in
 * `errorReporting.ts` (automatic reports from the axios interceptors and the
 * global handlers). Importing the tracking service from the transport would
 * close an import cycle through the axios client.
 */

export interface ErrorMapping {
  userMessage: string;
  troubleshootingSteps: string[];
}

export const ERROR_MAPPINGS: Record<string, ErrorMapping> = {
  EVENT_NOT_FOUND: {
    userMessage: 'This event could not be found. It may have been deleted or you may not have permission to view it.',
    troubleshootingSteps: [
      "Verify you're using the correct QR code for this event",
      'Check if the event has been cancelled or deleted',
      'Contact your organization administrator for assistance',
    ],
  },
  CHECK_IN_NOT_AVAILABLE: {
    userMessage: 'Check-in is not currently available for this event.',
    troubleshootingSteps: [
      'Check-in opens 1 hour before the event starts',
      'Check-in closes when the event ends',
      'Verify the current time matches the event schedule',
      'Ask an event manager if the event was ended early',
    ],
  },
  ALREADY_CHECKED_IN: {
    userMessage: 'You have already checked in to this event.',
    troubleshootingSteps: [
      'If you believe this is an error, contact an event manager',
      'Your attendance has been recorded',
    ],
  },
  EVENT_CANCELLED: {
    userMessage: 'This event has been cancelled.',
    troubleshootingSteps: [
      'Contact the event organizer for more information',
      'Check your email for cancellation details',
      'Look for rescheduled event information',
    ],
  },
  NETWORK_ERROR: {
    userMessage: 'Unable to connect to the server. Please check your internet connection.',
    troubleshootingSteps: [
      'Check your WiFi or mobile data connection',
      'Try refreshing the page',
      'Wait a moment and try again',
      'Contact IT support if the problem persists',
    ],
  },
  AUTHENTICATION_REQUIRED: {
    userMessage: 'Please log in to check in to this event.',
    troubleshootingSteps: [
      'Click the login link to sign in',
      'Use your organization email address',
      "Contact your administrator if you don't have login credentials",
    ],
  },
  NOT_ORGANIZATION_MEMBER: {
    userMessage: 'You are not a member of the organization hosting this event.',
    troubleshootingSteps: [
      "Verify you're logged in with the correct account",
      'Contact the organization administrator to request membership',
      'Check if you need to complete onboarding first',
    ],
  },
  CAPACITY_REACHED: {
    userMessage: 'This event has reached its maximum capacity.',
    troubleshootingSteps: [
      'Contact the event organizer about waitlist options',
      'Check for alternative event times or sessions',
    ],
  },
  QR_CODE_INVALID: {
    userMessage: 'This QR code is not valid or has expired.',
    troubleshootingSteps: [
      'Ask an event manager for a fresh QR code',
      "Verify you're scanning the correct code for this event",
      'Check if the event has been rescheduled',
    ],
  },

  // --- Automatically reported failures -------------------------------------
  // These are raised by the axios interceptors and the global window handlers
  // rather than by feature code, so an administrator reading the Error
  // Monitoring page sees the same guidance the affected member saw.
  API_SERVER_ERROR: {
    userMessage: 'The server could not complete this request.',
    troubleshootingSteps: [
      'Try the action again in a moment',
      'Check the Error Monitoring page for related backend errors',
      'Contact your system administrator if it keeps happening',
    ],
  },
  API_SERVICE_UNAVAILABLE: {
    userMessage: 'The service is temporarily unavailable.',
    troubleshootingSteps: [
      'The server may be restarting — wait a moment and retry',
      'Check whether other members are affected',
      'Contact your system administrator if it persists for more than a few minutes',
    ],
  },
  API_TIMEOUT: {
    userMessage: 'The server took too long to respond.',
    troubleshootingSteps: [
      'Check your internet connection',
      'Retry the action — large reports and exports can take longer',
      'Contact your system administrator if requests keep timing out',
    ],
  },
  API_FORBIDDEN: {
    userMessage: 'You do not have permission to perform this action.',
    troubleshootingSteps: [
      'Verify you are signed in with the correct account',
      'Ask an administrator to review the permissions on your role',
    ],
  },
  UNCAUGHT_EXCEPTION: {
    userMessage: 'Something went wrong on this page.',
    troubleshootingSteps: [
      'Reload the page and try again',
      'Report what you were doing when this happened to your administrator',
    ],
  },
  UNHANDLED_REJECTION: {
    userMessage: 'A background operation failed.',
    troubleshootingSteps: [
      'Reload the page and try again',
      'Report what you were doing when this happened to your administrator',
    ],
  },
  REACT_ERROR_BOUNDARY: {
    userMessage: 'This page could not be displayed.',
    troubleshootingSteps: [
      'Reload the page',
      'Return to the dashboard and try again',
      'Report the error to your administrator if it repeats',
    ],
  },
  REPORTING_THROTTLED: {
    userMessage: 'Further errors occurred but were not individually reported (client rate cap).',
    troubleshootingSteps: [
      'A burst of errors hit this member — the surrounding entries show what',
      'Treat the count as a floor, not a total',
      'Check for a failing background poll or a repeated retry loop',
    ],
  },
  CHUNK_LOAD_ERROR: {
    userMessage: 'Part of the application failed to load.',
    troubleshootingSteps: [
      'Reload the page to pick up the latest version',
      'This usually follows a deployment and clears on reload',
      'Contact your administrator if reloading does not resolve it',
    ],
  },
};

/**
 * Look up the mapping for an error type, falling back to the raw message.
 */
export function getErrorMapping(errorType: string, errorMessage: string): ErrorMapping {
  return (
    ERROR_MAPPINGS[errorType] ?? {
      userMessage: errorMessage,
      troubleshootingSteps: ['Please try again or contact support'],
    }
  );
}

/**
 * Best-effort error type inference for callers that don't supply one.
 */
export function detectErrorType(message: string): string {
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
