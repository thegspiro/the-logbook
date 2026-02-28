/**
 * Scheduling Store (Zustand)
 *
 * Centralized state management for the scheduling module.
 * Caches shared data (members, templates, apparatus, summary) so that
 * multiple tabs and components don't re-fetch redundantly.
 */

import { create } from "zustand";
import { userService } from "../../../services/api";
import { schedulingService } from "../services/api";
import type {
  ShiftRecord,
  SchedulingSummary,
  ShiftTemplateRecord,
  BasicApparatusRecord,
} from "../services/api";
import { getErrorMessage } from "../../../utils/errorHandling";

interface MemberOption {
  id: string;
  label: string;
}

interface SchedulingState {
  // ─── Shared data ────────────────────────────────────────────────────────
  members: MemberOption[];
  membersLoaded: boolean;
  membersLoading: boolean;

  templates: ShiftTemplateRecord[];
  templatesLoaded: boolean;
  templatesLoading: boolean;

  apparatus: BasicApparatusRecord[];
  apparatusLoaded: boolean;

  summary: SchedulingSummary | null;
  summaryLoading: boolean;

  // ─── Calendar state ─────────────────────────────────────────────────────
  shifts: ShiftRecord[];
  shiftsLoading: boolean;
  shiftsError: string | null;

  // ─── Actions ────────────────────────────────────────────────────────────
  loadMembers: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadApparatus: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadInitialData: () => Promise<void>;
  setShifts: (shifts: ShiftRecord[]) => void;
  setShiftsLoading: (loading: boolean) => void;
  setShiftsError: (error: string | null) => void;
}

export const useSchedulingStore = create<SchedulingState>((set, get) => ({
  // ─── Initial State ──────────────────────────────────────────────────────
  members: [],
  membersLoaded: false,
  membersLoading: false,

  templates: [],
  templatesLoaded: false,
  templatesLoading: false,

  apparatus: [],
  apparatusLoaded: false,

  summary: null,
  summaryLoading: false,

  shifts: [],
  shiftsLoading: false,
  shiftsError: null,

  // ─── Actions ────────────────────────────────────────────────────────────

  loadMembers: async () => {
    if (get().membersLoaded || get().membersLoading) return;
    set({ membersLoading: true });
    try {
      const users = await userService.getUsers();
      const members = users
        .filter((m) => m.status === "active")
        .map((m) => ({
          id: String(m.id),
          label:
            `${m.first_name || ""} ${m.last_name || ""}`.trim() ||
            String(m.email || m.id),
        }));
      set({ members, membersLoaded: true });
    } catch {
      // Non-critical — components fall back gracefully
    } finally {
      set({ membersLoading: false });
    }
  },

  loadTemplates: async () => {
    if (get().templatesLoaded || get().templatesLoading) return;
    set({ templatesLoading: true });
    try {
      const templates = await schedulingService.getTemplates({
        active_only: true,
      });
      set({ templates, templatesLoaded: true });
    } catch {
      set({ templatesLoaded: true }); // mark loaded even on error to prevent retry loop
    } finally {
      set({ templatesLoading: false });
    }
  },

  loadApparatus: async () => {
    if (get().apparatusLoaded) return;
    try {
      const apparatus = await schedulingService.getBasicApparatus();
      set({ apparatus, apparatusLoaded: true });
    } catch {
      set({ apparatusLoaded: true });
    }
  },

  loadSummary: async () => {
    if (get().summaryLoading) return;
    set({ summaryLoading: true });
    try {
      const summary = await schedulingService.getSummary();
      set({ summary });
    } catch (err) {
      console.warn("Failed to load scheduling summary:", getErrorMessage(err));
    } finally {
      set({ summaryLoading: false });
    }
  },

  /** Load all shared reference data in a single call. */
  loadInitialData: async () => {
    const state = get();
    const promises: Promise<void>[] = [];
    if (!state.membersLoaded && !state.membersLoading)
      promises.push(state.loadMembers());
    if (!state.templatesLoaded && !state.templatesLoading)
      promises.push(state.loadTemplates());
    if (!state.apparatusLoaded) promises.push(state.loadApparatus());
    await Promise.all(promises);
  },

  setShifts: (shifts) => set({ shifts }),
  setShiftsLoading: (loading) => set({ shiftsLoading: loading }),
  setShiftsError: (error) => set({ shiftsError: error }),
}));
