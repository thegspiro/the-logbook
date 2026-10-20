import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const getStatus = vi.fn();
vi.mock('../services/api-client', () => ({
  apiClient: {
    getStatus: () => getStatus() as unknown,
  },
}));

import { OnboardingGate } from './OnboardingGate';
import { clearOnboardingGateAnswer, setOnboardingGateAnswer } from '../utils/onboardingGateState';

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={['/onboarding/start']}>
      <Routes>
        <Route
          path="/onboarding/start"
          element={
            <OnboardingGate>
              <div>Setup form</div>
            </OnboardingGate>
          }
        />
        <Route path="/login" element={<div>Sign in page</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('OnboardingGate', () => {
  beforeEach(() => {
    getStatus.mockReset();
    clearOnboardingGateAnswer();
  });

  it('shows the step while setup is still open', async () => {
    getStatus.mockResolvedValue({ statusCode: 200, data: { needs_onboarding: true } });

    renderGate();

    expect(await screen.findByText('Setup form')).toBeInTheDocument();
  });

  it('sends a visitor to sign-in once setup is finished', async () => {
    getStatus.mockResolvedValue({ statusCode: 200, data: { needs_onboarding: false, is_completed: true } });

    renderGate();

    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByText('Setup form')).not.toBeInTheDocument();
  });

  it('says it is checking rather than flashing the form', () => {
    getStatus.mockReturnValue(new Promise(() => undefined));

    renderGate();

    expect(screen.getByRole('status')).toHaveTextContent('Checking setup status');
    expect(screen.queryByText('Setup form')).not.toBeInTheDocument();
  });

  it('asks the server once for a whole setup session, not once per step', async () => {
    getStatus.mockResolvedValue({ statusCode: 200, data: { needs_onboarding: true } });

    const view = renderGate();
    await screen.findByText('Setup form');
    view.unmount();
    renderGate();

    expect(await screen.findByText('Setup form')).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('answers a finished setup from what it already learned, without asking again', async () => {
    setOnboardingGateAnswer('closed');

    renderGate();

    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('fails open when the status call throws, and asks again next time', async () => {
    getStatus.mockRejectedValue(new Error('network down'));

    const view = renderGate();
    expect(await screen.findByText('Setup form')).toBeInTheDocument();
    view.unmount();

    getStatus.mockResolvedValue({ statusCode: 200, data: { needs_onboarding: true } });
    renderGate();
    await screen.findByText('Setup form');

    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('fails open when the status call is rate limited, and does not remember it', async () => {
    getStatus.mockResolvedValue({ statusCode: 429, error: 'Too many requests' });

    const view = renderGate();
    expect(await screen.findByText('Setup form')).toBeInTheDocument();
    view.unmount();

    getStatus.mockResolvedValue({ statusCode: 200, data: { needs_onboarding: false } });
    renderGate();

    expect(await screen.findByText('Sign in page')).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });
});
