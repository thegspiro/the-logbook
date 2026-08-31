import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckFlatList, CheckJumpSheet } from './CheckJumpSheet';

import type { CheckItemSpec } from './CheckItemControls';
import type { AnswerMap, LapStop } from './checkLapModel';

const count = (id: string, par: number): CheckItemSpec => ({ id, name: id, checkType: 'count', expectedQuantity: par });
const fn = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'function' });

const STOPS: LapStop[] = [
  { id: 'cab', name: 'Cab', items: [fn('lights'), fn('siren')] },
  { id: 'pump', name: 'Pump Panel', items: [fn('regulator')] },
  { id: 'ems', name: 'EMS cabinet', items: [count('gauze', 10)] },
  {
    id: 'drugs',
    name: 'Drug box',
    items: [count('morphine', 2)],
    isSealed: true,
    seal: { status: 'intact', tagNumber: 'M2-40871' },
  },
];

const setup = (answers: AnswerMap = {}, current = 1) => {
  const props = {
    stops: STOPS,
    answers,
    current,
    onJump: vi.fn(),
    onShowFlatList: vi.fn(),
    onClose: vi.fn(),
  };
  render(<CheckJumpSheet {...props} />);
  return props;
};

describe('CheckJumpSheet', () => {
  it('says the numbering is a route rather than a lock, and behaves like one', async () => {
    const user = userEvent.setup();
    const props = setup();
    expect(screen.getByText(/a route, not a lock/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /4 · Drug box/ }));
    expect(props.onJump).toHaveBeenCalledWith(3);
  });

  it('marks where you are', () => {
    setup({}, 1);
    expect(screen.getByText('You are here')).toBeVisible();
    const row = screen.getByRole('button', { name: /2 · Pump Panel/ });
    expect(row).toHaveAttribute('aria-current', 'step');
  });

  it('carries the progress and the fault, because "what have I not done" is why it is open', () => {
    setup({ lights: { status: 'pass' }, siren: { status: 'fail' }, gauze: { status: 'pass', quantityFound: 4 } });

    const cab = screen.getByRole('button', { name: /1 · Cab/ });
    expect(within(cab).getByText('siren')).toBeVisible();
    expect(within(cab).getByText('2/2')).toBeVisible();

    // A shortfall is reported as its own thing, not as a fault.
    const ems = screen.getByRole('button', { name: /3 · EMS cabinet/ });
    expect(within(ems).getByText('1 restock line')).toBeVisible();
  });

  it('says a sealed container is sealed, and names the tag', () => {
    setup();
    const drugs = screen.getByRole('button', { name: /4 · Drug box/ });
    expect(within(drugs).getByText('Sealed · tag M2-40871')).toBeVisible();
  });

  it('offers the flat list as the way out of the sequence entirely', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /Show every item as one list/ }));
    expect(props.onShowFlatList).toHaveBeenCalled();
  });
});

describe('CheckFlatList', () => {
  it('reads out every item with its state, and sends each one back to its stop', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(
      <CheckFlatList
        stops={STOPS}
        answers={{ lights: { status: 'pass' }, siren: { status: 'fail' } }}
        onJump={onJump}
        onClose={vi.fn()}
      />
    );

    // The name and the state are adjacent spans, so each row says both in its
    // accessible name rather than running them together as one word.
    expect(screen.getByRole('button', { name: 'lights, Done, go to stop 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'siren, Fault, go to stop 1' })).toBeVisible();

    // An intact seal has answered the count inside, so the flat list says so
    // rather than calling it unanswered and sending somebody to count through
    // a tag.
    expect(screen.getByRole('button', { name: 'morphine, Sealed, go to stop 4' })).toBeVisible();

    // A reading surface, not a second place to answer: tapping goes to the
    // stop that owns the item rather than answering it here.
    await user.click(screen.getByRole('button', { name: 'gauze, Not answered, go to stop 3' }));
    expect(onJump).toHaveBeenCalledWith(2);
  });
});
