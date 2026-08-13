import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';

const mockGetLocations = vi.fn();

vi.mock('../services/api', () => ({
  locationsService: {
    getLocations: (...args: unknown[]) => mockGetLocations(...args) as unknown,
  },
}));

// Must import after mocks
import RoomQRCodesPage from './RoomQRCodesPage';
import { groupByStation } from '../utils/locationGrouping';
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
  return render(
    <BrowserRouter>
      <RoomQRCodesPage />
    </BrowserRouter>
  );
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
    expect(screen.getByRole('heading', { name: 'Other Locations' })).toBeInTheDocument();
    expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    // Location without a display code has no card
    expect(screen.queryByText('Supply Closet')).not.toBeInTheDocument();
    // Kiosk URLs are shown for copying/verification
    expect(screen.getByText(`${window.location.origin}/display/ROOM1CODE`)).toBeInTheDocument();
  });

  it('shows an empty state when no locations have display codes', async () => {
    mockGetLocations.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No QR codes yet')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Set Up Locations' })).toHaveAttribute('href', '/locations');
  });
});
