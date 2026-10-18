/**
 * Ballots now send in the background, so a large roster keeps the dialog in
 * its sending state for minutes rather than failing at the 30-second request
 * timeout. The dialog says so, and that leaving the page does not stop it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Election } from '../../types/election';

import SendBallotEmailsModal from './SendBallotEmailsModal';

const election = { id: 'e-1', title: 'Test Election', email_sent: false, eligible_voters: [] } as unknown as Election;

const renderModal = (sending: boolean) =>
  render(
    <SendBallotEmailsModal
      election={election}
      sending={sending}
      error={null}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      timezone="UTC"
    />
  );

describe('SendBallotEmailsModal', () => {
  it('explains that a send in progress continues if the page is left', () => {
    renderModal(true);

    expect(screen.getByRole('status')).toHaveTextContent(/If you leave this page the send carries on/);
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
  });

  it('says nothing about progress before the send starts', () => {
    renderModal(false);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Ballots' })).toBeEnabled();
  });
});
