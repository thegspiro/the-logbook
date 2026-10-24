import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CertAlertSettings } from '../../types/training';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockToast = vi.fn();

vi.mock('../../services/api', () => ({
  trainingService: {
    getCertAlertSettings: (...a: unknown[]) => mockGet(...a) as unknown,
    updateCertAlertSettings: (...a: unknown[]) => mockUpdate(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => mockToast(...a) as unknown },
}));

import CertAlertSettingsPanel from './CertAlertSettingsPanel';

const off: CertAlertSettings = {
  enabled: false,
  cc_chief_on_escalation: false,
  include_personal_email_on_final: false,
};

const emailMembers = () => screen.findByRole('checkbox', { name: /Email members when a certification/ });
const copyChief = () => screen.getByRole('checkbox', { name: /Copy the chief officers/ });
const personalEmail = () => screen.getByRole('checkbox', { name: /member's personal email address/ });
const save = () => screen.getByRole('button', { name: /^Save$|Saving/ });

describe('CertAlertSettingsPanel', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockToast.mockReset();
    mockGet.mockResolvedValue(off);
  });

  it('shows a department that never set them as off, with nothing to save', async () => {
    render(<CertAlertSettingsPanel />);

    expect(await emailMembers()).not.toBeChecked();
    expect(save()).toBeDisabled();
  });

  it('keeps the two copy options unavailable until the alerts are on', async () => {
    const user = userEvent.setup();
    render(<CertAlertSettingsPanel />);

    await emailMembers();
    expect(copyChief()).toBeDisabled();
    expect(personalEmail()).toBeDisabled();

    await user.click(await emailMembers());

    expect(copyChief()).toBeEnabled();
    expect(personalEmail()).toBeEnabled();
  });

  it('saves all three switches and tells the officer it worked', async () => {
    const user = userEvent.setup();
    const saved: CertAlertSettings = {
      enabled: true,
      cc_chief_on_escalation: true,
      include_personal_email_on_final: false,
    };
    mockUpdate.mockResolvedValue(saved);
    render(<CertAlertSettingsPanel />);

    await user.click(await emailMembers());
    await user.click(copyChief());
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(save());

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(saved));
    expect(mockToast).toHaveBeenCalledWith('Certification alerts saved');
    await waitFor(() => expect(save()).toBeDisabled());
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('shows what the server now holds rather than what was sent', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(off);
    render(<CertAlertSettingsPanel />);

    await user.click(await emailMembers());
    await user.click(save());

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Email members when a certification/ })).not.toBeChecked()
    );
  });

  it('keeps the unsaved choice and names the problem when the save fails', async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new Error('network down'));
    render(<CertAlertSettingsPanel />);

    await user.click(await emailMembers());
    await user.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent(/network down|Could not save/);
    expect(await emailMembers()).toBeChecked();
    expect(save()).toBeEnabled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('says so, and offers no controls, when the settings cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    render(<CertAlertSettingsPanel />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
