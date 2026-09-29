import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();

vi.mock('../../../services/apiClient', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  },
}));

import { ipSecurityService } from './api';

// The backend request schemas are snake_case with no alias generator; a
// camelCase key is not an alias there, it is a missing field (422) or, for
// optional ones, a value silently dropped.
describe('ipSecurityService request bodies', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {} });
  });

  it('sends a new exception request in snake_case', async () => {
    await ipSecurityService.requestException({
      ipAddress: '203.0.113.50',
      reason: 'Conference travel',
      requestedDurationDays: 7,
      useCase: 'travel',
      description: 'Hotel wifi',
    });

    expect(mockPost).toHaveBeenCalledWith('/ip-security/exceptions', {
      ip_address: '203.0.113.50',
      reason: 'Conference travel',
      requested_duration_days: 7,
      use_case: 'travel',
      description: 'Hotel wifi',
    });
  });

  it('omits an absent description rather than sending the key', async () => {
    await ipSecurityService.requestException({
      ipAddress: '203.0.113.50',
      reason: 'Conference travel',
      requestedDurationDays: 7,
      useCase: 'travel',
    });

    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(body).sort()).toEqual(['ip_address', 'reason', 'requested_duration_days', 'use_case']);
  });

  it('sends approval duration and notes in snake_case', async () => {
    await ipSecurityService.approveException('e-1', { approvedDurationDays: 14, approvalNotes: 'OK for trip' });

    expect(mockPost).toHaveBeenCalledWith('/ip-security/exceptions/e-1/approve', {
      approved_duration_days: 14,
      approval_notes: 'OK for trip',
    });
  });

  it('sends an empty approval body when nothing overrides the request', async () => {
    await ipSecurityService.approveException('e-1', {});

    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toStrictEqual({});
  });

  it('sends the rejection reason in snake_case', async () => {
    await ipSecurityService.rejectException('e-1', { rejectionReason: 'not justified' });

    expect(mockPost).toHaveBeenCalledWith('/ip-security/exceptions/e-1/reject', {
      rejection_reason: 'not justified',
    });
  });

  it('sends the revoke reason in snake_case', async () => {
    await ipSecurityService.revokeException('e-1', { revokeReason: 'member left' });

    expect(mockPost).toHaveBeenCalledWith('/ip-security/exceptions/e-1/revoke', {
      revoke_reason: 'member left',
    });
  });

  it('sends a new country block rule in snake_case', async () => {
    await ipSecurityService.addBlockedCountry({
      countryCode: 'KP',
      countryName: 'North Korea',
      reason: 'Sanctioned',
      riskLevel: 'critical',
    });

    expect(mockPost).toHaveBeenCalledWith('/ip-security/blocked-countries', {
      country_code: 'KP',
      country_name: 'North Korea',
      reason: 'Sanctioned',
      risk_level: 'critical',
    });
  });

  it('omits an absent country name rather than sending the key', async () => {
    await ipSecurityService.addBlockedCountry({ countryCode: 'KP', reason: 'Sanctioned', riskLevel: 'high' });

    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toStrictEqual({ country_code: 'KP', reason: 'Sanctioned', risk_level: 'high' });
  });
});
