import { useEffect } from 'react';
import { create } from 'zustand';

import { PracticalSkillsMethod } from '../constants/enums';
import { trainingModuleConfigService } from '../services/api';
import { useAuthStore } from './authStore';

/**
 * Which practical-skills system the signed-in member's department runs.
 *
 * A department runs Skills Testing or shift-report sign-offs, and every
 * surface that offers one of them — the Training hub, both navigation bars,
 * My Training, the shift report form, the command palette — hides the other.
 * They read it from here so one request answers all of them, and so saving
 * the setting updates the navigation without a reload.
 *
 * `method` is null until the answer is known. Hiding a screen is not where
 * the setting is enforced — the server refuses to open a new skills test, and
 * a shift report records no sign-off, for the department that turned each
 * off — so an unknown answer here shows both rather than hiding a system the
 * department may be running.
 */
interface PracticalSkillsState {
  method: PracticalSkillsMethod | null;
  /** The organization `method` was loaded for, so a different one reloads. */
  organizationId: string | null;
  load: (organizationId: string) => Promise<void>;
  /** Record a saved choice, for the settings screen. */
  setMethod: (method: PracticalSkillsMethod) => void;
}

let inflight: { organizationId: string; promise: Promise<void> } | null = null;

const isMethod = (value: unknown): value is PracticalSkillsMethod =>
  value === PracticalSkillsMethod.SKILLS_TESTING || value === PracticalSkillsMethod.SHIFT_SIGNOFFS;

export const usePracticalSkillsStore = create<PracticalSkillsState>((set, get) => ({
  method: null,
  organizationId: null,
  load: (organizationId) => {
    if (get().organizationId === organizationId && get().method !== null) return Promise.resolve();
    // Every surface mounts together, so they share the first request rather
    // than each making one.
    if (inflight?.organizationId === organizationId) return inflight.promise;
    // Started inside a promise so that any failure, however it surfaces,
    // takes the catch below rather than throwing out of a component effect.
    const promise = Promise.resolve()
      .then(() => trainingModuleConfigService.getConfig())
      .then((config) => {
        set({
          organizationId,
          method: isMethod(config.practical_skills_method)
            ? config.practical_skills_method
            : PracticalSkillsMethod.SKILLS_TESTING,
        });
      })
      .catch(() => {
        // Leave it unknown: both systems stay visible, which is what a
        // department saw before the setting existed.
        set({ organizationId, method: null });
      })
      .finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { organizationId, promise };
    return promise;
  },
  setMethod: (method) => set({ method }),
}));

/**
 * The department's practical-skills method, loading it on first use.
 * Null while unknown; see the store for why that shows both systems.
 *
 * `enabled: false` keeps it from asking. The setting is the Training module's
 * and the server refuses it while that module is off, so a caller mounted
 * outside Training's own routes passes the module check in; the training pages
 * are behind that module's route gate already and leave it at the default.
 */
export function usePracticalSkillsMethod(enabled = true): PracticalSkillsMethod | null {
  // Read as unknown: a suite that stubs the store without honouring the
  // selector hands back its whole stub — a new object each render, which as an
  // id would reload on every render without end. Only a string is an id.
  const storeOrganizationId: unknown = useAuthStore((state) => state.user?.organization_id ?? null);
  const organizationId = typeof storeOrganizationId === 'string' ? storeOrganizationId : null;
  const method = usePracticalSkillsStore((state) => state.method);
  const loadedFor = usePracticalSkillsStore((state) => state.organizationId);
  const load = usePracticalSkillsStore((state) => state.load);

  useEffect(() => {
    if (organizationId && enabled) void load(organizationId);
  }, [organizationId, enabled, load]);

  return organizationId && loadedFor === organizationId ? method : null;
}

/** Whether a surface for Skills Testing should be offered. */
export const offersSkillsTesting = (method: PracticalSkillsMethod | null): boolean =>
  method !== PracticalSkillsMethod.SHIFT_SIGNOFFS;

/** Whether a surface for shift-report sign-offs should be offered. */
export const offersShiftSignoffs = (method: PracticalSkillsMethod | null): boolean =>
  method !== PracticalSkillsMethod.SKILLS_TESTING;
