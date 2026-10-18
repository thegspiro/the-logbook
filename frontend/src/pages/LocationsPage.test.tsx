import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getLocations = vi.fn();
const getSettings = vi.fn();
const updateLocation = vi.fn();
const createLocation = vi.fn();
const mockToastError = vi.fn();
let permissions: string[] = [];

vi.mock('../services/api', () => ({
  locationsService: {
    getLocations: (...args: unknown[]) => getLocations(...args) as unknown,
    updateLocation: (...args: unknown[]) => updateLocation(...args) as unknown,
    createLocation: (...args: unknown[]) => createLocation(...args) as unknown,
  },
  organizationService: {
    getSettings: (...args: unknown[]) => getSettings(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]): void => {
      mockToastError(...args);
    },
    success: vi.fn(),
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
  floor: '2',
  capacity: 30,
  description: 'Projector on the north wall',
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
    updateLocation.mockReset();
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

describe('LocationsPage editors clear fields on update', () => {
  beforeEach(() => {
    permissions = ['locations.manage'];
    getLocations.mockReset();
    getSettings.mockReset();
    updateLocation.mockReset();
    getLocations.mockResolvedValue([{ ...station, description: 'Main firehouse' }, room]);
    getSettings.mockResolvedValue({ station_mode: null });
    updateLocation.mockResolvedValue({});
  });

  it('sends null for every station field the user emptied', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit station' }));

    for (const label of ['City', 'State', 'Zip', 'Description']) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(updateLocation).toHaveBeenCalledTimes(1));
    expect(updateLocation).toHaveBeenCalledWith('st-1', {
      name: 'Station 1',
      address: '100 Main Street',
      city: null,
      state: null,
      zip: null,
      description: null,
    });
  });

  it('refuses to clear a station address, which would hide the station and its rooms', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit station' }));

    await user.clear(screen.getByLabelText(/^Street Address/));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(updateLocation).not.toHaveBeenCalled();
  });

  it('sends null for every room field the user emptied', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await openStation();
    await user.click(screen.getByRole('button', { name: 'Edit room' }));

    for (const label of ['Room Number', 'Floor', 'Capacity', 'Description']) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(updateLocation).toHaveBeenCalledTimes(1));
    expect(updateLocation).toHaveBeenCalledWith('rm-1', {
      name: 'Training Room A',
      building: 'Station 1',
      room_number: null,
      floor: null,
      capacity: null,
      description: null,
    });
  });
});

/** The shape an axios rejection carrying a FastAPI `detail` arrives in. */
const serverError = (detail: string) =>
  Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    response: { status: 400, data: { detail } },
  });

describe('LocationsPage create validation', () => {
  beforeEach(() => {
    permissions = ['locations.manage'];
    getLocations.mockReset();
    getSettings.mockReset();
    updateLocation.mockReset();
    createLocation.mockReset();
    mockToastError.mockReset();
    getLocations.mockResolvedValue([station, room]);
    getSettings.mockResolvedValue({ station_mode: 'multi_station' });
    updateLocation.mockResolvedValue({});
    createLocation.mockResolvedValue({ id: 'new-1' });
  });

  it('will not add a station without a street address', async () => {
    // groupLocations treats only an addressed location as a station, so one
    // created without an address lost its rooms from the page.
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await user.click(await screen.findByRole('button', { name: /Add Station/ }));

    const dialog = screen.getByRole('dialog', { name: 'Add Station' });
    await user.type(within(dialog).getByLabelText('Station Name / Number *'), 'Station 2');
    await user.click(within(dialog).getByRole('button', { name: 'Add Station' }));

    expect(mockToastError).toHaveBeenCalledWith('A station needs a street address');
    expect(createLocation).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Street Address *'), '200 Oak Avenue');
    await user.click(within(dialog).getByRole('button', { name: 'Add Station' }));

    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(1));
    expect(createLocation.mock.calls[0]?.[0]).toMatchObject({ name: 'Station 2', address: '200 Oak Avenue' });
  });

  it('refuses a room capacity of 0, which the server rejects', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await openStation();
    await user.click(screen.getByRole('button', { name: 'Edit room' }));

    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(mockToastError).toHaveBeenCalledWith('Capacity must be a whole number of at least 1, or left blank');
    expect(updateLocation).not.toHaveBeenCalled();
  });
});

describe('LocationsPage setup wizard', () => {
  beforeEach(() => {
    permissions = ['locations.manage'];
    getLocations.mockReset();
    getSettings.mockReset();
    createLocation.mockReset();
    mockToastError.mockReset();
    // No locations yet, so the wizard opens itself, on the stations step
    // because the mode is already chosen.
    getLocations.mockResolvedValue([]);
    getSettings.mockResolvedValue({ station_mode: 'multi_station' });
    createLocation.mockResolvedValue({ id: 'new-1' });
  });

  const fillStation = async (user: ReturnType<typeof userEvent.setup>, idx: number, name: string, address: string) => {
    const nameBox = screen.getAllByLabelText('Station Name / Number *')[idx];
    const addressBox = screen.getAllByLabelText('Street Address *')[idx];
    if (!nameBox || !addressBox) throw new Error(`station ${idx} is not on screen`);
    await user.type(nameBox, name);
    await user.type(addressBox, address);
  };

  it('will not save a station without a street address', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await screen.findByRole('button', { name: /Continue to Rooms/ });

    await user.type(screen.getByLabelText('Station Name / Number *'), 'Station 1');
    await user.click(screen.getByRole('button', { name: /Continue to Rooms/ }));

    expect(mockToastError).toHaveBeenCalledWith('Every station needs a street address');
    expect(createLocation).not.toHaveBeenCalled();
  });

  it('keeps the stations that saved, shows the server error, and retries only the rest', async () => {
    createLocation
      .mockResolvedValueOnce({ id: 'st-a' })
      .mockRejectedValueOnce(serverError('A location named "Station 2" already exists'));
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await screen.findByRole('button', { name: /Continue to Rooms/ });

    await user.click(screen.getByRole('button', { name: /Add Another Station/ }));
    await fillStation(user, 0, 'Station 1', '100 Main Street');
    await fillStation(user, 1, 'Station 2', '200 Oak Avenue');
    await user.click(screen.getByRole('button', { name: /Continue to Rooms/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('A location named "Station 2" already exists'));
    expect(createLocation).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: /Continue to Rooms/ }));

    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(3));
    expect(createLocation.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      'Station 1',
      'Station 2',
      'Station 2',
    ]);
  });

  it('refuses a room capacity of 0, and retries only the rooms that did not save', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LocationsPage />);
    await screen.findByRole('button', { name: /Continue to Rooms/ });
    await fillStation(user, 0, 'Station 1', '100 Main Street');
    await user.click(screen.getByRole('button', { name: /Continue to Rooms/ }));
    await screen.findByLabelText('Room Name *');

    await user.type(screen.getByLabelText('Room Name *'), 'Kitchen');
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: /^Add Room$/ }));
    expect(mockToastError).toHaveBeenCalledWith('Capacity must be a whole number of at least 1, or left blank');
    expect(screen.queryByText('Rooms added (1)')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: /^Add Room$/ }));
    await user.type(screen.getByLabelText('Room Name *'), 'Gym');
    await user.click(screen.getByRole('button', { name: /^Add Room$/ }));
    expect(screen.getByText('Rooms added (2)')).toBeInTheDocument();

    createLocation.mockReset();
    createLocation.mockResolvedValueOnce({ id: 'rm-a' }).mockRejectedValueOnce(serverError('Room name is too long'));
    await user.click(screen.getByRole('button', { name: /Save Rooms & Finish/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Room name is too long'));
    expect(createLocation).toHaveBeenCalledTimes(2);

    createLocation.mockResolvedValue({ id: 'rm-b' });
    await user.click(screen.getByRole('button', { name: /Save Rooms & Finish/ }));

    await waitFor(() => expect(createLocation).toHaveBeenCalledTimes(3));
    expect(createLocation.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      'Kitchen',
      'Gym',
      'Gym',
    ]);
    expect(createLocation.mock.calls[0]?.[0]).not.toHaveProperty('capacity');
  });
});
