/**
 * What the Add Applicant form sends.
 *
 * `createApplicant` builds its payload by hand, and it had left out the target
 * role the form collects: every applicant added from the form was stored with
 * none, and a later automatic conversion had no role to apply. Blank optional
 * fields also went out as '' -- an empty date of birth is a 422 on a date field.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  }),
}));

// Import AFTER the mock is in place.
import { applicantService } from './api';

// Only the request is under test; the response mapping has its own tests.
const sent = async (data: Parameters<typeof applicantService.createApplicant>[0]) => {
  await expect(applicantService.createApplicant(data)).rejects.toThrow('stop');
  return mockPost.mock.calls[0]?.[1] as Record<string, unknown>;
};

describe('applicantService.createApplicant', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockRejectedValue(new Error('stop'));
  });

  it('sends the target role the form collected', async () => {
    const payload = await sent({
      pipeline_id: 'pipe-1',
      first_name: 'Devon',
      last_name: 'Marsh',
      email: 'devon@example.org',
      target_membership_type: 'regular',
      target_role_id: 'role-9',
    });

    expect(mockPost.mock.calls[0]?.[0]).toBe('/prospective-members/prospects');
    expect(payload.target_role_id).toBe('role-9');
  });

  it('omits blank optional fields rather than sending empty strings', async () => {
    const payload = await sent({
      pipeline_id: 'pipe-1',
      first_name: 'Devon',
      last_name: 'Marsh',
      email: 'devon@example.org',
      target_membership_type: 'regular',
      target_role_id: '',
      phone: '  ',
      date_of_birth: '',
      notes: '',
      address: { street: '', city: 'Falls Church', state: '', zip_code: '' },
    });

    const json = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    for (const key of ['target_role_id', 'phone', 'date_of_birth', 'notes', 'address_street', 'address_zip']) {
      expect(json).not.toHaveProperty(key);
    }
    expect(json.address_city).toBe('Falls Church');
  });
});
