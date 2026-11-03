/**
 * Status-change request-contract tests.
 *
 * Rejecting, holding and withdrawing a single applicant used to go through
 * the update endpoint as `{ status, notes: reason }`. `notes` is the
 * coordinator's running record of the applicant, so the rejection reason
 * overwrote it — the bug fixed for the bulk path in 2026-08, still live on
 * the single-record path afterwards. These assert the wire shape, because a
 * regression here is silent: the request succeeds and the notes are gone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
const mockPut = vi.fn();
const mockGet = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }),
}));

// Import after the mock is registered.
import { applicantService } from './api';

const prospectResponse = {
  data: {
    id: 'p1',
    first_name: 'Ann',
    last_name: 'Lee',
    email: 'ann@example.com',
    status: 'rejected',
    step_progress: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
};

const emptyPage = { data: { items: [], total: 0, limit: 25, offset: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue(prospectResponse);
  mockPut.mockResolvedValue(prospectResponse);
  mockGet.mockResolvedValue(emptyPage);
});

describe('applicantService status changes', () => {
  it('rejects through the status endpoint, never through notes', async () => {
    await applicantService.rejectApplicant('p1', 'Failed the agility test');

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith('/prospective-members/prospects/p1/status', {
      status: 'rejected',
      reason: 'Failed the agility test',
    });
  });

  it('holds and withdraws the same way', async () => {
    await applicantService.putOnHold('p1', 'Awaiting medical');
    await applicantService.withdrawApplicant('p1', { reason: 'Moved out of district' });

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenNthCalledWith(1, '/prospective-members/prospects/p1/status', {
      status: 'on_hold',
      reason: 'Awaiting medical',
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/prospective-members/prospects/p1/status', {
      status: 'withdrawn',
      reason: 'Moved out of district',
    });
  });

  it('reactivates and resumes back to active', async () => {
    await applicantService.resumeApplicant('p1');
    await applicantService.reactivateApplicant('p1', { notes: 'Appealed successfully' });

    expect(mockPost).toHaveBeenNthCalledWith(1, '/prospective-members/prospects/p1/status', {
      status: 'active',
      reason: undefined,
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/prospective-members/prospects/p1/status', {
      status: 'active',
      reason: 'Appealed successfully',
    });
  });

  it('omits a blank reason instead of writing one', async () => {
    await applicantService.rejectApplicant('p1', '');

    expect(mockPost).toHaveBeenCalledWith('/prospective-members/prospects/p1/status', {
      status: 'rejected',
      reason: undefined,
    });
  });
});

/** The query params of the single recorded GET. */
const requestedParams = (): Record<string, unknown> => {
  const [url, config] = mockGet.mock.calls[0] as [string, { params: Record<string, unknown> }];
  expect(url).toBe('/prospective-members/prospects');
  return config.params;
};

describe('applicantService list scoping', () => {
  it('asks for open applications only when the board or table fetches', async () => {
    await applicantService.getApplicants({ page: 1, pageSize: 25, openOnly: true });

    expect(requestedParams().open_only).toBe(true);
  });

  it('asks for the caller’s applicants only when My applicants is on', async () => {
    await applicantService.getApplicants({ filters: { assigned_to_me: true }, openOnly: true });

    expect(requestedParams().assigned_to_me).toBe(true);
  });

  it('leaves assigned_to_me off otherwise, so the request is unchanged', async () => {
    await applicantService.getApplicants({ filters: { assigned_to_me: false }, openOnly: true });

    expect(requestedParams().assigned_to_me).toBeUndefined();
  });

  it('leaves open_only off the archive fetches, which filter to one closed status', async () => {
    await applicantService.getRejectedApplicants({ page: 1, pageSize: 25 });

    const params = requestedParams();
    expect(params.status).toBe('rejected');
    // Omitted rather than false, so the archive request URLs are unchanged.
    expect(params.open_only).toBeUndefined();
  });

  it('reaches converted applications by their backend status name', async () => {
    // Their application history is only viewable from this page, and the
    // active tab no longer carries them.
    await applicantService.getConvertedApplicants({ page: 1, pageSize: 25 });

    const params = requestedParams();
    expect(params.status).toBe('transferred');
    expect(params.open_only).toBeUndefined();
  });
});

describe('applicantService interview requirement', () => {
  it('reads the stage’s grading for the applicant', async () => {
    const progress = {
      step_id: 's2',
      required_count: 1,
      recorded_count: 0,
      required_recommendation: null,
      recommendation_met: null,
      positions: [{ position: 'fire_chief', label: 'Fire Chief', satisfied: false }],
      complete: false,
    };
    mockGet.mockResolvedValue({ data: progress });

    const result = await applicantService.getInterviewRequirement('p1');

    expect(mockGet).toHaveBeenCalledWith('/prospective-members/prospects/p1/interview-requirement');
    expect(result).toEqual(progress);
  });

  it('is null when the applicant is not on an interview stage', async () => {
    mockGet.mockResolvedValue({ data: null });

    expect(await applicantService.getInterviewRequirement('p1')).toBeNull();
  });
});
