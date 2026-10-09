/**
 * The administrator-account step (workflow review W01).
 *
 * - W01-2: its checklist lacked two rules the server enforces, so a password
 *   such as "Abcdef123!xyz" passed every tick, was refused after submitting,
 *   and both password fields were cleared.
 * - W01-4: it reported "Step 7 of 10" and "continue with IT team setup" from
 *   before the steps were reordered; it is step 2 of 11 and Modules is next.
 * - W01-5: revisited after the account existed (Back from Modules), it showed
 *   an empty form whose only button could not succeed and whose Back bounced
 *   off Organization Setup. It now moves on, as Organization Setup does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navigate = vi.fn();
const getStatus = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('../services/api-client', () => ({
  apiClient: {
    getStatus: (...args: unknown[]) => getStatus(...args) as unknown,
    createSystemOwner: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import SystemOwnerCreation from './AdminUserCreation';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { nextStepPath } from '../config/steps';

const renderStep = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <SystemOwnerCreation />
      </MemoryRouter>
    </ThemeProvider>
  );

// Pasted rather than typed: each keystroke re-renders the form and re-runs
// the password rules, so typing six fields took ~2s unloaded and crossed the
// 5s timeout when the pre-commit hook ran every related suite at once. The
// tests assert what the finished values are refused or accepted for.
const fillAccount = async (user: ReturnType<typeof userEvent.setup>, password: string) => {
  const fill = async (label: RegExp, value: string) => {
    await user.click(screen.getByLabelText(label));
    await user.paste(value);
  };
  await fill(/^first name/i, 'Riley');
  await fill(/^last name/i, 'Owner');
  await fill(/^username/i, 'riley_owner');
  await fill(/^email address/i, 'riley@example.org');
  await fill(/^password \*/i, password);
  await fill(/^confirm password/i, password);
};

const createButton = () => screen.getByRole('button', { name: /create system owner/i });

beforeEach(() => {
  navigate.mockReset();
  getStatus.mockReset();
  getStatus.mockResolvedValue({ data: { steps_completed: { organization: { completed: true } } } });
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD' });
});

// Each case types a full password and its confirmation a keystroke at a time;
// on a loaded machine that alone can outrun the default 5s.
describe('the administrator password', { timeout: 20_000 }, () => {
  it('holds back a password with a run like "abc" or "123", and says why', async () => {
    const user = userEvent.setup();
    renderStep();

    await fillAccount(user, 'Abcdef123!xyz');
    await user.tab();

    expect(createButton()).toBeDisabled();
    expect(screen.getByText(/password cannot contain a run like/i)).toBeInTheDocument();
  });

  it('holds back a password that repeats a character three times', async () => {
    const user = userEvent.setup();
    renderStep();

    await fillAccount(user, 'Hydraaant$Blue9');

    expect(createButton()).toBeDisabled();
  });

  it('accepts a password that meets every rule', async () => {
    const user = userEvent.setup();
    renderStep();

    await fillAccount(user, 'Hydrant$Blue947');

    expect(createButton()).toBeEnabled();
  });
});

describe('where the step says it is', () => {
  it('reports its place in the current flow and names the next step', () => {
    renderStep();

    expect(screen.getByText(/step 2 of 12/i)).toBeInTheDocument();
    expect(screen.getByText(/continue with encryption key/i)).toBeInTheDocument();
    expect(screen.queryByText(/step 7 of 10/i)).not.toBeInTheDocument();
  });
});

describe('coming back after the account exists', () => {
  it('moves on to the next step instead of offering a form that cannot succeed', async () => {
    getStatus.mockResolvedValue({
      data: { steps_completed: { organization: { completed: true }, admin_user: { completed: true } } },
    });

    renderStep();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(nextStepPath('system_owner'), { replace: true }));
  });

  it('stays put while the account does not exist yet', async () => {
    renderStep();

    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalledWith(nextStepPath('system_owner'), { replace: true });
  });
});
