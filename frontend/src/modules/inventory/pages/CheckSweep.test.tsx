import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckSweep } from './CheckSweep';

import type { CheckItemSpec } from './CheckItemControls';
import { sweepSaveStateFrom } from './checkLapModel';

import type { AnswerMap, LapStop } from './checkLapModel';

const count = (id: string, par: number): CheckItemSpec => ({ id, name: id, checkType: 'count', expectedQuantity: par });
const fn = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'function' });
const level = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'level', minLevel: 100 });

const STOPS: LapStop[] = [
  { id: 'cab', name: 'Cab', items: [fn('lights'), fn('siren')] },
  { id: 'pump', name: 'Pump Panel', items: [level('booster'), level('foam')] },
  { id: 'ems', name: 'EMS cabinet', items: [count('gauze', 10), count('saline', 6)] },
];

const setup = (over: Partial<React.ComponentProps<typeof CheckSweep>> = {}, answers: AnswerMap = {}) => {
  const props = {
    stops: STOPS,
    answers,
    stopIndex: 0,
    onStopIndexChange: vi.fn(),
    onBulkClaim: vi.fn(),
    onOpenJump: vi.fn(),
    onFinish: vi.fn(),
    onClose: vi.fn(),
    unitName: 'ENGINE 402',
    templateName: 'START OF SHIFT',
    saveState: 'saved' as const,
    renderStop: (stop: LapStop) => <div data-testid="stop-body">{stop.name} body</div>,
    ...over,
  };
  render(<CheckSweep {...props} />);
  return props;
};

describe('CheckSweep', () => {
  it('says where you are and how much is left, without reading the list', async () => {
    setup({ stopIndex: 1 }, { lights: { status: 'pass' }, siren: { status: 'pass' } });

    expect(screen.getByText('Stop 2 of 3')).toBeVisible();
    expect(screen.getByText('2 / 6 answered')).toBeVisible();

    const map = screen.getByRole('list', { name: 'Truck map' });
    // Colour carries state; the accessible name has to carry it too, or the
    // strip is an orientation device only for people who can see it.
    expect(within(map).getByRole('listitem', { name: /Stop 1, Cab, complete/ })).toBeInTheDocument();
    expect(within(map).getByRole('listitem', { name: /Stop 2, Pump Panel, untouched, current/ })).toBeInTheDocument();
  });

  it('is a route, not a lock — any segment goes there', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('listitem', { name: /Stop 3, EMS cabinet/ }));
    expect(props.onStopIndexChange).toHaveBeenCalledWith(2);
  });

  it('claims the stop in the words of what it holds', () => {
    setup({ stopIndex: 2 });
    expect(screen.getByRole('button', { name: /All 2 counts at par/ })).toBeVisible();
  });

  it('offers no claim over a stop of gauges', () => {
    // A reading is a number nobody has looked at. There is nothing to claim.
    setup({ stopIndex: 1 });
    expect(screen.queryByRole('button', { name: /^✓ All/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing here can be bulk-confirmed/)).toBeVisible();
  });

  it('will not leave a gauge stop until the gauges are read, and says how many', async () => {
    const user = userEvent.setup();
    const props = setup({ stopIndex: 1 });

    const primary = screen.getByRole('button', { name: /Read 2 more gauges/ });
    expect(primary).toBeDisabled();
    await user.click(primary);
    expect(props.onStopIndexChange).not.toHaveBeenCalled();
  });

  it('lets a read gauge stop through, naming where next goes', async () => {
    const user = userEvent.setup();
    const props = setup({ stopIndex: 1 }, { booster: { levelReading: 90 }, foam: { levelReading: 22 } });

    await user.click(screen.getByRole('button', { name: /Next · EMS cabinet/ }));
    expect(props.onStopIndexChange).toHaveBeenCalledWith(2);
  });

  it('finishes rather than advancing on the last stop', async () => {
    const user = userEvent.setup();
    const props = setup({ stopIndex: 2 });
    expect(screen.getByText('Stop 3 of 3 · last one')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Finish the check' }));
    expect(props.onFinish).toHaveBeenCalled();
    expect(props.onStopIndexChange).not.toHaveBeenCalled();
  });

  it('reports a shortfall as a restock line, not a failure', () => {
    setup(
      { stopIndex: 2 },
      { gauze: { status: 'pass', quantityFound: 4 }, saline: { status: 'pass', quantityFound: 6 } }
    );
    expect(screen.getByText('1 restock line from this stop')).toBeVisible();
  });

  it('says the work is held on the phone when there is no signal', () => {
    setup({ saveState: 'offline' });
    expect(screen.getByText(/held on this phone/)).toBeVisible();
  });

  it('drops the claim once the stop is answered', () => {
    setup({ stopIndex: 0 }, { lights: { status: 'pass' }, siren: { status: 'pass' } });
    expect(screen.queryByRole('button', { name: /All 2 work/ })).not.toBeInTheDocument();
  });
});

describe('a bag with pockets', () => {
  const BAG: LapStop = {
    id: 'bag',
    name: 'Airway bag',
    items: [],
    children: [
      { id: 'p1', name: 'Front pocket', items: [count('opa', 2)] },
      { id: 'p2', name: 'Suction', items: [count('cath', 3), fn('unit')] },
      { id: 'p3', name: 'Airway roll', items: [count('tube', 4)] },
    ],
  };

  const openBag = (over: Partial<React.ComponentProps<typeof CheckSweep>> = {}, answers: AnswerMap = {}) =>
    setup({ stops: [...STOPS, BAG], stopIndex: 3, pocketIndex: 0, onPocketIndexChange: vi.fn(), ...over }, answers);

  it('lists the pockets as a strip, and says which is open', () => {
    openBag({ pocketIndex: 1 });
    const strip = screen.getByRole('list', { name: 'Pockets' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('listitem', { name: /Pocket 2, Suction, open/ })).toHaveAttribute('aria-current', 'step');
  });

  it('marks a finished pocket done, because "how many left" is why the strip is there', () => {
    openBag({}, { opa: { status: 'pass', quantityFound: 2 } });
    expect(screen.getByRole('listitem', { name: /Pocket 1, Front pocket, done/ })).toBeVisible();
    expect(screen.queryByRole('listitem', { name: /Pocket 3, Airway roll, done/ })).not.toBeInTheDocument();
  });

  it('starts a different bag at its first pocket', async () => {
    // Tapping another stop in the truck map leaves the pocket index behind
    // otherwise: clamped for rendering but stale everywhere else, so a
    // two-pocket bag reads "Pocket 6 of 2" and the primary leaves it without
    // ever showing pockets 1 to 5.
    const user = userEvent.setup();
    const props = openBag({ pocketIndex: 2 });
    await user.click(screen.getByRole('listitem', { name: /^Stop 1, Cab/ }));
    expect(props.onPocketIndexChange).toHaveBeenCalledWith(0);
    expect(props.onStopIndexChange).toHaveBeenCalledWith(0);
  });

  it('lets a pocket be opened out of order — the numbering is a route, not a lock', async () => {
    const user = userEvent.setup();
    const props = openBag();
    await user.click(screen.getByRole('listitem', { name: /Pocket 3, Airway roll/ }));
    expect(props.onPocketIndexChange).toHaveBeenCalledWith(2);
  });

  it('names the next pocket on the primary, not the next stop', () => {
    openBag({ pocketIndex: 1 });
    expect(screen.getByRole('button', { name: 'Next pocket · Airway roll' })).toBeVisible();
  });

  it('moves to the next pocket rather than leaving the bag', async () => {
    const user = userEvent.setup();
    const props = openBag();
    await user.click(screen.getByRole('button', { name: /^Next pocket/ }));
    expect(props.onPocketIndexChange).toHaveBeenCalledWith(1);
    // Leaving early would skip whatever is still zipped up inside.
    expect(props.onStopIndexChange).not.toHaveBeenCalled();
  });

  it('finishes the check from the last pocket of the last stop', async () => {
    const user = userEvent.setup();
    const props = openBag({ pocketIndex: 2 });
    await user.click(screen.getByRole('button', { name: 'Finish the check' }));
    expect(props.onFinish).toHaveBeenCalled();
  });

  it('claims the open pocket, not the whole bag', async () => {
    // "All 5 at par" over six pockets is a claim about five the crew has not
    // opened. The button speaks for what is in front of them.
    const user = userEvent.setup();
    const props = openBag({ pocketIndex: 1 });
    await user.click(screen.getByRole('button', { name: /All 2 good/ }));
    expect(props.onBulkClaim).toHaveBeenCalledWith(BAG.children?.[1]);
  });

  it('counts a gauge against the pocket it is in, not the bag', () => {
    // A gauge in pocket 3 blocking the way out of pocket 1 is a dead end with
    // no visible cause.
    const withGauge: LapStop = {
      ...BAG,
      children: [BAG.children?.[0] as LapStop, { id: 'pg', name: 'Cylinder pocket', items: [level('o2')] }],
    };
    openBag({ stops: [...STOPS, withGauge], pocketIndex: 0 });
    expect(screen.getByRole('button', { name: /^Next pocket/ })).toBeEnabled();
  });

  it('says where you are inside the bag as well as along the truck', () => {
    openBag({ pocketIndex: 1 });
    expect(screen.getByText('Pocket 2 of 3')).toBeVisible();
  });
});

describe('what the save chip is reporting', () => {
  it('says the walk is not saved when the draft write failed, over anything else', () => {
    // The offline banner promises the walk is held on this phone. That is the
    // exact claim a rejected IndexedDB write breaks, so it must not be what
    // the crew is looking at.
    setup({ saveState: 'failed' });
    expect(screen.getByText('Not saved')).toBeVisible();
    expect(screen.getByText(/closing it will lose what you have answered/)).toBeVisible();
    expect(screen.queryByText(/held on this phone/)).not.toBeInTheDocument();
  });
});

describe('which save state the chip is showing', () => {
  it('reports a rejected write ahead of everything else', () => {
    expect(sweepSaveStateFrom('failed', true)).toBe('failed');
    expect(sweepSaveStateFrom('failed', false)).toBe('failed');
  });

  it('does not promise the walk is held on the phone while the write is open', () => {
    // The offline chip's content is "this is already on your device". Until
    // IndexedDB resolves it is not, and a page closed inside that window loses
    // the answers the chip just vouched for.
    expect(sweepSaveStateFrom('saving', false)).toBe('saving');
    expect(sweepSaveStateFrom('saving', true)).toBe('saving');
  });

  it('says offline only once the write has settled', () => {
    expect(sweepSaveStateFrom('saved', false)).toBe('offline');
    expect(sweepSaveStateFrom('idle', false)).toBe('offline');
    expect(sweepSaveStateFrom('saved', true)).toBe('saved');
  });
});
