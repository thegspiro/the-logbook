/**
 * Bulk action request-contract tests.
 *
 * These endpoints are the reason a coordinator's 30-applicant selection costs
 * one request instead of 30, so the payload has to match what the backend
 * schema accepts. This module's API serializes snake_case (unlike the
 * repo-wide camelCase default), and a mismatch here surfaces only as a 422 at
 * runtime — hence asserting the wire shape rather than the return value.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: vi.fn(),
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }),
}));

// Import after the mock is registered.
import { applicantService } from './api';

const emptyResult = {
  data: { succeeded_count: 0, failed_count: 0, results: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue(emptyResult);
});

describe('applicantService.bulkAdvance', () => {
  it('sends every id in a single request', async () => {
    await applicantService.bulkAdvance(['a', 'b', 'c']);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/prospective-members/prospects/bulk-advance', {
      prospect_ids: ['a', 'b', 'c'],
      notes: undefined,
    });
  });

  it('omits an empty note rather than sending an empty string', async () => {
    await applicantService.bulkAdvance(['a'], '   ');

    expect(mockPost).toHaveBeenCalledWith('/prospective-members/prospects/bulk-advance', {
      prospect_ids: ['a'],
      notes: undefined,
    });
  });

  it('returns the itemized result so callers can name the failures', async () => {
    mockPost.mockResolvedValue({
      data: {
        succeeded_count: 1,
        failed_count: 1,
        results: [
          { prospect_id: 'a', name: 'Ann Lee', succeeded: true, error: null },
          {
            prospect_id: 'b',
            name: 'Bo Ruiz',
            succeeded: false,
            error: 'Prospect is already at the final stage',
          },
        ],
      },
    });

    const result = await applicantService.bulkAdvance(['a', 'b']);

    expect(result.failed_count).toBe(1);
    expect(result.results[1]).toMatchObject({
      name: 'Bo Ruiz',
      error: 'Prospect is already at the final stage',
    });
  });
});

describe('applicantService.bulkSetStatus', () => {
  it('sends the status and reason alongside the ids', async () => {
    await applicantService.bulkSetStatus(['a', 'b'], 'rejected', 'Did not meet residency');

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/prospective-members/prospects/bulk-status', {
      prospect_ids: ['a', 'b'],
      status: 'rejected',
      reason: 'Did not meet residency',
    });
  });

  it('omits a blank reason instead of writing one', async () => {
    await applicantService.bulkSetStatus(['a'], 'active', '');

    expect(mockPost).toHaveBeenCalledWith('/prospective-members/prospects/bulk-status', {
      prospect_ids: ['a'],
      status: 'active',
      reason: undefined,
    });
  });
});
