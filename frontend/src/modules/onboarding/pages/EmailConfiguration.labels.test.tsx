/**
 * Workflow review W01, 2026-10-31, on a fresh install: every field on the
 * email step — From address, SMTP host, port, encryption, username, password,
 * the Gmail and Microsoft secrets — had a visible label with no `htmlFor` and
 * an input with no `id`, so a screen reader announced each by its placeholder
 * or not at all. The SMTP provider box was also pinned to its first option, so
 * after choosing iCloud it read "My own mail server" above iCloud's settings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

import EmailConfiguration from './EmailConfiguration';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <EmailConfiguration />
      </MemoryRouter>
    </ThemeProvider>
  );

// Every role-bearing field on the form. Password inputs carry no role, so each
// form's secret is also asserted by its label below.
const unlabelled = () =>
  [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('combobox'), ...screen.queryAllByRole('spinbutton')]
    .filter((el) => !el.getAttribute('aria-label') && !screen.queryAllByLabelText(/./).includes(el))
    .map((el) => el.getAttribute('placeholder') ?? el.tagName);

describe('EmailConfiguration labels', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ departmentName: 'Test FD' });
  });

  it.each(['gmail', 'selfhosted', 'cloudflare'])('labels every field on the %s form', (platform) => {
    useOnboardingStore.setState({ emailPlatform: platform });
    renderPage();

    expect(screen.getByLabelText(/From Email Address/)).toBeInTheDocument();
    expect(unlabelled()).toEqual([]);
  });

  it('labels every field on both Microsoft 365 forms, and names the method group', async () => {
    const user = userEvent.setup();
    useOnboardingStore.setState({ emailPlatform: 'microsoft' });
    renderPage();

    expect(screen.getByRole('group', { name: 'Authentication' })).toBeInTheDocument();
    expect(unlabelled()).toEqual([]);
    expect(screen.getByLabelText(/^Client secret/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /App Password/ }));
    expect(unlabelled()).toEqual([]);
    expect(screen.getByLabelText(/^Microsoft 365 App Password/)).toBeInTheDocument();
  });

  it('labels the Gmail App Password', () => {
    useOnboardingStore.setState({ emailPlatform: 'gmail' });
    renderPage();

    expect(screen.getByLabelText(/^Google App Password/)).toBeInTheDocument();
  });

  it('labels the SMTP server fields by name', () => {
    useOnboardingStore.setState({ emailPlatform: 'selfhosted' });
    renderPage();

    expect(screen.getByLabelText(/SMTP Host/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Port/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Encryption/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Username/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
  });

  it('shows the provider it filled in, and drops its hint when set back to "my own server"', async () => {
    const user = userEvent.setup();
    useOnboardingStore.setState({ emailPlatform: 'selfhosted' });
    renderPage();

    const box = screen.getByLabelText('Fill in settings for a known provider');
    await user.selectOptions(box, 'icloud');

    expect(box).toHaveValue('icloud');
    expect(screen.getByLabelText(/SMTP Host/)).toHaveValue('smtp.mail.me.com');
    expect(screen.getByText(/app-specific password from appleid\.apple\.com/)).toBeInTheDocument();

    await user.selectOptions(box, '');

    expect(box).toHaveValue('');
    expect(screen.queryByText(/app-specific password from appleid\.apple\.com/)).not.toBeInTheDocument();
  });
});
