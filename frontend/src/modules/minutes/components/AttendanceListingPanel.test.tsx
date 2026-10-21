import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { AttendanceListingPanel } from './AttendanceListingPanel';
import type { AttendanceListing, MinutesReminderSettings } from '../types/minutes';

const settings = (listing: AttendanceListing): MinutesReminderSettings => ({
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
  attendance_listing: listing,
  auto_file_election_results: true,
});

describe('AttendanceListingPanel', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    onSaved.mockReset();
    onSaved.mockResolvedValue(undefined);
  });

  const open = (listing: AttendanceListing = 'all', canEdit = true) =>
    render(<AttendanceListingPanel settings={settings(listing)} canEdit={canEdit} onSaved={onSaved} />);

  it('shows what the server applies', () => {
    open('present');

    expect(screen.getByRole('radio', { name: /Present only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Everyone/ })).not.toBeChecked();
  });

  it('offers nothing to save until the choice changes', () => {
    open();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the choice and asks the page to re-read what the server holds', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('radio', { name: /Present only/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({ minutes: { attendance_listing: 'present' } });
    expect(onSaved).toHaveBeenCalled();
  });

  it('is read-only without the settings permission', () => {
    open('all', false);

    expect(screen.getByRole('radio', { name: /Everyone/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('does not report a save that failed', async () => {
    mockUpdate.mockRejectedValue(new Error('Nope'));
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('radio', { name: /Present only/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSaved).not.toHaveBeenCalled();
  });
});
