/**
 * The wizard's last step is the one that finalizes setup.
 *
 * Finalization used to live on Module Selection because that step happened to
 * be last. It follows the final position in the flow, not the subject matter
 * of any particular step, so when Module Selection moved to third the
 * `completeOnboarding` call had to move with the last slot — otherwise setup
 * would be marked complete with two thirds of the wizard still ahead of it,
 * and every remaining step would then be rejected by the post-completion
 * replay guards that protect a provisioned org.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const saveDepartmentInfo = vi.fn();
const completeOnboarding = vi.fn();
vi.mock('../services/api-client', () => ({
  apiClient: {
    saveDepartmentInfo: (...args: unknown[]) => saveDepartmentInfo(...args) as unknown,
    completeOnboarding: () => completeOnboarding() as unknown,
  },
}));

// Run the callback the page passes in, so the API sequence is exercised.
vi.mock('../hooks', () => ({
  useApiRequest: () => ({
    execute: async (fn: () => Promise<unknown>) => {
      try {
        return { data: await fn(), error: null };
      } catch {
        return { data: null, error: 'failed' };
      }
    },
    isLoading: false,
    error: null,
    canRetry: false,
    clearError: vi.fn(),
  }),
}));

// vi.hoisted: the factory below builds its state eagerly, and vi.mock is
// hoisted above a plain `const`.
const { loadUser } = vi.hoisted(() => ({ loadUser: vi.fn() }));
// The store is consumed two ways here: the page calls getState().loadUser, and
// useTimezone (via AutoSaveNotification) calls it as a selector hook. A mock
// that serves only one of those takes the render down before the assertion.
vi.mock('../../../stores/authStore', () => {
  const state = { user: null, loadUser };
  const useAuthStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    { getState: () => state }
  );
  return { useAuthStore };
});

import NavigationChoice from './NavigationChoice';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <NavigationChoice />
      </MemoryRouter>
    </ThemeProvider>
  );

const chooseLayoutAndContinue = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Left sidebar navigation layout'));
  await user.click(screen.getByRole('button', { name: 'Continue to next step' }));
};

describe('NavigationChoice finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveDepartmentInfo.mockReset();
    completeOnboarding.mockReset();
    loadUser.mockReset();
    saveDepartmentInfo.mockResolvedValue({ data: { ok: true } });
    completeOnboarding.mockResolvedValue({ data: { ok: true } });
    loadUser.mockResolvedValue(undefined);
    useOnboardingStore.setState({ departmentName: 'Engine Co.', navigationLayout: 'top' });
  });

  it('completes onboarding and hands off to the completion screen', async () => {
    renderPage();
    await chooseLayoutAndContinue();

    expect(saveDepartmentInfo).toHaveBeenCalled();
    expect(completeOnboarding).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/complete');
  });

  it('loads the authenticated user before navigating', async () => {
    // The completion screen links straight into the protected /setup route.
    renderPage();
    await chooseLayoutAndContinue();

    expect(loadUser).toHaveBeenCalled();
  });

  it('does not finalize when saving the department fails', async () => {
    saveDepartmentInfo.mockRejectedValue(new Error('nope'));

    renderPage();
    await chooseLayoutAndContinue();

    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding/complete');
  });

  it('stays put when finalization itself fails', async () => {
    // Never strand the operator on a screen that claims setup finished.
    completeOnboarding.mockResolvedValue({ error: 'boom' });

    renderPage();
    await chooseLayoutAndContinue();

    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding/complete');
  });
});
