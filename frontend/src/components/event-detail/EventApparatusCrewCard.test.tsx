const mockGetBoard = vi.fn();
const mockClaim = vi.fn();
const mockRelease = vi.fn();
const mockAssign = vi.fn();
const mockRemovePlan = vi.fn();

vi.mock('../../services/api', () => ({
  apparatusEventService: {
    getCrewBoard: (...args: unknown[]) => mockGetBoard(...args) as unknown,
    claimSeat: (...args: unknown[]) => mockClaim(...args) as unknown,
    releaseSeat: (...args: unknown[]) => mockRelease(...args) as unknown,
    assignSeat: (...args: unknown[]) => mockAssign(...args) as unknown,
    removePlan: (...args: unknown[]) => mockRemovePlan(...args) as unknown,
    getAssignableMembers: () => Promise.resolve([]),
    getDriverCandidates: () => Promise.resolve(null),
    getEditorOptions: () => Promise.resolve({ apparatus: [], categories: [] }),
  },
}));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { nth, renderWithRouter } from '../../test/utils';
import { ApparatusEventEvocMode, ApparatusEventSeatType, type CrewBoard } from '../../types/apparatusEvent';
import EventApparatusCrewCard from './EventApparatusCrewCard';
import { seatLabels } from './apparatus-crew/seatLabels';

const FUTURE_START = new Date(Date.now() + 5 * 86_400_000).toISOString();
const FUTURE_END = new Date(Date.now() + 5 * 86_400_000 + 3 * 3_600_000).toISOString();

const board = (overrides: Partial<CrewBoard> = {}): CrewBoard => ({
  event_id: 'night-1',
  title: 'Santamobile 2026',
  event_type: 'public_education',
  start_datetime: FUTURE_START,
  end_datetime: FUTURE_END,
  location: 'Route A',
  is_cancelled: false,
  attendance_finalized: false,
  template_id: 'tpl-1',
  template_name: 'Santamobile — Full',
  evoc_mode: ApparatusEventEvocMode.ENFORCE,
  allow_self_signup: true,
  show_on_schedule: true,
  admin_hours_category_id: 'cat-1',
  admin_hours_category_name: 'Community Outreach',
  night_number: 1,
  night_count: 2,
  series: [
    { event_id: 'night-1', start_datetime: FUTURE_START, filled: 1, total: 4 },
    { event_id: 'night-2', start_datetime: FUTURE_END, filled: 0, total: 4 },
  ],
  units: [
    {
      id: 'unit-1',
      apparatus_id: 'engine-1',
      unit_number: 'E1',
      apparatus_name: null,
      required_evoc_level_name: 'EVOC 3',
      seats: [
        {
          id: 'seat-driver',
          name: 'Driver',
          seat_type: ApparatusEventSeatType.DRIVER,
          note: null,
          user_id: 'u-driver',
          user_name: 'J. Ramirez',
          assignment_method: 'self_signup',
          is_me: false,
          checked_in: false,
        },
        {
          id: 'seat-santa',
          name: 'Santa',
          seat_type: ApparatusEventSeatType.GENERAL,
          note: 'Suit is in the Station 1 closet',
          user_id: null,
          user_name: null,
          assignment_method: null,
          is_me: false,
          checked_in: false,
        },
        {
          id: 'seat-elf-1',
          name: 'Elf',
          seat_type: ApparatusEventSeatType.GENERAL,
          note: null,
          user_id: null,
          user_name: null,
          assignment_method: null,
          is_me: false,
          checked_in: false,
        },
        {
          id: 'seat-elf-2',
          name: 'Elf',
          seat_type: ApparatusEventSeatType.GENERAL,
          note: null,
          user_id: null,
          user_name: null,
          assignment_method: null,
          is_me: false,
          checked_in: false,
        },
      ],
    },
  ],
  my_seat_id: null,
  can_manage: false,
  can_sign_up: true,
  warnings: [],
  ...overrides,
});

describe('EventApparatusCrewCard', () => {
  beforeEach(() => {
    mockGetBoard.mockReset();
    mockClaim.mockReset();
    mockRelease.mockReset();
    mockAssign.mockReset();
    mockRemovePlan.mockReset();
  });

  it('renders nothing on an event that is not an apparatus night', async () => {
    mockGetBoard.mockRejectedValue(
      new AxiosError('Not found', 'ERR_BAD_REQUEST', undefined, undefined, { status: 404 } as AxiosResponse)
    );
    const { container } = renderWithRouter(<EventApparatusCrewCard eventId="plain" timezone="America/New_York" />);

    await waitFor(() => expect(mockGetBoard).toHaveBeenCalledWith('plain'));
    expect(container).toBeEmptyDOMElement();
  });

  it('numbers repeated seats and labels a lone one plainly', () => {
    expect([...seatLabels(nth(board().units, 0)).values()]).toEqual(['Driver', 'Santa', 'Elf 1', 'Elf 2']);
  });

  it('lets a member take an open seat', async () => {
    mockGetBoard.mockResolvedValue(board());
    mockClaim.mockResolvedValue(board({ my_seat_id: 'seat-santa' }));
    const user = userEvent.setup();
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    expect(await screen.findByText('Outreach · not a shift')).toBeInTheDocument();
    expect(screen.getByText('Night 1 of 2 · from “Santamobile — Full” · 1 of 4 seats filled')).toBeInTheDocument();
    const signUps = screen.getAllByRole('button', { name: /Sign me up/ });
    expect(signUps).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Assign/ })).not.toBeInTheDocument();

    await user.click(signUps[0] as HTMLElement);

    expect(mockClaim).toHaveBeenCalledWith('night-1', 'seat-santa');
  });

  it('offers no second seat to a member who already has one', async () => {
    mockGetBoard.mockResolvedValue(board({ my_seat_id: 'seat-driver' }));
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    await screen.findByText('Outreach · not a shift');
    expect(screen.queryByRole('button', { name: /Sign me up/ })).not.toBeInTheDocument();
  });

  it('gives a coordinator assignment and night editing', async () => {
    mockGetBoard.mockResolvedValue(board({ can_manage: true }));
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    await screen.findByText('Outreach · not a shift');
    expect(screen.getAllByRole('button', { name: 'Assign…' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Change…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit this night/ })).toBeInTheDocument();
  });

  it('is read-only once attendance is finalized', async () => {
    mockGetBoard.mockResolvedValue(board({ can_manage: true, attendance_finalized: true }));
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    expect(await screen.findByText(/crew’s hours are posted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign me up|Assign|Edit this night/ })).not.toBeInTheDocument();
  });

  it('links the other nights of the run', async () => {
    mockGetBoard.mockResolvedValue(board());
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    const nav = await screen.findByRole('navigation', { name: 'Other nights in this run' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/events/night-2']);
  });

  it('will not remove the crew while someone holds a seat', async () => {
    mockGetBoard.mockResolvedValue(board({ can_manage: true }));
    const user = userEvent.setup();
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    await user.click(await screen.findByRole('button', { name: /Edit this night/ }));

    expect(await screen.findByRole('button', { name: 'Remove crew' })).toBeDisabled();
  });

  it('removes an empty crew and leaves the event page without the card', async () => {
    const empty = board({ can_manage: true });
    empty.units = empty.units.map((unit) => ({
      ...unit,
      seats: unit.seats.map((seat) => ({ ...seat, user_id: null, user_name: null })),
    }));
    mockGetBoard.mockResolvedValue(empty);
    mockRemovePlan.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithRouter(<EventApparatusCrewCard eventId="night-1" timezone="America/New_York" />);

    await user.click(await screen.findByRole('button', { name: /Edit this night/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove crew' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove the apparatus crew?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove crew' }));

    await waitFor(() => expect(mockRemovePlan).toHaveBeenCalledWith('night-1'));
    await waitFor(() => expect(screen.queryByText('Outreach · not a shift')).not.toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Apparatus & Crew' })).not.toBeInTheDocument();
  });
});
