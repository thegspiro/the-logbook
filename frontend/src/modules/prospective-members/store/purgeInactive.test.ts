/**
 * `purgeInactiveApplicants` reports what the server did.
 *
 * It used to resolve `void` on every path -- success, a failed request, and no
 * pipeline selected -- so the page could only assume success and toasted
 * "Purged N" for applications that were still in the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPurge = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    purgeInactiveApplicants: (...args: unknown[]) => mockPurge(...args) as unknown,
  },
  pipelineService: {},
  interviewService: {},
  eventLinkService: {},
}));

// Import the store only once the mocks are registered.
import { useProspectiveMembersStore } from './prospectiveMembersStore';
import type { Pipeline } from '../types';

const store = () => useProspectiveMembersStore.getState();
const fetchInactive = vi.fn();
const fetchStats = vi.fn();

describe('purgeInactiveApplicants', () => {
  beforeEach(() => {
    mockPurge.mockReset();
    fetchInactive.mockReset();
    fetchStats.mockReset();
    fetchInactive.mockResolvedValue(undefined);
    fetchStats.mockResolvedValue(undefined);
    useProspectiveMembersStore.setState({
      currentPipeline: { id: 'pipe-1' } as unknown as Pipeline,
      isPurging: false,
      error: null,
      fetchInactiveApplicants: fetchInactive,
      fetchPipelineStats: fetchStats,
    });
  });

  it("resolves with the server's count and refreshes the list and counts", async () => {
    mockPurge.mockResolvedValue({ purged_count: 1, message: 'Purged 1 inactive application(s)' });

    await expect(store().purgeInactiveApplicants(['a', 'b'])).resolves.toBe(1);

    expect(mockPurge).toHaveBeenCalledWith('pipe-1', { applicant_ids: ['a', 'b'], confirm: true });
    expect(fetchInactive).toHaveBeenCalled();
    expect(fetchStats).toHaveBeenCalledWith('pipe-1');
    expect(store().isPurging).toBe(false);
  });

  it('rejects when the request fails', async () => {
    mockPurge.mockRejectedValue(new Error('Could not delete a file'));

    await expect(store().purgeInactiveApplicants(['a'])).rejects.toThrow('Could not delete a file');

    expect(store().isPurging).toBe(false);
    expect(store().error).not.toBeNull();
  });

  it('rejects when no pipeline is selected', async () => {
    useProspectiveMembersStore.setState({ currentPipeline: null });

    await expect(store().purgeInactiveApplicants(['a'])).rejects.toThrow('No pipeline is selected');

    expect(mockPurge).not.toHaveBeenCalled();
  });
});
