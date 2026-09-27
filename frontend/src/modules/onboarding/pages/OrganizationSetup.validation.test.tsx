/**
 * A field that fails validation says so next to itself.
 *
 * The validator stored the ZIP error under `mailingZip` while the address
 * form looked it up as `mailingZipCode`, so ZIP Code was the one required
 * field with no message beside it — the summary named it, the field did not.
 * Messages were also not tied to their fields, so a screen reader reported an
 * invalid input without saying why (workflow review W01-1).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/api-client', () => ({ apiClient: { getStatus: vi.fn() } }));
vi.mock('../hooks/useOnboardingSession', () => ({
  useOnboardingSession: () => ({
    hasSession: true,
    isLoading: false,
    initializeSession: () => Promise.resolve(true),
    saveOrganization: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import OrganizationSetup from './OrganizationSetup';
import { ThemeProvider } from '../../../contexts/ThemeContext';

describe('OrganizationSetup — field errors', () => {
  it('shows the ZIP code error beside the ZIP code field', async () => {
    render(
      <ThemeProvider>
        <OrganizationSetup />
      </ThemeProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: /^continue/i }));

    const zip = screen.getByLabelText(/^zip code/i);
    expect(zip).toHaveAttribute('aria-invalid', 'true');
    expect(zip).toHaveAccessibleDescription('ZIP/Postal code is required');
  });

  it('describes every invalid field by its own message', async () => {
    render(
      <ThemeProvider>
        <OrganizationSetup />
      </ThemeProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: /^continue/i }));

    expect(screen.getByLabelText(/^organization name/i)).toHaveAccessibleDescription('Organization name is required');
    expect(screen.getByLabelText(/^city/i)).toHaveAccessibleDescription('City is required');
    expect(screen.getByLabelText(/^state/i)).toHaveAccessibleDescription('State is required');
  });
});
