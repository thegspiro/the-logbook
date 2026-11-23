const mockGetBoard = vi.fn();
const mockListTemplates = vi.fn();
const mockConflicts = vi.fn();
const mockAttach = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../services/api', () => ({
  apparatusEventService: {
    getCrewBoard: (...args: unknown[]) => mockGetBoard(...args) as unknown,
    listTemplates: (...args: unknown[]) => mockListTemplates(...args) as unknown,
    checkAttachConflicts: (...args: unknown[]) => mockConflicts(...args) as unknown,
    attachToRequest: (...args: unknown[]) => mockAttach(...args) as unknown,
  },
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ checkPermission: (p: string) => mockCheckPermission(p) as boolean }),
}));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import RequestApparatusCrewSection from './RequestApparatusCrewSection';

const TEMPLATE = {
  id: 'tpl-truck',
  name: 'Touch-a-Truck',
  total_seats: 3,
  units: [{ id: 'u1', unit_number: 'E2' }],
};

const CONFLICT = {
  night_index: 0,
  apparatus_id: 'e2',
  unit_number: 'E2',
  reason: 'E2 is already on Holiday Parade.',
  conflicting_event_id: 'p1',
  conflicting_title: 'Holiday Parade',
};

describe('RequestApparatusCrewSection', () => {
  beforeEach(() => {
    for (const mock of [mockGetBoard, mockListTemplates, mockConflicts, mockAttach, mockCheckPermission]) {
      mock.mockReset();
    }
    mockCheckPermission.mockReturnValue(true);
    mockGetBoard.mockRejectedValue(new Error('404'));
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    mockConflicts.mockResolvedValue([]);
    mockAttach.mockResolvedValue({ event_id: 'ev-1', plan_id: 'plan-1' });
  });

  it('shows nothing to someone who cannot manage apparatus events', () => {
    mockCheckPermission.mockReturnValue(false);
    const { container } = renderWithRouter(<RequestApparatusCrewSection requestId="r1" eventId="ev-1" />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGetBoard).not.toHaveBeenCalled();
  });

  it('asks for a calendar event first', () => {
    renderWithRouter(<RequestApparatusCrewSection requestId="r1" eventId={undefined} />);

    expect(screen.getByText(/scheduled without a calendar event/)).toBeInTheDocument();
  });

  it('summarises a crew already on the event and links to it', async () => {
    mockGetBoard.mockResolvedValue({
      template_name: 'Touch-a-Truck',
      units: [
        {
          id: 'cu1',
          unit_number: 'E2',
          seats: [
            { id: 's1', user_id: 'u-1' },
            { id: 's2', user_id: null },
          ],
        },
      ],
    });
    renderWithRouter(<RequestApparatusCrewSection requestId="r1" eventId="ev-1" />);

    const link = await screen.findByRole('link', { name: /1 of 2 seats filled/ });
    expect(link).toHaveAttribute('href', '/events/ev-1');
  });

  it('adds a crew from a template once a conflict has been acknowledged', async () => {
    mockConflicts.mockResolvedValue([CONFLICT]);
    const user = userEvent.setup();
    renderWithRouter(<RequestApparatusCrewSection requestId="r1" eventId="ev-1" />);

    // The select renders before the template list arrives; pick only once the option exists.
    await screen.findByRole('option', { name: /^Touch-a-Truck/ });
    await user.selectOptions(screen.getByLabelText('Template'), 'tpl-truck');
    expect(await screen.findByText('E2 is already on Holiday Parade.')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: /Add apparatus crew/ });
    expect(add).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Add it anyway/ }));
    await user.click(add);

    await waitFor(() => expect(mockAttach).toHaveBeenCalledWith('r1', 'tpl-truck', true));
    expect(mockConflicts).toHaveBeenCalledWith('ev-1', 'tpl-truck');
  });
});
