/**
 * The check-in window fields commit deliberately, not on every keystroke.
 *
 * Saving straight from `onChange` was wrong three ways, and each is covered
 * here: `Number('')` is 0, so clearing the box to retype silently persisted
 * "opens at the shift start"; every keystroke saved, so typing "12" wrote 1 and
 * then 12; and `min`/`max` on a number input do not stop `onChange`, so a typed
 * 999 reached the server, was rejected, and stayed in state to be resubmitted
 * with the next unrelated edit.
 *
 * These fields moved here from the shift module's settings panel when equipment
 * checklists became Inventory's; the behaviour they guard did not change, so
 * this suite moved with them rather than being rewritten.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSchedulingStore } from '../../scheduling/store/schedulingStore';
import { renderWithRouter } from '../../../test/utils';

const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => getSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => updateSettings(...args) as unknown,
  },
}));

import { ChecklistSettingsPage } from './ChecklistSettingsPage';

interface SettingsPayload {
  shift_reports?: { checklist_timing?: Record<string, number | boolean> };
}

const lastPayload = (): SettingsPayload | undefined => {
  const calls = updateSettings.mock.calls as SettingsPayload[][];
  return calls.length > 0 ? calls[calls.length - 1]?.[0] : undefined;
};

/** The saved window, as the last updateSettings call described it. */
const lastSavedTiming = (): Record<string, number | boolean> | null =>
  lastPayload()?.shift_reports?.checklist_timing ?? null;

const mountPage = () => {
  renderWithRouter(<ChecklistSettingsPage />);
};

/**
 * The "opens before" field, once the loading spinner has given way to the form.
 *
 * Kept separate from mounting so the awaited value is a DOM node rather than a
 * render result — `testing-library/render-result-naming-convention` rejects
 * naming the latter anything but `view`/`utils`.
 */
const opensField = () => screen.findByLabelText(/Opens before the start/i);

beforeEach(() => {
  // mockReset, not clearAllMocks: an implementation set by one block otherwise
  // survives into the next (CLAUDE.md pitfall #28).
  getSettings.mockReset();
  updateSettings.mockReset();
  getSettings.mockResolvedValue({
    shift_reports: {
      checklist_timing: {
        start_of_shift_enabled: true,
        end_of_shift_enabled: true,
        checkin_opens_hours_before: 2,
        checkin_closes_hours_after: 12,
      },
    },
  });
  updateSettings.mockResolvedValue({});
});

describe('check-in window fields', () => {
  it('does not save while the box is empty', async () => {
    const user = userEvent.setup();
    mountPage();
    const opens = await opensField();

    await user.clear(opens);
    expect(opens).toHaveValue(null);
    // Clearing is an edit in progress, not a request to allow check-in only
    // from the start time onward.
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('restores the saved value when the box is left empty', async () => {
    const user = userEvent.setup();
    mountPage();
    const opens = await opensField();

    await user.clear(opens);
    await user.tab();

    await waitFor(() => expect(opens).toHaveValue(2));
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('saves once, on blur, rather than per keystroke', async () => {
    const user = userEvent.setup();
    mountPage();
    const opens = await opensField();

    await user.clear(opens);
    await user.type(opens, '12');
    expect(updateSettings).not.toHaveBeenCalled();

    await user.tab();
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(lastSavedTiming()).toMatchObject({ checkin_opens_hours_before: 12 });
  });

  it('clamps a value past the maximum instead of sending it', async () => {
    const user = userEvent.setup();
    mountPage();
    const opens = await opensField();

    await user.clear(opens);
    await user.type(opens, '999');
    await user.tab();

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    // 24 is the backend's own ceiling for this field.
    expect(lastSavedTiming()).toMatchObject({ checkin_opens_hours_before: 24 });
  });
});

describe('what the save touches', () => {
  /**
   * The load-bearing assertion of the move. Post-shift validation is still
   * edited in Scheduling, under the same `shift_reports` key; the endpoint
   * deep-merges, so this page must send `checklist_timing` ALONE. Sending the
   * whole `shift_reports` object from two screens in two modules is what would
   * let whichever saved last silently revert the other.
   */
  it('sends only checklist_timing, never the whole shift_reports object', async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({
      shift_reports: {
        checklist_timing: {
          start_of_shift_enabled: true,
          end_of_shift_enabled: true,
          checkin_opens_hours_before: 2,
          checkin_closes_hours_after: 12,
        },
        post_shift_validation: { enabled: true, require_officer_report: true, validation_window_hours: 6 },
      },
    });
    mountPage();
    await opensField();

    await user.click(screen.getByRole('checkbox', { name: /Start-of-shift checklists/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(Object.keys(payload?.shift_reports ?? {})).toEqual(['checklist_timing']);
    expect(lastSavedTiming()).toMatchObject({ start_of_shift_enabled: false });
  });

  it('keeps current behaviour when the organization has never saved settings', async () => {
    getSettings.mockResolvedValue({});
    mountPage();
    await opensField();

    // Absence must mean "current behaviour", never "off" (CLAUDE.md pitfall
    // #19) — a department that never opened this screen keeps being prompted.
    expect(screen.getByRole('checkbox', { name: /Start-of-shift checklists/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /End-of-shift checklists/i })).toBeChecked();
  });
});

describe('the scheduling cushion this setting feeds', () => {
  /**
   * `checkin_closes_hours_after` is not only a check-in bound: scheduling
   * reads it to decide how long a shift with no recorded `end_time` still
   * counts as running, which is what its roster lock gates on. That store is a
   * once-per-session cache, so without invalidation an administrator who
   * widened check-in here would return to scheduling in the same tab and find
   * the roster still locking on the old number — hiding controls the server
   * now accepts.
   */
  beforeEach(() => {
    useSchedulingStore.setState({ settingsLoaded: true });
  });

  it('invalidates the cached scheduling settings on save', async () => {
    const user = userEvent.setup();
    mountPage();
    await opensField();

    await user.click(screen.getByRole('checkbox', { name: /Start-of-shift checklists/i }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));

    // Invalidated rather than recomputed: the server resolves the cushion (a
    // floor and a ceiling) and reports it, so clamping a second copy here is
    // how the two would come to disagree.
    await waitFor(() => expect(useSchedulingStore.getState().settingsLoaded).toBe(false));
  });

  it('leaves the cache alone when the save fails', async () => {
    const user = userEvent.setup();
    updateSettings.mockRejectedValueOnce(new Error('network'));
    mountPage();
    await opensField();

    await user.click(screen.getByRole('checkbox', { name: /Start-of-shift checklists/i }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));

    // Nothing was stored, so nothing the store holds went stale.
    expect(useSchedulingStore.getState().settingsLoaded).toBe(true);
  });
});
