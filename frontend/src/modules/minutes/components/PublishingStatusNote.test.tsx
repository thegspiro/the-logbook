import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { PublishingStatusNote } from './PublishingStatusNote';
import type { MinutesPublishingStatus } from '../types/minutes';

const base: MinutesPublishingStatus = {
  library_allowed: true,
  library_published: false,
  library_version: null,
  library_published_at: null,
  public_allowed: false,
  public_posted: false,
  public_withdrawn: false,
  public_version: null,
  public_posted_at: null,
  public_replaced_version: null,
  public_under_correction: false,
  public_copy_id: null,
};

const show = (status: MinutesPublishingStatus | null, onWithdraw = vi.fn()) =>
  renderWithRouter(<PublishingStatusNote status={status} withdrawing={false} onWithdraw={onWithdraw} />);

describe('PublishingStatusNote', () => {
  it('renders nothing before the status arrives', () => {
    show(null);
    expect(screen.queryByTestId('publishing-status')).not.toBeInTheDocument();
  });

  it('says public posting is off when it is', () => {
    show(base);
    expect(screen.getByText(/Not posted publicly/)).toBeInTheDocument();
  });

  it('says publishing will post a public copy when it is allowed', () => {
    show({ ...base, public_allowed: true });
    expect(screen.getByText('Publishing will also post a public copy.')).toBeInTheDocument();
  });

  it('explains why executive-session minutes cannot be published', () => {
    show({ ...base, library_allowed: false });
    expect(screen.getByText(/The department has not allowed publishing them/)).toBeInTheDocument();
  });

  it('links the posted copy, names the version it replaced, and offers to take it down', async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    show(
      {
        ...base,
        library_published: true,
        library_version: 2,
        public_allowed: true,
        public_posted: true,
        public_version: 2,
        public_replaced_version: 1,
        public_under_correction: true,
        public_copy_id: 'abc',
      },
      onWithdraw
    );

    expect(screen.getByRole('link', { name: 'public minutes page' })).toHaveAttribute('href', '/public/minutes/abc');
    expect(screen.getByText(/It replaced version 1/)).toBeInTheDocument();
    expect(screen.getByText(/being corrected/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take the public copy down' }));
    expect(onWithdraw).toHaveBeenCalled();
  });

  it('says a withdrawn copy is down, without a take-down button', () => {
    show({ ...base, library_published: true, public_withdrawn: true });
    expect(screen.getByText(/The public copy was taken down/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take the public copy down' })).not.toBeInTheDocument();
  });
});
