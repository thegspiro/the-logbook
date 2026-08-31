import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckSweepStop } from './CheckSweepStop';

import type { CheckItemAnswer, CheckItemSpec } from './CheckItemControls';
import type { AnswerMap, LapStop } from './checkLapModel';

const stop = (items: CheckItemSpec[]): LapStop => ({ id: 's', name: 'EMS cabinet', items });

const setup = (items: CheckItemSpec[], answers: AnswerMap = {}) => {
  const onAnswer = vi.fn();
  render(<CheckSweepStop stop={stop(items)} answers={answers} onAnswer={onAnswer} />);
  return onAnswer;
};

/** A date far enough out that it is neither expired nor in the pull window. */
const FAR = '2099-01-01';
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

describe('the count tally', () => {
  const gauze: CheckItemSpec = { id: 'gauze', name: '4×4 gauze', checkType: 'count', expectedQuantity: 10 };

  it('shows par and found as separate columns, unread until answered', () => {
    setup([gauze]);
    expect(screen.getByTestId('tally-value-gauze')).toHaveTextContent('—');
  });

  it('counts from par, so a full cabinet is one tap off the top', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([gauze]);
    await user.click(screen.getByRole('button', { name: 'One fewer 4×4 gauze' }));
    // Not from zero: the crew is adjusting a par they can see, not entering a
    // number from scratch.
    expect(onAnswer).toHaveBeenCalledWith('gauze', expect.objectContaining({ quantityFound: 9 }));
  });

  it('reports short of par as a restock, whatever it stores', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([gauze]);
    await user.click(screen.getByRole('button', { name: 'One fewer 4×4 gauze' }));
    // Stored as a failure, because that is what the record holds either way.
    expect(onAnswer).toHaveBeenCalledWith('gauze', { quantityFound: 9, status: 'fail', restockNeeded: true });
  });

  it('never counts below zero', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([{ ...gauze, expectedQuantity: 0 }]);
    await user.click(screen.getByRole('button', { name: 'One fewer 4×4 gauze' }));
    expect(onAnswer).toHaveBeenCalledWith('gauze', expect.objectContaining({ quantityFound: 0 }));
  });
});

describe('the gauge card', () => {
  const cylinder: CheckItemSpec = {
    id: 'o2',
    name: 'O₂ cylinder',
    checkType: 'level',
    minLevel: 1500,
    levelUnit: 'psi',
    lastLevelReading: 1850,
  };

  it('puts the threshold and the last reading beside the box, because the trend is the point', () => {
    setup([cylinder]);
    expect(screen.getByText('Swap below 1500 psi')).toBeVisible();
    expect(screen.getByText('Last shift 1850 psi')).toBeVisible();
  });

  it('fails a reading under the threshold, and says what that opens', () => {
    const onAnswer = setup([cylinder]);
    // `fireEvent.change` rather than `user.type`: the box is controlled by the
    // answer above it, and a spy feeds nothing back, so typed characters cannot
    // accumulate. A real reading arrives as one value either way.
    fireEvent.change(screen.getByTestId('gauge-input-o2'), { target: { value: '900' } });
    expect(onAnswer).toHaveBeenLastCalledWith('o2', { levelReading: 900, status: 'fail' });

    setup([cylinder], { o2: { levelReading: 900, status: 'fail' } });
    expect(screen.getByText(/opens a swap task/)).toBeVisible();
  });

  it('treats an emptied box as unread, not as an empty cylinder', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([cylinder], { o2: { levelReading: 1800, status: 'pass' } });
    await user.clear(screen.getByTestId('gauge-input-o2'));
    // Zero would report an empty cylinder and open a swap task for a gauge
    // nobody has looked at.
    expect(onAnswer).toHaveBeenLastCalledWith('o2', { levelReading: undefined, status: 'not_checked' });
  });
});

describe('the switch row', () => {
  const lights: CheckItemSpec = {
    id: 'lights',
    name: 'Emergency lights',
    checkType: 'function',
    description: 'All four quadrants, plus the traffic advisor.',
  };

  it('writes the test beside the item, so two people run it the same way', () => {
    setup([lights]);
    expect(screen.getByText('All four quadrants, plus the traffic advisor.')).toBeVisible();
  });

  it('records the verdict, and says which one is pressed', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([lights]);
    await user.click(screen.getByRole('button', { name: 'Emergency lights does not work' }));
    expect(onAnswer).toHaveBeenCalledWith('lights', { status: 'fail' });

    setup([lights], { lights: { status: 'fail' } });
    expect(screen.getAllByRole('button', { name: 'Emergency lights does not work' })[1]).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});

describe('the expiry row', () => {
  it('confirms the date rather than asking for it again', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([{ id: 'epi', name: 'Epinephrine 1 mg', checkType: 'expiry', expirationDate: FAR }]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAnswer).toHaveBeenCalledWith('epi', { expiryConfirmed: true, status: 'pass' });
  });

  it('fails an expired unit whatever the crew taps', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([{ id: 'old', name: 'Midazolam', checkType: 'expiry', expirationDate: YESTERDAY }]);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    // Confirming that you read it does not make it usable.
    expect(onAnswer).toHaveBeenCalledWith('old', { expiryConfirmed: true, status: 'fail' });
  });
});

describe('layout rows', () => {
  it('renders a heading and an instruction, and asks nothing of either', () => {
    setup([
      { id: 'h', name: 'WARNING DEVICES', checkType: 'header' },
      { id: 't', name: 'Ask dispatch for a radio check.', checkType: 'text' },
    ]);
    expect(screen.getByText('WARNING DEVICES')).toBeVisible();
    expect(screen.getByText('Ask dispatch for a radio check.')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('a switch that fails', () => {
  const siren: CheckItemSpec = { id: 'siren', name: 'Siren', checkType: 'function' };

  it('asks nothing extra while it passes', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([siren]);
    await user.click(screen.getByRole('button', { name: 'Siren works' }));
    expect(onAnswer).toHaveBeenCalledWith('siren', { status: 'pass' });
    expect(screen.queryByTestId('function-note-siren')).not.toBeInTheDocument();
  });

  it('opens the note and the photo, because a status code is not a fault report', () => {
    // Rendered from the answer, not from the click: the sweep is controlled, so
    // a fail already on the record has to open these on mount too.
    setup([siren], { siren: { status: 'fail' } });
    expect(screen.getByTestId('function-note-siren')).toBeVisible();
    expect(screen.getByTestId('function-photo-siren')).toBeInTheDocument();
  });

  it('records the note against the item that failed', () => {
    const onAnswer = setup([siren], { siren: { status: 'fail' } });
    fireEvent.change(screen.getByTestId('function-note-siren'), {
      target: { value: 'Wails then cuts out after ~3s.' },
    });
    expect(onAnswer).toHaveBeenCalledWith('siren', { notes: 'Wails then cuts out after ~3s.' });
  });

  it('never blocks the walk on either field', () => {
    // The fault detail is the one place a crew mid-walk could be trapped, so
    // the absence of a required marker is the assertion, not an oversight.
    setup([siren], { siren: { status: 'fail' } });
    expect(screen.getByTestId('function-note-siren')).not.toBeRequired();
    expect(screen.getByText(/Neither is required to move on/)).toBeVisible();
  });
});

describe('replacing what is expiring', () => {
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const epi = (over: Partial<CheckItemSpec> = {}): CheckItemSpec => ({
    id: 'epi',
    name: 'Epi 1:1000',
    checkType: 'expiry',
    expirationDate: soon,
    inventoryItemId: 'inv-1',
    ...over,
  });

  const mount = (item: CheckItemSpec) => {
    const onSwap = vi.fn();
    render(
      <CheckSweepStop
        stop={{ id: 's', name: 'Drug box', items: [item] }}
        answers={{}}
        onAnswer={vi.fn()}
        onSwap={onSwap}
      />
    );
    return onSwap;
  };

  it('offers the swap the expiry rule is asking for', async () => {
    // The seal rule tells the crew to open the container and replace what is
    // expiring. Without this they have to leave the walk to act on it.
    const user = userEvent.setup();
    const onSwap = mount(epi());
    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(onSwap).toHaveBeenCalledWith('epi');
  });

  it('calls an in-window swap a swap, not a replacement', () => {
    // Only an expired unit is *replaced*. `swap_item_lot` refuses to retire a
    // lot that is still in date — the disposition it files says the unit was
    // disposed of as expired, and that is untrue of a box with weeks left on
    // it. So an in-window swap is a top-up, and calling it "Replace" would
    // promise a retirement the crew cannot get.
    mount(epi());
    expect(screen.getByRole('button', { name: 'Swap' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
  });

  it('does not offer a submitter an in-window swap the server will refuse', () => {
    // Below manage, `swap_item_lot` allows a swap with no disposition only up
    // to the position's count shortfall, and an expiry-only row has no count —
    // so the POST comes back 403 every time. Disabled with the reason beats a
    // tap that spends the crew's attention on an error.
    render(
      <CheckSweepStop
        stop={{ id: 's', name: 'Drug box', items: [epi()] }}
        answers={{}}
        onAnswer={vi.fn()}
        onSwap={vi.fn()}
        canManageSwap={false}
      />
    );
    const swap = screen.getByRole('button', { name: 'Swap' });
    expect(swap).toBeDisabled();
    expect(swap).toHaveAttribute('title', expect.stringContaining('has not expired yet'));
  });

  it('still lets a submitter replace stock that has actually expired', () => {
    // The expired path carries a disposition, which the endpoint allows up to
    // the expired units aboard — so this one is not theirs to lose.
    render(
      <CheckSweepStop
        stop={{ id: 's', name: 'Drug box', items: [epi({ expirationDate: YESTERDAY })] }}
        answers={{}}
        onAnswer={vi.fn()}
        onSwap={vi.fn()}
        canManageSwap={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toBeEnabled();
  });

  it('lets a submitter top up a counted position that is demonstrably short', () => {
    // Here the shortfall the endpoint measures is real and visible on the row,
    // so the swap is one the server will accept.
    render(
      <CheckSweepStop
        stop={{ id: 's', name: 'Drug box', items: [epi({ expectedQuantity: 4, carriedQuantity: 1 })] }}
        answers={{}}
        onAnswer={vi.fn()}
        onSwap={vi.fn()}
        canManageSwap={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Swap' })).toBeEnabled();
  });

  it('calls an expired swap a replacement, because that one does retire stock', () => {
    mount(epi({ expirationDate: YESTERDAY }));
    expect(screen.getByRole('button', { name: 'Replace' })).toBeVisible();
  });

  it('offers nothing where there is no ready stock to draw from', () => {
    mount(epi({ inventoryItemId: null }));
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
  });

  it('offers nothing on a date that is nowhere near', () => {
    mount(epi({ expirationDate: FAR }));
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
  });
});

describe('an item this truck does not carry', () => {
  const gauze: CheckItemSpec = { id: 'gauze', name: 'Roller gauze', checkType: 'count', expectedQuantity: 10 };

  it('can be answered without counting it to zero', async () => {
    // Zero is a shortage, which the server turns into a failure; leaving it
    // alone files the check incomplete. Neither is true of an item the
    // apparatus simply does not carry.
    const user = userEvent.setup();
    const onAnswer = setup([gauze]);
    await user.click(screen.getByRole('button', { name: 'Roller gauze is not on this truck' }));
    expect(onAnswer).toHaveBeenCalledWith('gauze', { status: 'not_applicable' });
  });

  it('stops offering a count once it is marked not carried', () => {
    setup([gauze], { gauze: { status: 'not_applicable' } });
    expect(screen.getByRole('button', { name: 'One more Roller gauze' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Roller gauze is not on this truck' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('can be taken back', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([gauze], { gauze: { status: 'not_applicable' } });
    await user.click(screen.getByRole('button', { name: 'Roller gauze is not on this truck' }));
    expect(onAnswer).toHaveBeenCalledWith('gauze', { status: 'not_checked' });
  });
});

describe('a bag with pockets', () => {
  const bag = (): LapStop => ({
    id: 'bag',
    name: 'Airway bag',
    items: [{ id: 'seal-check', name: 'Zip pull', checkType: 'function' }],
    children: [
      {
        id: 'front',
        name: 'Front pocket',
        items: [{ id: 'opa', name: 'OPA set', checkType: 'count', expectedQuantity: 1 }],
      },
      {
        id: 'main',
        name: 'Main compartment',
        items: [{ id: 'bvm', name: 'BVM', checkType: 'function' }],
        children: [
          { id: 'inner', name: 'Inner sleeve', items: [{ id: 'peep', name: 'PEEP valve', checkType: 'function' }] },
        ],
      },
    ],
  });

  const mountBag = () => {
    const onAnswer = vi.fn();
    render(<CheckSweepStop stop={bag()} answers={{}} onAnswer={onAnswer} />);
    return onAnswer;
  };

  it('shows the pockets, because the tally already counts what is in them', () => {
    // stopItems() walks the whole tree, so a pocket that does not render is an
    // item the crew is asked for and cannot find: "3 of 4" with three on screen.
    mountBag();
    expect(screen.getByTestId('pocket-front')).toBeVisible();
    expect(screen.getByTestId('pocket-main')).toBeVisible();
    expect(screen.getByText('OPA set')).toBeVisible();
    expect(screen.getByText('BVM')).toBeVisible();
  });

  it('goes all the way down, not one level', () => {
    mountBag();
    expect(screen.getByTestId('pocket-inner')).toBeVisible();
    expect(screen.getByText('PEEP valve')).toBeVisible();
  });

  it('keeps the bag its own items too', () => {
    mountBag();
    expect(screen.getByText('Zip pull')).toBeVisible();
  });

  it('names each pocket, so a found fault has somewhere to be', () => {
    mountBag();
    expect(screen.getByRole('heading', { name: 'Front pocket' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Inner sleeve' })).toBeVisible();
  });

  it('answers a pocket item against its own id, not the bag', async () => {
    const user = userEvent.setup();
    const onAnswer = mountBag();
    await user.click(screen.getByRole('button', { name: 'PEEP valve works' }));
    expect(onAnswer).toHaveBeenCalledWith('peep', { status: 'pass' });
  });
});

describe('a sealed container', () => {
  const gauze: CheckItemSpec = { id: 'gauze', name: '4×4 gauze', checkType: 'count', expectedQuantity: 10 };
  const morphine: CheckItemSpec = { id: 'morphine', name: 'Morphine', checkType: 'count', expectedQuantity: 2 };
  const cylinder: CheckItemSpec = { id: 'o2', name: 'O2 cylinder', checkType: 'level' };
  const expiring: CheckItemSpec = { id: 'epi', name: 'Epi 1:1000', checkType: 'expiry', expirationDate: FAR };

  const box = (seal?: LapStop['seal']): LapStop => ({
    id: 'drugs',
    name: 'Drug box',
    isSealed: true,
    ...(seal ? { seal } : {}),
    items: [gauze, morphine, cylinder, expiring],
  });

  const mount = (seal?: LapStop['seal']) => {
    const onSeal = vi.fn();
    render(<CheckSweepStop stop={box(seal)} answers={{}} onAnswer={vi.fn()} onSeal={onSeal} />);
    return onSeal;
  };

  it('asks the tag first, and names the number on record', () => {
    mount({ tagNumber: 'M2-40871' });
    expect(screen.getByText('Read the tag before you open it')).toBeVisible();
    expect(screen.getByText('M2-40871')).toBeVisible();
  });

  it('does not clear the counting before anybody has read the tag', () => {
    // The whole point of a seal is evidence. An unread one is not evidence,
    // and clearing on it would answer the counts for a crew that never looked.
    mount({ tagNumber: 'M2-40871' });
    expect(screen.getByTestId('tally-row-morphine')).toBeVisible();
    expect(screen.getByTestId('tally-row-gauze')).toBeVisible();
  });

  it('records the crew reading the tag, and clears on evidence', async () => {
    const user = userEvent.setup();
    const onSeal = mount({ tagNumber: 'M2-40871', priorIntact: true });
    await user.click(screen.getByRole('button', { name: 'Tag matches' }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'intact', cleared: true });
  });

  it('clears nothing when the last check found the seal broken', async () => {
    // A matching number proves nothing about the time since a seal that was
    // already open. The crew can still say the tag in their hand is intact.
    const user = userEvent.setup();
    const onSeal = mount({ tagNumber: 'M2-40871', priorIntact: false });
    expect(screen.getByTestId('seal-no-evidence-drugs')).toHaveTextContent('found this seal broken');
    await user.click(screen.getByRole('button', { name: 'Tag matches' }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'intact', cleared: false });
  });

  it('clears nothing when there is no tag on record to match against', async () => {
    const user = userEvent.setup();
    const onSeal = mount();
    expect(screen.getByTestId('seal-no-evidence-drugs')).toHaveTextContent('Nothing on record to match against');
    await user.click(screen.getByRole('button', { name: 'Tag matches' }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'intact', cleared: false });
  });

  it('takes the counting off the screen once the tag matches', () => {
    mount({ status: 'intact', tagNumber: 'M2-40871', priorIntact: true });
    expect(screen.queryByTestId('tally-row-morphine')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tally-row-gauze')).not.toBeInTheDocument();
  });

  it('still asks the dates and the readings, because a seal proves unchanged, not full', () => {
    // These move while the box sits shut, which is the entire reason they are
    // exempt from what an intact tag answers for.
    mount({ status: 'intact', tagNumber: 'M2-40871', priorIntact: true });
    expect(screen.getByTestId('gauge-o2')).toBeVisible();
    expect(screen.getByTestId('expiry-epi')).toBeVisible();
  });

  it('brings the full count back when the tag is broken or wrong', async () => {
    const user = userEvent.setup();
    const onSeal = mount({ tagNumber: 'M2-40871' });
    await user.click(screen.getByRole('button', { name: 'Broken or wrong' }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'broken' });
  });

  it('names the replacement tag on a broken seal, so the re-seal comes off the record', () => {
    mount({ status: 'broken', tagNumber: 'M2-40871', replacementTagNumber: 'M2-40872' });
    expect(screen.getByTestId('seal-drugs')).toHaveTextContent('M2-40872');
    expect(screen.getByTestId('tally-row-morphine')).toBeVisible();
  });

  it('lets the crew take back a reading they got wrong', async () => {
    const user = userEvent.setup();
    const onSeal = mount({ status: 'intact', tagNumber: 'M2-40871', priorIntact: true });
    await user.click(screen.getByRole('button', { name: /the tag is broken or wrong/ }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'broken' });
  });

  it('undoing a broken reading clears no more than the first reading would have', async () => {
    // The undo path is a second way into `intact`, so it needs the same
    // evidence test the front door applies — otherwise a crew taps Broken,
    // taps Undo, and the counts they never performed come off the screen.
    const user = userEvent.setup();
    const onSeal = mount({ status: 'broken', tagNumber: 'M2-40871', priorIntact: false });
    await user.click(screen.getByRole('button', { name: /the tag matches after all/ }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'intact', cleared: false });
  });

  it('undoing a broken reading still clears where the evidence holds', async () => {
    const user = userEvent.setup();
    const onSeal = mount({ status: 'broken', tagNumber: 'M2-40871', priorIntact: true });
    await user.click(screen.getByRole('button', { name: /the tag matches after all/ }));
    expect(onSeal).toHaveBeenCalledWith('drugs', { status: 'intact', cleared: true });
  });

  it('shows no seal surface on a container that is not sealed', () => {
    render(<CheckSweepStop stop={{ id: 'cab', name: 'Cab', items: [gauze] }} answers={{}} onAnswer={vi.fn()} />);
    expect(screen.queryByTestId('seal-cab')).not.toBeInTheDocument();
  });
});

describe('counts carried forward from the last check', () => {
  // 12 found against a par of 10 is the case that matters: the surplus is real
  // and the next crew opens on it, so anything that "resets to par" is losing
  // a number somebody actually counted.
  const gauze: CheckItemSpec = {
    id: 'gauze',
    name: 'Roller gauze',
    checkType: 'count',
    expectedQuantity: 10,
    carriedQuantity: 12,
  };

  it('opens on what was last recorded, not on par', () => {
    setup([gauze]);
    expect(screen.getByTestId('tally-value-gauze')).toHaveTextContent('12');
  });

  it('does not read as answered, because nobody has looked yet', () => {
    // The number being on screen is not a check. Left indistinguishable from a
    // confirmed value, a crew could submit a full report having opened nothing
    // and the progress counter would agree with them.
    setup([gauze]);
    expect(screen.getByTestId('tally-value-gauze').className).toContain('text-theme-text-muted');
    expect(screen.getByTestId('tally-carried-note')).toBeVisible();
  });

  it('reads as answered once the crew touches it', () => {
    setup([gauze], { gauze: { status: 'pass', quantityFound: 12 } });
    expect(screen.getByTestId('tally-value-gauze').className).toContain('text-theme-alert-success-text');
    expect(screen.queryByTestId('tally-carried-note')).not.toBeInTheDocument();
  });

  it('counts up from the carried number, not from par', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([gauze]);
    await user.click(screen.getByRole('button', { name: 'One more Roller gauze' }));
    expect(onAnswer).toHaveBeenCalledWith('gauze', expect.objectContaining({ quantityFound: 13 }));
  });

  it('says nothing about carrying when there is nothing carried', () => {
    setup([{ id: 'tape', name: 'Tape', checkType: 'count', expectedQuantity: 4 }]);
    expect(screen.queryByTestId('tally-carried-note')).not.toBeInTheDocument();
  });
});

describe('a seal over something that is expiring', () => {
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const morphine: CheckItemSpec = { id: 'morphine', name: 'Morphine', checkType: 'count', expectedQuantity: 2 };

  const tray = (expiry: string, status?: 'intact' | 'broken'): LapStop => ({
    id: 'tray',
    name: 'Medication tray',
    isSealed: true,
    seal: { ...(status ? { status } : {}), tagNumber: 'M2-40871', replacementTagNumber: 'M2-40872' },
    items: [morphine, { id: 'epi', name: 'Epi 1:1000', checkType: 'expiry', expirationDate: expiry }],
  });

  const mount = (stop: LapStop) => {
    const onSeal = vi.fn();
    render(<CheckSweepStop stop={stop} answers={{}} onAnswer={vi.fn()} onSeal={onSeal} />);
    return onSeal;
  };

  it('leaves an intact seal alone while nothing inside is close', () => {
    mount(tray(FAR, 'intact'));
    expect(screen.getByTestId('seal-tray')).toHaveTextContent('Seal intact');
    expect(screen.queryByTestId('seal-blocker-epi')).not.toBeInTheDocument();
  });

  it('tells the crew to open it when a drug inside is inside the pull window', () => {
    mount(tray(soon, 'intact'));
    expect(screen.getByTestId('seal-tray')).toHaveTextContent('Break the seal');
    expect(screen.getByTestId('seal-blocker-epi')).toHaveTextContent('is inside the pull window');
  });

  it('says so for an expired drug, and names it', () => {
    mount(tray(YESTERDAY, 'intact'));
    expect(screen.getByTestId('seal-blocker-epi')).toHaveTextContent('has expired');
    expect(screen.getByTestId('seal-tray')).toHaveTextContent('Epi 1:1000');
  });

  it('never shows the calm banner over a tray that has to be opened', () => {
    // The failure this guards against is the quiet one: "seal intact, all
    // good" over a tray holding an expired drug, and a crew that carries it.
    mount(tray(YESTERDAY, 'intact'));
    expect(screen.getByTestId('seal-tray')).not.toHaveTextContent('Seal intact');
  });

  it('brings the counting back, because an opened container vouches for nothing', () => {
    mount(tray(YESTERDAY, 'intact'));
    expect(screen.getByTestId('tally-row-morphine')).toBeVisible();
  });

  it('names the replacement tag so the re-seal comes off the record', () => {
    mount(tray(YESTERDAY, 'intact'));
    expect(screen.getByTestId('seal-tray')).toHaveTextContent('M2-40872');
  });

  it('warns before the tag is read, since the tag was never going to change the answer', () => {
    mount(tray(YESTERDAY));
    expect(screen.getByTestId('seal-tray')).toHaveTextContent('Break the seal');
  });

  it('records the crew breaking it', async () => {
    const user = userEvent.setup();
    const onSeal = mount(tray(YESTERDAY, 'intact'));
    await user.click(screen.getByRole('button', { name: 'I have broken the seal' }));
    expect(onSeal).toHaveBeenCalledWith('tray', { status: 'broken' });
  });
});

describe('a sealed bag with pockets', () => {
  const gauze: CheckItemSpec = { id: 'gauze', name: 'Gauze', checkType: 'count', expectedQuantity: 4 };
  const igel: CheckItemSpec = { id: 'igel', name: 'i-gel size 4', checkType: 'count', expectedQuantity: 2 };
  const cylinder: CheckItemSpec = { id: 'o2', name: 'O2 cylinder', checkType: 'level' };

  const bag = (pocketSeal?: LapStop['seal']): LapStop => ({
    id: 'bag',
    name: 'Airway bag',
    isSealed: true,
    seal: { status: 'intact', tagNumber: 'M2-40871' },
    items: [gauze],
    children: [
      {
        id: 'front',
        name: 'Front pocket',
        items: [igel, cylinder],
        ...(pocketSeal ? { isSealed: true, seal: pocketSeal } : {}),
      },
    ],
  });

  it('clears the counting in the pockets too, since they are inside the same tag', () => {
    // The model already clears the whole tree. Leaving pocket rows on screen
    // means the tally reports them answered while they sit there asking.
    render(<CheckSweepStop stop={bag()} answers={{}} onAnswer={vi.fn()} onSeal={vi.fn()} />);
    expect(screen.queryByTestId('tally-row-gauze')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tally-row-igel')).not.toBeInTheDocument();
  });

  it('still asks the pocket for what a seal cannot vouch for', () => {
    render(<CheckSweepStop stop={bag()} answers={{}} onAnswer={vi.fn()} onSeal={vi.fn()} />);
    expect(screen.getByTestId('gauge-o2')).toBeVisible();
  });

  it('lets a pocket with its own tag answer for itself', () => {
    // An outer seal clearing says nothing about an inner one: a pouch sealed
    // inside this bag is a separate claim, and it has its own card to make it.
    render(<CheckSweepStop stop={bag({ tagNumber: 'P9-112' })} answers={{}} onAnswer={vi.fn()} onSeal={vi.fn()} />);
    expect(screen.getByTestId('seal-front')).toHaveTextContent('Read the tag');
    expect(screen.getByTestId('tally-row-igel')).toBeVisible();
  });

  it('asks everything again once the bag tag is broken', () => {
    const broken = { ...bag(), seal: { status: 'broken' as const } };
    render(<CheckSweepStop stop={broken} answers={{}} onAnswer={vi.fn()} onSeal={vi.fn()} />);
    expect(screen.getByTestId('tally-row-gauze')).toBeVisible();
    expect(screen.getByTestId('tally-row-igel')).toBeVisible();
  });
});

describe('which day an expiry is judged against', () => {
  it('uses the day it is given, not the device clock', () => {
    // Expiry is the one verdict that comes from the department's record rather
    // than the crew, so a phone an hour the wrong side of midnight must not
    // move it. The accordion derives the day from the org timezone; the sweep
    // is handed the same one.
    const item: CheckItemSpec = { id: 'epi', name: 'Epi', checkType: 'expiry', expirationDate: '2026-06-10' };
    const stop: LapStop = { id: 's', name: 'Drug box', items: [item] };

    const { unmount } = render(
      <CheckSweepStop stop={stop} answers={{}} onAnswer={vi.fn()} today={new Date(2026, 5, 20)} />
    );
    expect(screen.getByTestId('expiry-epi')).toHaveTextContent('10 days ago');
    unmount();

    render(<CheckSweepStop stop={stop} answers={{}} onAnswer={vi.fn()} today={new Date(2026, 5, 1)} />);
    expect(screen.getByTestId('expiry-epi')).toHaveTextContent('9 days');
  });

  it('judges Confirm against that same day, not the phone', async () => {
    // Rendering against the org's day and storing against the device's is the
    // one combination that produces a record disagreeing with the screen the
    // crew read — an item shown expired, filed as a pass.
    const user = userEvent.setup();
    // Dated past the supplied day and well ahead of any clock this suite runs
    // on, so the two verdicts genuinely disagree.
    const item: CheckItemSpec = { id: 'epi', name: 'Epi', checkType: 'expiry', expirationDate: '2099-06-10' };
    const onAnswer = vi.fn();
    render(
      <CheckSweepStop
        stop={{ id: 's', name: 'Drug box', items: [item] }}
        answers={{}}
        onAnswer={onAnswer}
        today={new Date(2099, 5, 20)}
      />
    );
    expect(screen.getByTestId('expiry-epi')).toHaveTextContent('10 days ago');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAnswer).toHaveBeenCalledWith('epi', expect.objectContaining({ status: 'fail' }));
  });
});

describe('marking a count not applicable', () => {
  const gauze: CheckItemSpec = { id: 'gauze', name: '4×4 gauze', checkType: 'count', expectedQuantity: 10 };

  it('clears the number along with the status', async () => {
    // Patches are merged, and the server reconciles any non-null observation
    // into the apparatus inventory whatever status sits beside it — so a count
    // left behind by an earlier tap rewrites the stock for an item the crew
    // has just said is not aboard.
    const user = userEvent.setup();
    const onAnswer = vi.fn<(id: string, patch: Partial<CheckItemAnswer>) => void>();
    render(
      <CheckSweepStop
        stop={stop([gauze])}
        answers={{ gauze: { status: 'fail', quantityFound: 4 } }}
        onAnswer={onAnswer}
      />
    );
    await user.click(screen.getByRole('button', { name: '4×4 gauze is not on this truck' }));
    // Strict, because the patch is merged: omitting the key leaves the old
    // count in place, which is the bug. Only an explicit undefined clears it,
    // and `toHaveBeenCalledWith` treats the two as equal.
    expect(onAnswer.mock.calls[0]).toStrictEqual(['gauze', { status: 'not_applicable', quantityFound: undefined }]);
  });

  it('shows no number at all once the item is not aboard', () => {
    // The carried figure is last check's count, shown as a suggestion until
    // this crew answers. `not_applicable` counts as confirmed, so falling back
    // to it here repaints last month's number as one somebody observed today —
    // while submission omits the quantity entirely.
    render(
      <CheckSweepStop
        stop={stop([{ ...gauze, carriedQuantity: 7 }])}
        answers={{ gauze: { status: 'not_applicable' } }}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByTestId('tally-value-gauze')).toHaveTextContent('—');
  });

  it('still offers the carried figure while the item is on the truck', () => {
    render(<CheckSweepStop stop={stop([{ ...gauze, carriedQuantity: 7 }])} answers={{}} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('tally-value-gauze')).toHaveTextContent('7');
  });
});
