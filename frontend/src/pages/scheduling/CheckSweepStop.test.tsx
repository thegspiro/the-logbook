import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckSweepStop } from './CheckSweepStop';

import type { CheckItemSpec } from './CheckItemControls';
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

  it('keeps short of par a restock rather than a failure', async () => {
    const user = userEvent.setup();
    const onAnswer = setup([gauze]);
    await user.click(screen.getByRole('button', { name: 'One fewer 4×4 gauze' }));
    expect(onAnswer).toHaveBeenCalledWith('gauze', { quantityFound: 9, status: 'pass', restockNeeded: true });
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
