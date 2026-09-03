import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EmailSettingsSection from './EmailSettingsSection';
import type { EmailServiceSettings } from '../../types/user';

const settings = (overrides: Partial<EmailServiceSettings> = {}): EmailServiceSettings => ({
  enabled: true,
  platform: 'gmail',
  smtp_port: 587,
  smtp_encryption: 'tls',
  use_tls: true,
  from_email: 'chief@example.org',
  ...overrides,
});

const renderSection = (
  emailSettings: EmailServiceSettings,
  props: Partial<React.ComponentProps<typeof EmailSettingsSection>> = {}
) => {
  const onEmailSettingsChange = vi.fn();
  const onSave = vi.fn();
  const onTest = vi.fn();
  render(
    <EmailSettingsSection
      emailSettings={emailSettings}
      onEmailSettingsChange={onEmailSettingsChange}
      savingEmail={false}
      testingEmail={false}
      emailPasswordVisible={false}
      onTogglePasswordVisible={vi.fn()}
      onSave={onSave}
      onTest={onTest}
      profileName="Test FD"
      {...props}
    />
  );
  return { onEmailSettingsChange, onSave, onTest };
};

// The change handler reads the input inside the state updater, so the updater
// has to run during the event — as React's setState does — before the
// controlled input is reset to its prop value. A bare vi.fn() would hand it
// back after the reset and see an empty field. The props never change across
// a render, so each field is typed one character at a time.
const applyUpdatesTo = (initial: EmailServiceSettings) => {
  let latest = initial;
  const onEmailSettingsChange = vi.fn((update: React.SetStateAction<EmailServiceSettings>) => {
    latest = typeof update === 'function' ? update(latest) : update;
  });
  return { onEmailSettingsChange, latest: () => latest };
};

describe('EmailSettingsSection — hosted platforms are App Password only', () => {
  it('asks Gmail for an App Password and nothing OAuth-shaped', () => {
    renderSection(settings({ platform: 'gmail' }));

    expect(screen.getByLabelText('Google App Password')).toBeInTheDocument();
    expect(screen.queryByText(/client id/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/client secret/i)).not.toBeInTheDocument();
    // The From address doubles as the login, and the label says so.
    expect(screen.getByText(/signs in as/i)).toBeInTheDocument();
  });

  // A stored row written before OAuth existed carries no method and signs in
  // with a password, so the screen has to open on the method that row is
  // actually using rather than on the one new setups get.
  it('opens a saved Microsoft config with no method on App Password', () => {
    renderSection(settings({ platform: 'microsoft' }));

    expect(screen.getByLabelText('Microsoft 365 App Password')).toBeInTheDocument();
    expect(screen.queryByLabelText(/directory \(tenant\) id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/application \(client\) id/i)).not.toBeInTheDocument();
  });

  it('writes the Gmail password to google_app_password', async () => {
    const state = applyUpdatesTo(settings({ platform: 'gmail' }));
    renderSection(settings({ platform: 'gmail' }), { onEmailSettingsChange: state.onEmailSettingsChange });

    await userEvent.type(screen.getByLabelText('Google App Password'), 'a');

    expect(state.latest()).toMatchObject({ google_app_password: 'a' });
  });

  it('writes the Microsoft password to microsoft_app_password', async () => {
    const state = applyUpdatesTo(settings({ platform: 'microsoft' }));
    renderSection(settings({ platform: 'microsoft' }), { onEmailSettingsChange: state.onEmailSettingsChange });

    await userEvent.type(screen.getByLabelText('Microsoft 365 App Password'), 'b');

    expect(state.latest()).toMatchObject({ microsoft_app_password: 'b' });
  });

  it('still shows the full SMTP form for a self-hosted server', () => {
    renderSection(settings({ platform: 'selfhosted' }));

    expect(screen.getByText('SMTP Host')).toBeInTheDocument();
    expect(screen.queryByText(/app password/i)).not.toBeInTheDocument();
  });
});

describe('EmailSettingsSection — test connection', () => {
  it('runs the test from the form', async () => {
    const { onTest, onSave } = renderSection(settings({ platform: 'gmail' }));

    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('has nothing to test when no platform is chosen', () => {
    renderSection(settings({ platform: 'other' }));

    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeDisabled();
  });

  it('holds both buttons while a test is running', () => {
    renderSection(settings({ platform: 'gmail' }), { testingEmail: true });

    expect(screen.getByRole('button', { name: 'Testing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Email Settings' })).toBeDisabled();
  });
});

describe('EmailSettingsSection — Microsoft 365 authentication method', () => {
  it('offers a method choice for Microsoft and for no other platform', () => {
    renderSection(settings({ platform: 'microsoft' }));
    expect(screen.getByRole('button', { name: /app registration \(oauth\)/i })).toBeInTheDocument();
  });

  it('offers no method choice for Gmail', () => {
    renderSection(settings({ platform: 'gmail' }));
    expect(screen.queryByRole('button', { name: /app registration \(oauth\)/i })).not.toBeInTheDocument();
  });

  it('asks for the app registration when the method is oauth', () => {
    renderSection(settings({ platform: 'microsoft', microsoft_auth_method: 'oauth' }));

    expect(screen.getByLabelText(/directory \(tenant\) id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/application \(client\) id/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Client secret')).toBeInTheDocument();
    // Offering both credentials at once would leave it ambiguous which one
    // the sender is going to use.
    expect(screen.queryByLabelText('Microsoft 365 App Password')).not.toBeInTheDocument();
  });

  // Exchange Online disables Basic auth by default for existing tenants at
  // the end of December 2026. A department left on an App Password stops
  // sending then, so the screen has to say so before that happens.
  it('warns that the App Password method is being retired', () => {
    renderSection(settings({ platform: 'microsoft', microsoft_auth_method: 'app_password' }));

    expect(screen.getByText(/December 2026/)).toBeInTheDocument();
  });

  it('does not carry that warning into the OAuth method', () => {
    renderSection(settings({ platform: 'microsoft', microsoft_auth_method: 'oauth' }));

    expect(screen.queryByText(/December 2026/)).not.toBeInTheDocument();
  });

  it('switches the stored method when the admin picks one', async () => {
    const user = userEvent.setup();
    const { onEmailSettingsChange } = renderSection(
      settings({ platform: 'microsoft', microsoft_auth_method: 'app_password' })
    );

    await user.click(screen.getByRole('button', { name: /app registration \(oauth\)/i }));

    const update = onEmailSettingsChange.mock.calls[0]?.[0] as (s: EmailServiceSettings) => EmailServiceSettings;
    expect(update(settings({ platform: 'microsoft' })).microsoft_auth_method).toBe('oauth');
  });

  it('writes each app registration field to its own key', async () => {
    const oauth = settings({ platform: 'microsoft', microsoft_auth_method: 'oauth' });
    const state = applyUpdatesTo(oauth);
    renderSection(oauth, { onEmailSettingsChange: state.onEmailSettingsChange });

    await userEvent.type(screen.getByLabelText(/directory \(tenant\) id/i), 't');
    await userEvent.type(screen.getByLabelText(/application \(client\) id/i), 'c');
    await userEvent.type(screen.getByLabelText('Client secret'), 's');

    expect(state.latest()).toMatchObject({
      microsoft_tenant_id: 't',
      microsoft_client_id: 'c',
      microsoft_client_secret: 's',
    });
  });

  // Basic auth is on its way out, so a Microsoft configuration being made
  // now should not start on it. One already carrying a password — the
  // redacted marker counts — keeps the method it is working with.
  it('preselects OAuth when Microsoft is chosen with nothing saved', async () => {
    const user = userEvent.setup();
    const { onEmailSettingsChange } = renderSection(settings({ platform: 'gmail' }));

    await user.click(screen.getByRole('button', { name: /microsoft 365/i }));

    const update = onEmailSettingsChange.mock.calls[0]?.[0] as (s: EmailServiceSettings) => EmailServiceSettings;
    expect(update(settings({ platform: 'gmail' })).microsoft_auth_method).toBe('oauth');
  });

  it('leaves a saved App Password configuration on its own method', async () => {
    const user = userEvent.setup();
    const saved = settings({ platform: 'gmail', microsoft_app_password: '••••••••' });
    const { onEmailSettingsChange } = renderSection(saved);

    await user.click(screen.getByRole('button', { name: /microsoft 365/i }));

    const update = onEmailSettingsChange.mock.calls[0]?.[0] as (s: EmailServiceSettings) => EmailServiceSettings;
    expect(update(saved).microsoft_auth_method).toBeUndefined();
  });
});
