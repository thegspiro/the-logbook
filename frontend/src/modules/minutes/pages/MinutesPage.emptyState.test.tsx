/**
 * The Minutes page's empty state sold the feature to people who cannot use it.
 *
 * With no meetings recorded, the page rendered three cards pitching what
 * recording minutes gets you — templates, action items, archives — and a card
 * telling the reader to "Start recording meeting minutes". Creating minutes is
 * `minutes.manage`-gated on the server, and the buttons beside that copy were
 * already withheld, so a member read an advertisement for a feature they have
 * no way to reach.
 *
 * The emptiness itself is still reported to everyone: a member opened this
 * page and deserves the answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../services/api', () => ({
  meetingsService: {
    getMeetings: (...a: unknown[]) => mockGetMeetings(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    createFromMeeting: vi.fn(),
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = {
    checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean,
    user: undefined,
  };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import MinutesPage from './MinutesPage';
import { renderWithRouter } from '../../../test/utils';

const PITCH = /Structured templates for recording meeting minutes/i;
const INSTRUCTION = /Start recording meeting minutes/i;

describe('MinutesPage — empty state', () => {
  beforeEach(() => {
    // Reset rather than clear: what checkPermission returns is this file's
    // whole subject, and an implementation survives vi.clearAllMocks()
    // (CLAUDE.md pitfall #28).
    mockGetMeetings.mockReset();
    mockGetSummary.mockReset();
    mockCheckPermission.mockReset();
    mockGetMeetings.mockResolvedValue({ meetings: [], total: 0 });
    mockGetSummary.mockResolvedValue({});
    mockCheckPermission.mockReturnValue(false);
  });

  it('reports the emptiness to a member without pitching or instructing', async () => {
    renderWithRouter(<MinutesPage />);

    expect(await screen.findByText('No Meeting Minutes')).toBeInTheDocument();
    expect(screen.queryByText(PITCH)).not.toBeInTheDocument();
    expect(screen.queryByText(INSTRUCTION)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record First Minutes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record Minutes/i })).not.toBeInTheDocument();
  });

  it('keeps the pitch and the prompt for a minutes manager', async () => {
    mockCheckPermission.mockReturnValue(true);
    renderWithRouter(<MinutesPage />);

    expect(await screen.findByText('No Meeting Minutes')).toBeInTheDocument();
    expect(screen.getByText(PITCH)).toBeInTheDocument();
    expect(screen.getByText(INSTRUCTION)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record First Minutes/i })).toBeInTheDocument();
  });

  it('does not leave the create dialog open when minutes.manage is revoked', async () => {
    const user = userEvent.setup();
    mockCheckPermission.mockReturnValue(true);
    const { rerender } = renderWithRouter(<MinutesPage />);

    await screen.findByText('No Meeting Minutes');
    await user.click(screen.getByRole('button', { name: /Record First Minutes/i }));
    expect(await screen.findByText('Record Meeting Minutes')).toBeInTheDocument();

    // The form only ever posts a minutes.manage-gated create.
    mockCheckPermission.mockReturnValue(false);
    rerender(<MinutesPage />);

    await waitFor(() => expect(screen.queryByText('Record Meeting Minutes')).not.toBeInTheDocument());
  });
});
