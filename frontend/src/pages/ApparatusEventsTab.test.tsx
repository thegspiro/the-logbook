const mockListTemplates = vi.fn();
const mockGetOptions = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../services/api', () => ({
  apparatusEventService: {
    listTemplates: (...args: unknown[]) => mockListTemplates(...args) as unknown,
    getEditorOptions: (...args: unknown[]) => mockGetOptions(...args) as unknown,
    listNights: () => Promise.resolve([]),
    archiveTemplate: () => Promise.resolve(),
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ checkPermission: (p: string) => mockCheckPermission(p) as boolean }),
}));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { ApparatusEventEvocMode, ApparatusEventSeatType, type ApparatusEventTemplate } from '../types/apparatusEvent';
import ApparatusEventsTab from './ApparatusEventsTab';

const ENGINE = {
  id: 'engine-1',
  unit_number: 'E1',
  name: 'Engine 1',
  required_evoc_level_name: 'EVOC 3',
  status_name: 'In Service',
  is_available: true,
};

const TEMPLATE: ApparatusEventTemplate = {
  id: 'tpl-1',
  name: 'Santamobile — Full',
  description: null,
  event_type: 'public_education',
  default_start_time: '18:00',
  duration_minutes: 210,
  location: null,
  admin_hours_category_id: 'cat-1',
  admin_hours_category_name: 'Community Outreach',
  evoc_mode: ApparatusEventEvocMode.ENFORCE,
  allow_self_signup: true,
  show_on_schedule: true,
  duplicated_from_id: null,
  duplicated_from_name: null,
  total_seats: 7,
  nights_scheduled: 0,
  last_scheduled_at: null,
  units: [
    {
      id: 'u1',
      apparatus_id: 'engine-1',
      unit_number: 'E1',
      apparatus_name: 'Engine 1',
      required_evoc_level_name: 'EVOC 3',
      seats: [
        { id: 's1', name: 'Driver', seat_type: ApparatusEventSeatType.DRIVER, count: 1, note: null },
        { id: 's2', name: 'Navigator', seat_type: ApparatusEventSeatType.GENERAL, count: 1, note: null },
        { id: 's3', name: 'Santa', seat_type: ApparatusEventSeatType.GENERAL, count: 1, note: null },
        { id: 's4', name: 'Elf', seat_type: ApparatusEventSeatType.GENERAL, count: 4, note: null },
      ],
    },
  ],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

describe('ApparatusEventsTab', () => {
  beforeEach(() => {
    mockListTemplates.mockReset();
    mockGetOptions.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    mockGetOptions.mockResolvedValue({
      apparatus: [ENGINE],
      categories: [{ id: 'cat-1', name: 'Community Outreach' }],
      mapped_event_types: ['public_education'],
    });
  });

  it('lists templates with their seats, EVOC rule and hours category', async () => {
    renderWithRouter(<ApparatusEventsTab />);

    expect(await screen.findByRole('heading', { name: 'Santamobile — Full' })).toBeInTheDocument();
    expect(screen.getByText('Driver · Navigator · Santa · Elf ×4')).toBeInTheDocument();
    expect(screen.getByText('EVOC enforced')).toBeInTheDocument();
    expect(screen.getByText('Hours: Community Outreach')).toBeInTheDocument();
  });

  it('opens the scheduler from a template', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApparatusEventsTab />);

    await user.click(await screen.findByRole('button', { name: /Schedule nights/ }));

    expect(screen.getByRole('heading', { name: /Schedule nights from “Santamobile — Full”/ })).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('warns while nothing would credit the crew’s hours, and stops once a category is chosen', async () => {
    mockGetOptions.mockResolvedValue({
      apparatus: [ENGINE],
      categories: [{ id: 'cat-1', name: 'Community Outreach' }],
      mapped_event_types: [],
    });
    const user = userEvent.setup();
    renderWithRouter(<ApparatusEventsTab />);

    await user.click(await screen.findByRole('button', { name: /New template/ }));
    expect(await screen.findByText(/hours won’t be credited/)).toHaveTextContent(
      'ask whoever manages Admin Hours to map this event type'
    );

    await user.selectOptions(screen.getByLabelText('Admin Hours category'), 'cat-1');
    expect(screen.queryByText(/hours won’t be credited/)).not.toBeInTheDocument();
  });

  it('does not warn when the event type is mapped', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApparatusEventsTab />);

    await user.click(await screen.findByRole('button', { name: /New template/ }));
    expect(await screen.findByLabelText('Admin Hours category')).toHaveValue('');
    expect(screen.queryByText(/hours won’t be credited/)).not.toBeInTheDocument();
  });

  it('asks for an apparatus before a template can exist', async () => {
    mockListTemplates.mockResolvedValue([]);
    mockGetOptions.mockResolvedValue({ apparatus: [], categories: [], mapped_event_types: [] });
    renderWithRouter(<ApparatusEventsTab />);

    expect(await screen.findByText('Add an apparatus first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New template/ })).not.toBeInTheDocument();
  });

  it('explains itself to someone who cannot manage it, without asking the server', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<ApparatusEventsTab />);

    expect(await screen.findByText('Apparatus events are managed by coordinators')).toBeInTheDocument();
    expect(mockListTemplates).not.toHaveBeenCalled();
  });
});
