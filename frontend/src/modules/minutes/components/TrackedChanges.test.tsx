import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackedChanges } from './TrackedChanges';
import type { SuggestionChange } from '../types/minutes';

const changes: SuggestionChange[] = [
  {
    id: 'c1',
    kind: 'replace',
    deleted: 'three bids',
    inserted: 'four quotes',
    before: 'reported',
    after: 'today.',
    decision: 'open',
  },
  { id: 'c2', kind: 'insert', deleted: '', inserted: 'sharp', before: 'the', after: 'vote', decision: 'open' },
  { id: 'c3', kind: 'delete', deleted: 'old', inserted: '', before: 'the', after: 'budget', decision: 'open' },
  { id: 'c4', kind: 'format', deleted: 'Vendor B', inserted: 'Vendor B', before: '', after: '', decision: 'open' },
];

describe('TrackedChanges', () => {
  it('draws removed words struck through and added words underlined, with their context', () => {
    render(<TrackedChanges suggestionId="g1" changes={changes} />);
    const cards = within(screen.getByRole('list', { name: 'Tracked changes' })).getAllByRole('listitem');

    expect(within(cards[0] as HTMLElement).getByText('three bids').tagName).toBe('DEL');
    expect(within(cards[0] as HTMLElement).getByText('four quotes').tagName).toBe('INS');
    expect(within(cards[0] as HTMLElement).getByText(/…reported/)).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('sharp').tagName).toBe('INS');
    expect(within(cards[1] as HTMLElement).queryByRole('deletion')).not.toBeInTheDocument();
    expect(within(cards[2] as HTMLElement).getByText('old').tagName).toBe('DEL');
  });

  it('names a formatting-only change as such instead of showing identical words', () => {
    render(<TrackedChanges suggestionId="g1" changes={changes} />);
    expect(screen.getByText(/Vendor B \(formatting only\)/)).toBeInTheDocument();
  });

  it('labels each change by what it does', () => {
    render(<TrackedChanges suggestionId="g1" changes={changes} />);
    for (const label of ['Changed', 'Added', 'Removed', 'Formatting']) {
      expect(screen.getByText(new RegExp(`· ${label}$`))).toBeInTheDocument();
    }
  });

  it('offers Accept and Reject for each change when given a way to decide', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<TrackedChanges suggestionId="g1" changes={changes} onDecide={onDecide} decisions={{ c2: 'rejected' }} />);

    expect(screen.getByRole('radio', { name: 'Accept change 1' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Reject change 2' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Reject change 1' }));
    expect(onDecide).toHaveBeenCalledWith('c1', 'rejected');
  });

  it('shows only what was decided when there is nothing to decide', () => {
    render(
      <TrackedChanges
        suggestionId="g1"
        changes={[
          { ...(changes[0] as SuggestionChange), decision: 'accepted' },
          { ...(changes[1] as SuggestionChange), decision: 'rejected' },
          { ...(changes[2] as SuggestionChange), decision: 'open' },
        ]}
      />
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('flags a change that no longer fits the section', () => {
    render(<TrackedChanges suggestionId="g1" changes={changes} doesNotFit={['c2']} />);
    const cards = within(screen.getByRole('list', { name: 'Tracked changes' })).getAllByRole('listitem');
    expect(within(cards[1] as HTMLElement).getByRole('status')).toHaveTextContent(/no longer fits/);
    expect(within(cards[0] as HTMLElement).queryByRole('status')).not.toBeInTheDocument();
  });
});
