/**
 * The ballot preview is a real dialog (W50-61).
 *
 * It rendered `role="dialog"` with a React `onKeyDown` for Escape but never
 * moved focus inside, so the key went to the opener behind the overlay and
 * the only way out was the mouse. It now goes through `useDialog`, which
 * traps focus and listens for Escape on the document.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Election, Candidate } from '../../types/election';

import BallotPreviewModal from './BallotPreviewModal';

const election = {
  id: 'elec-1',
  title: 'Officer Election 2026',
  status: 'draft',
  ballot_items: [],
  positions: ['Chief'],
  allow_write_ins: false,
  anonymous_voting: true,
} as unknown as Election;

const candidates: Candidate[] = [];

describe('BallotPreviewModal dialog behaviour (W50-61)', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
  });

  it('moves focus into the dialog when it opens', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    render(<BallotPreviewModal election={election} candidates={candidates} onClose={onClose} timezone="UTC" />);

    const close = screen.getByRole('button', { name: 'Close Preview' });
    expect(close).toHaveFocus();
    expect(screen.getByRole('dialog')).toContainElement(close);
    opener.remove();
  });

  it('closes on Escape from anywhere in the document', async () => {
    render(<BallotPreviewModal election={election} candidates={candidates} onClose={onClose} timezone="UTC" />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
