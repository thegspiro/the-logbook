import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const hasSession = vi.fn();
vi.mock('../services/api-client', () => ({
  apiClient: { hasSession: () => hasSession() as unknown },
}));

import { ExpiredSessionBanner } from './ExpiredSessionBanner';
import { useOnboardingStore } from '../store/onboardingStore';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ExpiredSessionBanner />
    </MemoryRouter>
  );

describe('ExpiredSessionBanner', () => {
  beforeEach(() => {
    hasSession.mockReset();
    hasSession.mockReturnValue(false);
    useOnboardingStore.setState({ departmentName: 'Falls Church FD' });
  });

  it('says the session ended when a draft reopens without one', () => {
    renderAt('/onboarding/positions');

    expect(screen.getByRole('status')).toHaveTextContent('Your setup session has ended');
    expect(screen.getByRole('link', { name: 'Return to the first step' })).toHaveAttribute('href', '/onboarding/start');
  });

  it('on the first step, says to continue from there instead of linking to it', () => {
    renderAt('/onboarding/start');

    expect(screen.getByRole('status')).toHaveTextContent('Continue from here to start a new session.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('is not shown while this tab has a session', () => {
    hasSession.mockReturnValue(true);

    renderAt('/onboarding/positions');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is not shown on a first visit with nothing typed yet', () => {
    useOnboardingStore.setState({ departmentName: '' });

    renderAt('/onboarding/start');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    renderAt('/onboarding/positions');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss the session notice' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
