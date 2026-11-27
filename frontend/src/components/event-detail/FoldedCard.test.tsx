import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoldedCard } from './FoldedCard';

const renderFolded = (startFolded: boolean) =>
  render(
    <>
      <button type="button">Earlier on the page</button>
      <FoldedCard title="Attachments" summary="None yet" actionLabel="Attach file" startFolded={startFolded}>
        <button type="button">Choose a file</button>
      </FoldedCard>
    </>
  );

describe('FoldedCard', () => {
  it('stands in for the card with its title, its state and one button', () => {
    renderFolded(true);

    expect(screen.getByRole('region', { name: 'Attachments' })).toHaveTextContent('Attachments · None yet');
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose a file' })).not.toBeInTheDocument();
  });

  it('opens the card in place and moves focus to it', async () => {
    const user = userEvent.setup();
    renderFolded(true);

    await user.click(screen.getByRole('button', { name: 'Attach file' }));

    expect(screen.queryByRole('button', { name: 'Attach file' })).not.toBeInTheDocument();
    // Focus dropped to the document would send Tab to the first button on the
    // page; from the opened card it goes to the card's own first control.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toHaveFocus();
  });

  it('never folds a card that has something in it', () => {
    renderFolded(false);

    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Attachments' })).not.toBeInTheDocument();
  });

  it('stays open when what it holds stops being empty and becomes empty again', async () => {
    const user = userEvent.setup();
    const { rerender } = renderFolded(true);
    await user.click(screen.getByRole('button', { name: 'Attach file' }));

    rerender(
      <>
        <button type="button">Earlier on the page</button>
        <FoldedCard title="Attachments" summary="None yet" actionLabel="Attach file" startFolded>
          <button type="button">Choose a file</button>
        </FoldedCard>
      </>
    );

    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });
});
