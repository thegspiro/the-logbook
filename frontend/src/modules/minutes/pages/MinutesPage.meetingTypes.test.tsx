/**
 * W51-4: a meeting record now accepts all eight meeting types, so the create
 * form offers Executive, Trustee and Annual and sends the chosen one as is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockCreateMeeting = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  meetingsService: {
    getMeetings: (...a: unknown[]) => mockGetMeetings(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
    createMeeting: (...a: unknown[]) => mockCreateMeeting(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    createFromMeeting: vi.fn(),
    listAllMinutes: () => Promise.resolve([]),
    getStats: () => Promise.resolve({ total: 0, this_month: 0, open_action_items: 0, pending_approval: 0 }),
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: () => true, user: undefined };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import MinutesPage from './MinutesPage';
import { renderWithRouter } from '../../../test/utils';

describe('MinutesPage — meeting types', () => {
  beforeEach(() => {
    mockGetMeetings.mockReset();
    mockGetSummary.mockReset();
    mockCreateMeeting.mockReset();
    mockGetMeetings.mockResolvedValue({ meetings: [], total: 0 });
    mockGetSummary.mockResolvedValue({});
    mockCreateMeeting.mockResolvedValue({ id: 'm1' });
  });

  it('links a meetings manager to the attendance dashboard', async () => {
    renderWithRouter(<MinutesPage />);

    expect(await screen.findByRole('link', { name: /Attendance/ })).toHaveAttribute('href', '/minutes/attendance');
  });

  it('offers and sends an executive meeting', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: /Record First Minutes/i }));
    const typeSelect = screen.getByLabelText('Meeting Type');
    const offered = Array.from((typeSelect as HTMLSelectElement).options).map((o) => o.value);
    expect(offered).toEqual(['business', 'special', 'committee', 'board', 'trustee', 'executive', 'annual', 'other']);

    await user.type(screen.getByLabelText(/Meeting Title/), 'Closed session');
    await user.selectOptions(typeSelect, 'executive');
    fireEvent.change(screen.getByLabelText(/Meeting Date/), { target: { value: '2026-10-01' } });
    await user.click(screen.getByRole('button', { name: /Start Recording/i }));

    expect(mockCreateMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Closed session', meeting_type: 'executive' })
    );
  });

  it('puts a server refusal on the field it names and creates nothing', async () => {
    const user = userEvent.setup();
    mockCreateMeeting.mockReset();
    mockCreateMeeting.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ field: 'location', message: 'String should have at most 255 characters' }] },
      },
    });
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: /Record First Minutes/i }));
    fireEvent.change(screen.getByLabelText(/Meeting Date/), { target: { value: '2026-10-01' } });
    // Enter in a field submits: the dialog is a real form (forms review F-7).
    await user.type(screen.getByLabelText(/Meeting Title/), 'Business meeting{Enter}');

    const location = screen.getByLabelText('Location');
    await waitFor(() =>
      expect(location).toHaveAccessibleDescription('Location is too long — keep it to 255 characters.')
    );
    expect(location).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/location:/)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Record Meeting Minutes' })).toBeInTheDocument();
  });

  it('asks before Escape discards a half-filled meeting', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: /Record First Minutes/i }));
    await user.type(screen.getByLabelText(/Meeting Title/), 'Business meeting');
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Record Meeting Minutes' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Meeting Title/)).toHaveValue('Business meeting');
  });
});
