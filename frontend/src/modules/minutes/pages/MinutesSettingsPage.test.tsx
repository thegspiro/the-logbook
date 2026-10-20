import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { render } from '@testing-library/react';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const authState = { checkPermission: (_p: string) => true };

vi.mock('../services/api', () => ({
  minutesService: { getReminderSettings: (...a: unknown[]) => mockGet(...a) as unknown },
}));
vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
  roleService: { getRoles: () => Promise.resolve([]) },
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(true) }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MinutesSettingsPage from './MinutesSettingsPage';
import type { MinutesReminderSettings } from '../types/minutes';

const server: MinutesReminderSettings = {
  action_item_reminders: true,
  reminder_days_before_due: 3,
  overdue_repeat_days: 7,
  open_items_digest: true,
  signature_slots: [{ key: 'recording_secretary', title: 'Recording Secretary', position_slug: null }],
  public_posting: false,
  executive_library_publishing: false,
  executive_public_posting: false,
  executive_effective_library: false,
  executive_effective_public: false,
  attendance_listing: 'all',
  auto_file_election_results: true,
};

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;

const show = (path = '/minutes/settings') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/minutes/settings" element={<MinutesSettingsPage />} />
        <Route path="/minutes" element={<span>Minutes list</span>} />
      </Routes>
      <Where />
    </MemoryRouter>
  );

// The panels are lazy chunks; the default 1s is too tight when the hook runs
// this file beside twenty others.
configure({ asyncUtilTimeout: 5000 });

describe('MinutesSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockGet.mockResolvedValue(server);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    authState.checkPermission = () => true;
  });

  it('opens on attendance and reads the settings once for every section', async () => {
    show();

    expect(await screen.findByRole('radio', { name: /Everyone/ })).toBeChecked();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('shows the section the address names', async () => {
    show('/minutes/settings?tab=publishing');

    expect(await screen.findByRole('checkbox', { name: /post a public copy/i })).toBeInTheDocument();
  });

  it('falls back to attendance for a section that does not exist', async () => {
    show('/minutes/settings?tab=nonsense');

    expect(await screen.findByRole('radio', { name: /Everyone/ })).toBeInTheDocument();
  });

  it('moves between sections without reading the settings again', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('radio', { name: /Everyone/ });

    await user.click(screen.getByRole('button', { name: /Reminders/ }));

    expect(await screen.findByLabelText('First reminder, days before the due date')).toHaveValue(3);
    expect(screen.getByTestId('where')).toHaveTextContent('?tab=reminders');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('shows the signers the server holds', async () => {
    show('/minutes/settings?tab=signatures');

    expect(await screen.findByDisplayValue('Recording Secretary')).toBeInTheDocument();
  });

  it('offers the election filing section', async () => {
    show('/minutes/settings?tab=elections');

    expect(await screen.findByRole('checkbox', { name: /File election results/ })).toBeChecked();
  });

  it('re-reads what the server holds after a save', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('radio', { name: /Present only/ }));
    mockGet.mockResolvedValue({ ...server, attendance_listing: 'present' });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({ minutes: { attendance_listing: 'present' } });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('radio', { name: /Present only/ })).toBeChecked();
  });

  it('is read-only for someone without the settings permission', async () => {
    authState.checkPermission = (p: string) => p === 'minutes.manage';
    show();

    expect(await screen.findByRole('radio', { name: /Everyone/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('says why the settings could not be loaded', async () => {
    mockGet.mockRejectedValue(new Error('Forbidden'));
    show();

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });

  it('goes back to the minutes list', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Back to Minutes' }));

    expect(await screen.findByText('Minutes list')).toBeInTheDocument();
  });
});
