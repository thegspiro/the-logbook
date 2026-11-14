import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    // The create dialog counts who its voter rules admit.
    previewElectorate: vi.fn().mockResolvedValue({ eligible: 0, total: 0 }),
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElectionSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue([]) },
  ranksService: { getRanks: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: [] },
    checkPermission: () => false,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

function election(id: string, status: string, title: string) {
  return {
    id,
    title,
    status,
    start_date: '2026-08-11T00:00:00Z',
    end_date: '2026-08-17T00:00:00Z',
    positions: [],
  };
}

describe('ElectionsPage status filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a filter for every lifecycle status, including nominations', async () => {
    mockGetElections.mockResolvedValue([
      election('e1', 'draft', 'Bylaw Amendment Vote'),
      election('e2', 'nominations', 'Annual Officer Elections'),
      election('e3', 'open', 'Line Officer Election'),
      election('e4', 'closed', 'Assistant Chief Special Election'),
    ]);

    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Nominations/ })).toBeInTheDocument();
    });
    for (const label of ['All', 'Draft', 'Nominations', 'Open', 'Closed']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it('filters the list down to the nominations election', async () => {
    mockGetElections.mockResolvedValue([
      election('e1', 'draft', 'Bylaw Amendment Vote'),
      election('e2', 'nominations', 'Annual Officer Elections'),
    ]);

    const user = userEvent.setup();
    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Bylaw Amendment Vote')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^Nominations/ }));

    expect(screen.getByText('Annual Officer Elections')).toBeInTheDocument();
    expect(screen.queryByText('Bylaw Amendment Vote')).not.toBeInTheDocument();
  });

  it('hides the cancelled filter until there is a cancelled election', async () => {
    mockGetElections.mockResolvedValue([election('e1', 'draft', 'Bylaw Amendment Vote')]);

    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Draft/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^Cancelled/ })).not.toBeInTheDocument();
  });

  it('offers the cancelled filter once one exists, so it is not reachable only via All', async () => {
    mockGetElections.mockResolvedValue([
      election('e1', 'draft', 'Bylaw Amendment Vote'),
      election('e2', 'cancelled', 'Abandoned Special Election'),
    ]);

    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Cancelled/ })).toBeInTheDocument();
    });
  });

  // W50-76: the filter is in the URL, so a reload or a shared link keeps it.
  it('keeps the chosen filter across a reload, from the URL', async () => {
    mockGetElections.mockResolvedValue([
      election('e1', 'draft', 'Bylaw Amendment Vote'),
      election('e3', 'open', 'Line Officer Election'),
    ]);
    window.history.pushState({}, '', '/elections?status=open');

    renderWithRouter(<ElectionsPage />);

    expect(await screen.findByText('Line Officer Election')).toBeInTheDocument();
    expect(screen.queryByText('Bylaw Amendment Vote')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Draft/ }));
    expect(window.location.search).toBe('?status=draft');
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(window.location.search).toBe('');
    window.history.pushState({}, '', '/');
  });

  it('ignores a status in the URL that is not a real one', async () => {
    mockGetElections.mockResolvedValue([election('e1', 'draft', 'Bylaw Amendment Vote')]);
    window.history.pushState({}, '', '/elections?status=bogus');

    renderWithRouter(<ElectionsPage />);

    expect(await screen.findByText('Bylaw Amendment Vote')).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
});
