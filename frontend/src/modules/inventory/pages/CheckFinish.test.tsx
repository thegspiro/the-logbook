import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckFinish } from './CheckFinish';

import type { CheckItemSpec } from './CheckItemControls';
import type { AnswerMap, LapStop } from './checkLapModel';

const count = (id: string, par: number): CheckItemSpec => ({ id, name: id, checkType: 'count', expectedQuantity: par });
const fn = (id: string): CheckItemSpec => ({ id, name: id, checkType: 'function' });

const STOPS: LapStop[] = [
  { id: 'cab', name: 'Cab', items: [fn('lights'), fn('siren')] },
  { id: 'pump', name: 'Pump Panel', items: [fn('regulator')] },
  { id: 'ems', name: 'EMS cabinet', items: [count('gauze', 10), count('saline', 6), fn('suction')] },
];

const setup = (answers: AnswerMap, over: Partial<React.ComponentProps<typeof CheckFinish>> = {}) => {
  const props = {
    stops: STOPS,
    answers,
    onJump: vi.fn(),
    onSubmit: vi.fn(),
    onBack: vi.fn(),
    submittingAs: 'FF Delgado',
    goesTo: 'Lt. Ruiz',
    ...over,
  };
  render(<CheckFinish {...props} />);
  return props;
};

const ALL_GOOD: AnswerMap = {
  lights: { status: 'pass' },
  siren: { status: 'pass' },
  regulator: { status: 'pass' },
  gauze: { status: 'pass', quantityFound: 10 },
  saline: { status: 'pass', quantityFound: 6 },
  suction: { status: 'pass' },
};

describe('CheckFinish', () => {
  it('lists the faults and where they are, because that is what is still undecided', () => {
    setup({ ...ALL_GOOD, regulator: { status: 'fail' } });
    expect(screen.getByTestId('finish-fault-regulator')).toHaveTextContent('Fault · regulator');
    expect(screen.getByTestId('finish-fault-regulator')).toHaveTextContent('Stop 2 · Pump Panel');
  });

  it('accounts for everything good in one line rather than a list', () => {
    setup(ALL_GOOD);
    expect(screen.getByText(/do not have to read them again/)).toBeVisible();
    expect(screen.getByText('6')).toBeVisible();
    expect(screen.queryByTestId('finish-unanswered')).not.toBeInTheDocument();
  });

  it('offers one jump per stop, not one per unanswered item', async () => {
    const user = userEvent.setup();
    // Two unanswered items in the same cabinet: the crew is going back to a
    // place, so two buttons to that place would be two ways to say one thing.
    const props = setup({ ...ALL_GOOD, gauze: {}, saline: {} });
    const jumps = screen.getAllByRole('button', { name: /^Go to stop/ });
    expect(jumps).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Go to stop 3' }));
    expect(props.onJump).toHaveBeenCalledWith(2);
  });

  it('separates a restock from a fault, and says how far short', () => {
    setup({ ...ALL_GOOD, gauze: { status: 'pass', quantityFound: 6 } });
    const restocks = screen.getByTestId('finish-restocks');
    expect(restocks).toHaveTextContent('1 restock line');
    expect(restocks).toHaveTextContent('gauze −4');
    // A shortfall is not a fault and must not be counted as one.
    expect(screen.queryByTestId('finish-fault-gauze')).not.toBeInTheDocument();
  });

  it('says what submitting will carry, rather than hiding the gap', async () => {
    const user = userEvent.setup();
    const props = setup({ ...ALL_GOOD, gauze: {}, siren: {} });
    const submit = screen.getByRole('button', { name: 'Submit with 2 unanswered' });
    await user.click(submit);
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('warns by default but blocks only where the template says so', () => {
    setup({ ...ALL_GOOD, gauze: {} }, { blockOnUnanswered: true });
    const submit = screen.getByRole('button', { name: 'Answer 1 more to submit' });
    expect(submit).toBeDisabled();
  });

  it('names who is submitting and who it reaches, because a check is a record', () => {
    setup(ALL_GOOD);
    expect(screen.getByText(/Submitting as/)).toHaveTextContent('Submitting as FF Delgado · goes to Lt. Ruiz');
  });

  it('counts a stop once however many things are wrong in it', () => {
    // Three problems, all in the EMS cabinet. The crew has one place to go.
    setup({ ...ALL_GOOD, gauze: {}, saline: {}, suction: { status: 'fail' } });
    expect(screen.getByTestId('finish-tally')).toHaveTextContent('1 stop needs a look');
  });

  it('counts each stop that needs a look, once', () => {
    setup({ ...ALL_GOOD, gauze: {}, siren: { status: 'fail' } });
    expect(screen.getByTestId('finish-tally')).toHaveTextContent('2 stops need a look');
  });
});

describe('the note about the whole truck', () => {
  it('can be written, and a restored one is visible before it is filed', async () => {
    const user = userEvent.setup();
    const onOverallNotesChange = vi.fn();
    setup(ALL_GOOD, { overallNotes: 'Nearside step still loose', onOverallNotesChange });
    const field = screen.getByTestId('sweep-overall-notes');
    expect(field).toHaveValue('Nearside step still loose');
    await user.type(field, '.');
    expect(onOverallNotesChange).toHaveBeenCalled();
  });

  it('is absent where nothing can receive it', () => {
    setup(ALL_GOOD);
    expect(screen.queryByTestId('sweep-overall-notes')).not.toBeInTheDocument();
  });
});
