import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
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
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { AttendanceListingDialog } from './AttendanceListingDialog';

describe('AttendanceListingDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockGet.mockResolvedValue({ attendance_listing: 'all' });
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    authState.checkPermission = () => true;
  });

  const open = () => render(<AttendanceListingDialog isOpen onClose={onClose} />);

  it('shows what the server applies', async () => {
    mockGet.mockResolvedValue({ attendance_listing: 'present' });
    open();

    expect(await screen.findByRole('radio', { name: /Present only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Everyone/ })).not.toBeChecked();
  });

  it('offers nothing to save until the choice changes', async () => {
    open();

    await screen.findByRole('radio', { name: /Everyone/ });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the choice and re-reads what the server holds', async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('radio', { name: /Present only/ }));
    mockGet.mockResolvedValue({ attendance_listing: 'present' });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({ minutes: { attendance_listing: 'present' } });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('is read-only without the settings permission', async () => {
    authState.checkPermission = () => false;
    open();

    expect(await screen.findByRole('radio', { name: /Everyone/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('reports a load failure', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    open();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
