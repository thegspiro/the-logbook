import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetProfile = vi.fn();
const mockUpdateContactDetails = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getProfile: (...args: unknown[]) => mockGetProfile(...args) as unknown,
    updateContactDetails: (...args: unknown[]) => mockUpdateContactDetails(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => mockCheckPermission(p) as boolean }),
}));

// Imported after the mocks so the component binds to them.
import DepartmentContactCard from './DepartmentContactCard';
import { renderWithRouter } from '../../../test/utils';
import type { OrganizationProfile } from '../../../services/api';

const profile = (overrides: Partial<OrganizationProfile> = {}): OrganizationProfile => ({
  name: 'Falls Church Fire & Rescue',
  timezone: 'America/New_York',
  phone: '(555) 111-2222',
  email: 'info@example.org',
  website: 'https://example.org',
  county: '',
  founded_year: null,
  logo: null,
  mailing_address: { line1: '100 Main Street', line2: '', city: 'Falls Church', state: 'VA', zip: '22046' },
  physical_address_same: true,
  physical_address: { line1: '', line2: '', city: '', state: '', zip: '' },
  ...overrides,
});

describe('DepartmentContactCard', () => {
  beforeEach(() => {
    mockGetProfile.mockReset();
    mockGetProfile.mockResolvedValue(profile());
    mockUpdateContactDetails.mockReset();
    mockUpdateContactDetails.mockImplementation((updates: Record<string, unknown>) =>
      Promise.resolve(profile({ phone: (updates['phone'] as string | null) ?? '' }))
    );
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
  });

  it("loads the department's own values into the fields", async () => {
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);

    expect(await screen.findByLabelText('Phone')).toHaveValue('(555) 111-2222');
    expect(screen.getByLabelText('Email')).toHaveValue('info@example.org');
    expect(screen.getByLabelText('Website')).toHaveValue('https://example.org');
    expect(screen.getByLabelText('Address line 1')).toHaveValue('100 Main Street');
    expect(screen.getByLabelText('City')).toHaveValue('Falls Church');
    expect(screen.getByLabelText('State')).toHaveValue('VA');
    expect(screen.getByLabelText('ZIP')).toHaveValue('22046');
  });

  it('asks for the permission the save endpoint enforces', async () => {
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);
    await screen.findByLabelText('Phone');

    expect(mockCheckPermission).toHaveBeenCalledWith('settings.manage');
  });

  it('saves only the contact fields, sending a cleared one as null, then tells the screen', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithRouter(<DepartmentContactCard onSaved={onSaved} />);

    const phone = await screen.findByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '(555) 999-0000');
    await user.clear(screen.getByLabelText('Website'));
    await user.click(screen.getByRole('button', { name: /save contact details/i }));

    await waitFor(() => expect(mockUpdateContactDetails).toHaveBeenCalledTimes(1));
    expect(mockUpdateContactDetails).toHaveBeenCalledWith({
      phone: '(555) 999-0000',
      email: 'info@example.org',
      website: null,
      mailing_address: {
        line1: '100 Main Street',
        line2: null,
        city: 'Falls Church',
        state: 'VA',
        zip: '22046',
      },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('does not offer a save until something changes', async () => {
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);
    await screen.findByLabelText('Phone');

    expect(screen.getByRole('button', { name: /save contact details/i })).toBeDisabled();
  });

  it('refuses an email address with no @ rather than saving it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);

    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'office.example.org');

    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save contact details/i })).toBeDisabled();
  });

  it('puts the saved values back on Discard', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);

    const phone = await screen.findByLabelText('Phone');
    await user.clear(phone);
    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(screen.getByLabelText('Phone')).toHaveValue('(555) 111-2222');
  });

  it('shows the values read-only to someone who cannot change them', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);

    expect(await screen.findByLabelText('Phone')).toBeDisabled();
    expect(screen.getByText(/needs the organization settings permission/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save contact details/i })).not.toBeInTheDocument();
  });

  it('says so when the details cannot be loaded', async () => {
    mockGetProfile.mockRejectedValue(new Error('network'));
    renderWithRouter(<DepartmentContactCard onSaved={vi.fn()} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument();
  });

  it('keeps the edits and does not report success when the save fails', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockUpdateContactDetails.mockRejectedValue(new Error('String should have at most 20 characters'));
    renderWithRouter(<DepartmentContactCard onSaved={onSaved} />);

    const phone = await screen.findByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '555');
    await user.click(screen.getByRole('button', { name: /save contact details/i }));

    await waitFor(() => expect(mockUpdateContactDetails).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Phone')).toHaveValue('555');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
