import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckSweep } from './CheckSweep';

import type { CheckItemSpec } from './CheckItemControls';
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
