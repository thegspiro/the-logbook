import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

// Import after the mock is in place.
import { applicantService, eventLinkService } from './api';

/** Query params of the first GET, without reaching through an `any`. */
const firstGetParams = (): Record<string, unknown> => {
  const call = mockGet.mock.calls[0] as [string, { params?: Record<string, unknown> }?] | undefined;
  return call?.[1]?.params ?? {};
};

describe('source-event filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSourceEvents', () => {
    it('returns the events applicants are linked to', async () => {
      const events = [
        {
          event_id: 'evt-1',
          title: 'Fall Open House',
          event_type: 'recruitment',
          start_datetime: '2026-09-01T18:00:00Z',
          prospect_count: 9,
        },
      ];
      mockGet.mockResolvedValue({ data: events });

      await expect(eventLinkService.getSourceEvents()).resolves.toEqual(events);
      expect(mockGet).toHaveBeenCalledWith('/prospective-members/source-events');
    });

    it('degrades a non-array payload to an empty list rather than throwing', async () => {
      mockGet.mockResolvedValue({ data: null });

      await expect(eventLinkService.getSourceEvents()).resolves.toEqual([]);
    });
  });

  describe('getApplicants', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue({ data: { items: [], total: 0, limit: 25, offset: 0 } });
    });

    it('sends event_id when the filter is set', async () => {
      await applicantService.getApplicants({ filters: { event_id: 'evt-1' } });

      expect(firstGetParams().event_id).toBe('evt-1');
    });

    it('omits event_id when no source event is chosen', async () => {
      await applicantService.getApplicants({ filters: { search: 'dana' } });

      expect(firstGetParams().event_id).toBeUndefined();
    });
  });
});
