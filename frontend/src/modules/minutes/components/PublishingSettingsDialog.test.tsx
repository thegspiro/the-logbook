import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockConfirm = vi.fn();
const authState = { checkPermission: (_p: string) => true };

vi.mock('../services/api', () => ({
  minutesService: { getReminderSettings: (...a: unknown[]) => mockGet(...a) as unknown },
}));
vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PublishingSettingsDialog } from './PublishingSettingsDialog';

const off = {
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
};

describe('PublishingSettingsDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockGet.mockResolvedValue(off);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(true);
    authState.checkPermission = () => true;
  });

  const open = () => render(<PublishingSettingsDialog isOpen onClose={onClose} />);

  it('starts with everything off and says what executive sessions can do right now', async () => {
    open();

    expect(await screen.findByRole('checkbox', { name: /post a public copy/i })).not.toBeChecked();
    expect(screen.getByTestId('executive-effective')).toHaveTextContent(
      'cannot be published to the library and cannot be posted publicly'
    );
  });

  it('reports the server’s effective result, not the switches alone', async () => {
    mockGet.mockResolvedValue({
      ...off,
      public_posting: true,
      executive_library_publishing: true,
      executive_public_posting: false,
      executive_effective_library: true,
      executive_effective_public: false,
    });
    open();

    await screen.findByRole('checkbox', { name: /post a public copy/i });
    expect(screen.getByTestId('executive-effective')).toHaveTextContent(
      'can be published to the library and cannot be posted publicly'
    );
  });

  it('saves every switch and re-reads what the server holds', async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('checkbox', { name: /post a public copy/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: { public_posting: true, executive_library_publishing: false, executive_public_posting: false },
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the public executive switch unavailable until the library one is on', async () => {
    const user = userEvent.setup();
    open();

    const publicExecutive = await screen.findByRole('checkbox', { name: /posting them on the public minutes page/i });
    expect(publicExecutive).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /allow publishing to the library/i }));
    expect(publicExecutive).toBeEnabled();
  });

  it('asks before allowing executive-session minutes on the public page, and saves nothing on a no', async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue(false);
    mockGet.mockResolvedValue({ ...off, public_posting: true });
    open();

    await user.click(await screen.findByRole('checkbox', { name: /allow publishing to the library/i }));
    await user.click(screen.getByRole('checkbox', { name: /posting them on the public minutes page/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves after a yes to the executive public warning', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ ...off, public_posting: true });
    open();

    await user.click(await screen.findByRole('checkbox', { name: /allow publishing to the library/i }));
    await user.click(screen.getByRole('checkbox', { name: /posting them on the public minutes page/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: { public_posting: true, executive_library_publishing: true, executive_public_posting: true },
    });
  });

  it('is read-only without the settings permission', async () => {
    authState.checkPermission = () => false;
    open();

    expect(await screen.findByRole('checkbox', { name: /post a public copy/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
