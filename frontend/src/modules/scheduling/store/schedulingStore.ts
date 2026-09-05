/**
 * Scheduling Store (Zustand)
 *
 * Centralized state management for the scheduling module.
 * Caches shared data (members, templates, apparatus, summary) so that
 * multiple tabs and components don't re-fetch redundantly.
 */

import { create } from 'zustand';
import { userService } from '../../../services/api';
import { schedulingService } from '../services/api';
import type { SchedulingSummary, ShiftTemplateRecord, BasicApparatusRecord } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { UserStatus } from '../../../constants/enums';
import { DEFAULT_SIGNUP_WINDOW } from '../utils/shiftBoard';

interface MemberOption {
  id: string;
  label: string;
  platoon?: string | undefined;
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
  summaryError: string | null;

  // Department feature toggle: whether platoon scheduling UI is shown.
  platoonsEnabled: boolean;
  // Whether the department requires end-of-shift equipment checks before a
  // shift can be finalized. Used to tailor the finalize flow (awareness prompt
  // when off, enforcement when on).
  requireEndOfShiftChecks: boolean;
  /** 'detailed' | 'count_only' | 'off'. Defaults to 'detailed'. */
  callTrackingMode: string;
  /**
   * Call-type slug to display label, retired types included. A slug is the
   * value stored on every call ever filed under it, so anything rendering one
   * — a shift report, a print-out — resolves it through here rather than
   * showing the storage key.
   */
  callTypeLabels: Record<string, string>;
  /**
   * The department's signup window — how long before a shift starts members
   * stop being able to claim a seat, and how long past the start an officer
   * may still seat somebody. Held here so every screen that gates a claim
   * button reads one answer rather than fetching its own.
   */
  signupClosesMinutesBefore: number;
  lateSignupGraceMinutes: number;
  settingsLoaded: boolean;

  // ─── Actions ────────────────────────────────────────────────────────────
  loadMembers: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadApparatus: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadSettings: () => Promise<void>;
  /**
   * Drop the department-wide settings so the next sign-in re-fetches them.
   *
   * `settingsLoaded` is a once-per-session cache, and on a shared station
   * computer the session outlives the member: without this, signing out and
   * signing in as somebody from another department left every screen reading
   * the previous department's call types, signup window and toggles, because
   * `loadSettings` short-circuits on the flag. Called from the logout purge
   * beside the other caches keyed by nothing user-specific.
   */
  resetSettings: () => void;
  setPlatoonsEnabled: (enabled: boolean) => void;
  loadInitialData: () => Promise<void>;
}

/**
 * The in-flight settings request, shared by every concurrent caller.
 *
 * Module-level rather than store state: it is request bookkeeping, not
 * something a component renders, and it must be readable synchronously by the
 * next caller in the same tick.
 */
let settingsRequest: Promise<void> | null = null;

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
  summaryError: null,

  platoonsEnabled: false,
  requireEndOfShiftChecks: false,
  callTrackingMode: 'detailed',
  callTypeLabels: {},
  signupClosesMinutesBefore: DEFAULT_SIGNUP_WINDOW.closesMinutesBefore,
  lateSignupGraceMinutes: DEFAULT_SIGNUP_WINDOW.graceMinutes,
  settingsLoaded: false,

  // ─── Actions ────────────────────────────────────────────────────────────

  resetSettings: () => {
    settingsRequest = null;
    set({
      settingsLoaded: false,
      platoonsEnabled: false,
      requireEndOfShiftChecks: false,
      callTrackingMode: 'detailed',
      callTypeLabels: {},
      signupClosesMinutesBefore: DEFAULT_SIGNUP_WINDOW.closesMinutesBefore,
      lateSignupGraceMinutes: DEFAULT_SIGNUP_WINDOW.graceMinutes,
    });
  },

  loadSettings: async () => {
    if (get().settingsLoaded) return;
    // Share one request across every caller that arrives before it resolves.
    // The `settingsLoaded` guard alone does not dedupe: a board paints one
    // ShiftBoard, two calendar variants, a DayDetailPanel and a ShiftSeatList
    // per shift, and each reads the signup window on mount — so a single day
    // with six shifts fired ten simultaneous GET /scheduling/settings, all of
    // them past the guard because none had resolved yet. Mirrors the shared
    // `refreshPromise` in services/api.ts.
    if (settingsRequest) return settingsRequest;

    settingsRequest = (async () => {
      try {
        const settings = await schedulingService.getFeatureSettings();
        set({
          platoonsEnabled: settings.platoons_enabled,
          requireEndOfShiftChecks: settings.require_end_of_shift_checks,
          // A missing setting means today's behaviour, never 'off'.
          callTrackingMode: settings.call_tracking?.mode || 'detailed',
          callTypeLabels: Object.fromEntries((settings.call_tracking?.call_types ?? []).map((t) => [t.slug, t.label])),
          // `??`, not `||`: 0 is a meaningful value here — it is what "closes
          // exactly at the start" means — and `||` would silently replace it
          // with the default.
          signupClosesMinutesBefore: settings.signup_closes_minutes_before ?? DEFAULT_SIGNUP_WINDOW.closesMinutesBefore,
          lateSignupGraceMinutes: settings.late_signup_grace_minutes ?? DEFAULT_SIGNUP_WINDOW.graceMinutes,
          settingsLoaded: true,
        });
      } catch {
        // Deliberately does NOT mark the settings loaded. They now carry the
        // signup window, and caching the permissive fallback for the session
        // would let one transient failure make every scheduling screen offer
        // signups the server refuses, for a department with a real cutoff,
        // until the tab is reloaded. Leaving it unloaded lets the next mount
        // retry; the shared promise above stops that becoming a storm.
      } finally {
        settingsRequest = null;
      }
    })();

    return settingsRequest;
  },

  setPlatoonsEnabled: (enabled) => set({ platoonsEnabled: enabled }),

  loadMembers: async () => {
    if (get().membersLoaded || get().membersLoading) return;
    set({ membersLoading: true });
    try {
      const users = await userService.getUsers();
      const members = users
        .filter((m) => m.status === UserStatus.ACTIVE)
        .map((m) => ({
          id: String(m.id),
          label: `${m.first_name || ''} ${m.last_name || ''}`.trim() || String(m.email || m.id),
          platoon: m.platoon || undefined,
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
      // No array guard needed here: schedulingService normalizes every
      // array-returning method at the boundary (see asArray there).
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
    set({ summaryLoading: true, summaryError: null });
    try {
      const summary = await schedulingService.getSummary();
      set({ summary });
    } catch (err) {
      const message = getErrorMessage(err, 'Failed to load scheduling summary');
      set({ summaryError: message });
    } finally {
      set({ summaryLoading: false });
    }
  },

  /** Load all shared reference data in a single call. */
  loadInitialData: async () => {
    const state = get();
    const promises: Promise<void>[] = [];
    if (!state.membersLoaded && !state.membersLoading) promises.push(state.loadMembers());
    if (!state.templatesLoaded && !state.templatesLoading) promises.push(state.loadTemplates());
    if (!state.apparatusLoaded) promises.push(state.loadApparatus());
    if (!state.settingsLoaded) promises.push(state.loadSettings());
    await Promise.all(promises);
  },
}));
