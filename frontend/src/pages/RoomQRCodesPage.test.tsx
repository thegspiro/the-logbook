import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetLocations = vi.fn();
const mockRegenerateDisplayCode = vi.fn();

vi.mock('../services/api', () => ({
  locationsService: {
    getLocations: (...args: unknown[]) => mockGetLocations(...args) as unknown,
    regenerateDisplayCode: (...args: unknown[]) => mockRegenerateDisplayCode(...args) as unknown,
  },
}));

// Must import after mocks
import RoomQRCodesPage from './RoomQRCodesPage';
import { groupByStation } from '../utils/locationGrouping';
import { renderWithRouter } from '../test/utils';
import { useAuthStore } from '../stores/authStore';
import type { Location } from '../services/api';

const baseLocation = {
  organization_id: 'org-1',
  is_active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockLocations: Location[] = [
  {
    ...baseLocation,
    id: 'station-1',
    name: 'Station 1',
    address: '123 Main St',
    display_code: 'STAT1CODE',
  },
  {
    ...baseLocation,
    id: 'room-1',
    name: 'Training Room',
    building: 'Station 1',
    room_number: '101',
    display_code: 'ROOM1CODE',
  },
  {
    ...baseLocation,
    id: 'room-2',
    name: 'Meeting Room',
    building: 'Station 1',
    display_code: 'ROOM2CODE',
  },
  // No display code — must not render a card
  {
    ...baseLocation,
    id: 'room-3',
    name: 'Supply Closet',
    building: 'Station 1',
  },
  // Standalone room with no building — grouped under "Other Locations"
  {
    ...baseLocation,
    id: 'room-4',
    name: 'Annex Hall',
    display_code: 'ANNEXCODE',
  },
];

function renderPage() {
  return renderWithRouter(<RoomQRCodesPage />);
}

describe('groupByStation', () => {
  it('groups rooms under their station and drops locations without codes', () => {
    const groups = groupByStation(mockLocations);
    const station1 = groups.find((g) => g.name === 'Station 1');
    expect(station1).toBeDefined();
    // Station's own code first, then its rooms; no-code room excluded
    expect(station1?.locations.map((l) => l.id)).toEqual(['station-1', 'room-1', 'room-2']);
    const other = groups.find((g) => g.name === 'Other Locations');
    expect(other?.locations.map((l) => l.id)).toEqual(['room-4']);
  });

  it('returns no groups when nothing has a display code', () => {
    expect(groupByStation([{ ...baseLocation, id: 'x', name: 'No Code Room' }])).toEqual([]);
  });
});

describe('RoomQRCodesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    mockGetLocations.mockResolvedValue(mockLocations);
  });

  it('renders grouped QR cards for every location with a display code', async () => {
    renderPage();

    await waitFor(() => {
      // level 2 = the group heading; the station's own card repeats the name at level 3
      expect(screen.getByRole('heading', { level: 2, name: 'Station 1' })).toBeInTheDocument();
    });

    expect(mockGetLocations).toHaveBeenCalledWith({ is_active: true });
    expect(screen.getByText('Training Room #101')).toBeInTheDocument();
    expect(screen.getByText('Meeting Room')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Other Locations' })).toBeInTheDocument();
    expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    // Location without a display code has no card
    expect(screen.queryByText('Supply Closet')).not.toBeInTheDocument();
    // Kiosk URLs are shown for copying/verification
    expect(screen.getByText(`${window.location.origin}/display/ROOM1CODE`)).toBeInTheDocument();
    // Every card offers a PNG download
    expect(screen.getAllByRole('button', { name: /Download PNG/ })).toHaveLength(4);
  });

  it('shows an empty state when no locations have display codes', async () => {
    mockGetLocations.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No QR codes yet')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Set Up Locations' })).toHaveAttribute('href', '/locations');
  });

  it('hides the regenerate action without locations edit permission', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Station 1' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument();
  });

  it('regenerates a display code after confirmation', async () => {
    useAuthStore.setState({ user: { permissions: ['locations.manage'] } as never });
    const annexHall = { ...baseLocation, id: 'room-4', name: 'Annex Hall', display_code: 'ANNEXCODE' };
    mockGetLocations.mockResolvedValue([annexHall]);
    mockRegenerateDisplayCode.mockResolvedValue({ ...annexHall, display_code: 'NEWCODE99' });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Regenerate/ }));

    // Confirm dialog warns that the old code stops working
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/stop working immediately/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }));

    await waitFor(() => {
      expect(mockRegenerateDisplayCode).toHaveBeenCalledWith('room-4');
    });
    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/display/NEWCODE99`)).toBeInTheDocument();
    });
    expect(screen.queryByText(`${window.location.origin}/display/ANNEXCODE`)).not.toBeInTheDocument();
  });

  it('does not regenerate when the confirmation is cancelled', async () => {
    useAuthStore.setState({ user: { permissions: ['locations.edit'] } as never });
    mockGetLocations.mockResolvedValue([
      { ...baseLocation, id: 'room-4', name: 'Annex Hall', display_code: 'ANNEXCODE' },
    ]);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Regenerate/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep current code' }));

    expect(mockRegenerateDisplayCode).not.toHaveBeenCalled();
  });
});
