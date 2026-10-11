/**
 * W51-4: a meeting record now accepts all eight meeting types, so the create
 * form offers Executive, Trustee and Annual and sends the chosen one as is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockCreateMeeting = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../services/api', () => ({
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
});
