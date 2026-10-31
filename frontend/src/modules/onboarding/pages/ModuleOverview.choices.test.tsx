/**
 * What the module step's choices say, against what they do.
 *
 * Workflow review W01, 2026-10-31, driven on a fresh install:
 * - every essential and recommended card showed the same "Enable" button
 *   whether the module was on or off, so the page's own instruction ("only
 *   modules marked Enable are turned on") described every card;
 * - Members, Events and Documents offered Later and Skip, and the server keeps
 *   all three on regardless (`ModuleSettings.get_enabled_modules`), so skipping
 *   them changed nothing;
 * - Later and Skip both left a module off, and nothing ever read the
 *   difference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../services/api-client', () => ({
  apiClient: { saveModuleConfig: vi.fn(), completeOnboarding: vi.fn() },
}));

vi.mock('../hooks', () => ({
  useApiRequest: () => ({ execute: vi.fn(), isLoading: false, error: null, canRetry: false, clearError: vi.fn() }),
}));

import ModuleOverview from './ModuleOverview';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <ModuleOverview />
      </MemoryRouter>
    </ThemeProvider>
  );

const card = (name: string) => screen.getByRole('group', { name });

describe('ModuleOverview choices', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ departmentName: 'Falls Church Fire', moduleStatuses: {}, selectedModules: [] });
  });

  it('shows which recommended modules are on, in words and to assistive technology', async () => {
    const user = userEvent.setup();
    renderPage();

    const training = within(card('Training & Certifications'));
    const before = training.getByRole('button', { name: 'Enable Training & Certifications' });
    expect(before).toHaveAttribute('aria-pressed', 'false');

    await user.click(before);

    const after = training.getByRole('button', { name: 'Enabled Training & Certifications' });
    expect(after).toHaveAttribute('aria-pressed', 'true');
    expect(after).toHaveTextContent('Enabled');
  });

  it('marks Members, Events and Documents always on, with nothing to turn off', () => {
    renderPage();

    for (const name of ['Member Management', 'Events & RSVP', 'Documents & Files']) {
      const cardView = within(card(name));
      expect(cardView.getByText('Always on')).toBeInTheDocument();
      expect(cardView.queryByRole('button', { name: /^skip /i })).not.toBeInTheDocument();
      expect(cardView.queryByRole('button', { name: /^enable /i })).not.toBeInTheDocument();
    }
  });

  it('still lets Custom Forms, which the server can turn off, be skipped', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(card('Custom Forms')).getByRole('button', { name: 'Skip Custom Forms' }));

    expect(useOnboardingStore.getState().moduleStatuses.forms).toBe('ignored');
  });

  it('turns an always-on module back on if an earlier session stored it skipped', () => {
    useOnboardingStore.setState({ moduleStatuses: { events: 'ignored', training: 'enabled' } });

    renderPage();

    expect(useOnboardingStore.getState().moduleStatuses.events).toBe('enabled');
  });

  it('offers one way to leave a module off, not two that do the same thing', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: /later$/i })).not.toBeInTheDocument();
  });

  it('describes the notifications switch as the bell and inbox, not as email', () => {
    renderPage();

    const notifications = within(card('In-App Notifications'));
    expect(notifications.getByText(/emailed whether or not/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Email Notifications' })).not.toBeInTheDocument();
  });
});
