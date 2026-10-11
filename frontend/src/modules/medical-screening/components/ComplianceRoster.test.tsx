import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComplianceRoster as Roster } from '../types';

const mockGetRoster = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    getComplianceRoster: (...a: unknown[]) => mockGetRoster(...a) as unknown,
  },
}));

import { ComplianceRoster } from './ComplianceRoster';

const roster = (overrides: Partial<Roster> = {}): Roster => ({
  total_requirements: 2,
  total_subjects: 3,
  not_compliant: 1,
  expiring_soon: 1,
  compliant: 1,
  rows: [
    {
      subject_id: 'u-1',
      subject_name: 'Cal Cole',
      subject_type: 'user',
      compliant_count: 1,
      non_compliant_count: 1,
      expiring_soon_count: 0,
      standing: 'not_compliant',
    },
    {
      subject_id: 'p-1',
      subject_name: 'Eve Ewing',
      subject_type: 'prospect',
      compliant_count: 2,
      non_compliant_count: 0,
      expiring_soon_count: 1,
      standing: 'expiring_soon',
    },
  ],
  ...overrides,
});

describe('ComplianceRoster', () => {
  beforeEach(() => {
    mockGetRoster.mockReset();
    mockGetRoster.mockResolvedValue(roster());
  });

  it('lists everyone with the totals and each standing', async () => {
    render(<ComplianceRoster onOpen={vi.fn()} />);

    expect(await screen.findByText('Cal Cole')).toBeInTheDocument();
    expect(mockGetRoster).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('1 of 2 met · 1 not met')).toBeInTheDocument();
    expect(screen.getByText('Not compliant', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Prospect')).toBeInTheDocument();
  });

  it('asks the server for only the overdue rows when filtered to not compliant', async () => {
    const user = userEvent.setup();
    render(<ComplianceRoster onOpen={vi.fn()} />);
    await screen.findByText('Cal Cole');

    mockGetRoster.mockResolvedValue(roster({ rows: [] }));
    await user.selectOptions(screen.getByLabelText('Show'), 'not_compliant');

    await waitFor(() => expect(mockGetRoster).toHaveBeenLastCalledWith('not_compliant'));
    expect(await screen.findByText('Nobody matches this filter.')).toBeInTheDocument();
  });

  it('keeps the rows of the filter on screen when an older request lands last', async () => {
    const user = userEvent.setup();
    render(<ComplianceRoster onOpen={vi.fn()} />);
    await screen.findByText('Cal Cole');

    let resolveOverdue: (value: Roster) => void = () => undefined;
    mockGetRoster.mockImplementationOnce(
      () =>
        new Promise<Roster>((resolve) => {
          resolveOverdue = resolve;
        })
    );
    mockGetRoster.mockResolvedValueOnce(roster({ rows: [] }));
    await user.selectOptions(screen.getByLabelText('Show'), 'not_compliant');
    await user.selectOptions(screen.getByLabelText('Show'), 'compliant');
    expect(await screen.findByText('Nobody matches this filter.')).toBeInTheDocument();

    resolveOverdue(roster());
    await waitFor(() => expect(mockGetRoster).toHaveBeenCalledTimes(3));
    await new Promise((settle) => setTimeout(settle, 0));
    expect(screen.queryByText('Cal Cole')).not.toBeInTheDocument();
    expect(screen.getByText('Nobody matches this filter.')).toBeInTheDocument();
  });

  it('opens a row as the subject it names', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ComplianceRoster onOpen={onOpen} />);

    await user.click(await screen.findByRole('button', { name: 'View Eve Ewing compliance' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'prospect', id: 'p-1', name: 'Eve Ewing' });
  });

  it('does not present a department with no requirements as compliant', async () => {
    mockGetRoster.mockResolvedValue(
      roster({ total_requirements: 0, not_compliant: 0, expiring_soon: 0, compliant: 0, rows: [] })
    );
    render(<ComplianceRoster onOpen={vi.fn()} />);

    expect(await screen.findByText(/No screening requirements are active/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument();
  });
});
