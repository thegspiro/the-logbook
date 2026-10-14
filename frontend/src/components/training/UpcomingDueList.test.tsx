import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpcomingDueList } from './UpcomingDueList';
import type { UpcomingItem } from '../../utils/trainingUpcoming';

const skill = (overrides: Partial<UpcomingItem> = {}): UpcomingItem => ({
  key: 'skill-1',
  kind: 'skill',
  title: 'SCBA Donning',
  detail: 'Skills test expires',
  date: '2026-12-01',
  days: 49,
  urgency: 'soon',
  ...overrides,
});

describe('UpcomingDueList skills tests', () => {
  it('reads "Expires <date> · N days" for a pass that has not lapsed', () => {
    render(<UpcomingDueList items={[skill()]} />);
    expect(screen.getByText('SCBA Donning')).toBeInTheDocument();
    expect(screen.getByText('Skills test expires')).toBeInTheDocument();
    expect(screen.getByText(/^Expires .* · 49 days$/)).toBeInTheDocument();
  });

  it('reads "Expired N days ago", not "Overdue", for a lapsed pass', () => {
    render(<UpcomingDueList items={[skill({ days: -3, urgency: 'overdue', detail: 'Skills test expired' })]} />);
    expect(screen.getByText('Expired 3 days ago')).toBeInTheDocument();
  });
});
