import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const retrySignOut = vi.fn();
let signOutUnconfirmed = false;

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (state: { signOutUnconfirmed: boolean; retrySignOut: () => Promise<void> }) => unknown) =>
    selector({ signOutUnconfirmed, retrySignOut: () => retrySignOut() as Promise<void> }),
}));

import { SignOutUnconfirmedNotice } from './SignOutUnconfirmedNotice';

describe('SignOutUnconfirmedNotice', () => {
  beforeEach(() => {
    retrySignOut.mockReset();
    retrySignOut.mockResolvedValue(undefined);
    signOutUnconfirmed = false;
  });

  it('renders nothing after a confirmed sign-out', () => {
    const { container } = render(<SignOutUnconfirmedNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells the member to close the browser, with no way to dismiss it', () => {
    signOutUnconfirmed = true;
    render(<SignOutUnconfirmedNotice />);

    expect(screen.getByRole('alertdialog', { name: 'Sign-out could not be confirmed' })).toBeInTheDocument();
    expect(screen.getByText(/Close every window of this browser now/)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('asks the server again on Try signing out again', async () => {
    signOutUnconfirmed = true;
    render(<SignOutUnconfirmedNotice />);

    await userEvent.click(screen.getByRole('button', { name: 'Try signing out again' }));

    expect(retrySignOut).toHaveBeenCalledTimes(1);
  });
});
