import { describe, it, expect } from 'vitest';
import { retryAction } from './googleAccount';
import type { GoogleAccount } from '../types/googleAccount';

const account = (overrides: Partial<GoogleAccount>): GoogleAccount => ({
  user_id: 'u-1',
  primary_email: 'jordan.hale@firedept.org',
  status: 'created',
  credentials_sent: true,
  pending_groups: [],
  last_error: null,
  attempts: 1,
  last_attempt_at: null,
  created_at: null,
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

  it('offers nothing for a finished or linked account', () => {
    expect(retryAction(account({}))).toBeNull();
    expect(retryAction(account({ status: 'linked_existing', credentials_sent: false }))).toBeNull();
  });
});
