import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router';
import { renderWithRouter } from '../test/utils';
import { UserSettingsPage } from './UserSettingsPage';
import * as apiModule from '../services/api';

// Mock the API module
vi.mock('../services/api', () => ({
  authService: {
    changePassword: vi.fn().mockResolvedValue(undefined),
  },
  userService: {
    getUserWithRoles: vi.fn(),
    updateUserProfile: vi.fn(),
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    getMyConsents: vi.fn(),
    setMyConsent: vi.fn().mockResolvedValue(undefined),
    getMyProfileVisibility: vi.fn(),
    setMyProfileVisibility: vi.fn(),
    checkContactInfoEnabled: vi.fn(),
  },
}));

const defaultProfile = {
  id: 'user-123',
  username: 'jdoe',
  email: 'jdoe@example.com',
  first_name: 'John',
  last_name: 'Doe',
  phone: '555-1234',
  mobile: '',
  membership_number: 'FD-0042',
  rank: 'firefighter',
  station: 'Station 1',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  address_country: 'USA',
  emergency_contacts: [],
  roles: [],
};

// Mock auth store
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: {
      id: 'user-123',
      username: 'jdoe',
      email: 'jdoe@example.com',
      organization_id: 'org-456',
      timezone: 'America/New_York',
      roles: [],
      positions: [],
      rank: null,
      membership_type: 'active',
      permissions: [],
      is_active: true,
      email_verified: true,
      mfa_enabled: false,
      password_expired: false,
      must_change_password: false,
    },
    loadUser: vi.fn(),
    checkPermission: () => false,
  }),
}));

// Mock theme context
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}));

// Mock useRanks hook
vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    rankOptions: [{ value: 'firefighter', label: 'Firefighter' }],
  }),
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UserSettingsPage', () => {
  const { userService } = apiModule;

  beforeEach(() => {
    // The page mirrors the selected section into `?tab=`, and renderWithRouter
    // uses a BrowserRouter over the one shared jsdom window — so without this
    // reset a test that clicks a tab decides which section the NEXT test opens
    // on.
    window.history.pushState({}, '', '/account');
    vi.clearAllMocks();
    vi.mocked(userService.getUserWithRoles).mockResolvedValue(defaultProfile as never);
    vi.mocked(userService.getNotificationPreferences).mockResolvedValue({
      email_notifications: true,
      sms_notifications: true,
      event_reminders: true,
      training_reminders: true,
    });
    vi.mocked(userService.getMyConsents).mockResolvedValue([
      { consent_type: 'sms_notifications', granted: true, updated_at: null },
    ]);
    vi.mocked(userService.getMyProfileVisibility).mockReset();
    vi.mocked(userService.getMyProfileVisibility).mockResolvedValue({
      email: true,
      personal_email: false,
      phone: true,
      mobile: true,
      address: false,
    });
    vi.mocked(userService.setMyProfileVisibility).mockReset();
    vi.mocked(userService.setMyProfileVisibility).mockImplementation((v) => Promise.resolve(v));
    vi.mocked(userService.checkContactInfoEnabled).mockReset();
    vi.mocked(userService.checkContactInfoEnabled).mockResolvedValue({
      enabled: true,
      show_email: true,
      show_phone: true,
      show_mobile: true,
    });
  });

  describe('Privacy Tab', () => {
    it('lists a switch for each of the five fields with the current value beside it', async () => {
      window.history.pushState({}, '', '/account?tab=privacy');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByText('Profile visibility')).toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(5));
      expect(screen.getByRole('switch', { name: 'Work email visibility' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: 'Mailing address visibility' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      // The value under the switch comes from the loaded profile.
      expect(await screen.findByText('jdoe@example.com')).toBeInTheDocument();
    });

    it('saves the whole object when one switch is flipped', async () => {
      window.history.pushState({}, '', '/account?tab=privacy');
      renderWithRouter(<UserSettingsPage />);

      await userEvent.setup().click(await screen.findByRole('switch', { name: 'Mailing address visibility' }));

      await waitFor(() =>
        expect(userService.setMyProfileVisibility).toHaveBeenCalledWith({
          email: true,
          personal_email: false,
          phone: true,
          mobile: true,
          address: true,
        })
      );
      expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    });

    it('now holds the consents and the data export, which left the Security tab', async () => {
      window.history.pushState({}, '', '/account?tab=privacy');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByText('Privacy Choices')).toBeInTheDocument();
      expect(await screen.findByText('Text message notifications')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
    });

    it('keeps the switches off when the profile behind them could not load', async () => {
      // A member must never enable a field they cannot see: with the profile
      // unknown every row would read "Nothing on file" over a real value.
      vi.mocked(userService.getUserWithRoles).mockRejectedValue(new Error('offline'));
      window.history.pushState({}, '', '/account?tab=privacy');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();

      vi.mocked(userService.getUserWithRoles).mockResolvedValue(defaultProfile as never);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(5));
    });

    it('marks a work field the department has switched off for everyone', async () => {
      vi.mocked(userService.checkContactInfoEnabled).mockResolvedValue({
        enabled: true,
        show_email: false,
        show_phone: true,
        show_mobile: true,
      });
      window.history.pushState({}, '', '/account?tab=privacy');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByText('Off for everyone (department setting)')).toBeInTheDocument();
    });

    it('leaves the Security tab to two-factor authentication', async () => {
      window.history.pushState({}, '', '/account?tab=security');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByText('Two-Factor Authentication')).toBeInTheDocument();
      expect(screen.queryByText('Privacy Choices')).not.toBeInTheDocument();
      expect(screen.queryByText('Download my data')).not.toBeInTheDocument();
    });
  });

  it('should render the page title', () => {
    renderWithRouter(<UserSettingsPage />);

    expect(screen.getByText('User Settings')).toBeInTheDocument();
  });

  it('should render all tabs including Emergency Contacts', () => {
    renderWithRouter(<UserSettingsPage />);

    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByText('Emergency Contacts')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('should default to the Account tab', () => {
    renderWithRouter(<UserSettingsPage />);

    expect(screen.getByText('Account Information')).toBeInTheDocument();
  });

  describe('Notifications Tab', () => {
    it('turning off urgent texts withdraws the SMS consent and the preference together', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      await user.click(screen.getByText('Notifications'));

      const smsToggle = await screen.findByRole('switch', {
        name: /urgent text messages/i,
      });
      // Consent granted and preference on, so the add-on reads as on.
      await waitFor(() => expect(smsToggle).toHaveAttribute('aria-checked', 'true'));
      await user.click(smsToggle);

      // Saved on the switch, not deferred to the Save Preferences button —
      // and carrying only the key this switch owns, so it cannot commit
      // unsaved edits sitting in the toggles above it.
      await waitFor(() => expect(userService.setMyConsent).toHaveBeenCalledWith('sms_notifications', false));
      expect(userService.updateNotificationPreferences).toHaveBeenCalledWith('user-123', {
        sms_notifications: false,
      });
    });

    it('grants consent last when enabling, so a half-failed save leaves texts off', async () => {
      // Two requests, no transaction across them. Consent is the gate that
      // opens (the preference defaults to on when unset), so writing it first
      // would let texts start sending to a member the UI just told the save
      // had failed.
      vi.mocked(userService.getMyConsents).mockResolvedValue([
        { consent_type: 'sms_notifications', granted: null, updated_at: null },
      ]);
      const order: string[] = [];
      vi.mocked(userService.updateNotificationPreferences).mockImplementation(() => {
        order.push('preference');
        return Promise.resolve();
      });
      vi.mocked(userService.setMyConsent).mockImplementation(() => {
        order.push('consent');
        return Promise.resolve();
      });

      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);
      await user.click(screen.getByText('Notifications'));
      await user.click(await screen.findByRole('switch', { name: /urgent text messages/i }));

      await waitFor(() => expect(order).toEqual(['preference', 'consent']));
    });

    it('withdraws consent first when disabling, for the same reason', async () => {
      const order: string[] = [];
      vi.mocked(userService.updateNotificationPreferences).mockImplementation(() => {
        order.push('preference');
        return Promise.resolve();
      });
      vi.mocked(userService.setMyConsent).mockImplementation(() => {
        order.push('consent');
        return Promise.resolve();
      });

      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);
      await user.click(screen.getByText('Notifications'));
      const smsToggle = await screen.findByRole('switch', { name: /urgent text messages/i });
      await waitFor(() => expect(smsToggle).toHaveAttribute('aria-checked', 'true'));
      await user.click(smsToggle);

      // Revoking consent closes the gate; if the preference write then fails,
      // texts have already stopped.
      await waitFor(() => expect(order).toEqual(['consent', 'preference']));
    });

    it('reads as off until the member grants SMS consent, whatever the stored preference says', async () => {
      // The consent is the gate the backend actually enforces. A preference of
      // true with no consent on record sends nothing, so the switch must not
      // show the member as opted in.
      vi.mocked(userService.getMyConsents).mockResolvedValue([
        { consent_type: 'sms_notifications', granted: null, updated_at: null },
      ]);
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      await user.click(screen.getByText('Notifications'));

      const smsToggle = await screen.findByRole('switch', {
        name: /urgent text messages/i,
      });
      expect(smsToggle).toHaveAttribute('aria-checked', 'false');

      await user.click(smsToggle);
      await waitFor(() => expect(userService.setMyConsent).toHaveBeenCalledWith('sms_notifications', true));
    });
  });

  describe('Emergency Contacts Tab', () => {
    it('should show empty state when no contacts exist', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByText('No emergency contacts on file.')).toBeInTheDocument();
      });
    });

    it('should show Add Emergency Contact button in empty state', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add emergency contact/i })).toBeInTheDocument();
      });
    });

    it('should add a contact form when Add button is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add emergency contact/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add emergency contact/i }));

      expect(screen.getByText('Contact 1')).toBeInTheDocument();
      expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Phone/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Relationship/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    });

    it('should allow adding multiple contacts', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add emergency contact/i })).toBeInTheDocument();
      });

      // Add first contact
      await user.click(screen.getByRole('button', { name: /add emergency contact/i }));
      expect(screen.getByText('Contact 1')).toBeInTheDocument();

      // Add second contact
      await user.click(screen.getByRole('button', { name: /add another contact/i }));
      expect(screen.getByText('Contact 2')).toBeInTheDocument();
    });

    it('should allow removing a contact', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add emergency contact/i })).toBeInTheDocument();
      });

      // Add a contact
      await user.click(screen.getByRole('button', { name: /add emergency contact/i }));
      expect(screen.getByText('Contact 1')).toBeInTheDocument();

      // Remove it
      const removeButton = screen.getByRole('button', {
        name: /remove contact 1/i,
      });
      await user.click(removeButton);

      // Should be back to empty state
      expect(screen.getByText('No emergency contacts on file.')).toBeInTheDocument();
    });

    it('should display existing contacts from the profile', async () => {
      vi.mocked(userService.getUserWithRoles).mockResolvedValue({
        ...defaultProfile,
        emergency_contacts: [
          {
            name: 'Jane Doe',
            relationship: 'Spouse',
            phone: '555-5678',
            email: 'jane@example.com',
            is_primary: true,
          },
        ],
      } as never);

      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByText('Contact 1')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Spouse')).toBeInTheDocument();
        expect(screen.getByDisplayValue('555-5678')).toBeInTheDocument();
        expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
      });
    });

    it('should show save button when contacts exist', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add emergency contact/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add emergency contact/i }));

      expect(screen.getByRole('button', { name: /save emergency contacts/i })).toBeInTheDocument();
    });

    it('should call API when saving contacts', async () => {
      vi.mocked(userService.updateUserProfile).mockResolvedValue({
        ...defaultProfile,
        emergency_contacts: [
          {
            name: 'Jane Doe',
            relationship: '',
            phone: '555-5678',
            email: '',
            is_primary: true,
          },
        ],
      } as never);

      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add emergency contact/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add emergency contact/i }));

      // Fill in the form
      const nameInput = screen.getByLabelText(/^Name/);
      const phoneInput = screen.getByLabelText(/^Phone/);

      await user.type(nameInput, 'Jane Doe');
      await user.type(phoneInput, '555-5678');

      // Save
      await user.click(screen.getByRole('button', { name: /save emergency contacts/i }));

      await waitFor(() => {
        expect(userService.updateUserProfile).toHaveBeenCalledWith('user-123', {
          emergency_contacts: [
            {
              name: 'Jane Doe',
              relationship: '',
              phone: '555-5678',
              email: '',
              is_primary: true,
            },
          ],
        });
      });
    });

    it('should show description text on the emergency tab', async () => {
      const user = userEvent.setup();
      renderWithRouter(<UserSettingsPage />);

      const emergencyTab = screen.getByText('Emergency Contacts');
      await user.click(emergencyTab);

      await waitFor(() => {
        expect(screen.getByText(/Add emergency contacts so your department can reach someone/)).toBeInTheDocument();
      });
    });
  });

  describe('section selection via ?tab=', () => {
    // renderWithRouter uses BrowserRouter, so the query string comes from
    // window.location — set it before rendering.
    function startAt(url: string): void {
      window.history.pushState({}, '', url);
    }

    it('opens the section named by ?tab= on first render', async () => {
      startAt('/account?tab=app');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByText('App Version')).toBeInTheDocument();
    });

    it('follows ?tab= on an in-place navigation, not just on mount', async () => {
      // The update banner links to /account?tab=app from anywhere in the app,
      // including from this page with another section already open. That is a
      // client-side navigation that leaves this component mounted, so reading
      // the parameter once at useState time showed the member the section they
      // were already on and none of the Force refresh controls it promised.
      startAt('/account?tab=security');
      renderWithRouter(
        <>
          <Link to="/account?tab=app">Go to app settings</Link>
          <UserSettingsPage />
        </>
      );

      await waitFor(() => expect(screen.queryByText('App Version')).not.toBeInTheDocument());

      await userEvent.setup().click(screen.getByRole('link', { name: 'Go to app settings' }));

      expect(await screen.findByText('App Version')).toBeInTheDocument();
    });

    it('mirrors a clicked section into ?tab= so returning to it navigates', async () => {
      startAt('/account?tab=app');
      renderWithRouter(<UserSettingsPage />);

      expect(await screen.findByText('App Version')).toBeInTheDocument();
      await userEvent.setup().click(screen.getByText('Emergency Contacts'));

      // Without the mirroring the URL would still read ?tab=app here, and the
      // banner's link back to it would be a no-op navigation that re-selects
      // nothing.
      await waitFor(() => expect(new URLSearchParams(window.location.search).get('tab')).toBe('emergency'));
    });
  });
});
