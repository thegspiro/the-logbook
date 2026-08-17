/**
 * Tests for the shift settings API service: backend-as-source-of-truth
 * loading, the one-time localStorage migration, the offline fallback chain
 * (cache → localStorage mirror → built-in defaults), and the organization
 * scoping that keeps one department's settings away from another's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  }),
}));

// The signed-in organization keys every cache and mirror entry. Mocked rather
// than driven through the real store so a test can swap departments the way a
// shared station terminal does: log out, log in, no page reload.
let mockOrgId: string | null = 'org-a';
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: mockOrgId ? { organization_id: mockOrgId } : null }),
  },
}));

// Import AFTER mocks are in place (store test pattern)
import {
  loadShiftSettings,
  ensureShiftSettingsLoaded,
  getCachedShiftSettings,
  resetShiftSettingsCache,
  shiftSettingsService,
} from './shiftSettingsApi';
import type { ShiftSettings } from '../types/shiftSettings';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../types/shiftSettings';

const serverSettings: ShiftSettings = {
  ...DEFAULT_SETTINGS,
  defaultDurationHours: 24,
  customPositions: [{ value: 'rescue_tech', label: 'Rescue Technician' }],
};

const localOnly: Partial<ShiftSettings> = {
  defaultDurationHours: 8,
  customPositions: [{ value: 'diver', label: 'Rescue Diver' }],
};

/** Where the mirror for a given department actually lives. */
const mirrorKeyFor = (orgId: string) => `${SETTINGS_KEY}:${orgId}`;

const readMirror = (orgId: string): Partial<ShiftSettings> =>
  JSON.parse(localStorage.getItem(mirrorKeyFor(orgId)) ?? '{}') as Partial<ShiftSettings>;

beforeEach(() => {
  localStorage.clear();
  resetShiftSettingsCache();
  mockOrgId = 'org-a';
  vi.clearAllMocks();
});

describe('loadShiftSettings', () => {
  it('returns backend settings and mirrors them to localStorage when stored', async () => {
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });

    const result = await loadShiftSettings();

    expect(mockGet).toHaveBeenCalledWith('/scheduling/shift-settings');
    expect(result.defaultDurationHours).toBe(24);
    expect(readMirror('org-a').defaultDurationHours).toBe(24);
  });

  it('migrates the localStorage copy to the backend once when nothing is stored', async () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    mockGet.mockResolvedValue({ data: { settings: DEFAULT_SETTINGS, stored: false } });
    mockPut.mockImplementation((_url: unknown, body: unknown) =>
      Promise.resolve({ data: { settings: body as ShiftSettings, stored: true } })
    );

    const result = await loadShiftSettings({ migrateLocal: true });

    expect(mockPut).toHaveBeenCalledWith('/scheduling/shift-settings', {
      ...DEFAULT_SETTINGS,
      ...localOnly,
    });
    expect(result.defaultDurationHours).toBe(8);
    expect(result.customPositions).toEqual([{ value: 'diver', label: 'Rescue Diver' }]);
  });

  it('does not attempt the migration PUT without migrateLocal, but still uses the local copy', async () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    mockGet.mockResolvedValue({ data: { settings: DEFAULT_SETTINGS, stored: false } });

    const result = await loadShiftSettings();

    expect(mockPut).not.toHaveBeenCalled();
    expect(result.defaultDurationHours).toBe(8);
  });

  it('keeps the local copy as the working value when the migration PUT fails', async () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    mockGet.mockResolvedValue({ data: { settings: DEFAULT_SETTINGS, stored: false } });
    mockPut.mockRejectedValue(new Error('403'));

    const result = await loadShiftSettings({ migrateLocal: true });

    expect(result.defaultDurationHours).toBe(8);
    expect(getCachedShiftSettings().defaultDurationHours).toBe(8);
  });

  it('ignores localStorage once the backend has stored settings', async () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });

    const result = await loadShiftSettings({ migrateLocal: true });

    expect(mockPut).not.toHaveBeenCalled();
    expect(result.defaultDurationHours).toBe(24);
  });

  it('falls back to the localStorage mirror when the API call fails', async () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    mockGet.mockRejectedValue(new Error('network down'));

    const result = await loadShiftSettings();

    expect(result.defaultDurationHours).toBe(8);
  });

  it('falls back to built-in defaults when the API fails and no mirror exists', async () => {
    mockGet.mockRejectedValue(new Error('network down'));

    const result = await loadShiftSettings();

    expect(result).toEqual(DEFAULT_SETTINGS);
  });
});

describe('ensureShiftSettingsLoaded', () => {
  it('single-flights the load: repeated calls make one GET', async () => {
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });

    await Promise.all([ensureShiftSettingsLoaded(), ensureShiftSettingsLoaded()]);
    await ensureShiftSettingsLoaded();

    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('getCachedShiftSettings', () => {
  it('returns defaults with no cache and no mirror', () => {
    expect(getCachedShiftSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads the localStorage mirror before any load completes', () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    expect(getCachedShiftSettings().defaultDurationHours).toBe(8);
  });

  it('prefers the in-memory cache after a load', async () => {
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });
    await loadShiftSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(localOnly));

    expect(getCachedShiftSettings().defaultDurationHours).toBe(24);
  });
});

describe('shiftSettingsService', () => {
  it('save PUTs the full object and updates cache + mirror', async () => {
    mockPut.mockResolvedValue({ data: { settings: serverSettings, stored: true } });

    const result = await shiftSettingsService.saveShiftSettings(serverSettings);

    expect(mockPut).toHaveBeenCalledWith('/scheduling/shift-settings', serverSettings);
    expect(result.defaultDurationHours).toBe(24);
    expect(getCachedShiftSettings().defaultDurationHours).toBe(24);
    expect(readMirror('org-a').defaultDurationHours).toBe(24);
  });

  it('reset DELETEs server-side, clears the mirror, and returns defaults', async () => {
    localStorage.setItem(mirrorKeyFor('org-a'), JSON.stringify(localOnly));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(localOnly));
    mockDelete.mockResolvedValue({ data: { settings: DEFAULT_SETTINGS, stored: false } });

    const result = await shiftSettingsService.resetShiftSettings();

    expect(mockDelete).toHaveBeenCalledWith('/scheduling/shift-settings');
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(localStorage.getItem(mirrorKeyFor('org-a'))).toBeNull();
    // The un-adopted pre-backend blob goes too, or the next load would
    // re-migrate the settings this department just cleared.
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(getCachedShiftSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

// SEC: an admin can log out of one department and another log in on the same
// station terminal without the SPA reloading. Nothing cached for the first may
// ever be served to the second.
describe('organization scoping', () => {
  it('re-loads for the new organization instead of reusing the resolved promise', async () => {
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });
    await ensureShiftSettingsLoaded();
    expect(mockGet).toHaveBeenCalledTimes(1);

    mockOrgId = 'org-b';
    mockGet.mockResolvedValue({
      data: { settings: { ...DEFAULT_SETTINGS, defaultDurationHours: 10 }, stored: true },
    });

    const result = await ensureShiftSettingsLoaded();

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.defaultDurationHours).toBe(10);
  });

  it('does not serve the previous organization in-memory cache to the next one', async () => {
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });
    await loadShiftSettings();
    expect(getCachedShiftSettings().defaultDurationHours).toBe(24);
    expect(getCachedShiftSettings().customPositions).toEqual(serverSettings.customPositions);

    mockOrgId = 'org-b';

    expect(getCachedShiftSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('does not serve the previous organization localStorage mirror to the next one', async () => {
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });
    await loadShiftSettings();
    resetShiftSettingsCache();

    mockOrgId = 'org-b';
    // Offline for the new department: the fallback must be the built-in
    // defaults, never org A's positions and staffing rules.
    mockGet.mockRejectedValue(new Error('network down'));

    const result = await loadShiftSettings();

    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(getCachedShiftSettings()).toEqual(DEFAULT_SETTINGS);
    // Org A's mirror survives untouched for org A's next session.
    expect(readMirror('org-a').defaultDurationHours).toBe(24);
  });

  it('never adopts an untagged legacy copy into the current organization', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(localOnly));
    mockGet.mockResolvedValue({ data: { settings: DEFAULT_SETTINGS, stored: false } });
    const forOrgB = await loadShiftSettings({ migrateLocal: true });

    expect(mockPut).not.toHaveBeenCalled();
    expect(forOrgB).toEqual(DEFAULT_SETTINGS);
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(JSON.stringify(localOnly));
  });

  it('never writes a mirror when no organization is known yet', async () => {
    mockOrgId = null;
    mockGet.mockResolvedValue({ data: { settings: serverSettings, stored: true } });

    await loadShiftSettings();

    expect(localStorage.length).toBe(0);
    // …and the value fetched before the user resolved is not handed on.
    mockOrgId = 'org-a';
    expect(getCachedShiftSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
