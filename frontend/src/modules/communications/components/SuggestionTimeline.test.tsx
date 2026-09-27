import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { TimelineEntry } from '../types/suggestions';
import SuggestionTimeline from './SuggestionTimeline';

const step = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  disposition: 'new',
  publicResponse: null,
  createdAt: '2026-09-20T12:00:00Z',
  timestampPrecision: 'exact',
  ...overrides,
});

describe('SuggestionTimeline', () => {
  it('reads receipt, status changes and a response in order', () => {
    renderWithRouter(
      <SuggestionTimeline
        entries={[
          step({ timestampPrecision: 'day' }),
          step({ disposition: 'under_review', createdAt: '2026-09-21T15:00:00Z' }),
          step({
            disposition: 'under_review',
            publicResponse: 'Scheduling it for the spring drills.',
            createdAt: '2026-09-22T15:00:00Z',
          }),
        ]}
      />
    );

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/^Received/);
    expect(items[1]).toHaveTextContent(/^Under review/);
    expect(items[2]).toHaveTextContent(/^Reviewers responded/);
    expect(items[2]).toHaveTextContent('Scheduling it for the spring drills.');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });

  it('never names a reviewer', () => {
    renderWithRouter(
      <SuggestionTimeline
        entries={[step(), step({ disposition: 'accepted', publicResponse: 'Approved for next quarter.' })]}
      />
    );
    expect(screen.getByText('Reviewers')).toBeInTheDocument();
  });

  it('renders nothing for a one-way box', () => {
    const { container } = renderWithRouter(<SuggestionTimeline entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
