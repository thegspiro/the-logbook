import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreditCard } from 'lucide-react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('keeps the page-body spacing by default', () => {
    render(<EmptyState icon={CreditCard} title="Nothing here" description="Add one." />);

    expect(screen.getByTestId('empty-state')).toHaveClass('py-12');
    expect(screen.getByTestId('empty-state')).not.toHaveClass('py-4');
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toHaveClass('mb-2', 'text-lg');
    expect(screen.getByText('Add one.')).toHaveClass('mb-6');
    expect(screen.getByTestId('empty-state-icon')).toHaveClass('h-16', 'w-16', 'mb-5');
  });

  it('tightens spacing when compact', () => {
    render(
      <EmptyState compact headingLevel={3} icon={CreditCard} title="No ID cards issued" description="Write a tag." />
    );

    expect(screen.getByTestId('empty-state')).toHaveClass('py-4');
    expect(screen.getByTestId('empty-state')).not.toHaveClass('py-12');
    expect(screen.getByRole('heading', { level: 3, name: 'No ID cards issued' })).toHaveClass('mb-1', 'text-base');
    expect(screen.getByTestId('empty-state-icon')).toHaveClass('h-12', 'w-12', 'mb-3');
  });

  it('drops the description margin when compact and nothing follows it', () => {
    render(<EmptyState compact title="Empty" description="Nothing follows." />);

    const description = screen.getByText('Nothing follows.');
    expect(description).not.toHaveClass('mb-4');
    expect(description).not.toHaveClass('mb-6');
  });

  it('keeps a gap above the actions when compact', async () => {
    const onClick = vi.fn();
    render(<EmptyState compact title="Empty" description="Then a button." actions={[{ label: 'Add', onClick }]} />);

    expect(screen.getByText('Then a button.')).toHaveClass('mb-4');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
