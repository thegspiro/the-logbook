import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event } from '../../types/event';

const setOutreachCloseout = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: { setOutreachCloseout: (...a: unknown[]) => setOutreachCloseout(...a) as unknown },
}));
vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getApparatusOptions: () =>
      Promise.resolve({
        source: 'basic',
        options: [
          { id: 'e1', name: 'Engine 1', unit_number: 'E1', apparatus_type: 'engine', source: 'basic' },
          { name: 'Engine', apparatus_type: 'engine', source: 'default' },
        ],
      }),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import EventOutreachCloseoutCard from './EventOutreachCloseoutCard';

const event = { id: 'ev-1', title: 'Station Tour' } as Event;

describe('EventOutreachCloseoutCard', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    setOutreachCloseout.mockReset();
    onSaved.mockReset();
    setOutreachCloseout.mockResolvedValue({ ...event, outreach_photos: 'consented' });
  });

  it('saves every field it owns', async () => {
    const user = userEvent.setup();
    render(<EventOutreachCloseoutCard event={event} onSaved={onSaved} />);

    await user.type(screen.getByLabelText('Outcome and follow-ups'), 'Kids loved the hose.');
    await user.click(await screen.findByRole('checkbox', { name: 'E1 — Engine 1' }));
    // A type placeholder has no id to save, so it is not offered.
    expect(screen.queryByRole('checkbox', { name: 'Engine' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    await user.type(screen.getByRole('textbox', { name: 'Material 1' }), 'Smoke alarms');
    const quantity = screen.getByRole('spinbutton', { name: 'How many of material 1' });
    await user.clear(quantity);
    await user.type(quantity, '12');
    await user.selectOptions(screen.getByLabelText('Photos'), 'consented');
    await user.click(screen.getByRole('button', { name: 'Save close-out' }));

    await waitFor(() =>
      expect(setOutreachCloseout).toHaveBeenCalledWith('ev-1', {
        outcome_note: 'Kids loved the hose.',
        apparatus_ids: ['e1'],
        materials: [{ item: 'Smoke alarms', quantity: 12 }],
        photos: 'consented',
      })
    );
    expect(onSaved).toHaveBeenCalledWith({ ...event, outreach_photos: 'consented' });
  });

  it('sends a cleared record as nulls and empty lists', async () => {
    const user = userEvent.setup();
    render(
      <EventOutreachCloseoutCard
        event={{ ...event, outreach_outcome_note: 'Old note', outreach_photos: 'none' }}
        onSaved={onSaved}
      />
    );

    await user.clear(screen.getByLabelText('Outcome and follow-ups'));
    await user.selectOptions(screen.getByLabelText('Photos'), '');
    await user.click(screen.getByRole('button', { name: 'Save close-out' }));

    await waitFor(() =>
      expect(setOutreachCloseout).toHaveBeenCalledWith('ev-1', {
        outcome_note: null,
        apparatus_ids: [],
        materials: [],
        photos: null,
      })
    );
  });

  it('holds the save until every item has a name', async () => {
    const user = userEvent.setup();
    render(<EventOutreachCloseoutCard event={event} onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Add an item' }));

    expect(screen.getByText('Give every item a name and a number.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save close-out' })).toBeDisabled();
  });
});
