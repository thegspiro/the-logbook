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

const cleared: SealState = { sealNumber: 'M2-40817', intact: true, confirmed: true, cleared: true };

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
    expect(onConfirmIntact).toHaveBeenCalledWith('M2-40817', true);
  });

  // A tag nobody recognises is evidence the bag was opened, not evidence it
  // stayed shut. The panel used to say exactly that and then offer to clear
  // the contents anyway.
  it('records but does not clear when the tag differs from the last count', async () => {
    const user = userEvent.setup();
    const onConfirmIntact = vi.fn();
    renderPanel({ onConfirmIntact });

    const input = screen.getByLabelText('Seal number on the bag');
    await user.clear(input);
    await user.type(input, 'M2-99999');

    const button = screen.getByRole('button', { name: 'Record seal' });
    expect(screen.queryByRole('button', { name: /clear 4 checks/ })).not.toBeInTheDocument();

    await user.click(button);
    expect(onConfirmIntact).toHaveBeenCalledWith('M2-99999', false);
  });

  it('will not clear when there is no prior seal to match', async () => {
    const user = userEvent.setup();
    const onConfirmIntact = vi.fn();
    renderPanel({ lastSeal: undefined, onConfirmIntact });

    await user.type(screen.getByLabelText('Seal number on the bag'), 'M2-40817');
    expect(screen.getByText(/No seal to compare against/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record seal' }));
    expect(onConfirmIntact).toHaveBeenCalledWith('M2-40817', false);
  });

  // A seal the last crew found broken cannot vouch for anything either, even
  // if this crew reads the same number off it.
  it('will not clear when the last count found the seal broken', async () => {
    renderPanel({ lastSeal: { sealNumber: 'M2-40817', intact: false, checkedAt: null } });

    expect(screen.getByText(/last count found this seal broken/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record seal' })).toBeInTheDocument();
  });

  it('shows a recorded seal that cleared nothing as still needing a count', () => {
    renderPanel({ state: { sealNumber: 'M2-99999', intact: true, confirmed: true, cleared: false } });

    expect(screen.getByText('Seal recorded')).toBeInTheDocument();
    expect(screen.getByText(/does not stand in for them/)).toBeInTheDocument();
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

    // With no prior seal the primary records rather than clears, so it is
    // named for what it does — but it still needs a number to record.
    expect(screen.getByRole('button', { name: 'Record seal' })).toBeDisabled();
    await user.type(screen.getByLabelText('Seal number on the bag'), 'M2-1');
    expect(screen.getByRole('button', { name: 'Record seal' })).toBeEnabled();
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
    renderPanel({ state: { sealNumber: 'M2-40817', intact: false, confirmed: true, cleared: false } });

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
