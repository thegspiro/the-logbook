/**
 * The check-in window fields commit deliberately, not on every keystroke.
 *
 * Saving straight from `onChange` was wrong three ways, and each is covered
 * here: `Number('')` is 0, so clearing the box to retype silently persisted
 * "opens at the shift start"; every keystroke saved, so typing "12" wrote 1 and
 * then 12; and `min`/`max` on a number input do not stop `onChange`, so a typed
 * 999 reached the server, was rejected, and stayed in state to be resubmitted
 * with the next unrelated edit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => getSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => updateSettings(...args) as unknown,
  },
}));

vi.mock('../../../services/trainingServices', () => ({
  trainingModuleConfigService: {
    getConfig: vi.fn().mockResolvedValue(null),
    updateConfig: vi.fn().mockResolvedValue({}),
    getSkillNames: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../services/api', () => ({
  schedulingService: {
    getApparatusTypes: vi.fn().mockResolvedValue([]),
    getFeatureSettings: vi.fn().mockResolvedValue({}),
    getBasicApparatus: vi.fn().mockResolvedValue([]),
  },
}));

import { ShiftReportsSettingsPanel } from './ShiftReportsSettingsPanel';

interface SettingsPayload {
  shift_reports?: { checklist_timing?: Record<string, number> };
}

/** The saved window, as the last updateSettings call described it. */
const lastSavedTiming = (): Record<string, number> | null => {
  const calls = updateSettings.mock.calls as SettingsPayload[][];
  const payload = calls.length > 0 ? calls[calls.length - 1]?.[0] : undefined;
  return payload?.shift_reports?.checklist_timing ?? null;
};

/**
 * Open the Checklist Timing section and hand back its "opens before" field.
 *
 * The label appears twice — the panel renders its section list as a scrollable
 * strip for phones and a sidebar for desktop — so take the first match.
 */
const openChecklistTiming = async (user: ReturnType<typeof userEvent.setup>) => {
  const [tab] = await screen.findAllByText('Checklist Timing');
  if (!tab) throw new Error('Checklist Timing section not rendered');
  await user.click(tab);
  return screen.findByLabelText(/Opens before the start/i);
};

beforeEach(() => {
  vi.clearAllMocks();
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
    renderWithRouter(<ShiftReportsSettingsPanel />);
    const opens = await openChecklistTiming(user);

    await user.clear(opens);
    expect(opens).toHaveValue(null);
    // Clearing is an edit in progress, not a request to allow check-in only
    // from the start time onward.
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('restores the saved value when the box is left empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    const opens = await openChecklistTiming(user);

    await user.clear(opens);
    await user.tab();

    await waitFor(() => expect(opens).toHaveValue(2));
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('saves once, on blur, rather than per keystroke', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    const opens = await openChecklistTiming(user);

    await user.clear(opens);
    await user.type(opens, '12');
    expect(updateSettings).not.toHaveBeenCalled();

    await user.tab();
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(lastSavedTiming()).toMatchObject({ checkin_opens_hours_before: 12 });
  });

  it('clamps a value past the maximum instead of sending it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    const opens = await openChecklistTiming(user);

    await user.clear(opens);
    await user.type(opens, '999');
    await user.tab();

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    // 24 is the backend's own ceiling for this field.
    expect(lastSavedTiming()).toMatchObject({ checkin_opens_hours_before: 24 });
  });
});
