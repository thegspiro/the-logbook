import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { StaffingMappingView } from '../../../modules/integrations/types/historicalImport';

const mockGet = vi.fn();
const mockDecide = vi.fn();
const mockAccept = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getStaffingMapping: (...a: unknown[]) => mockGet(...a) as unknown,
    updateStaffingDecisions: (...a: unknown[]) => mockDecide(...a) as unknown,
    acceptStaffingSuggestions: (...a: unknown[]) => mockAccept(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import StaffingMappingPanel from './StaffingMappingPanel';

const progress = { items: 2, decided: 0, suggested: 1, undecided: 1, seats: 300, seats_settled: 200 };

const view = (overrides: Partial<StaffingMappingView> = {}): StaffingMappingView => ({
  list: 'activities',
  items: [
    {
      key: 'la106 call back staff',
      label: 'LA106 Call Back Staff',
      seats: 200,
      events: 120,
      suggestion: 'shift',
      choice: null,
      examples: [],
    },
    {
      key: 'santamobile',
      label: 'Santamobile',
      seats: 100,
      events: 40,
      suggestion: 'event',
      choice: null,
      examples: [],
    },
  ],
  total: 2,
  progress: { activities: progress, seat_titles: progress, event_titles: progress },
  seat_choices: [
    { value: 'driver', label: 'Driver/Operator' },
    { value: 'lead_tech', label: 'Lead Technician' },
  ],
  role_choices: [{ value: 'party_staff', label: 'Party Staff' }],
  ...overrides,
});

const eventTitles = view({
  list: 'event_titles',
  items: [
    {
      key: 'attendee',
      label: 'Attendee',
      seats: 678,
      events: 90,
      suggestion: '__attendance__',
      choice: null,
      examples: ['Attendee'],
    },
    {
      key: 'elf',
      label: 'Elf',
      seats: 597,
      events: 80,
      suggestion: null,
      choice: null,
      examples: ['Elf', 'Lead Elf: 1800-2100'],
    },
  ],
});

describe('StaffingMappingPanel', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockDecide, mockAccept]) mock.mockReset();
    mockGet.mockResolvedValue(view());
    mockDecide.mockResolvedValue(view());
    mockAccept.mockResolvedValue(2);
  });

  it('starts with what each activity is suggested to be', async () => {
    renderWithRouter(<StaffingMappingPanel importId="hist-1" />);
    expect(await screen.findByLabelText('LA106 Call Back Staff')).toHaveDisplayValue('Suggested: Shift');
    expect(mockGet).toHaveBeenCalledWith('hist-1', 'activities', { search: '', offset: 0, limit: 25 });
    expect(screen.getByRole('status')).toHaveTextContent('200 of 300 seats are settled');
  });

  it('decides an activity', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingMappingPanel importId="hist-1" />);
    await user.selectOptions(await screen.findByLabelText('Santamobile'), 'Leave out');

    await waitFor(() =>
      expect(mockDecide).toHaveBeenCalledWith(
        'hist-1',
        'activities',
        { santamobile: 'skip' },
        {
          search: '',
          offset: 0,
          limit: 25,
        }
      )
    );
  });

  it('offers only the departments roles, attendance or leaving out at an event', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(eventTitles);
    renderWithRouter(<StaffingMappingPanel importId="hist-1" />);
    await user.click(await screen.findByRole('tab', { name: /Event roles/ }));

    const elf = await screen.findByLabelText('Elf');
    expect(mockGet).toHaveBeenLastCalledWith('hist-1', 'event_titles', { search: '', offset: 0, limit: 25 });
    expect([...(elf as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Choose…',
      'Party Staff',
      'Attendance',
      'Leave out',
    ]);
    expect(screen.getByText(/as Elf, Lead Elf: 1800-2100/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Outreach roles/ })).toHaveAttribute('href', '/events/admin?tab=settings');

    await user.selectOptions(elf, 'Party Staff');
    await waitFor(() =>
      expect(mockDecide).toHaveBeenCalledWith('hist-1', 'event_titles', { elf: 'party_staff' }, expect.any(Object))
    );
  });

  it('offers only the departments crew seats on a shift', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(
      view({
        list: 'seat_titles',
        items: [
          {
            key: 'lead technician',
            label: 'Lead Technician',
            seats: 1829,
            events: 900,
            suggestion: null,
            choice: null,
            examples: [],
          },
        ],
      })
    );
    renderWithRouter(<StaffingMappingPanel importId="hist-1" />);
    await user.click(await screen.findByRole('tab', { name: /Shift seats/ }));

    const select = await screen.findByLabelText('Lead Technician');
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Choose…',
      'Driver/Operator',
      'Lead Technician',
      'Leave out',
    ]);
    expect(screen.getByRole('link', { name: /Position Names/ })).toHaveAttribute(
      'href',
      '/scheduling/admin/settings/general'
    );
  });

  it('takes every suggestion at once', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingMappingPanel importId="hist-1" />);
    await user.click(await screen.findByRole('button', { name: 'Accept all suggestions' }));

    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('hist-1', 'activities'));
  });

  it('searches once typing stops', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingMappingPanel importId="hist-1" />);
    await screen.findByLabelText('Santamobile');
    await user.type(screen.getByLabelText('Search'), 'santa');

    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('hist-1', 'activities', { search: 'santa', offset: 0, limit: 25 })
    );
  });
});
