import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getLocations = vi.fn();
const getSettings = vi.fn();
let permissions: string[] = [];

vi.mock('../services/api', () => ({
  locationsService: {
    getLocations: (...args: unknown[]) => getLocations(...args) as unknown,
  },
  organizationService: {
    getSettings: (...args: unknown[]) => getSettings(...args) as unknown,
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => permissions.includes(p) }),
}));

import LocationsPage from './LocationsPage';

const station = {
  id: 'st-1',
  organization_id: 'org-1',
  name: 'Station 1',
  address: '100 Main Street',
  city: 'Springfield',
  state: 'IL',
  zip: '62701',
  is_active: true,
};
const room = {
  id: 'rm-1',
  organization_id: 'org-1',
  name: 'Training Room A',
  building: 'Station 1',
  room_number: '101',
  is_active: true,
  display_code: null,
};

const openStation = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /1 room/ }));
  await screen.findByText('Training Room A #101');
};

describe('LocationsPage controls', () => {
  beforeEach(() => {
    getLocations.mockReset();
    getSettings.mockReset();
    getLocations.mockResolvedValue([station, room]);
    getSettings.mockResolvedValue({ station_mode: null });
  });

  it('offers a member no control the server would refuse', async () => {
    permissions = [];
    renderWithRouter(<LocationsPage />);
    await openStation();

    expect(screen.queryByRole('button', { name: /Add Station/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set Single-Station' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Setup Wizard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit station' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete station' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Room/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete room' })).not.toBeInTheDocument();
  });

  it('offers a location manager the location controls, and station mode only with settings access', async () => {
    permissions = ['locations.manage'];
    renderWithRouter(<LocationsPage />);
    await openStation();

    expect(screen.getByRole('button', { name: /Add Station/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit station' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete station' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Room/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete room' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set Single-Station' })).not.toBeInTheDocument();
  });

  it('offers station mode to someone who can change settings', async () => {
    permissions = ['settings.manage'];
    renderWithRouter(<LocationsPage />);
    await openStation();

    expect(screen.getByRole('button', { name: 'Set Single-Station' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Station/ })).not.toBeInTheDocument();
  });
});
