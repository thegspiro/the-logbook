/**
 * The four controls, and the rules that make them four rather than one.
 *
 * Each type's distinguishing behaviour is asserted here because those are the
 * rules a well-meaning refactor flattens: short-of-par quietly becoming a
 * failure, an emptied box reading as zero, an expired item passing because
 * somebody confirmed they looked at it.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CheckItemControl,
  CountControl,
  ExpiryControl,
  FunctionControl,
  LevelControl,
  type CheckItemAnswer,
  type CheckItemSpec,
} from './CheckItemControls';
import { daysUntil } from '@/modules/inventory/types/equipmentCheck';

const item = (over: Partial<CheckItemSpec> = {}): CheckItemSpec => ({
  id: 'i1',
  name: 'O2 main cylinder',
  ...over,
});

/**
 * The controls are controlled components: they render whatever `answer` says.
 * Driving them with a fixed `answer` makes every keystroke overwrite the last,
 * so typing "1850" ends up asserting on "0". This harness holds the state the
 * form would hold, which is also what the control actually meets in the app.
 */
const Harness: React.FC<{
  spec: CheckItemSpec;
  control: React.FC<{
    item: CheckItemSpec;
    answer: CheckItemAnswer | undefined;
    onChange: (patch: Partial<CheckItemAnswer>) => void;
  }>;
  initial?: CheckItemAnswer;
  onChange?: (patch: Partial<CheckItemAnswer>) => void;
}> = ({ spec, control: Control, initial, onChange }) => {
  const [answer, setAnswer] = React.useState<CheckItemAnswer | undefined>(initial);
  return (
    <Control
      item={spec}
      answer={answer}
      onChange={(patch) => {
        onChange?.(patch);
        setAnswer((prev) => ({ ...prev, ...patch }));
      }}
    />
  );
};

describe('LevelControl', () => {
  it('stores the number rather than reducing it to a tick', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness spec={item({ minLevel: 500, levelUnit: 'psi' })} control={LevelControl} onChange={onChange} />);

    await user.type(screen.getByTestId('level-input-i1'), '1850');

    expect(onChange).toHaveBeenLastCalledWith({ levelReading: 1850, status: 'pass' });
  });

  it('fails the item under the threshold', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness spec={item({ minLevel: 500 })} control={LevelControl} onChange={onChange} />);

    await user.type(screen.getByTestId('level-input-i1'), '400');

    expect(onChange).toHaveBeenLastCalledWith({ levelReading: 400, status: 'fail' });
  });

  it('reads an emptied box as unread, not as zero', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        spec={item({ minLevel: 500 })}
        control={LevelControl}
        initial={{ levelReading: 1850 }}
        onChange={onChange}
      />
    );

    await user.clear(screen.getByTestId('level-input-i1'));

    // Zero would report an empty cylinder and open a swap task for a gauge
    // nobody has looked at.
    expect(onChange).toHaveBeenLastCalledWith({ levelReading: undefined, status: 'not_checked' });
  });

  it('shows the threshold and the last reading so a drift is visible', () => {
    render(
      <LevelControl
        item={item({ minLevel: 500, levelUnit: 'psi', lastLevelReading: 2100 })}
        answer={undefined}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Swap below 500 psi/)).toBeInTheDocument();
    expect(screen.getByText(/Last shift 2100 psi/)).toBeInTheDocument();
  });
});

describe('FunctionControl', () => {
  it('writes the test on the item so two people run it the same way', () => {
    render(
      <FunctionControl
        item={item({ description: 'Run 10 seconds · must pull 300 mmHg' })}
        answer={undefined}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText('Run 10 seconds · must pull 300 mmHg')).toBeInTheDocument();
  });

  it('opens the note and photo fields on a fail, every time', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<FunctionControl item={item()} answer={undefined} onChange={onChange} />);

    expect(screen.queryByTestId('function-note-i1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('function-fail-i1'));
    expect(onChange).toHaveBeenCalledWith({ status: 'fail' });

    rerender(<FunctionControl item={item()} answer={{ status: 'fail' }} onChange={onChange} />);
    expect(screen.getByTestId('function-note-i1')).toBeInTheDocument();
    expect(screen.getByTestId('function-photo-i1')).toBeInTheDocument();
  });

  it('does not require the note to move on', () => {
    render(<FunctionControl item={item()} answer={{ status: 'fail' }} onChange={vi.fn()} />);
    // A crew mid-walk should not be held at a textarea; the finished check
    // flags the gap instead.
    expect(screen.getByTestId('function-note-i1')).not.toBeRequired();
    expect(screen.getByText(/required to move on/i)).toBeInTheDocument();
  });

  it('shows no note fields on a pass', () => {
    render(<FunctionControl item={item()} answer={{ status: 'pass' }} onChange={vi.fn()} />);
    expect(screen.queryByTestId('function-note-i1')).not.toBeInTheDocument();
  });
});

describe('CountControl', () => {
  it('confirms par in one tap', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CountControl item={item({ expectedQuantity: 24 })} answer={undefined} onChange={onChange} />);

    await user.click(screen.getByTestId('count-at-par-i1'));

    expect(onChange).toHaveBeenCalledWith({ quantityFound: 24, status: 'pass', restockNeeded: false });
  });

  it('treats short of par as a restock line, NOT a failure', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CountControl item={item({ expectedQuantity: 24 })} answer={{ quantityFound: 24 }} onChange={onChange} />);

    await user.click(screen.getByTestId('count-minus-i1'));

    // The verdict stays `pass`. A truck three bandages light is not a truck
    // that failed its check, and filing it as one teaches crews that failures
    // are routine — which is how a real failure gets missed.
    expect(onChange).toHaveBeenCalledWith({ quantityFound: 23, status: 'pass', restockNeeded: true });
  });

  it('names the shortfall', () => {
    render(<CountControl item={item({ expectedQuantity: 24 })} answer={{ quantityFound: 21 }} onChange={vi.fn()} />);
    expect(screen.getByText(/3 short/)).toBeInTheDocument();
    expect(screen.getByText(/not a failure/i)).toBeInTheDocument();
  });

  it('never steps below zero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CountControl item={item({ expectedQuantity: 2 })} answer={{ quantityFound: 0 }} onChange={onChange} />);

    await user.click(screen.getByTestId('count-minus-i1'));

    expect(onChange).toHaveBeenLastCalledWith({ quantityFound: 0, status: 'pass', restockNeeded: true });
  });

  it('reads an emptied box as uncounted', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        spec={item({ expectedQuantity: 4 })}
        control={CountControl}
        initial={{ quantityFound: 4 }}
        onChange={onChange}
      />
    );

    await user.clear(screen.getByTestId('count-input-i1'));

    expect(onChange).toHaveBeenLastCalledWith({
      quantityFound: undefined,
      status: 'not_checked',
      restockNeeded: false,
    });
  });
});

describe('ExpiryControl', () => {
  const inDays = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10) ?? '';
  };

  it('confirms the date on record rather than asking for it again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ExpiryControl
        item={item({ expirationDate: inDays(200), expirationWarningDays: 14 })}
        answer={undefined}
        onChange={onChange}
      />
    );

    // No date entry — retyping a date the system already knows turns a check
    // into a transcription exercise.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('expiry-confirm-i1'));
    expect(onChange).toHaveBeenCalledWith({ expiryConfirmed: true, status: 'pass' });
  });

  it('fails an expired item even when confirmed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ExpiryControl item={item({ expirationDate: inDays(-3) })} answer={undefined} onChange={onChange} />);

    await user.click(screen.getByTestId('expiry-confirm-i1'));

    // Confirming that you read the date does not make the unit usable.
    expect(onChange).toHaveBeenCalledWith({ expiryConfirmed: true, status: 'fail' });
    expect(screen.getByText(/Out of date/i)).toBeInTheDocument();
  });

  it('warns inside the pull window on every shift', () => {
    render(
      <ExpiryControl
        item={item({ expirationDate: inDays(10), expirationWarningDays: 14 })}
        answer={{ expiryConfirmed: true }}
        onChange={vi.fn()}
      />
    );
    // Still amber after confirmation — a warning that can be cleared without
    // changing anything is a warning that stops being read.
    expect(screen.getByText(/Inside the pull window/i)).toBeInTheDocument();
  });

  it('says so when there is no date on record', () => {
    render(<ExpiryControl item={item({ expirationDate: null })} answer={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('No date on record')).toBeInTheDocument();
  });
});

describe('daysUntil', () => {
  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(null, new Date())).toBeNull();
    expect(daysUntil('not-a-date', new Date())).toBeNull();
  });

  it('is zero on the day itself', () => {
    const today = new Date(2026, 7, 23);
    expect(daysUntil('2026-08-23', today)).toBe(0);
  });

  it('is negative once past', () => {
    const today = new Date(2026, 7, 23);
    expect(daysUntil('2026-08-20', today)).toBe(-3);
  });
});

describe('CheckItemControl', () => {
  it.each([
    ['level', 'level-input-i1'],
    ['count', 'count-input-i1'],
    ['function', 'function-pass-i1'],
  ])('renders the %s control', (checkType, testId) => {
    render(<CheckItemControl item={item({ checkType, expectedQuantity: 2 })} answer={undefined} onChange={vi.fn()} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('renders the expiry control', () => {
    render(
      <CheckItemControl
        item={item({ checkType: 'expiry', expirationDate: '2027-01-01' })}
        answer={undefined}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('expiry-confirm-i1')).toBeInTheDocument();
  });

  it.each([
    ['present', 'function-pass-i1'],
    ['pass_fail', 'function-pass-i1'],
    ['functional', 'function-pass-i1'],
    ['reading', 'level-input-i1'],
    ['quantity', 'count-input-i1'],
    ['date_lot', 'expiry-confirm-i1'],
  ])('still renders a legacy %s item', (legacy, testId) => {
    // A response may reach a client that predates the collapse to four types.
    render(
      <CheckItemControl
        item={item({ checkType: legacy, expectedQuantity: 2, expirationDate: '2027-01-01' })}
        answer={undefined}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it.each(['header', 'text'])('asks nothing for a %s row', (structural) => {
    const { container } = render(
      <CheckItemControl item={item({ checkType: structural })} answer={undefined} onChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to the answerable control for an unknown type', () => {
    render(<CheckItemControl item={item({ checkType: 'presence' })} answer={undefined} onChange={vi.fn()} />);
    expect(screen.getByTestId('function-pass-i1')).toBeInTheDocument();
  });
});
