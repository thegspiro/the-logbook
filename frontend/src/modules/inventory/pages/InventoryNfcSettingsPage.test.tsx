import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryNfcSettingsPage } from './InventoryNfcSettingsPage';

const { getNfcSettings, updateSettings } = vi.hoisted(() => ({
  getNfcSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  inventoryService: { getNfcSettings },
  organizationService: { updateSettings },
}));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));

describe('InventoryNfcSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNfcSettings.mockReset();
    getNfcSettings.mockResolvedValue({ enabled: false });
    updateSettings.mockReset();
    updateSettings.mockResolvedValue({});
  });

  it('shows the switch as the server reports it', async () => {
    getNfcSettings.mockResolvedValue({ enabled: true });
    renderWithRouter(<InventoryNfcSettingsPage />);
    expect(await screen.findByRole('checkbox', { name: /Use NFC tags/ })).toBeChecked();
  });

  it('saves only the NFC key, so the rest of the inventory section is untouched', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcSettingsPage />);
    getNfcSettings.mockResolvedValue({ enabled: true });
    await user.click(await screen.findByRole('checkbox', { name: /Use NFC tags/ }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ inventory: { nfc_tracking_enabled: true } }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Use NFC tags/ })).toBeChecked());
  });

  it('shows what the server enforces after a failed save, not what was clicked', async () => {
    updateSettings.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcSettingsPage />);
    await user.click(await screen.findByRole('checkbox', { name: /Use NFC tags/ }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(screen.getByRole('checkbox', { name: /Use NFC tags/ })).not.toBeChecked();
  });
});
