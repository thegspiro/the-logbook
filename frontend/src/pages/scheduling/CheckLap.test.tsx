/**
 * The lap: one stop open at a time, any stop reachable, and a bulk action that
 * refuses to invent a gauge reading.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CheckLap } from './CheckLap';
import {
  answerableItems,
  bulkConfirmable,
  bulkLabel,
  isStopComplete,
  sealCannotClear,
  stopFailures,
  stopItems,
  type AnswerMap,
  type LapStop,
} from './checkLapModel';
import type { CheckItemSpec } from './CheckItemControls';

const fn = (id: string, name: string): CheckItemSpec => ({ id, name, checkType: 'function' });
const count = (id: string, name: string, par = 2): CheckItemSpec => ({
  id,
  name,
  checkType: 'count',
  expectedQuantity: par,
});
const level = (id: string, name: string): CheckItemSpec => ({ id, name, checkType: 'level', minLevel: 500 });

const stop = (id: string, name: string, items: CheckItemSpec[], over: Partial<LapStop> = {}): LapStop => ({
  id,
  name,
  items,
  ...over,
});

const LAP: LapStop[] = [
  stop('s1', 'Cab & driver area', [fn('i1', 'Seat belts')]),
  stop('s2', "Exterior · officer's side", [fn('i2', 'Scene light, rear'), fn('i3', 'Ladder')]),
  stop('s3', 'Shelf · airway', [count('i4', 'ET tube 7.5')]),
];

describe('helpers', () => {
  it('counts items through pockets', () => {
    const bag = stop('b', 'Airway bag', [fn('x', 'Tag')], {
      children: [stop('p1', 'Front pocket', [count('y', 'i-gel')])],
    });
    expect(stopItems(bag).map((i) => i.id)).toEqual(['x', 'y']);
  });

  it('does not treat layout rows as questions', () => {
    const s = stop('s', 'Wall', [
      { id: 'h', name: 'Wall mounts', checkType: 'header' },
      { id: 't', name: 'Then the shelf below', checkType: 'text' },
      fn('a', 'Suction'),
    ]);
    expect(answerableItems(s).map((i) => i.id)).toEqual(['a']);
    // A stop of pure layout is complete because it asks nothing.
    expect(isStopComplete(stop('e', 'Notes', [{ id: 'h2', name: 'X', checkType: 'header' }]), {})).toBe(true);
  });

  it('is incomplete until every question is answered', () => {
    const s = LAP[1] as LapStop;
    expect(isStopComplete(s, {})).toBe(false);
    expect(isStopComplete(s, { i2: { status: 'pass' } })).toBe(false);
    expect(isStopComplete(s, { i2: { status: 'pass' }, i3: { status: 'pass' } })).toBe(true);
  });

  it('does not count "not_checked" as answered', () => {
    expect(isStopComplete(LAP[0] as LapStop, { i1: { status: 'not_checked' } })).toBe(false);
  });

  it('treats out of service as a failure', () => {
    const s = LAP[1] as LapStop;
    expect(stopFailures(s, { i2: { status: 'out_of_service' } }).map((i) => i.id)).toEqual(['i2']);
  });

  it('excludes levels from a bulk claim', () => {
    // Inventing a gauge reading is a fabricated record on the one type whose
    // whole purpose is the stored value.
    const items = [fn('a', 'Siren'), level('b', 'O2'), count('c', 'Gauze')];
    expect(bulkConfirmable(items).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('names what a seal cannot vouch for', () => {
    const items: CheckItemSpec[] = [
      fn('a', 'Siren'),
      count('b', 'Gauze', 4),
      level('c', 'O2 cylinder'),
      { id: 'd', name: 'Epinephrine', checkType: 'expiry', expirationDate: '2026-09-02' },
      { id: 'e', name: 'Saline', checkType: 'count', expectedQuantity: 2, expirationDate: '2026-10-01' },
    ];
    // A seal proves nothing was touched. It cannot stop a drug expiring or a
    // cylinder losing pressure, and an expiring item is excluded whatever its
    // type — hence the count with a date on it.
    expect(sealCannotClear(items).map((i) => i.id)).toEqual(['c', 'd', 'e']);
  });

  it('says what is being claimed', () => {
    expect(bulkLabel([count('a', 'i-gel'), count('b', 'ET tube')])).toBe('All at par');
    expect(bulkLabel([count('a', 'i-gel'), fn('b', 'Suction')])).toBe('All good');
    // A stop of only gauges can claim nothing.
    expect(bulkLabel([level('a', 'O2')])).toBe('All good');
  });
});

describe('CheckLap', () => {
  const setup = (over: Partial<React.ComponentProps<typeof CheckLap>> = {}) => {
    const onOpenStop = vi.fn();
    const onAnswer = vi.fn();
    const onAllGood = vi.fn();
    const answers: AnswerMap = {};
    render(
      <CheckLap
        stops={LAP}
        answers={answers}
        openStopId="s2"
        onOpenStop={onOpenStop}
        onAnswer={onAnswer}
        onAllGood={onAllGood}
        {...over}
      />
    );
    return { onOpenStop, onAnswer, onAllGood };
  };

  it('opens one stop in place and collapses the rest', () => {
    setup();
    expect(screen.getByTestId('stop-s2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('stop-s1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('stop-s3')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the walking position', () => {
    setup();
    expect(screen.getByTestId('lap-progress')).toHaveTextContent('Stop 2/3');
  });

  it('lets a stop be taken out of order — the numbering is a route, not a lock', async () => {
    const user = userEvent.setup();
    const { onOpenStop } = setup();
    // A crew interrupted at stop 3 comes back to whichever end they are at.
    await user.click(screen.getByTestId('stop-s1'));
    expect(onOpenStop).toHaveBeenCalledWith('s1');
  });

  it('summarizes a collapsed stop by its item count', () => {
    setup({ openStopId: 's2' });
    expect(screen.getByTestId('stop-s1')).toHaveTextContent('1 item');
    expect(screen.getByTestId('stop-s3')).toHaveTextContent('1 item');
  });

  it('shows the fault instead of the count once a stop has one', () => {
    setup({ openStopId: 's3', answers: { i2: { status: 'fail' } } });
    // The count is what you need before you walk it; once something is wrong,
    // the fault is the only thing worth the line.
    expect(screen.getByTestId('stop-s2')).toHaveTextContent(/Scene light, rear/);
    expect(screen.getByTestId('stop-s2')).not.toHaveTextContent('2 items');
  });

  it('names how many more faults there are', () => {
    setup({ openStopId: 's1', answers: { i2: { status: 'fail' }, i3: { status: 'fail' } } });
    expect(screen.getByTestId('stop-s2')).toHaveTextContent('+1 more');
  });

  it('offers the next stop by name', async () => {
    const user = userEvent.setup();
    const { onOpenStop } = setup({ openStopId: 's2' });
    const next = screen.getByTestId('next-stop');
    expect(next).toHaveTextContent('Shelf · airway');
    await user.click(next);
    expect(onOpenStop).toHaveBeenCalledWith('s3');
  });

  it('offers no next stop on the last one', () => {
    setup({ openStopId: 's3' });
    expect(screen.queryByTestId('next-stop')).not.toBeInTheDocument();
  });

  it('renders the control for each item in the open stop', () => {
    setup({ openStopId: 's2' });
    expect(screen.getByTestId('function-pass-i2')).toBeInTheDocument();
    expect(screen.getByTestId('function-pass-i3')).toBeInTheDocument();
    // The closed stop's controls are not mounted.
    expect(screen.queryByTestId('count-input-i4')).not.toBeInTheDocument();
  });

  it('labels the bulk action for what the stop holds', () => {
    setup({ openStopId: 's3' });
    expect(screen.getByTestId('all-good-s3')).toHaveTextContent('All at par');
  });

  it('says gauges are left alone when the stop has one', () => {
    const withLevel: LapStop[] = [stop('sl', 'Cab', [fn('a', 'Siren'), level('b', 'O2 cylinder')])];
    setup({ stops: withLevel, openStopId: 'sl' });
    expect(screen.getByText(/Gauges are left for you to read/i)).toBeInTheDocument();
  });

  it('does not mention gauges when there are none', () => {
    setup({ openStopId: 's3' });
    expect(screen.queryByText(/Gauges are left/i)).not.toBeInTheDocument();
  });

  it('renders layout rows without asking anything', () => {
    const withLayout: LapStop[] = [
      stop('sh', 'Wall', [
        { id: 'h1', name: 'Wall mounts, then the shelf below', checkType: 'header' },
        fn('a', 'Suction'),
      ]),
    ];
    setup({ stops: withLayout, openStopId: 'sh' });
    expect(screen.getByText('Wall mounts, then the shelf below')).toBeInTheDocument();
    expect(screen.getByTestId('function-pass-a')).toBeInTheDocument();
  });

  it('shows nothing open when no stop is', () => {
    setup({ openStopId: null });
    expect(screen.getByTestId('lap-progress')).toHaveTextContent('3 stops');
    expect(screen.queryByTestId('next-stop')).not.toBeInTheDocument();
  });
});

// ============================================================================
// 5b — bags, pockets and seals
// ============================================================================

// `pocket` is a department's own container label — containerType accepts a
// custom string, and a bag's children are pockets, not compartments.
const pocket = (id: string, name: string, items: CheckItemSpec[]): LapStop =>
  stop(id, name, items, { containerType: 'pocket' });

const bag = (over: Partial<LapStop> = {}): LapStop =>
  stop('bag', 'Airway bag', [fn('tag', 'Seal tag matches')], {
    isSealed: true,
    containerType: 'bag',
    children: [
      pocket('p1', 'Front pocket · airways', [count('a1', 'i-gel size 4', 2)]),
      pocket('p2', 'Main compartment', [count('a2', 'ET tube 7.5', 2)]),
      pocket('p3', 'Side pocket · dressings', [count('a3', 'Gauze', 4)]),
    ],
    ...over,
  });

describe('seals', () => {
  it('an intact seal means the pockets are not counted', () => {
    const b = bag({ seal: { status: 'intact', tagNumber: 'M2-40871' } });
    render(<CheckLap stops={[b]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('seal-bag')).toHaveTextContent('Sealed · tag M2-40871');
    // Counting them anyway means breaking the seal to confirm what the seal
    // already tells you.
    expect(screen.queryByTestId('pocket-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('count-input-a1')).not.toBeInTheDocument();
  });

  it('a sealed bag is complete once its own line is answered', () => {
    const b = bag({ seal: { status: 'intact', tagNumber: 'M2-40871' } });
    // The tag clears the three pocket COUNTS. Nothing in this bag expires or
    // holds pressure, so the tag is the whole check.
    expect(isStopComplete(b, { tag: { status: 'pass' } })).toBe(true);
  });

  it('an intact seal does NOT clear an expiry inside — it proves unchanged, not full', () => {
    const withDrug = bag({
      seal: { status: 'intact', tagNumber: 'M2-40871' },
      children: [
        pocket('p1', 'Front pocket · airways', [count('a1', 'i-gel size 4', 2)]),
        pocket('pd', 'Drug pocket', [
          { id: 'epi', name: 'Epinephrine 1:1000', checkType: 'expiry', expirationDate: '2026-09-02' },
        ]),
      ],
    });
    // A drug expires whether or not anybody opened the bag. Hiding it behind
    // an intact tag is the one thing this rule exists to prevent.
    expect(isStopComplete(withDrug, { tag: { status: 'pass' } })).toBe(false);
    expect(isStopComplete(withDrug, { tag: { status: 'pass' }, epi: { status: 'pass' } })).toBe(true);
  });

  it('an intact seal does NOT clear a pressure reading inside', () => {
    const withCylinder = bag({
      seal: { status: 'intact', tagNumber: 'M2-40871' },
      children: [
        pocket('pb', 'Back pocket · O2 D cylinder', [
          { id: 'o2', name: 'O2 D cylinder', checkType: 'level', minLevel: 500 },
        ]),
      ],
    });
    // A cylinder loses pressure while the bag sits shut.
    expect(isStopComplete(withCylinder, { tag: { status: 'pass' } })).toBe(false);
  });

  it('a broken seal makes every pocket count again', () => {
    const b = bag({
      seal: {
        status: 'broken',
        tagNumber: 'M2-40871',
        brokenAt: '02:41',
        brokenNote: 'run 26-1188',
        replacementTagNumber: 'M2-40902',
      },
    });
    render(<CheckLap stops={[b]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('seal-bag')).toHaveTextContent('Seal broken · count all pockets');
    expect(screen.getByTestId('pocket-progress')).toHaveTextContent('Pocket 1/3');
    expect(screen.getByTestId('count-input-a1')).toBeInTheDocument();

    expect(isStopComplete(b, { tag: { status: 'pass' } })).toBe(false);
  });

  it('says when and where it was opened, and which tag replaces which', () => {
    const b = bag({
      seal: {
        status: 'broken',
        tagNumber: 'M2-40871',
        brokenAt: '02:41',
        brokenNote: 'run 26-1188',
        replacementTagNumber: 'M2-40902',
      },
    });
    render(<CheckLap stops={[b]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    const seal = screen.getByTestId('seal-bag');
    expect(seal).toHaveTextContent('Opened 02:41 on run 26-1188');
    // Reaching for a number on the record is what keeps the chain traceable.
    expect(seal).toHaveTextContent('Tag M2-40902 replaces M2-40871 when you re-seal');
  });

  it('shows no seal banner on an ordinary stop', () => {
    render(<CheckLap stops={LAP} answers={{}} openStopId="s2" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    expect(screen.queryByTestId('seal-s2')).not.toBeInTheDocument();
  });
});

describe('pockets', () => {
  const broken = (): LapStop => bag({ seal: { status: 'broken', tagNumber: 'M2-40871' } });

  it('opens the first pocket and collapses the others', () => {
    render(<CheckLap stops={[broken()]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('stop-p1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('stop-p2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers the next pocket by name', async () => {
    const user = userEvent.setup();
    render(<CheckLap stops={[broken()]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    const next = screen.getByTestId('next-pocket');
    expect(next).toHaveTextContent('Main compartment');
    await user.click(next);
    expect(screen.getByTestId('stop-p2')).toHaveAttribute('aria-expanded', 'true');
  });

  it('lets a pocket be opened out of order', async () => {
    const user = userEvent.setup();
    render(<CheckLap stops={[broken()]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    await user.click(screen.getByTestId('stop-p3'));
    expect(screen.getByTestId('stop-p3')).toHaveAttribute('aria-expanded', 'true');
  });

  it('runs the same four controls inside a bag as on a wall', () => {
    render(<CheckLap stops={[broken()]} answers={{}} openStopId="bag" onOpenStop={vi.fn()} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('count-at-par-a1')).toBeInTheDocument();
  });

  it('describes a collapsed bag by its pockets, not its items', () => {
    render(
      <CheckLap stops={[broken(), ...LAP]} answers={{}} openStopId="s1" onOpenStop={vi.fn()} onAnswer={vi.fn()} />
    );
    expect(screen.getByTestId('stop-bag')).toHaveTextContent('3 pockets');
  });
});
