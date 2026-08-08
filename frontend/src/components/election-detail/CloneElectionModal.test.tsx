import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloneElectionModal from './CloneElectionModal';

const onSubmit = vi.fn();
const onClose = vi.fn();

const renderModal = (overrides: Partial<React.ComponentProps<typeof CloneElectionModal>> = {}) =>
  render(
    <CloneElectionModal
      sourceTitle="Officer Election 2026"
      cloning={false}
      error={null}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />
  );

describe('CloneElectionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the title from the source election', () => {
    renderModal();
    expect(screen.getByLabelText('Title')).toHaveValue('Officer Election 2026 (Copy)');
  });

  it('disables submit until both dates are set', async () => {
    const user = userEvent.setup();
    renderModal();
    const submit = screen.getByRole('button', { name: 'Create Draft' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Voting opens'), '2027-03-01T18:00');
    await user.type(screen.getByLabelText('Voting closes'), '2027-03-01T20:00');
    expect(submit).toBeEnabled();
  });

  it('submits the entered values including the candidates checkbox', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Officer Election 2027');
    await user.type(screen.getByLabelText('Voting opens'), '2027-03-01T18:00');
    await user.type(screen.getByLabelText('Voting closes'), '2027-03-01T20:00');
    await user.click(screen.getByRole('checkbox', { name: /copy the accepted candidates/i }));
    await user.click(screen.getByRole('button', { name: 'Create Draft' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Officer Election 2027',
      start_date: '2027-03-01T18:00',
      end_date: '2027-03-01T20:00',
      include_candidates: true,
    });
  });

  it('shows a server error and closes on cancel', async () => {
    const user = userEvent.setup();
    renderModal({ error: 'Election not found' });
    expect(screen.getByRole('alert')).toHaveTextContent('Election not found');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith(expect.anything());
  });
});
