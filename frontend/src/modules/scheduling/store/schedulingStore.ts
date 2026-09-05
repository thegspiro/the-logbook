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
  openEndedCushionHours: number;
  settingsLoaded: boolean;

  // ─── Actions ────────────────────────────────────────────────────────────
  loadMembers: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadApparatus: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadSettings: () => Promise<void>;
  /**
   * Drop the cached settings so the next mount refetches them.
   *
   * For a screen that writes a setting this store mirrors — the checklist
   * timing behind `openEndedCushionHours` lives on another module's page.
   */
  invalidateSettings: () => void;
  /**
   * Drop everything this store holds for the current organization.
   *
   * Distinct from `invalidateSettings`, which says "one of these values is
   * stale, refetch it". This says "none of this belongs to whoever is here
   * now". The store is memory-only and keyed by nothing user-specific, so on
   * a shared station computer it outlives the member: without this, signing
   * in as somebody from another department left every screen reading the
   * previous one's call types, signup window, roster, templates and
   * apparatus, because each loader short-circuits on its own loaded flag.
   * Called from the logout purge and from every sign-in path.
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

/**
 * Bumped by `invalidateSettings`, captured by each `loadSettings` call.
 *
 * Clearing `settingsLoaded` alone does not undo a request already in flight:
 * an administrator who leaves scheduling while the GET is pending and then
 * saves the checklist timing would have that older response land afterwards
 * and write the pre-save cushion back with `settingsLoaded: true`. The window
 * is small and the result is silent — the roster locks on a number the server
 * has already replaced, and nothing refetches until the tab is reloaded.
 *
 * A response whose generation no longer matches is therefore discarded rather
 * than applied.
 */
let settingsGeneration = 0;

/**
 * Bumped only by `resetSettings`, captured by every organization-scoped
 * loader in this store.
 *
 * `settingsGeneration` covers the settings request alone, and clearing the
 * state does nothing to a `loadMembers` / `loadTemplates` / `loadApparatus` /
 * `loadSummary` promise already awaiting a response: it lands afterwards and
 * writes the previous department's roster, templates or apparatus back in,
 * with its loaded flag set so nothing refetches. Separate from
 * `settingsGeneration` because `invalidateSettings` means "one setting is
 * stale", which is no reason to discard a roster already on its way.
 */
let accountGeneration = 0;

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
  openEndedCushionHours: DEFAULT_SIGNUP_WINDOW.openEndedCushionHours,
  settingsLoaded: false,

  // ─── Actions ────────────────────────────────────────────────────────────

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

    const generation = settingsGeneration;
    settingsRequest = (async () => {
      try {
        const settings = await schedulingService.getFeatureSettings();
        // Superseded while in flight: this response predates a save that
        // changed one of these settings, so applying it would reinstate the
        // old value and mark it loaded.
        if (generation !== settingsGeneration) return;
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
          openEndedCushionHours: settings.open_ended_shift_cushion_hours ?? DEFAULT_SIGNUP_WINDOW.openEndedCushionHours,
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
        // Only if this is still the current request: `invalidateSettings` has
        // already cleared it, and a later mount may have stored its own.
        if (generation === settingsGeneration) settingsRequest = null;
      }
    })();

    return settingsRequest;
  },

  invalidateSettings: () => {
    settingsGeneration += 1;
    settingsRequest = null;
    set({ settingsLoaded: false });
  },

  resetSettings: () => {
    // Bumps both: the settings counter for the same reason
    // `invalidateSettings` does, and the account counter so every other
    // in-flight loader drops its response too.
    settingsGeneration += 1;
    accountGeneration += 1;
    settingsRequest = null;
    set({
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
      settingsLoaded: false,
      platoonsEnabled: false,
      requireEndOfShiftChecks: false,
      callTrackingMode: 'detailed',
      callTypeLabels: {},
      signupClosesMinutesBefore: DEFAULT_SIGNUP_WINDOW.closesMinutesBefore,
      lateSignupGraceMinutes: DEFAULT_SIGNUP_WINDOW.graceMinutes,
      openEndedCushionHours: DEFAULT_SIGNUP_WINDOW.openEndedCushionHours,
    });
  },

  setPlatoonsEnabled: (enabled) => set({ platoonsEnabled: enabled }),

  loadMembers: async () => {
    if (get().membersLoaded || get().membersLoading) return;
    const generation = accountGeneration;
    set({ membersLoading: true });
    try {
      const users = await userService.getUsers();
      // Started under a different account: this roster is not theirs.
      if (generation !== accountGeneration) return;
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
      if (generation === accountGeneration) set({ membersLoading: false });
    }
  },

  loadTemplates: async () => {
    if (get().templatesLoaded || get().templatesLoading) return;
    const generation = accountGeneration;
    set({ templatesLoading: true });
    try {
      const templates = await schedulingService.getTemplates({
        active_only: true,
      });
      if (generation !== accountGeneration) return;
      // No array guard needed here: schedulingService normalizes every
      // array-returning method at the boundary (see asArray there).
      set({ templates, templatesLoaded: true });
    } catch {
      // Mark loaded even on error to prevent a retry loop — but not against
      // an account that has since changed.
      if (generation === accountGeneration) set({ templatesLoaded: true });
    } finally {
      if (generation === accountGeneration) set({ templatesLoading: false });
    }
  },

  loadApparatus: async () => {
    if (get().apparatusLoaded) return;
    const generation = accountGeneration;
    try {
      const apparatus = await schedulingService.getBasicApparatus();
      if (generation !== accountGeneration) return;
      set({ apparatus, apparatusLoaded: true });
    } catch {
      if (generation === accountGeneration) set({ apparatusLoaded: true });
    }
  },

  loadSummary: async () => {
    if (get().summaryLoading) return;
    const generation = accountGeneration;
    set({ summaryLoading: true, summaryError: null });
    try {
      const summary = await schedulingService.getSummary();
      if (generation !== accountGeneration) return;
      set({ summary });
    } catch (err) {
      if (generation !== accountGeneration) return;
      const message = getErrorMessage(err, 'Failed to load scheduling summary');
      set({ summaryError: message });
    } finally {
      if (generation === accountGeneration) set({ summaryLoading: false });
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
