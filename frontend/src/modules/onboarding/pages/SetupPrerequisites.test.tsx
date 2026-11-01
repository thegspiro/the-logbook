/**
 * The screen that says what setup will ask for, before it asks.
 *
 * Its two lists are derived from ONBOARDING_STEPS rather than restated, so the
 * thing worth testing is that the derivation holds: a step whose `optional`
 * flag changes must change this screen with it, and the required list must
 * never quietly grow past what `complete_onboarding` actually demands.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import SetupPrerequisites from './SetupPrerequisites';
import { ONBOARDING_STEPS } from '../config/steps';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <SetupPrerequisites />
      </MemoryRouter>
    </ThemeProvider>
  );

describe('SetupPrerequisites', () => {
  it('names the required steps from the flow itself', () => {
    const required = ONBOARDING_STEPS.filter((s) => !s.optional).map((s) => s.name);

    renderPage();

    const names = `${required.slice(0, -1).join(', ')} and ${required[required.length - 1] ?? ''}`;
    expect(screen.getByText(`${names} — the only required steps.`)).toBeInTheDocument();
  });

  // Workflow review W01, 2026-10-31: the heading said "Only the first two steps
  // are required" beside a list of three, and the list read "A and B and C".
  it('states the number of required steps the flow actually has', () => {
    const required = ONBOARDING_STEPS.filter((s) => !s.optional);

    renderPage();

    expect(screen.getByText(new RegExp(`Only the first ${required.length} steps are required`))).toBeInTheDocument();
    expect(screen.queryByText(/ and .* and .* — the only required steps/)).not.toBeInTheDocument();
  });

  it('offers only the storage platforms that actually store files', () => {
    renderPage();

    expect(screen.queryByText(/Azure/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OneDrive/)).not.toBeInTheDocument();
  });

  it('counts the optional steps from the flow itself', () => {
    const optional = ONBOARDING_STEPS.filter((s) => s.optional).length;

    renderPage();

    expect(screen.getByText(`${optional} of the ${ONBOARDING_STEPS.length} steps are optional.`)).toBeInTheDocument();
  });

  it('tells the operator the credential steps can wait', () => {
    // This is the whole point: nobody should leave mid-wizard to find an SMTP
    // password, because walking away is what used to strand the install.
    renderPage();

    expect(screen.getByText(/skipped now and set up later/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP host, port, username and password/i)).toBeInTheDocument();
  });

  it('starts the wizard at the first step', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /start setup/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/start');
  });
});
