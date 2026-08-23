import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SealPanel from './SealPanel';
import type { SealState } from './SealPanel';

const noop = () => undefined;

const renderPanel = (over: Partial<React.ComponentProps<typeof SealPanel>> = {}) =>
  render(
    <SealPanel
      compartmentName="Medic 2 › Drug Bag"
      clearableCount={4}
      clearableNames={['Airway', 'IV', 'Trauma', 'Splints']}
      lastSeal={{ sealNumber: 'M2-40817', intact: true, checkedAt: '2026-08-09T12:00:00Z' }}
      onConfirmIntact={noop}
      onReportBroken={noop}
      onCountAnyway={noop}
      onReopen={noop}
      {...over}
    />
  );

const cleared: SealState = { sealNumber: 'M2-40817', intact: true, confirmed: true, countAnyway: false };

describe('SealPanel', () => {
  // Retyping a number that is already on the record is the exact work this
  // panel exists to remove.
  it('prefills the tag the last count recorded', () => {
    renderPanel();

    expect(screen.getByLabelText('Seal number on the bag')).toHaveValue('M2-40817');
    expect(screen.getByText(/Matches the last count/)).toBeInTheDocument();
  });

  it('says so when the tag differs from the last count', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByLabelText('Seal number on the bag');
    await user.clear(input);
    await user.type(input, 'M2-99999');

    expect(screen.getByText(/Different from the last count \(M2-40817\)/)).toBeInTheDocument();
  });

  it('names how many checks confirming the seal would clear', async () => {
    const onConfirmIntact = vi.fn();
    renderPanel({ onConfirmIntact });

    await userEvent.click(screen.getByRole('button', { name: 'Seal intact — clear 4 checks' }));
    expect(onConfirmIntact).toHaveBeenCalledWith('M2-40817');
  });

  // Case and padding are not the number: a tag read off a printed label may
  // come back lowercase or with a stray space.
  it('treats a differently-cased tag as the same seal', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByLabelText('Seal number on the bag');
    await user.clear(input);
    await user.type(input, ' m2-40817 ');

    expect(screen.getByText(/Matches the last count/)).toBeInTheDocument();
  });

  it('will not confirm an empty tag', async () => {
    const user = userEvent.setup();
    renderPanel({ lastSeal: undefined });

    expect(screen.getByRole('button', { name: /Seal intact/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Seal number on the bag'), 'M2-1');
    expect(screen.getByRole('button', { name: /Seal intact/ })).toBeEnabled();
  });

  it('reports what the seal cleared, and offers to count anyway', async () => {
    const onCountAnyway = vi.fn();
    renderPanel({ state: cleared, onCountAnyway });

    expect(screen.getByText('Tag M2-40817 matches the last count.')).toBeInTheDocument();
    expect(screen.getByText(/4 contents checks cleared by the seal — Airway, IV, Trauma, Splints/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Count anyway/ }));
    expect(onCountAnyway).toHaveBeenCalled();
  });

  // A broken seal is the more important of the two records: it is what says
  // the contents below were counted by hand.
  it('states plainly that a broken seal means counting the contents', () => {
    renderPanel({ state: { sealNumber: 'M2-40817', intact: false, confirmed: true, countAnyway: false } });

    expect(screen.getByText('Seal broken or missing')).toBeInTheDocument();
    expect(screen.getByText(/Recorded tag M2-40817\. Count the contents below\./)).toBeInTheDocument();
  });

  it('lets a crew take the confirmation back', async () => {
    const onReopen = vi.fn();
    renderPanel({ state: cleared, onReopen });

    await userEvent.click(screen.getByRole('button', { name: 'Broken?' }));
    expect(onReopen).toHaveBeenCalled();
  });
});
