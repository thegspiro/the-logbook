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

    expect(
      screen.getByText(`${required.join(' and ')} — the only steps setup cannot finish without.`)
    ).toBeInTheDocument();
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
