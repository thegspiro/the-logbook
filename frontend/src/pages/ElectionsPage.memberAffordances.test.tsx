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
  electionService: {
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

  it('leaves the panel blank for a member when no elections exist', async () => {
    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^All/ })).toBeInTheDocument();
    });
    expect(screen.queryByText('No elections found')).not.toBeInTheDocument();
    expect(screen.queryByText('No elections have been created yet.')).not.toBeInTheDocument();
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

    expect(await screen.findByText('No elections found')).toBeInTheDocument();
    expect(screen.getByText('Get started by creating your first election.')).toBeInTheDocument();
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

  it('requests create-dialog support data for a secretary', async () => {
    mockCanManage = true;

    renderWithRouter(<ElectionsPage />);

    await waitFor(() => {
      expect(mockGetMeetings).toHaveBeenCalled();
    });
    expect(mockGetRanks).toHaveBeenCalled();
  });
});
