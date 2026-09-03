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

describe('EmailSettingsSection — hosted platforms are App Password only', () => {
  it('asks Gmail for an App Password and nothing OAuth-shaped', () => {
    renderSection(settings({ platform: 'gmail' }));

    expect(screen.getByLabelText('Google App Password')).toBeInTheDocument();
    expect(screen.queryByText(/client id/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/client secret/i)).not.toBeInTheDocument();
    // The From address doubles as the login, and the label says so.
    expect(screen.getByText(/signs in as/i)).toBeInTheDocument();
  });

  it('asks Microsoft 365 for an App Password, not a tenant or client', () => {
    renderSection(settings({ platform: 'microsoft' }));

    expect(screen.getByLabelText('Microsoft 365 App Password')).toBeInTheDocument();
    expect(screen.queryByText(/tenant id/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/client id/i)).not.toBeInTheDocument();
  });

  // The change handler reads the input inside the state updater, so the
  // updater has to run during the event — as React's setState does — before
  // the controlled input is reset to its prop value. A bare vi.fn() would
  // hand it back after the reset and see an empty field.
  const applyUpdatesTo = (initial: EmailServiceSettings) => {
    let latest = initial;
    const onEmailSettingsChange = vi.fn((update: React.SetStateAction<EmailServiceSettings>) => {
      latest = typeof update === 'function' ? update(latest) : update;
    });
    return { onEmailSettingsChange, latest: () => latest };
  };

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
