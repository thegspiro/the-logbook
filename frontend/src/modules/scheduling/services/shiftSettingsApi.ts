/**
 * Shift Settings API Service
 *
 * Department-wide scheduling defaults (position names, apparatus-type crew
 * defaults, equipment-check rules) live on the backend, org-scoped, at
 * /scheduling/shift-settings. They previously persisted only to each admin's
 * localStorage, so every admin had a private copy and a new browser saw
 * factory defaults.
 *
 * localStorage (under SETTINGS_KEY) is kept as a read-only mirror of the
 * last-known server value: it is the offline/API-failure fallback and the
 * source for the one-time migration of pre-backend settings — never the
 * primary store.
 *
 * Lives in its own file (not services/api.ts) with its own client from the
 * shared factory, which carries the standard cookie/CSRF/refresh setup.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type { ShiftSettings } from '../types/shiftSettings';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../types/shiftSettings';

const api = createApiClient();

export interface ShiftSettingsEnvelope {
  settings: ShiftSettings;
  /** False until the organization has saved settings at least once. */
  stored: boolean;
}

// ─── Cache & localStorage mirror ─────────────────────────────────────────────

let cachedSettings: ShiftSettings | null = null;
let loadPromise: Promise<ShiftSettings> | null = null;

const mergeWithDefaults = (partial: Partial<ShiftSettings>): ShiftSettings => ({
  ...DEFAULT_SETTINGS,
  ...partial,
});

const readLocalSettings = (): Partial<ShiftSettings> | null => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? (JSON.parse(stored) as Partial<ShiftSettings>) : null;
  } catch {
    return null;
  }
};

const mirrorToLocalStorage = (settings: ShiftSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota/privacy-mode failures only cost the offline fallback.
  }
};

const setCache = (settings: ShiftSettings, mirror: boolean): ShiftSettings => {
  cachedSettings = settings;
  if (mirror) mirrorToLocalStorage(settings);
  return settings;
};

/** Drop the in-memory cache and single-flight promise (tests / logout). */
export const resetShiftSettingsCache = (): void => {
  cachedSettings = null;
  loadPromise = null;
};

// ─── API calls ───────────────────────────────────────────────────────────────

export const shiftSettingsService = {
  async getShiftSettings(): Promise<ShiftSettingsEnvelope> {
    const response = await api.get<ShiftSettingsEnvelope>('/scheduling/shift-settings');
    return response.data;
  },

  async saveShiftSettings(settings: ShiftSettings): Promise<ShiftSettings> {
    const response = await api.put<ShiftSettingsEnvelope>('/scheduling/shift-settings', settings);
    return setCache(mergeWithDefaults(response.data.settings), true);
  },

  async resetShiftSettings(): Promise<ShiftSettings> {
    const response = await api.delete<ShiftSettingsEnvelope>('/scheduling/shift-settings');
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // Losing the stale mirror is harmless; the next load rewrites it.
    }
    cachedSettings = mergeWithDefaults(response.data.settings);
    return cachedSettings;
  },
};

// ─── Loading with migration & offline fallback ───────────────────────────────

/**
 * Load the department settings, treating the backend as the source of truth.
 *
 * `migrateLocal` (settings panel only — it requires scheduling.manage):
 * when the backend has never stored settings but this browser's localStorage
 * has a pre-backend copy, push that copy up once, best-effort, so the first
 * admin to open the panel donates their settings to the whole department.
 * Other callers must not pass it: a plain member would just collect a 403.
 *
 * When the API call fails entirely (offline), the localStorage mirror is the
 * read fallback, then the built-in defaults.
 */
export async function loadShiftSettings(options?: { migrateLocal?: boolean }): Promise<ShiftSettings> {
  try {
    const { settings, stored } = await shiftSettingsService.getShiftSettings();
    if (!stored) {
      const local = readLocalSettings();
      if (local) {
        const merged = mergeWithDefaults(local);
        if (options?.migrateLocal) {
          try {
            return await shiftSettingsService.saveShiftSettings(merged);
          } catch {
            // Backend reachable but the write failed — keep the local copy
            // as the working value; the next explicit Save will persist it.
            return setCache(merged, false);
          }
        }
        // Not migrating (viewer context): the local copy is still the best
        // known value while nothing is stored department-wide.
        return setCache(merged, false);
      }
    }
    return setCache(mergeWithDefaults(settings), true);
  } catch {
    const local = readLocalSettings();
    return setCache(local ? mergeWithDefaults(local) : DEFAULT_SETTINGS, false);
  }
}

/**
 * Kick off (at most one) background load and return its promise. Sync
 * consumers call this fire-and-forget and read via getCachedShiftSettings().
 */
export function ensureShiftSettingsLoaded(): Promise<ShiftSettings> {
  loadPromise ??= loadShiftSettings();
  return loadPromise;
}

/**
 * Synchronous accessor for consumers that cannot await (render-time option
 * lists, click handlers): in-memory cache, then the localStorage mirror,
 * then the built-in defaults.
 */
export function getCachedShiftSettings(): ShiftSettings {
  if (cachedSettings) return cachedSettings;
  const local = readLocalSettings();
  return local ? mergeWithDefaults(local) : DEFAULT_SETTINGS;
}
