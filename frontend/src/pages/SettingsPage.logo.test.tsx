import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockGetEnabledModules = vi.fn();
const mockGetProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    getEnabledModules: (...args: unknown[]) => mockGetEnabledModules(...args) as unknown,
    getProfile: (...args: unknown[]) => mockGetProfile(...args) as unknown,
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
    success: vi.fn(),
  }),
}));

// Imported after the mocks so the page binds to them.
import SettingsPage from './SettingsPage';
import { renderWithRouter } from '../test/utils';
import type { OrganizationProfile } from '../services/api';

const STORED_LOGO = 'data:image/png;base64,U1RPUkVE';
const CLEANED_LOGO = 'data:image/png;base64,Q0xFQU5FRA==';

const profile = (overrides: Partial<OrganizationProfile> = {}): OrganizationProfile => ({
  name: 'Station 12',
  timezone: 'America/New_York',
  phone: '',
  email: '',
  website: '',
  county: '',
  founded_year: null,
  logo: STORED_LOGO,
  mailing_address: { line1: '', line2: '', city: '', state: '', zip: '' },
  physical_address_same: true,
  physical_address: { line1: '', line2: '', city: '', state: '', zip: '' },
  ...overrides,
});

const pngFile = () => new File([new Uint8Array([137, 80, 78, 71])], 'crest.png', { type: 'image/png' });

const logoInput = () => screen.getByLabelText<HTMLInputElement>('Department logo file');

describe('SettingsPage logo upload', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({});
    mockGetEnabledModules.mockReset();
    mockGetEnabledModules.mockResolvedValue({ enabled_modules: [], module_settings: {} });
    mockGetProfile.mockReset();
    mockGetProfile.mockResolvedValue(profile());
    mockUpdateProfile.mockReset();
    mockToastError.mockReset();
  });

  it('sends only the logo, then shows the copy the server stored', async () => {
    const user = userEvent.setup();
    mockUpdateProfile.mockResolvedValue(profile({ logo: CLEANED_LOGO }));
    renderWithRouter(<SettingsPage />);

    await screen.findByRole('button', { name: /upload logo/i });
    await user.upload(logoInput(), pngFile());

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const payload = mockUpdateProfile.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['logo']);
    expect(String(payload['logo'])).toMatch(/^data:image\/png;base64,/);
    await waitFor(() => expect(screen.getByAltText(/logo/i)).toHaveAttribute('src', CLEANED_LOGO));
  });

  it('keeps the stored logo and says why when the server refuses the image', async () => {
    const user = userEvent.setup();
    mockUpdateProfile.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { detail: 'Invalid image: Image too small' } },
    });
    renderWithRouter(<SettingsPage />);

    await screen.findByRole('button', { name: /upload logo/i });
    await user.upload(logoInput(), pngFile());

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastError).toHaveBeenCalledWith('Invalid image: Image too small');
    expect(screen.getByAltText(/logo/i)).toHaveAttribute('src', STORED_LOGO);
  });
});
