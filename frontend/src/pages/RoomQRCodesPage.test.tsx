import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetLocations = vi.fn();
const mockRegenerateDisplayCode = vi.fn();
const mockGetEnabledModules = vi.fn();
const mockGetApparatusList = vi.fn();

vi.mock('../services/api', () => ({
  locationsService: {
    getLocations: (...args: unknown[]) => mockGetLocations(...args) as unknown,
    regenerateDisplayCode: (...args: unknown[]) => mockRegenerateDisplayCode(...args) as unknown,
  },
  organizationService: {
    getEnabledModules: (...args: unknown[]) => mockGetEnabledModules(...args) as unknown,
  },
}));

vi.mock('../modules/apparatus/services/api', () => ({
  apparatusService: {
    getApparatusList: (...args: unknown[]) => mockGetApparatusList(...args) as unknown,
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

const mockApparatus = {
  items: [
    { id: 'app-1', unitNumber: 'E-3', name: 'Engine 3' },
    { id: 'app-2', unitNumber: 'T-1', name: null },
  ],
  total: 2,
  page: 1,
  pageSize: 100,
  totalPages: 1,
};

describe('RoomQRCodesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    mockGetLocations.mockResolvedValue(mockLocations);
    // Configurable module list including scheduling — apparatus section eligible
    mockGetEnabledModules.mockResolvedValue({
      enabled_modules: ['members', 'events', 'documents', 'roles', 'settings', 'scheduling'],
    });
    mockGetApparatusList.mockResolvedValue(mockApparatus);
  });

  it('renders grouped QR cards for every location with a display code', async () => {
    renderPage();

    await waitFor(() => {
      // level 2 = the group heading; the station's own card repeats the name at level 3
      expect(screen.getByRole('heading', { level: 2, name: 'Station 1' })).toBeInTheDocument();
    });

    expect(mockGetLocations).toHaveBeenCalledWith({ is_active: true, skip: 0, limit: 100 });
    expect(screen.getByText('Training Room #101')).toBeInTheDocument();
    expect(screen.getByText('Meeting Room')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Other Locations' })).toBeInTheDocument();
    expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    // Location without a display code has no card
    expect(screen.queryByText('Supply Closet')).not.toBeInTheDocument();
    // Kiosk URLs are shown for copying/verification
    expect(screen.getByText(`${window.location.origin}/display/ROOM1CODE`)).toBeInTheDocument();
    // Every card offers a PNG download (4 locations + 2 apparatus)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Download PNG/ })).toHaveLength(6);
    });
  });

  it('pages through locations beyond the first 100', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      ...baseLocation,
      id: `loc-${i}`,
      name: `Room ${i}`,
      building: 'Station 1',
      display_code: `CODE${i}`,
    }));
    mockGetLocations
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([
        { ...baseLocation, id: 'loc-last', name: 'Last Room', building: 'Station 1', display_code: 'LASTCODE' },
      ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Last Room')).toBeInTheDocument();
    });
    expect(mockGetLocations).toHaveBeenCalledTimes(2);
    expect(mockGetLocations).toHaveBeenLastCalledWith({ is_active: true, skip: 100, limit: 100 });
  });

  it('renders apparatus shift check-in codes when scheduling is enabled', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Apparatus Shift Check-In' })).toBeInTheDocument();
    });
    expect(screen.getByText('E-3 — Engine 3')).toBeInTheDocument();
    expect(screen.getByText('T-1')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/scheduling/checkin?apparatus=app-1`)).toBeInTheDocument();
    // Permanent codes — no regenerate action on apparatus cards even for admins
    useAuthStore.setState({ user: { permissions: ['locations.manage'] } as never });
    expect(mockGetApparatusList).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
  });

  it('hides the apparatus section when the scheduling module is off', async () => {
    mockGetEnabledModules.mockResolvedValue({
      enabled_modules: ['members', 'events', 'documents', 'roles', 'settings', 'facilities'],
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Station 1' })).toBeInTheDocument();
    });
    // The modules hook is permissive while loading, so the section may flash;
    // once the module list resolves without scheduling it must be gone.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 2, name: 'Apparatus Shift Check-In' })).not.toBeInTheDocument();
    });
  });

  it('hides the apparatus section when the apparatus list is not accessible', async () => {
    mockGetApparatusList.mockRejectedValue(new Error('403'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Station 1' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { level: 2, name: 'Apparatus Shift Check-In' })).not.toBeInTheDocument();
  });

  it('filters cards by search query', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    });

    await user.type(screen.getByRole('textbox', { name: 'Search rooms or apparatus...' }), 'training');

    expect(screen.getByText('Training Room #101')).toBeInTheDocument();
    expect(screen.queryByText('Annex Hall')).not.toBeInTheDocument();
    expect(screen.queryByText('Meeting Room')).not.toBeInTheDocument();
    expect(screen.queryByText('E-3 — Engine 3')).not.toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Search rooms or apparatus...' }));
    await user.type(screen.getByRole('textbox', { name: 'Search rooms or apparatus...' }), 'engine');

    // Apparatus are searchable by unit number and name
    expect(screen.getByText('E-3 — Engine 3')).toBeInTheDocument();
    expect(screen.queryByText('Training Room #101')).not.toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Search rooms or apparatus...' }));
    await user.type(screen.getByRole('textbox', { name: 'Search rooms or apparatus...' }), 'zzz-no-match');

    expect(screen.getByText('Nothing matches your search')).toBeInTheDocument();
    // Not the "no codes yet" empty state — codes exist, the search just excluded them
    expect(screen.queryByText('No QR codes yet')).not.toBeInTheDocument();
  });

  it('switches to full-page room signs layout', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('E-3 — Engine 3')).toBeInTheDocument();
    });
    // Grid mode groups by station; signs mode is a flat list with a per-sign scan hint
    expect(screen.getByRole('heading', { level: 2, name: 'Station 1' })).toBeInTheDocument();
    expect(screen.queryByText(/Scan to check in/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Room signs/ }));

    expect(screen.queryByRole('heading', { level: 2, name: 'Station 1' })).not.toBeInTheDocument();
    // One sign per code: 4 locations + 2 apparatus in the fixtures
    expect(screen.getAllByText(/Scan to check in/)).toHaveLength(6);
    expect(screen.getByText('Annex Hall')).toBeInTheDocument();
    expect(screen.getByText('E-3 — Engine 3')).toBeInTheDocument();
  });

  it('shows an empty state when no locations have display codes', async () => {
    mockGetLocations.mockResolvedValue([]);
    mockGetApparatusList.mockResolvedValue({ ...mockApparatus, items: [], total: 0, totalPages: 1 });
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
