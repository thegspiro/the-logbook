import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getConfig = vi.fn();
const updateConfig = vi.fn();
const getApparatusOptions = vi.fn();

vi.mock('../../services/api', () => ({
  trainingModuleConfigService: {
    getConfig: (...a: unknown[]) => getConfig(...a) as unknown,
    updateConfig: (...a: unknown[]) => updateConfig(...a) as unknown,
  },
}));
vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getApparatusOptions: (...a: unknown[]) => getApparatusOptions(...a) as unknown,
  },
}));

import { ManualEntrySettingsPanel } from './ManualEntrySettingsPanel';

const savedConfig = {
  manual_entry_enabled: true,
  manual_entry_require_apparatus: true,
  manual_entry_apparatus_ids: ['app-1'],
  manual_entry_default_start_time: '07:00',
  manual_entry_default_duration_hours: 24,
};

describe('ManualEntrySettingsPanel', () => {
  beforeEach(() => {
    getConfig.mockReset();
    getConfig.mockResolvedValue(savedConfig);
    updateConfig.mockReset();
    updateConfig.mockResolvedValue(savedConfig);
    getApparatusOptions.mockReset();
    getApparatusOptions.mockResolvedValue({
      source: 'apparatus',
      options: [{ id: 'app-1', name: 'Engine 1', apparatus_type: 'engine', source: 'apparatus' }],
    });
  });

  // The update is partial on the server, so an omitted key keeps the stored
  // value: unchecking every apparatus ("allow any") has to go out as [], and
  // an emptied default as null, or the old restriction and defaults stay.
  it('sends cleared settings as an empty list and nulls', async () => {
    const user = userEvent.setup();
    render(<ManualEntrySettingsPanel />);

    await user.click(await screen.findByRole('checkbox', { name: /Engine 1/ }));
    await user.clear(screen.getByDisplayValue('07:00'));
    await user.clear(screen.getByDisplayValue('24'));
    await user.click(screen.getByRole('button', { name: /Save Settings/ }));

    expect(updateConfig).toHaveBeenCalledWith({
      manual_entry_enabled: true,
      manual_entry_require_apparatus: true,
      manual_entry_apparatus_ids: [],
      manual_entry_default_start_time: null,
      manual_entry_default_duration_hours: null,
    });
  });

  it('sends the selections and defaults it holds', async () => {
    const user = userEvent.setup();
    render(<ManualEntrySettingsPanel />);

    await screen.findByRole('checkbox', { name: /Engine 1/ });
    await user.click(screen.getByRole('button', { name: /Save Settings/ }));

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        manual_entry_apparatus_ids: ['app-1'],
        manual_entry_default_start_time: '07:00',
        manual_entry_default_duration_hours: 24,
      })
    );
  });
});
