import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  handleApiError,
  formatValidationErrors,
  isNetworkError,
  isAuthError,
  isValidationError,
  getOnboardingErrorMessage,
  type ValidationErrorEntry,
} from './errorHandler';

/**
 * A genuine AxiosError, so the `isAxiosError` branch is exercised for real.
 * The handler has a second, near-identical branch for plain objects that merely
 * look like one (fetch wrappers), which `responseLike` below covers — the two
 * are tested side by side so they cannot drift apart unnoticed.
 */
function axiosErr(status: number, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', String(status), config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  } as never);
}

/** A plain object shaped like an axios error but not one. */
function responseLike(status: number, data?: unknown): unknown {
  return { response: { status, data } };
}

describe('onboarding errorHandler', () => {
  describe('handleApiError — transport failures', () => {
    it('explains a failed fetch as a connectivity problem', () => {
      expect(handleApiError(new TypeError('Failed to fetch'))).toMatch(/cannot connect to server/i);
    });

    it('recognises a NetworkError by name', () => {
      const err = Object.assign(new Error('boom'), { name: 'NetworkError' });
      expect(handleApiError(err)).toMatch(/cannot connect to server/i);
    });

    it('explains a timeout', () => {
      expect(handleApiError(new Error('timeout of 30000ms exceeded'))).toMatch(/timed out/i);
    });

    it('explains a CORS rejection as a policy block, not a bug the user caused', () => {
      expect(handleApiError(new Error('blocked by CORS policy'))).toMatch(/security policy/i);
    });
  });

  // Both branches must produce identical text for the same status; running the
  // same table against each is what keeps the duplicated switch statements in
  // step.
  describe.each([
    ['AxiosError', axiosErr],
    ['response-shaped object', responseLike],
  ] as const)('handleApiError — HTTP status via %s', (_label, build) => {
    it.each([
      [401, /session expired/i],
      [403, /access denied/i],
      [429, /too many requests/i],
      [500, /server error occurred/i],
      [502, /temporarily unavailable/i],
      [503, /temporarily unavailable/i],
      [504, /temporarily unavailable/i],
    ])('maps %i to a plain-language message', (status, expected) => {
      expect(handleApiError(build(status))).toMatch(expected);
    });

    it('prefers the API detail on a 400', () => {
      expect(handleApiError(build(400, { detail: 'Station name is required' }))).toBe('Station name is required');
    });

    it('falls back to the API message on a 400 with no detail', () => {
      expect(handleApiError(build(400, { message: 'Bad shape' }))).toBe('Bad shape');
    });

    it('uses a generic 400 message when the body carries neither', () => {
      expect(handleApiError(build(400, {}))).toMatch(/invalid request/i);
    });

    it('surfaces the conflict detail on a 409', () => {
      expect(handleApiError(build(409, { detail: 'Organization already exists' }))).toBe('Organization already exists');
    });

    it('surfaces the validation detail on a 422', () => {
      expect(handleApiError(build(422, { detail: 'Invalid port' }))).toBe('Invalid port');
    });

    it('names the step in a 404 when context is supplied', () => {
      expect(handleApiError(build(404), 'Station')).toBe('Station not found. It may have been deleted or moved.');
    });

    it('uses a generic 404 message without context', () => {
      expect(handleApiError(build(404))).toMatch(/requested resource was not found/i);
    });

    it('reports an unmapped status by number', () => {
      expect(handleApiError(build(418))).toMatch(/status 418/);
    });
  });

  describe('handleApiError — message shaping', () => {
    it('returns a backend detail supplied without a response wrapper', () => {
      expect(handleApiError({ detail: 'Seed data missing' })).toBe('Seed data missing');
    });

    it('rewrites a database error into something a chief can act on', () => {
      expect(handleApiError(new Error('database connection pool exhausted'))).toMatch(/database connection error/i);
    });

    it('rewrites a raw internal server error', () => {
      expect(handleApiError(new Error('Internal Server Error'))).toMatch(/unexpected error occurred/i);
    });

    it('passes through a message that already reads as user-facing', () => {
      expect(handleApiError(new Error('Station name is already taken'))).toBe('Station name is already taken');
    });

    // A stack trace or an errno in the UI tells the user nothing and leaks
    // implementation detail, so jargon is swallowed in favour of the fallback.
    it.each([
      'TypeError: cannot read property foo of undefined',
      'Traceback (most recent call last)',
      'connect ECONNREFUSED 127.0.0.1:3306',
      'getaddrinfo ENOTFOUND db',
    ])('suppresses the technical message %#', (message) => {
      const result = handleApiError(new Error(message));
      expect(result).toBe('An unexpected error occurred. Please try again.');
    });

    it('uses the context in the fallback when one is supplied', () => {
      expect(handleApiError(new Error('stack trace follows'), 'create the station')).toBe(
        'Failed to create the station. Please try again.'
      );
    });

    it('falls back cleanly for a value that is not an error at all', () => {
      expect(handleApiError(null)).toBe('An unexpected error occurred. Please try again.');
      expect(handleApiError('just a string')).toBe('An unexpected error occurred. Please try again.');
    });
  });

  describe('formatValidationErrors', () => {
    it('describes a single error as "Field: reason"', () => {
      expect(formatValidationErrors([{ field: 'email', message: 'is not valid' }])).toBe('Email: is not valid');
    });

    // The API's own handler rewrites Pydantic's {loc,msg} into {field,message};
    // loc/msg is still accepted for 422s raised outside it.
    it('accepts the raw Pydantic loc/msg shape', () => {
      expect(formatValidationErrors([{ loc: ['body', 'port'], msg: 'must be an integer' }])).toBe(
        'Port: must be an integer'
      );
    });

    it('takes the last loc segment as the field name', () => {
      expect(formatValidationErrors([{ loc: ['body', 'smtp', 'host'], msg: 'required' }])).toBe('Host: required');
    });

    // The backend labels an unattributable error "request", which would read as
    // a field name of its own if echoed back.
    it('does not echo the placeholder "request" as a field name', () => {
      expect(formatValidationErrors([{ field: 'request', message: 'malformed' }])).toBe('Field: malformed');
    });

    it('bullets multiple errors under a heading', () => {
      const result = formatValidationErrors([
        { field: 'email', message: 'is not valid' },
        { field: 'port', message: 'must be an integer' },
      ]);
      expect(result).toBe('Please fix the following errors:\n• Email: is not valid\n• Port: must be an integer');
    });

    it('falls back when the list is empty', () => {
      expect(formatValidationErrors([])).toMatch(/validation failed/i);
    });

    it('supplies a reason when an entry carries none', () => {
      expect(formatValidationErrors([{ field: 'email' }])).toBe('Email: Invalid value');
    });

    it('skips null entries rather than throwing', () => {
      const entries = [
        { field: 'email', message: 'is not valid' },
        null,
        { field: 'port', message: 'required' },
      ] as unknown as ValidationErrorEntry[];
      expect(formatValidationErrors(entries)).toBe(
        'Please fix the following errors:\n• Email: is not valid\n• Port: required'
      );
    });
  });

  describe('error classification', () => {
    it('identifies a failed fetch as a network error', () => {
      expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    });

    it('does not treat an HTTP failure as a network error', () => {
      expect(isNetworkError(axiosErr(500))).toBe(false);
    });

    it.each([401, 403])('treats %i as an auth error', (status) => {
      expect(isAuthError(axiosErr(status))).toBe(true);
      expect(isAuthError(responseLike(status))).toBe(true);
    });

    it.each([400, 404, 500])('does not treat %i as an auth error', (status) => {
      expect(isAuthError(axiosErr(status))).toBe(false);
    });

    it.each([400, 422])('treats %i as a validation error', (status) => {
      expect(isValidationError(axiosErr(status))).toBe(true);
      expect(isValidationError(responseLike(status))).toBe(true);
    });

    it.each([401, 404, 500])('does not treat %i as a validation error', (status) => {
      expect(isValidationError(axiosErr(status))).toBe(false);
    });

    it('classifies a non-error value as neither', () => {
      expect(isAuthError('nope')).toBe(false);
      expect(isValidationError(null)).toBe(false);
      expect(isNetworkError({})).toBe(false);
    });
  });

  describe('getOnboardingErrorMessage', () => {
    it('appends the app-password tip when SMTP auth fails', () => {
      const result = getOnboardingErrorMessage(axiosErr(400, { detail: 'SMTP authentication failed' }), 'smtp');
      expect(result).toContain('SMTP authentication failed');
      expect(result).toMatch(/app-specific passwords/i);
    });

    it('suggests a distinguishing name when the organization already exists', () => {
      const result = getOnboardingErrorMessage(
        axiosErr(409, { detail: 'Organization already exists' }),
        'organization'
      );
      expect(result).toMatch(/FCVFD 2024/);
    });

    it('suggests a variation when the admin username is taken', () => {
      const result = getOnboardingErrorMessage(axiosErr(409, { detail: 'Username already taken' }), 'admin');
      expect(result).toMatch(/Try variations/i);
    });

    it('matches the step name case-insensitively', () => {
      expect(
        getOnboardingErrorMessage(axiosErr(409, { detail: 'Organization already exists' }), 'ORGANIZATION')
      ).toMatch(/FCVFD 2024/);
    });

    it('adds no tip when the step has none to offer', () => {
      const error = axiosErr(409, { detail: 'Organization already exists' });
      expect(getOnboardingErrorMessage(error, 'stations')).toBe('Organization already exists');
    });

    it('adds no tip when the message does not match the step condition', () => {
      const error = axiosErr(500);
      expect(getOnboardingErrorMessage(error, 'organization')).toBe(handleApiError(error, 'organization'));
    });

    it('behaves like handleApiError when no step is given', () => {
      const error = axiosErr(403);
      expect(getOnboardingErrorMessage(error)).toBe(handleApiError(error));
    });
  });
});
