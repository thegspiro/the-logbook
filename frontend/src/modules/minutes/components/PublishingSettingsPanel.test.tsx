import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
}));
vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PublishingSettingsPanel } from './PublishingSettingsPanel';
import type { MinutesReminderSettings } from '../types/minutes';

const off: MinutesReminderSettings = {
  action_item_reminders: true,
  reminder_days_before_due: 3,
  overdue_repeat_days: 7,
  open_items_digest: true,
  signature_slots: [],
  public_posting: false,
  executive_library_publishing: false,
  executive_public_posting: false,
  executive_effective_library: false,
  executive_effective_public: false,
  attendance_listing: 'all',
  auto_file_election_results: true,
};

describe('PublishingSettingsPanel', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(true);
    onSaved.mockReset();
    onSaved.mockResolvedValue(undefined);
  });

  const open = (settings: MinutesReminderSettings = off, canEdit = true) =>
    render(<PublishingSettingsPanel settings={settings} canEdit={canEdit} onSaved={onSaved} />);

  it('starts with everything off and says what executive sessions can do right now', () => {
    open();

    expect(screen.getByRole('checkbox', { name: /post a public copy/i })).not.toBeChecked();
    expect(screen.getByTestId('executive-effective')).toHaveTextContent(
      'cannot be published to the library and cannot be posted publicly'
    );
  });

  it('reports the server’s effective result, not the switches alone', () => {
    open({
      ...off,
      public_posting: true,
      executive_library_publishing: true,
      executive_public_posting: false,
      executive_effective_library: true,
      executive_effective_public: false,
    });

    expect(screen.getByTestId('executive-effective')).toHaveTextContent(
      'can be published to the library and cannot be posted publicly'
    );
  });

  it('has nothing to save until a switch changes', () => {
    open();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves every switch and asks the page to re-read what the server holds', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('checkbox', { name: /post a public copy/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: { public_posting: true, executive_library_publishing: false, executive_public_posting: false },
    });
    expect(onSaved).toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('keeps the public executive switch unavailable until the library one is on', async () => {
    const user = userEvent.setup();
    open();

    const publicExecutive = screen.getByRole('checkbox', { name: /posting them on the public minutes page/i });
    expect(publicExecutive).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /allow publishing to the library/i }));
    expect(publicExecutive).toBeEnabled();
  });

  it('asks before allowing executive-session minutes on the public page, and saves nothing on a no', async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue(false);
    open({ ...off, public_posting: true });

    await user.click(screen.getByRole('checkbox', { name: /allow publishing to the library/i }));
    await user.click(screen.getByRole('checkbox', { name: /posting them on the public minutes page/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves after a yes to the executive public warning', async () => {
    const user = userEvent.setup();
    open({ ...off, public_posting: true });

    await user.click(screen.getByRole('checkbox', { name: /allow publishing to the library/i }));
    await user.click(screen.getByRole('checkbox', { name: /posting them on the public minutes page/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: { public_posting: true, executive_library_publishing: true, executive_public_posting: true },
    });
  });

  it('is read-only without the settings permission', () => {
    open(off, false);

    expect(screen.getByRole('checkbox', { name: /post a public copy/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
