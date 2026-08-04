import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MergeWriteInsModal from './MergeWriteInsModal';
import type { Candidate } from '../../types/election';

const makeCandidate = (overrides: Partial<Candidate>): Candidate => ({
  id: 'c1',
  election_id: 'e1',
  name: 'Candidate',
  position: 'Chief',
  accepted: true,
  is_write_in: false,
  display_order: 0,
  nomination_date: '2026-07-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
});

const candidates: Candidate[] = [
  makeCandidate({ id: 'real', name: 'Bob Baker' }),
  makeCandidate({ id: 'wi1', name: 'bob baker', is_write_in: true }),
  makeCandidate({ id: 'wi2', name: 'B. Baker', is_write_in: true }),
  makeCandidate({ id: 'merged', name: 'old merge', is_write_in: true, merged_into_candidate_id: 'real' }),
];

const onSubmit = vi.fn();
const onClose = vi.fn();

const renderModal = () =>
  render(
    <MergeWriteInsModal candidates={candidates} merging={false} error={null} onSubmit={onSubmit} onClose={onClose} />
  );

describe('MergeWriteInsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers only unmerged write-ins as sources', () => {
    renderModal();
    expect(screen.getByRole('checkbox', { name: /bob baker/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /B\. Baker/ })).toBeInTheDocument();
    // Real nominees and already-merged variants are not source options.
    expect(screen.queryByRole('checkbox', { name: 'Bob Baker (Chief)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /old merge/ })).not.toBeInTheDocument();
  });

  it('excludes selected sources from the target list and submits the merge', async () => {
    const user = userEvent.setup();
    renderModal();
    const submit = screen.getByRole('button', { name: /Merge/ });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /bob baker/ }));
    const target = screen.getByLabelText('Count their votes for');
    // The selected source disappears from the target options.
    expect(within(target).queryByRole('option', { name: 'bob baker (Chief)' })).not.toBeInTheDocument();

    await user.selectOptions(target, 'real');
    await user.click(screen.getByRole('button', { name: 'Merge 1 Variant' }));
    expect(onSubmit).toHaveBeenCalledWith(['wi1'], 'real');
  });

  it('shows a server error', () => {
    render(
      <MergeWriteInsModal
        candidates={candidates}
        merging={false}
        error="bob baker has already been merged"
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('already been merged');
  });
});
