import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockApplyUpdate = vi.fn();
const mockDismiss = vi.fn();
let mockUpdateAvailable = false;

vi.mock('../hooks/useAppUpdate', () => ({
  useAppUpdate: () => ({
    updateAvailable: mockUpdateAvailable,
    applyUpdate: mockApplyUpdate,
    dismiss: mockDismiss,
  }),
}));

import { UpdateNotification } from './UpdateNotification';

describe('UpdateNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAvailable = false;
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
    expect(
      screen.getByText('A new version of The Logbook is available.'),
    ).toBeInTheDocument();
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
    await user.click(screen.getByLabelText('Dismiss update notification'));

    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
