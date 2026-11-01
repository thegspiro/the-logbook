/**
 * Workflow review W01, 2026-10-31: on a fresh install, SMTP was chosen and then
 * Skip for Now pressed on its settings page. Nothing reached the server, but
 * the wizard kept "SMTP" as the choice, so the send-off reported "Email
 * platform: SMTP" for a department with no email set up. Skipping here now
 * records the same "set up later" outcome the platform page's own Skip card
 * does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
const { saveEmailConfig } = vi.hoisted(() => ({ saveEmailConfig: vi.fn() }));
vi.mock('../services/api-client', () => ({
  apiClient: { saveEmailConfig: (...args: unknown[]) => saveEmailConfig(...args) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import EmailConfiguration from './EmailConfiguration';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { nextStepPath } from '../config/steps';

describe('EmailConfiguration — Skip for Now', () => {
  beforeEach(() => {
    navigate.mockReset();
    saveEmailConfig.mockReset();
    saveEmailConfig.mockResolvedValue({ data: {} });
    useOnboardingStore.setState({ departmentName: 'Test FD', emailPlatform: 'selfhosted' });
  });

  it('records email as not set up, and moves on to the next step', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <MemoryRouter>
          <EmailConfiguration />
        </MemoryRouter>
      </ThemeProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Skip for Now' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(nextStepPath('email')));
    expect(saveEmailConfig).toHaveBeenCalledWith({ platform: 'other', config: {} });
    expect(useOnboardingStore.getState().emailPlatform).toBe('other');
    expect(navigate).not.toHaveBeenCalledWith('/onboarding/start');
  });
});
