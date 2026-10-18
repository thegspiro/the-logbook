import { describe, it, expect } from 'vitest';
import { directoryVendor, retryAction } from './googleAccount';
import type { GoogleAccount } from '../types/googleAccount';

const account = (overrides: Partial<GoogleAccount>): GoogleAccount => ({
  user_id: 'u-1',
  provider: 'google',
  provider_name: 'Google Workspace',
  primary_email: 'jordan.hale@firedept.org',
  status: 'created',
  credentials_sent: true,
  pending_groups: [],
  license_pending: false,
  managed_on_premises: false,
  last_error: null,
  attempts: 1,
  last_attempt_at: null,
  created_at: null,
  suspension_wanted: false,
  suspension_settled: true,
  suspended_by_logbook: false,
  suspended_at: null,
  suspension_error: null,
  ...overrides,
});

describe('retryAction', () => {
  it('creates an account that failed or never ran', () => {
    expect(retryAction(account({ status: 'failed' }))).toBe('create');
    expect(retryAction(account({ status: 'pending' }))).toBe('create');
  });

  it('finishes a created account missing its password or a group', () => {
    expect(retryAction(account({ credentials_sent: false }))).toBe('finish');
    expect(retryAction(account({ pending_groups: ['members@firedept.org'] }))).toBe('finish');
  });

  it('finishes an unsettled suspension before anything else', () => {
    expect(retryAction(account({ suspension_settled: false, credentials_sent: false }))).toBe('suspension');
    expect(retryAction(account({ status: 'linked_existing', suspension_settled: false }))).toBe('suspension');
  });

  it('has no suspension to finish on an account that was never created', () => {
    expect(retryAction(account({ status: 'failed', suspension_settled: false }))).toBe('create');
  });

  it('offers nothing for a finished or linked account', () => {
    expect(retryAction(account({}))).toBeNull();
    expect(retryAction(account({ status: 'linked_existing', credentials_sent: false }))).toBeNull();
  });
});

describe('a Microsoft 365 license', () => {
  it('is finished by a retry while it is outstanding', () => {
    expect(retryAction(account({ provider: 'microsoft', license_pending: true }))).toBe('finish');
  });
});

describe('directoryVendor', () => {
  it('names each directory, and Google for a record from before Microsoft 365', () => {
    expect(directoryVendor('microsoft')).toBe('Microsoft');
    expect(directoryVendor('google')).toBe('Google');
    expect(directoryVendor(undefined)).toBe('Google');
  });
});
