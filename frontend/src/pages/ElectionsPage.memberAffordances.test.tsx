import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockGetMeetings = vi.fn();
const mockGetEvents = vi.fn();
const mockGetRanks = vi.fn();
let mockCanManage = false;

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    // The create dialog counts who its voter rules admit.
    previewElectorate: vi.fn().mockResolvedValue({ eligible: 0, total: 0 }),
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getSettings: vi.fn().mockResolvedValue({ reminders_enabled: true, auto_open_enabled: true }),
  },
  eventService: { getEvents: (...args: unknown[]) => mockGetEvents(...args) as unknown },
  meetingsService: { getMeetings: (...args: unknown[]) => mockGetMeetings(...args) as unknown },
  ranksService: { getRanks: (...args: unknown[]) => mockGetRanks(...args) as unknown },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: [] },
    checkPermission: () => mockCanManage,
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

describe('ElectionsPage member affordances', () => {
  beforeEach(() => {
    // The status filter lives in ?status= (W50-76), and BrowserRouter keeps
    // jsdom's URL between tests, so a filter clicked in one test would
    // otherwise narrow the next one's list.
    window.history.replaceState(null, '', '/elections');
    mockCanManage = false;
    mockGetElections.mockReset();
    mockGetElections.mockResolvedValue([]);
    mockGetMeetings.mockReset();
    mockGetMeetings.mockResolvedValue({ meetings: [] });
    mockGetEvents.mockReset();
    mockGetEvents.mockResolvedValue([]);
    mockGetRanks.mockReset();
    mockGetRanks.mockResolvedValue([]);
  });

  // A blank panel read as a broken page on a fresh install. The member's copy
  // says where a vote turns up, and never points at Create Election.
  it('tells a member where a vote will appear when no elections exist', async () => {
    renderWithRouter(<ElectionsPage />);

    // An h2 under the page's h1: the sweep runs as a member, and an h3 here
    // tripped axe heading-order once this panel started rendering for them.
    expect(await screen.findByRole('heading', { level: 2, name: 'No elections yet' })).toBeInTheDocument();
    expect(screen.getByText(/When your department opens a vote, it appears here/)).toBeInTheDocument();
    expect(screen.queryByText(/Create an election, add the candidates/)).not.toBeInTheDocument();
  });

  it('still reports an empty result to a member when a status filter narrows the list', async () => {
    mockGetElections.mockResolvedValue([election('e1', 'open', 'Line Officer Election')]);

    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Closed/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /^Closed/ }));

    expect(await screen.findByText('No elections found')).toBeInTheDocument();
    expect(screen.getByText('No closed elections. Try a different filter.')).toBeInTheDocument();
  });

  it('shows a secretary the create prompt on an empty roster', async () => {
    mockCanManage = true;

    renderWithRouter(<ElectionsPage />);

    expect(await screen.findByText('No elections yet')).toBeInTheDocument();
    expect(screen.getByText(/Create an election, add the candidates, then open voting/)).toBeInTheDocument();
  });

  it('does not request create-dialog support data for a member', async () => {
    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(mockGetElections).toHaveBeenCalled();
    });
    expect(mockGetMeetings).not.toHaveBeenCalled();
    expect(mockGetEvents).not.toHaveBeenCalled();
    expect(mockGetRanks).not.toHaveBeenCalled();
  });

  it('closes an open create dialog if the manage permission is revoked', async () => {
    mockCanManage = true;

    const { rerender } = renderWithRouter(<ElectionsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create Election' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create New Election')).toBeInTheDocument();

    mockCanManage = false;
    rerender(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create Election' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Create New Election')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the settings link in the header for a secretary', async () => {
    mockCanManage = true;

    renderWithRouter(<ElectionsPage />);

    const settings = await screen.findByRole('link', { name: 'Election Settings' });
    expect(settings).toHaveAttribute('href', '/elections/settings');
    expect(settings).toHaveTextContent('Election Settings');
  });

  it('does not offer the settings link to a member', async () => {
    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(mockGetElections).toHaveBeenCalled();
    });
    expect(screen.queryByRole('link', { name: 'Election Settings' })).not.toBeInTheDocument();
  });

  it('requests create-dialog support data for a secretary', async () => {
    mockCanManage = true;

    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(mockGetMeetings).toHaveBeenCalled();
    });
    expect(mockGetRanks).toHaveBeenCalled();
  });
});
