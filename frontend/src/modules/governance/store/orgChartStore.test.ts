import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetChart = vi.fn();
const mockCreateNode = vi.fn();
const mockUpdateNode = vi.fn();
const mockMoveNode = vi.fn();
const mockDeleteNode = vi.fn();

vi.mock('../services/api', () => ({
  orgChartService: {
    getChart: () => mockGetChart() as unknown,
    createNode: (...args: unknown[]) => mockCreateNode(...args) as unknown,
    updateNode: (...args: unknown[]) => mockUpdateNode(...args) as unknown,
    moveNode: (...args: unknown[]) => mockMoveNode(...args) as unknown,
    deleteNode: (...args: unknown[]) => mockDeleteNode(...args) as unknown,
  },
}));

import { useOrgChartStore } from './orgChartStore';

const chief = {
  id: 'node-1',
  parentId: null,
  title: 'Fire Chief',
  responsibility: 'Everything operational.',
  userId: 'user-1',
  holderName: 'Dana Reyes',
  displayName: null,
  contactEmail: null,
  contactPhone: null,
  sortOrder: 0,
  isPublished: true,
  depth: 0,
};

const emptyChart = { nodes: [], canManage: true, members: [] };
const oneNodeChart = { nodes: [chief], canManage: true, members: [{ id: 'user-1', name: 'Dana Reyes' }] };

describe('useOrgChartStore', () => {
  beforeEach(() => {
    useOrgChartStore.setState({ chart: null, isLoading: false, isSaving: false, error: null });
    vi.clearAllMocks();
    mockGetChart.mockResolvedValue(emptyChart);
  });

  it('loads the chart', async () => {
    mockGetChart.mockResolvedValue(oneNodeChart);
    await useOrgChartStore.getState().fetchChart();
    expect(useOrgChartStore.getState().chart).toEqual(oneNodeChart);
    expect(useOrgChartStore.getState().isLoading).toBe(false);
  });

  it("drops the previous chart before loading, so one session cannot see another's", async () => {
    useOrgChartStore.setState({ chart: oneNodeChart });
    let chartDuringFetch: unknown = 'not captured';
    mockGetChart.mockImplementation(() => {
      chartDuringFetch = useOrgChartStore.getState().chart;
      return Promise.resolve(emptyChart);
    });

    await useOrgChartStore.getState().fetchChart();

    // The store outlives a logout, and the page only shows its skeleton while
    // `chart` is null — so a surviving chart renders the previous member's
    // organization while the new member's request is still in flight.
    expect(chartDuringFetch).toBeNull();
  });

  it('does not fall back to the previous chart when the load fails', async () => {
    useOrgChartStore.setState({ chart: oneNodeChart });
    mockGetChart.mockRejectedValue(new Error('network'));

    await useOrgChartStore.getState().fetchChart();

    expect(useOrgChartStore.getState().chart).toBeNull();
    expect(useOrgChartStore.getState().error).toBe('network');
  });

  it('surfaces a load failure instead of showing an empty chart', async () => {
    mockGetChart.mockRejectedValue(new Error('network'));
    await useOrgChartStore.getState().fetchChart();
    expect(useOrgChartStore.getState().error).toBe('network');
    expect(useOrgChartStore.getState().chart).toBeNull();
  });

  it('adopts the chart the server returns after a write rather than refetching', async () => {
    mockCreateNode.mockResolvedValue(oneNodeChart);
    await useOrgChartStore.getState().createNode({ title: 'Fire Chief' });

    expect(mockCreateNode).toHaveBeenCalledWith({ title: 'Fire Chief' });
    expect(useOrgChartStore.getState().chart).toEqual(oneNodeChart);
    // A move renumbers siblings and a delete promotes children, so the write's
    // own response is the view — a follow-up GET would be a second round trip
    // for an answer already in hand.
    expect(mockGetChart).not.toHaveBeenCalled();
  });

  it('re-throws a failed write so the caller can keep the editor open', async () => {
    mockUpdateNode.mockRejectedValue(new Error('That position is not on this chart'));

    await expect(useOrgChartStore.getState().updateNode('node-1', { title: 'x' })).rejects.toThrow(
      'That position is not on this chart'
    );
    expect(useOrgChartStore.getState().error).toBe('That position is not on this chart');
    expect(useOrgChartStore.getState().isSaving).toBe(false);
  });

  it('passes the move target through untouched', async () => {
    mockMoveNode.mockResolvedValue(oneNodeChart);
    await useOrgChartStore.getState().moveNode('node-2', { parentId: null, position: 0 });
    expect(mockMoveNode).toHaveBeenCalledWith('node-2', { parentId: null, position: 0 });
  });

  it('adopts the promoted-children chart a delete returns', async () => {
    mockDeleteNode.mockResolvedValue(emptyChart);
    await useOrgChartStore.getState().deleteNode('node-1');
    expect(mockDeleteNode).toHaveBeenCalledWith('node-1');
    expect(useOrgChartStore.getState().chart).toEqual(emptyChart);
  });
});
