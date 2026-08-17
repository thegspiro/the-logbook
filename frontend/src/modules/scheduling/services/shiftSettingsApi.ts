/**
 * Shift Settings API Service
 *
 * Department-wide scheduling defaults (position names, apparatus-type crew
 * defaults, equipment-check rules) live on the backend, org-scoped, at
 * /scheduling/shift-settings. They previously persisted only to each admin's
 * localStorage, so every admin had a private copy and a new browser saw
 * factory defaults.
 *
 * localStorage (under an org-scoped SETTINGS_KEY) is kept as a read-only
 * mirror of the last-known server value: it is the offline/API-failure
 * fallback and is never the primary store. Legacy values without an
 * organization suffix are intentionally ignored.
 *
 * Lives in its own file (not services/api.ts) with its own client from the
 * shared factory, which carries the standard cookie/CSRF/refresh setup.
 */

import { useAuthStore } from '../../../stores/authStore';
import { createApiClient } from '../../../utils/createApiClient';
import type { ShiftSettings } from '../types/shiftSettings';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../types/shiftSettings';

const api = createApiClient();

export interface ShiftSettingsEnvelope {
  settings: ShiftSettings;
  /** False until the organization has saved settings at least once. */
  stored: boolean;
}

// ─── Org-scoped cache & localStorage mirror ──────────────────────────────────

/**
 * SEC (multi-tenant): every cached copy is stamped with the organization it
 * was fetched for, in memory and in localStorage alike.
 *
 * These settings are department-wide, and on a shared station terminal one
 * department's admin can log out and another's log in without the SPA ever
 * reloading. An org-neutral cache then served department A's position names,
 * staffing minimums and equipment-check rules to department B — silently, with
 * no request made. Keying on the organization id makes that impossible by
 * construction: a key mismatch falls through to the built-in defaults, never to
 * another tenant's data. That is deliberately preferred over clearing the cache
 * on logout, which leaks the day the hook stops firing (an unclean logout, a
 * crashed tab) with nothing to show for it.
 */
const currentOrgId = (): string | null => useAuthStore.getState().user?.organization_id ?? null;

/** null orgId (nobody signed in yet) is a distinct key, so a value fetched
 *  before the user resolved can never be handed to a named organization. */
let cache: { orgId: string | null; settings: ShiftSettings } | null = null;
let inFlight: { orgId: string | null; promise: Promise<ShiftSettings> } | null = null;

const mergeWithDefaults = (partial: Partial<ShiftSettings>): ShiftSettings => ({
  ...DEFAULT_SETTINGS,
  ...partial,
});

/** The mirror's localStorage key, or null when there is no organization to
 *  scope it to — in which case nothing is read from or written to the mirror. */
const mirrorKey = (orgId: string | null): string | null => (orgId ? `${SETTINGS_KEY}:${orgId}` : null);

const readLocalSettings = (orgId: string | null): Partial<ShiftSettings> | null => {
  const key = mirrorKey(orgId);
  if (!key) return null;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as Partial<ShiftSettings>;
  } catch {
    return null;
  }
  return null;
};

const mirrorToLocalStorage = (settings: ShiftSettings, orgId: string | null): void => {
  const key = mirrorKey(orgId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // Quota/privacy-mode failures only cost the offline fallback.
  }
};

const setCache = (settings: ShiftSettings, orgId: string | null, mirror: boolean): ShiftSettings => {
  cache = { orgId, settings };
  if (mirror) mirrorToLocalStorage(settings, orgId);
  return settings;
};

/** Drop the in-memory cache and single-flight promise (tests / logout).
 *  Defence in depth only — the org-keyed cache above is what actually keeps
 *  one department's settings away from another. */
export const resetShiftSettingsCache = (): void => {
  cache = null;
  inFlight = null;
};

// ─── API calls ───────────────────────────────────────────────────────────────

export const shiftSettingsService = {
  async getShiftSettings(): Promise<ShiftSettingsEnvelope> {
    const response = await api.get<ShiftSettingsEnvelope>('/scheduling/shift-settings');
    return response.data;
  },

  async saveShiftSettings(settings: ShiftSettings): Promise<ShiftSettings> {
    const orgId = currentOrgId();
    const response = await api.put<ShiftSettingsEnvelope>('/scheduling/shift-settings', settings);
    return setCache(mergeWithDefaults(response.data.settings), orgId, true);
  },

  async resetShiftSettings(): Promise<ShiftSettings> {
    const orgId = currentOrgId();
    const response = await api.delete<ShiftSettingsEnvelope>('/scheduling/shift-settings');
    try {
      const key = mirrorKey(orgId);
      if (key) localStorage.removeItem(key);
      // Also drop any un-adopted pre-backend blob, so a reset cannot be undone
      // by the next load re-migrating settings this department just cleared.
      localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // Losing the stale mirror is harmless; the next load rewrites it.
    }
    return setCache(mergeWithDefaults(response.data.settings), orgId, false);
  },
};

// ─── Loading with migration & offline fallback ───────────────────────────────

/**
 * Load the department settings, treating the backend as the source of truth.
 *
 * `migrateLocal` (settings panel only — it requires scheduling.manage):
 * when the backend has never stored settings but this browser has a mirror
 * explicitly scoped to the current organization, push that copy up once,
 * best-effort. Untagged legacy values are never migration candidates because
 * their owning organization cannot be verified.
 * Other callers must not pass it: a plain member would just collect a 403.
 *
 * When the API call fails entirely (offline), the localStorage mirror is the
 * read fallback, then the built-in defaults.
 */
export async function loadShiftSettings(options?: { migrateLocal?: boolean }): Promise<ShiftSettings> {
  const orgId = currentOrgId();
  try {
    const { settings, stored } = await shiftSettingsService.getShiftSettings();
    if (!stored) {
      const local = readLocalSettings(orgId);
      if (local) {
        const merged = mergeWithDefaults(local);
        if (options?.migrateLocal) {
          try {
            return await shiftSettingsService.saveShiftSettings(merged);
          } catch {
            // Backend reachable but the write failed — keep the local copy
            // as the working value; the next explicit Save will persist it.
            return setCache(merged, orgId, false);
          }
        }
        // Not migrating (viewer context): the local copy is still the best
        // known value while nothing is stored department-wide.
        return setCache(merged, orgId, false);
      }
    }
    return setCache(mergeWithDefaults(settings), orgId, true);
  } catch {
    const local = readLocalSettings(orgId);
    return setCache(local ? mergeWithDefaults(local) : DEFAULT_SETTINGS, orgId, false);
  }
}

/**
 * Kick off (at most one per organization) background load and return its
 * promise. Sync consumers call this fire-and-forget and read via
 * getCachedShiftSettings(). A second organization signing in on the same tab
 * gets its own load rather than the first one's resolved promise.
 */
export function ensureShiftSettingsLoaded(): Promise<ShiftSettings> {
  const orgId = currentOrgId();
  if (!inFlight || inFlight.orgId !== orgId) {
    inFlight = { orgId, promise: loadShiftSettings() };
  }
  return inFlight.promise;
}

/**
 * Synchronous accessor for consumers that cannot await (render-time option
 * lists, click handlers): in-memory cache, then the localStorage mirror,
 * then the built-in defaults — each step scoped to the signed-in organization,
 * so a miss degrades to defaults rather than to another department's rules.
 */
export function getCachedShiftSettings(): ShiftSettings {
  const orgId = currentOrgId();
  if (cache && cache.orgId === orgId) return cache.settings;
  const local = readLocalSettings(orgId);
  return local ? mergeWithDefaults(local) : DEFAULT_SETTINGS;
}
