import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockGetEnabledModules = vi.fn();
const mockGetProfile = vi.fn();
const mockUpdateProfile = vi.fn();

vi.mock('../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    getEnabledModules: (...args: unknown[]) => mockGetEnabledModules(...args) as unknown,
    getProfile: (...args: unknown[]) => mockGetProfile(...args) as unknown,
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) as unknown,
  },
}));

// Imported after the mocks so the page binds to them.
import SettingsPage from './SettingsPage';
import { renderWithRouter } from '../test/utils';
import type { OrganizationProfile } from '../services/api';

const profile = (overrides: Partial<OrganizationProfile> = {}): OrganizationProfile => ({
  name: 'Station 12',
  timezone: 'America/New_York',
  phone: '(703) 555-0112',
  email: 'office@station12.org',
  website: 'https://station12.org',
  county: 'Fairfax',
  founded_year: null,
  logo: null,
  mailing_address: { line1: '12 Firehouse Lane', line2: '', city: 'Vienna', state: 'VA', zip: '22180' },
  physical_address_same: false,
  physical_address: { line1: '12 Firehouse Lane', line2: '', city: 'Vienna', state: 'VA', zip: '22180' },
  ...overrides,
});

const openSubPage = (page: 'contact' | 'addresses') => {
  window.history.pushState({}, '', `/settings?page=${page}`);
  return renderWithRouter(<SettingsPage />);
};

const savedEmails = () => mockUpdateProfile.mock.calls.map((call) => (call[0] as Partial<OrganizationProfile>).email);

describe('SettingsPage profile field limits', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({});
    mockGetEnabledModules.mockReset();
    mockGetEnabledModules.mockResolvedValue({ enabled_modules: [], module_settings: {} });
    mockGetProfile.mockReset();
    mockGetProfile.mockResolvedValue(profile());
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockImplementation((next: OrganizationProfile) => Promise.resolve(next));
  });

  it('stops each contact field at its column length', async () => {
    openSubPage('contact');

    expect(await screen.findByLabelText('Phone')).toHaveAttribute('maxLength', '20');
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxLength', '255');
    expect(screen.getByLabelText('Website')).toHaveAttribute('maxLength', '255');
    expect(screen.getByLabelText('County')).toHaveAttribute('maxLength', '100');
  });

  it('stops each address field at its column length, mailing and physical alike', async () => {
    openSubPage('addresses');

    for (const side of ['Mailing', 'Physical']) {
      expect(await screen.findByLabelText(`${side} address line 1`)).toHaveAttribute('maxLength', '255');
      expect(screen.getByLabelText(`${side} address line 2`)).toHaveAttribute('maxLength', '255');
      expect(screen.getByLabelText(`${side} address city`)).toHaveAttribute('maxLength', '100');
      expect(screen.getByLabelText(`${side} address state`)).toHaveAttribute('maxLength', '50');
      expect(screen.getByLabelText(`${side} address ZIP`)).toHaveAttribute('maxLength', '20');
    }
  });

  it('holds back a malformed email and says the saved one still stands', async () => {
    const user = userEvent.setup();
    openSubPage('contact');

    const email = await screen.findByLabelText('Email');
    // An edit to the stored address that breaks it, without passing through
    // blank (which is itself a valid, clearing value).
    await user.type(email, ' x');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/enter an email address/i);
    expect(alert).toHaveTextContent('It is still saved as \u201coffice@station12.org\u201d.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveValue('office@station12.org x');
    // Wait past the autosave debounce: nothing malformed may have been sent.
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(savedEmails().some((value) => value?.includes(' x'))).toBe(false);
  });

  it('says nothing is saved while an address typed from empty is incomplete', async () => {
    const user = userEvent.setup();
    mockGetProfile.mockResolvedValue(profile({ email: '' }));
    openSubPage('contact');

    const email = await screen.findByLabelText('Email');
    await user.type(email, 'office@station12');

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is saved until it is complete.');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(savedEmails()).not.toContain('office@station12');
  });

  it('saves the address once it is complete', async () => {
    const user = userEvent.setup();
    openSubPage('contact');

    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'chief@station12.org');

    await waitFor(() => expect(savedEmails()).toContain('chief@station12.org'), { timeout: 3000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets the email be cleared', async () => {
    const user = userEvent.setup();
    openSubPage('contact');

    await user.clear(await screen.findByLabelText('Email'));

    await waitFor(() => expect(savedEmails()).toContain(''), { timeout: 3000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
