import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockApplyUpdate = vi.fn();
const mockDismiss = vi.fn();
let mockUpdateAvailable = false;
let mockUpdateBlocked = false;

vi.mock('../hooks/useAppUpdate', () => ({
  useAppUpdate: () => ({
    updateAvailable: mockUpdateAvailable,
    updateBlocked: mockUpdateBlocked,
    applyUpdate: mockApplyUpdate,
    dismiss: mockDismiss,
  }),
}));

import { UpdateNotification } from './UpdateNotification';
import { renderWithRouter } from '../test/utils';

describe('UpdateNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAvailable = false;
    mockUpdateBlocked = false;
  });

  it('renders nothing when no update is available', () => {
    mockUpdateAvailable = false;
    const { container } = render(<UpdateNotification />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the banner when an update is available', () => {
    mockUpdateAvailable = true;
    render(<UpdateNotification />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('A new version of The Logbook is available.')).toBeInTheDocument();
    expect(screen.getByText('Reload now')).toBeInTheDocument();
  });

  it('calls applyUpdate when "Reload now" is clicked', async () => {
    mockUpdateAvailable = true;
    render(<UpdateNotification />);

    const user = userEvent.setup();
    await user.click(screen.getByText('Reload now'));

    expect(mockApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it('calls dismiss when the close button is clicked', async () => {
    mockUpdateAvailable = true;
    render(<UpdateNotification />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Remind me about this update later'));

    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('stops offering a reload once automatic recovery is exhausted', () => {
    mockUpdateAvailable = true;
    mockUpdateBlocked = true;
    renderWithRouter(<UpdateNotification />);

    // Offering "Reload now" again would repeat an action that has already
    // failed twice on this device, which is what left members clearing their
    // browser cache by hand.
    expect(screen.queryByText('Reload now')).not.toBeInTheDocument();
    expect(
      screen.getByText('A new version is available, but this device could not install it automatically.')
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Force refresh' });
    expect(link).toHaveAttribute('href', '/account?tab=app');
  });

  it('still allows deferring while blocked', async () => {
    mockUpdateAvailable = true;
    mockUpdateBlocked = true;
    renderWithRouter(<UpdateNotification />);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Remind me about this update later'));

    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
