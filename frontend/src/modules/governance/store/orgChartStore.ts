/**
 * Governance — Organizational Chart Store
 */

import { create } from 'zustand';

import { getErrorMessage } from '../../../utils/errorHandling';
import { orgChartService } from '../services/api';
import type { OrgChart, OrgChartNodeCreate, OrgChartNodeMove, OrgChartNodeUpdate } from '../types/orgChart';

interface OrgChartState {
  chart: OrgChart | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchChart: () => Promise<void>;
  createNode: (payload: OrgChartNodeCreate) => Promise<void>;
  updateNode: (nodeId: string, payload: OrgChartNodeUpdate) => Promise<void>;
  moveNode: (nodeId: string, payload: OrgChartNodeMove) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
}

export const useOrgChartStore = create<OrgChartState>((set) => {
  /**
   * Run a mutation and adopt the chart the server returns.
   *
   * No optimistic patch: a move renumbers siblings and a delete promotes
   * children, so the shape after a write is the server's to decide — a local
   * guess would show a tree the next reload contradicts.
   */
  const mutate = async (action: () => Promise<OrgChart>): Promise<void> => {
    set({ isSaving: true, error: null });
    try {
      const chart = await action();
      set({ chart, isSaving: false });
    } catch (err: unknown) {
      set({
        isSaving: false,
        error: getErrorMessage(err, 'Could not save the organizational chart'),
      });
      throw err;
    }
  };

  return {
    chart: null,
    isLoading: false,
    isSaving: false,
    error: null,

    fetchChart: async () => {
      // `chart: null`, not just `isLoading: true`. A Zustand store outlives a
      // logout — nothing resets module stores on the way out — so on a shared
      // station computer the previous member's chart would render while the
      // new member's request is still in flight, and stay on screen if that
      // request failed. The page only shows its skeleton while `chart` is
      // null, which is exactly the state a new session should start from.
      set({ chart: null, isLoading: true, error: null });
      try {
        const chart = await orgChartService.getChart();
        set({ chart, isLoading: false });
      } catch (err: unknown) {
        set({
          chart: null,
          isLoading: false,
          error: getErrorMessage(err, 'Could not load the organizational chart'),
        });
      }
    },

    createNode: (payload) => mutate(() => orgChartService.createNode(payload)),
    updateNode: (nodeId, payload) => mutate(() => orgChartService.updateNode(nodeId, payload)),
    moveNode: (nodeId, payload) => mutate(() => orgChartService.moveNode(nodeId, payload)),
    deleteNode: (nodeId) => mutate(() => orgChartService.deleteNode(nodeId)),
  };
});
