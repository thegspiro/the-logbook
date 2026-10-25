import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { LabelPrintMenu } from './LabelPrintMenu';

const LIST_PATH = '/inventory/print-labels?all=1&category_id=cat-1';

describe('LabelPrintMenu', () => {
  it('stays closed until asked', () => {
    renderWithRouter(<LabelPrintMenu listPath={LIST_PATH} listCount={8} needsLabelCount={4} />);

    expect(screen.getByRole('button', { name: /Print Labels/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers this list, what needs a label, and the chooser, each at its own address', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LabelPrintMenu listPath={LIST_PATH} listCount={8} needsLabelCount={4} />);

    await user.click(screen.getByRole('button', { name: /Print Labels/ }));

    expect(screen.getByRole('button', { name: /Print Labels/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /This list — 8 items/ })).toHaveAttribute('href', LIST_PATH);
    expect(screen.getByRole('link', { name: /Items that need a label — 4/ })).toHaveAttribute(
      'href',
      '/inventory/print-labels?all=1&label_printed=false'
    );
    expect(screen.getByRole('link', { name: /Choose by category or location/ })).toHaveAttribute(
      'href',
      '/inventory/print-labels'
    );
  });

  it('leaves out "this list" when the list cannot be printed by its filters', async () => {
    // The low-stock filter has no print-page equivalent; offering the list
    // anyway would label more items than it shows.
    const user = userEvent.setup();
    renderWithRouter(<LabelPrintMenu listPath={null} listCount={8} needsLabelCount={4} />);

    await user.click(screen.getByRole('button', { name: /Print Labels/ }));

    expect(screen.queryByRole('link', { name: /This list/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Items that need a label/ })).toBeInTheDocument();
  });

  it('omits a count it does not have yet rather than showing zero', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LabelPrintMenu listPath={LIST_PATH} listCount={1} needsLabelCount={null} />);

    await user.click(screen.getByRole('button', { name: /Print Labels/ }));

    expect(screen.getByRole('link', { name: 'This list — 1 item' })).toHaveAccessibleDescription(
      'Every item matching the filters above'
    );
    expect(screen.getByRole('link', { name: 'Items that need a label' })).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to the button', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LabelPrintMenu listPath={LIST_PATH} listCount={8} needsLabelCount={4} />);
    const trigger = screen.getByRole('button', { name: /Print Labels/ });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on a click elsewhere', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <>
        <p>Elsewhere</p>
        <LabelPrintMenu listPath={LIST_PATH} listCount={8} needsLabelCount={4} />
      </>
    );

    await user.click(screen.getByRole('button', { name: /Print Labels/ }));
    await user.click(screen.getByText('Elsewhere'));

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
