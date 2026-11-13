/**
 * User Settings Page
 *
 * Allows users to manage their personal account settings, password,
 * appearance, and notification preferences.
 */

import React, { useState, useEffect, useRef } from 'react';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../hooks/useFieldErrors';
import { FormField } from '../components/ux/FormField';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  User,
  Lock,
  Bell,
  Eye,
  EyeOff,
  CheckCircle,
  Sun,
  Moon,
  Monitor,
  Contrast,
  Palette,
  AlertTriangle,
  Heart,
  Plus,
  Trash2,
  ShieldCheck,
  Download,
  Smartphone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { authService, userService } from '../services/api';
import { MfaSettingsCard } from '../components/settings/MfaSettingsCard';
import { PasskeySettingsCard } from '../components/settings/PasskeySettingsCard';
import { AppVersionSection } from '../components/settings/AppVersionSection';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { PASSWORD_CHECKLIST, validatePasswordStrength } from '../utils/passwordValidation';
import type { PasswordChangeData } from '../types/auth';
import type {
  UserProfileUpdate,
  EmergencyContact,
  ConsentItem,
  ContactInfoSettings,
  MemberEmailChoice,
  ProfileVisibilityField,
} from '../types/user';
import { PROFILE_VISIBILITY_FIELDS } from '../types/user';
import type { UserWithRoles } from '../types/role';
import { useProfileVisibility } from '../hooks/useProfileVisibility';
import { VisibilityControl } from '../components/member-profile/VisibilityControl';
import { orgHidesField } from '../utils/profileVisibility';
import { SaveStatusPill } from '../components/settings/SaveStatusPill';
import { SettingsPanelHead } from '../components/settings/SettingsPanelHead';
import { getErrorMessage } from '../utils/errorHandling';
import { blankToNull } from '../utils/formValues';
import { useRanks } from '../hooks/useRanks';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout';
import { SettingsToggle } from '../components/settings/SettingsToggle';
import { BottomNavigationSettings } from '../components/settings/BottomNavigationSettings';

type TabType = 'account' | 'password' | 'security' | 'privacy' | 'emergency' | 'appearance' | 'notifications' | 'app';

const TAB_IDS: TabType[] = [
  'account',
  'password',
  'security',
  'privacy',
  'emergency',
  'appearance',
  'notifications',
  'app',
];

const SECTIONS: SettingsSection<TabType>[] = [
  { key: 'account', label: 'Account', icon: User, description: 'Your name, contact details, and photo' },
  { key: 'password', label: 'Password', icon: Lock, description: 'Change the password you sign in with' },
  { key: 'security', label: 'Security', icon: ShieldCheck, description: 'Two-factor authentication' },
  {
    key: 'privacy',
    label: 'Privacy',
    icon: EyeOff,
    description: 'What other members can see, and your privacy choices',
  },
  { key: 'emergency', label: 'Emergency Contacts', icon: Heart, description: 'Who the department calls for you' },
  { key: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and phone navigation bar' },
  { key: 'notifications', label: 'Notifications', icon: Bell, description: 'How and when the department reaches you' },
  { key: 'app', label: 'App', icon: Smartphone, description: 'Installed version and update status' },
];

type LegalNameField = 'first_name' | 'last_name';
const LEGAL_NAME_FIELDS: readonly LegalNameField[] = ['first_name', 'last_name'];
const LEGAL_NAME_LABELS: Record<LegalNameField, string> = { first_name: 'first name', last_name: 'last name' };

type ProfileField =
  | 'first_name'
  | 'middle_name'
  | 'last_name'
  | 'preferred_name'
  | 'phone'
  | 'mobile'
  | 'address_street'
  | 'address_city'
  | 'address_state'
  | 'address_zip';

// Every field the profile save can be refused on, in page order. The ids are
// the inputs' own; a 422 entry names the request key, which is the field name.
const PROFILE_FIELDS: FieldSpecs<ProfileField> = {
  first_name: { id: 'firstName', label: 'First name' },
  middle_name: { id: 'middleName', label: 'Middle name' },
  last_name: { id: 'lastName', label: 'Last name' },
  preferred_name: { id: 'preferredName', label: 'Preferred name' },
  phone: { id: 'phone', label: 'Phone' },
  mobile: { id: 'mobile', label: 'Mobile' },
  address_street: { id: 'addressStreet', label: 'Street address' },
  address_city: { id: 'addressCity', label: 'City' },
  address_state: { id: 'addressState', label: 'State' },
  address_zip: { id: 'addressZip', label: 'ZIP code' },
};

const PROFILE_LABEL_CLASS = 'text-theme-text-secondary mb-1 block text-sm font-medium';

const legalNameMissing = (field: LegalNameField) => `Enter your ${LEGAL_NAME_LABELS[field]}.`;

/** An error on each legal name the record holds blank. */
function blankLegalNameErrors(record: Partial<Record<LegalNameField, string | null | undefined>>) {
  const errors: FieldErrors<ProfileField> = {};
  for (const field of LEGAL_NAME_FIELDS) {
    if (!record[field]?.trim()) errors[field] = legalNameMissing(field);
  }
  return errors;
}

export const UserSettingsPage: React.FC = () => {
  const { user, endSessionLocally } = useAuthStore();
  const navigate = useNavigate();
  const { rankOptions } = useRanks();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const forcePasswordChange =
    (location.state as { forcePasswordChange?: boolean } | null)?.forcePasswordChange ||
    user?.must_change_password ||
    user?.password_expired;
  const forceMfaSetup =
    (location.state as { forceMfaSetup?: boolean } | null)?.forceMfaSetup || user?.mfa_enrollment_required;
  // Deep links land here from the department setup checklist
  // (/account?tab=security for the MFA step), so honor ?tab= — but never over
  // a forced password change or MFA enrollment, which must not be navigated
  // away from.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab: TabType = TAB_IDS.includes(requestedTab as TabType) ? (requestedTab as TabType) : 'account';
  const [activeTab, setActiveTab] = useState<TabType>(
    forcePasswordChange ? 'password' : forceMfaSetup ? 'security' : initialTab
  );

  // `?tab=` is not only an initial value. The update banner links to
  // /account?tab=app from anywhere in the app, including from this page with
  // another section already open — a client-side navigation that leaves this
  // component mounted. Reading the parameter once at useState time meant such a
  // link changed the query string and nothing else, so the section it promised
  // was never shown.
  //
  // A forced password change or MFA enrollment still wins: those must not be
  // navigated away from.
  useEffect(() => {
    if (forcePasswordChange || forceMfaSetup) return;
    if (!requestedTab || !TAB_IDS.includes(requestedTab as TabType)) return;
    setActiveTab(requestedTab as TabType);
  }, [requestedTab, forcePasswordChange, forceMfaSetup]);

  /**
   * Select a section and mirror it into `?tab=`, matching the settings screens
   * that render through SettingsLayout.
   *
   * The mirroring is what keeps the effect above usable: without it the URL
   * would still say `?tab=app` after the member clicked away to another
   * section, so returning via the banner's link would be a no-op navigation
   * that changes nothing and re-selects nothing. Replace rather than push —
   * switching sections is not a history entry worth backing through.
   */
  const selectTab = (tab: TabType): void => {
    setActiveTab(tab);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('tab', tab);
        return next;
      },
      { replace: true }
    );
  };

  // Profile state
  const [profile, setProfile] = useState<UserWithRoles | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  // Open errors on the profile's fields. Owner rule (2026-11-05): a form saves
  // even with an error, and the error stays flagged until it is resolved.
  const profileErrors = useFieldErrors(PROFILE_FIELDS);
  const setProfileErrors = profileErrors.setErrors;
  // The inputs are disabled while a save is in flight and a disabled input
  // cannot take focus, so the field to point at waits for the save to end.
  const focusAfterSave = useRef<FieldErrors<ProfileField> | null>(null);
  const focusFirstProfileError = profileErrors.focusFirst;
  useEffect(() => {
    if (savingProfile || !focusAfterSave.current) return;
    focusFirstProfileError(focusAfterSave.current);
    focusAfterSave.current = null;
  }, [savingProfile, focusFirstProfileError]);
  const [downloadingData, setDownloadingData] = useState(false);
  const [consents, setConsents] = useState<ConsentItem[]>([]);
  const [savingConsent, setSavingConsent] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<UserProfileUpdate>({});

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Notification preferences state
  const [emailNotifications, setEmailNotifications] = useState(true);
  // Per-device web push; separate from the account-level email/SMS prefs below
  // because a subscription belongs to this browser, not to the user record.
  const push = usePushNotifications();
  const [smsNotifications, setSmsNotifications] = useState(true);
  // Which optional emails the member receives. The list comes from the
  // backend so a kind the department has made required is never offered
  // here as a choice — it is listed under alwaysSent instead.
  const [emailChoices, setEmailChoices] = useState<MemberEmailChoice[]>([]);
  const [alwaysSent, setAlwaysSent] = useState<string[]>([]);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [_loadingPreferences, setLoadingPreferences] = useState(false);

  // Emergency contacts state
  const [contactsForm, setContactsForm] = useState<EmergencyContact[]>([]);
  const [savingContacts, setSavingContacts] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  // Load user profile. A failure is remembered rather than swallowed: the
  // Privacy section must not offer switches over values it could not show,
  // so it needs to know the difference between "nothing on file" and "could
  // not load".
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [profileReloadToken, setProfileReloadToken] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    const loadProfile = async () => {
      setLoadingProfile(true);
      setProfileLoadFailed(false);
      try {
        const data = await userService.getUserWithRoles(user.id);
        setProfile(data);
        setProfileErrors(blankLegalNameErrors(data));
        setProfileForm({
          first_name: data.first_name || '',
          middle_name: data.middle_name || '',
          last_name: data.last_name || '',
          preferred_name: data.preferred_name || '',
          phone: data.phone || '',
          mobile: data.mobile || '',
          membership_number: data.membership_number || '',
          rank: data.rank || '',
          station: data.station || '',
          address_street: data.address_street || '',
          address_city: data.address_city || '',
          address_state: data.address_state || '',
          address_zip: data.address_zip || '',
          address_country: data.address_country || 'USA',
        });
        setContactsForm(
          data.emergency_contacts?.length ? data.emergency_contacts.map((ec: EmergencyContact) => ({ ...ec })) : []
        );
      } catch {
        // Non-critical for the other sections; Privacy reads the flag.
        setProfileLoadFailed(true);
      } finally {
        setLoadingProfile(false);
      }
    };
    void loadProfile();
  }, [user?.id, profileReloadToken, setProfileErrors]);

  // Load notification preferences from backend
  useEffect(() => {
    if (!user?.id) return;
    const loadPreferences = async () => {
      setLoadingPreferences(true);
      try {
        const prefs = await userService.getNotificationPreferences(user.id);
        setEmailNotifications(prefs.email_notifications ?? true);
        setSmsNotifications(prefs.sms_notifications ?? true);
      } catch {
        // Use defaults if fetch fails
      }
      try {
        const choices = await userService.getMyEmailChoices();
        setEmailChoices(choices.choices);
        setAlwaysSent(choices.always_sent);
      } catch {
        // Without the list there is nothing to choose; the master switch
        // above still works on its own.
      } finally {
        setLoadingPreferences(false);
      }
    };
    void loadPreferences();
  }, [user?.id]);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    const firstName = profileForm.first_name?.trim() ?? '';
    const lastName = profileForm.last_name?.trim() ?? '';
    setSavingProfile(true);
    profileErrors.setFormError(null);
    try {
      // Strip fields that are only editable by Membership Coordinators via Members admin
      const {
        membership_number: _mn,
        rank: _r,
        station: _s,
        first_name: _fn,
        last_name: _ln,
        ...editableFields
      } = profileForm;
      const payload: UserProfileUpdate = {
        ...editableFields,
        // A blank legal name is left out rather than sent: the server refuses
        // one, and an omitted key keeps the stored name, so the rest of the
        // profile still saves.
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        // An emptied box must clear the stored name, not be omitted (CLAUDE.md #1).
        preferred_name: blankToNull(profileForm.preferred_name),
      };
      let refused: FieldErrors<ProfileField> = {};
      let updated: UserWithRoles;
      try {
        updated = await userService.updateUserProfile(user.id, payload);
      } catch (err: unknown) {
        // Owner rule (2026-11-05), the same one that keeps a blank name out:
        // a value the record cannot hold is not written, the rest of the
        // profile saves, and the field stays flagged. A refusal the form has
        // no field for is a real failure and goes to the handler below, as
        // does a resend that fails too.
        const placed = placeApiError(PROFILE_FIELDS, err);
        const keys = placed ? (Object.keys(placed.fieldErrors) as ProfileField[]) : [];
        if (!placed || keys.length === 0 || placed.unmatched.length > 0) throw err;
        refused = placed.fieldErrors;
        const rest: Record<string, unknown> = { ...payload };
        for (const key of keys) delete rest[key];
        updated = await userService.updateUserProfile(user.id, rest);
      }
      setProfile(updated);
      // A name blanked by mistake comes back from the server unchanged; one
      // that was never recorded stays blank and flagged until it is entered.
      // A refused name keeps what was typed, so it can be corrected.
      setProfileForm((prev) => ({
        ...prev,
        first_name: refused.first_name ? prev.first_name || '' : updated.first_name || '',
        last_name: refused.last_name ? prev.last_name || '' : updated.last_name || '',
      }));
      const stillBlank = LEGAL_NAME_FIELDS.filter((f) => !updated[f]?.trim());
      const kept = LEGAL_NAME_FIELDS.filter(
        (f) => !(f === 'first_name' ? firstName : lastName) && !stillBlank.includes(f)
      );
      const nameErrors = blankLegalNameErrors(updated);
      profileErrors.setErrors({ ...nameErrors, ...refused });
      const firstBlank = stillBlank[0];
      const firstRefused = (Object.keys(PROFILE_FIELDS) as ProfileField[]).find((f) => refused[f]);
      if (firstRefused) {
        toast.error(
          `Profile saved, except ${PROFILE_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused]} Fix it and save again.`
        );
        focusAfterSave.current = refused;
      } else if (firstBlank) {
        toast.success(
          `Profile saved. Your ${LEGAL_NAME_LABELS[firstBlank]} is still missing; enter it to complete your profile.`
        );
        focusAfterSave.current = nameErrors;
      } else if (kept[0]) {
        toast.success(`Profile saved. A name can't be blank, so your saved ${LEGAL_NAME_LABELS[kept[0]]} was kept.`);
      } else {
        toast.success('Profile saved');
      }
      // The header and greeting read the signed-in user, not this form.
      if (updated.display_name !== user.display_name) {
        void useAuthStore.getState().loadUser();
      }
    } catch (err: unknown) {
      // A refusal lands on the field it names; the toast only says to look.
      const flagged = profileErrors.setFromApiError(err, 'Could not save your profile. Try again.');
      // A legal name left blank is still blank whatever else failed, so its
      // flag is kept beside the server's (F-1).
      profileErrors.setErrors({
        ...blankLegalNameErrors({ first_name: firstName, last_name: lastName }),
        ...flagged,
      });
      if (Object.keys(flagged).length > 0) {
        // A message the server could not pin on a field stays on the page,
        // under the button, rather than being lost behind the generic toast.
        toast.error('Check the highlighted fields and save again.');
        focusAfterSave.current = flagged;
      } else {
        profileErrors.setFormError(null);
        toast.error(getErrorMessage(err, 'Could not save your profile. Try again.'));
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleProfileChange = (field: keyof UserProfileUpdate, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
    if (field in PROFILE_FIELDS) {
      const key = field as ProfileField;
      // A legal name stays flagged until something is typed into it; any
      // other field's error is answered by editing it at all.
      if (!((key === 'first_name' || key === 'last_name') && !value.trim())) profileErrors.setError(key, null);
    }
  };

  const passwordValidation = validatePasswordStrength(newPassword);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    // Validate password strength
    if (!passwordValidation.isValid) {
      toast.error('Your new password does not meet all the requirements yet');
      return;
    }

    setChangingPassword(true);

    try {
      const data: PasswordChangeData = {
        current_password: currentPassword,
        new_password: newPassword,
      };

      await authService.changePassword(data);

      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // A password change ends every session, this one included
      // (AuthService.change_password). Reloading the user here met a 401 and
      // the refresh interceptor sent the member to sign-in with no word of
      // whether the change had worked — the success toast never showed
      // (workflow review W04-1). Sign out here without asking the server — it
      // has already ended the session — and say so on arrival.
      await endSessionLocally();
      void navigate('/login', { replace: true, state: { reason: 'password_changed' } });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change your password. Check your current password and try again.'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!user?.id) return;
    setSavingPreferences(true);

    try {
      await userService.updateNotificationPreferences(user.id, {
        email_notifications: emailNotifications,
        sms_notifications: smsNotifications,
        email_kinds: Object.fromEntries(emailChoices.map((choice) => [choice.key, choice.enabled])),
      });

      toast.success('Notification preferences saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save your preferences. Try again.'));
    } finally {
      setSavingPreferences(false);
    }
  };

  // Loaded for Notifications as well as Privacy: the SMS consent is the gate
  // that actually decides whether texts are sent, so the member has to be able
  // to grant it from the screen where they go looking for text messages.
  useEffect(() => {
    if (activeTab !== 'privacy' && activeTab !== 'notifications') return;
    userService
      .getMyConsents()
      .then(setConsents)
      .catch(() => {
        // Section renders empty on failure; toggling still surfaces errors.
      });
  }, [activeTab]);

  // What other members may see of this member's contact block. Fetched when
  // the Privacy section opens; saved on every switch, whole object each time.
  const privacy = useProfileVisibility({ enabled: activeTab === 'privacy' });

  // The department's ceiling over the three work fields, so a switch that is
  // on does not read as "visible" while the department has it off for all.
  const [orgContactVisibility, setOrgContactVisibility] = useState<ContactInfoSettings | null>(null);
  useEffect(() => {
    if (activeTab !== 'privacy') return;
    let cancelled = false;
    userService
      .checkContactInfoEnabled()
      .then((settings) => {
        if (!cancelled) setOrgContactVisibility(settings);
      })
      .catch(() => {
        if (!cancelled) setOrgContactVisibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // The switches write the whole object, so they stay off until both the
  // stored choice and the profile values under them are on hand — a member
  // must never enable a field they cannot see.
  const privacyControlsBlocked = privacy.loadError || profileLoadFailed || !profile;
  const retryPrivacyLoads = () => {
    privacy.reload();
    setProfileReloadToken((n) => n + 1);
  };

  const PROFILE_VISIBILITY_LABELS: Record<ProfileVisibilityField, string> = {
    email: 'Work email',
    personal_email: 'Personal email',
    phone: 'Phone',
    mobile: 'Mobile',
    address: 'Mailing address',
  };
  // The current value under each switch, read from the loaded profile rather
  // than the Account form so an unsaved edit there is not shown as shared.
  const profileVisibilityValue = (field: ProfileVisibilityField): string => {
    switch (field) {
      case 'email':
        return profile?.email ?? '';
      case 'personal_email':
        return profile?.personal_email ?? '';
      case 'phone':
        return profile?.phone ?? '';
      case 'mobile':
        return profile?.mobile ?? '';
      case 'address':
        return [
          profile?.address_street,
          [profile?.address_city, profile?.address_state].filter(Boolean).join(', '),
          profile?.address_zip,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
      default:
        return '';
    }
  };

  const smsConsent = consents.find((c) => c.consent_type === 'sms_notifications');
  // Absent row means never asked, which the backend treats as a refusal.
  const smsConsentGranted = smsConsent?.granted === true;
  const hasMobileOnFile = Boolean(profileForm.mobile?.trim() || profileForm.phone?.trim());

  const CONSENT_LABELS: Record<string, { title: string; description: string }> = {
    photo_use: {
      title: 'Photo use',
      description: 'Allow the department to use your photo in publications, social media, and other public material.',
    },
    public_roster_listing: {
      title: 'Public roster listing',
      description: 'Show your name and rank on the public website roster.',
    },
    sms_notifications: {
      title: 'Text message notifications',
      description:
        'Add a text at your mobile number for urgent department messages. These are on top of the emails you already receive, never instead of them.',
    },
  };

  const applyConsentLocally = (consentType: string, granted: boolean) => {
    setConsents((prev) =>
      prev.some((c) => c.consent_type === consentType)
        ? prev.map((c) => (c.consent_type === consentType ? { ...c, granted } : c))
        : [...prev, { consent_type: consentType, granted, updated_at: null }]
    );
  };

  /**
   * Turning texts on or off writes the SMS consent *and* the sms_notifications
   * preference together, so the member has one switch rather than two controls
   * on two tabs that each only half-work. It saves immediately rather than
   * waiting for the Save Preferences button: the consent is a legal record
   * (TCPA), and a switch that quietly defers is how a member ends up believing
   * they opted in when they did not.
   *
   * These are two requests with no transaction across them, so the order is
   * chosen to fail closed — a half-completed toggle must never leave texts
   * sending to somebody the UI just told the save had failed. The consent
   * write is the one that opens the gate (the preference defaults to on when
   * unset), so it goes **last** when enabling and **first** when disabling.
   * Either way, if the second request fails, SMS is off.
   */
  const handleSmsAddOnToggle = async (enabled: boolean) => {
    if (!user?.id) return;
    setSavingConsent('sms_notifications');
    try {
      // Only the key this switch owns. The backend merges, so the toggles
      // above keep whatever the member last saved — flipping this must not
      // quietly commit unsaved edits sitting in the rest of the form.
      const writePreference = () => userService.updateNotificationPreferences(user.id, { sms_notifications: enabled });
      const writeConsent = () => userService.setMyConsent('sms_notifications', enabled);

      if (enabled) {
        await writePreference();
        await writeConsent();
      } else {
        await writeConsent();
        await writePreference();
      }

      applyConsentLocally('sms_notifications', enabled);
      setSmsNotifications(enabled);
      toast.success(enabled ? 'Text messages turned on' : 'Text messages turned off');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update your text message setting'));
    } finally {
      setSavingConsent(null);
    }
  };

  const handleConsentToggle = async (consentType: string, granted: boolean) => {
    // SMS is a notification channel as well as a consent, so it goes through
    // the shared handler that keeps the preference in step with the consent.
    if (consentType === 'sms_notifications') {
      await handleSmsAddOnToggle(granted);
      return;
    }
    setSavingConsent(consentType);
    try {
      await userService.setMyConsent(consentType, granted);
      applyConsentLocally(consentType, granted);
      toast.success('Privacy choice saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save your choice'));
    } finally {
      setSavingConsent(null);
    }
  };

  const handleDownloadMyData = async () => {
    setDownloadingData(true);
    try {
      const blob = await userService.downloadMyData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'logbook-personal-data-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Your data export has been downloaded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not prepare your data export. Try again later.'));
    } finally {
      setDownloadingData(false);
    }
  };

  // Emergency contacts handlers
  const handleAddContact = () => {
    setContactsForm((prev) => [
      ...prev,
      { name: '', relationship: '', phone: '', email: '', is_primary: prev.length === 0 },
    ]);
  };

  const handleRemoveContact = (index: number) => {
    setContactsForm((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContactChange = (index: number, field: keyof EmergencyContact, value: string | boolean) => {
    setContactsForm((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const handleSaveEmergencyContacts = async () => {
    if (!user?.id) return;
    // The server requires a name, relationship and phone on every contact
    // (schemas/user.py EmergencyContact), and refuses an empty-string email:
    // a contact filled in with only the fields this form used to mark
    // required came back as a 422 in schema paths (workflow review W04).
    const valid = contactsForm.every((c) => c.name.trim() && c.relationship.trim() && c.phone.trim());
    if (!valid) {
      setContactsError('Each emergency contact needs a name, relationship and phone number.');
      return;
    }
    try {
      setSavingContacts(true);
      setContactsError(null);
      const updated = await userService.updateUserProfile(user.id, {
        emergency_contacts: contactsForm.map((c) => ({
          ...c,
          name: c.name.trim(),
          relationship: c.relationship.trim(),
          phone: c.phone.trim(),
          email: c.email?.trim() || undefined,
        })),
      });
      setProfile(updated);
      setContactsForm(
        updated.emergency_contacts?.length ? updated.emergency_contacts.map((ec: EmergencyContact) => ({ ...ec })) : []
      );
      toast.success('Emergency contacts saved');
    } catch (err: unknown) {
      setContactsError(getErrorMessage(err, 'Could not save your emergency contacts. Try again.'));
    } finally {
      setSavingContacts(false);
    }
  };

  const themeOptions = [
    {
      value: 'light' as const,
      label: 'Light',
      description: 'A clean, bright interface',
      icon: Sun,
    },
    {
      value: 'dark' as const,
      label: 'Dark',
      description: 'Easier on the eyes in low light',
      icon: Moon,
    },
    {
      value: 'system' as const,
      label: 'System',
      description: 'Follows your device settings',
      icon: Monitor,
    },
    {
      value: 'high-contrast' as const,
      label: 'High Contrast',
      description: 'Maximum visibility for accessibility',
      icon: Contrast,
    },
  ];

  return (
    <div className="min-h-screen">
      <SettingsLayout<TabType>
        sections={SECTIONS}
        activeSection={activeTab}
        onSectionChange={selectTab}
        navLabel="Account sections"
        title="My Account"
      >
        <>
          {/* Account Tab */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Account Information</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Update your personal details and contact information
                </p>
              </div>

              {loadingProfile ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-theme-text-muted">Loading profile...</div>
                </div>
              ) : (
                <form
                  noValidate
                  className="space-y-6"
                  onSubmit={(e) => {
                    // A real form, so Enter in a field saves the profile (forms review F-7).
                    e.preventDefault();
                    void handleSaveProfile();
                  }}
                >
                  {/* Personal Information */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Personal Information
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <FormField
                          id={PROFILE_FIELDS.first_name.id}
                          label="First Name"
                          required
                          error={profileErrors.errors.first_name}
                          labelClassName={PROFILE_LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              autoComplete="given-name"
                              maxLength={100}
                              type="text"
                              value={profileForm.first_name || ''}
                              autoComplete="given-name"
                              onChange={(e) => handleProfileChange('first_name', e.target.value)}
                              className="form-input sm:text-sm"
                              disabled={savingProfile}
                            />
                          )}
                        </FormField>
                      </div>
                      <div>
                        <FormField
                          id={PROFILE_FIELDS.middle_name.id}
                          label="Middle Name"
                          error={profileErrors.errors.middle_name}
                          labelClassName={PROFILE_LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              autoComplete="additional-name"
                              maxLength={100}
                              type="text"
                              value={profileForm.middle_name || ''}
                              autoComplete="additional-name"
                              onChange={(e) => handleProfileChange('middle_name', e.target.value)}
                              className="form-input sm:text-sm"
                              disabled={savingProfile}
                            />
                          )}
                        </FormField>
                      </div>
                      <div>
                        <FormField
                          id={PROFILE_FIELDS.last_name.id}
                          label="Last Name"
                          required
                          error={profileErrors.errors.last_name}
                          labelClassName={PROFILE_LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              autoComplete="family-name"
                              maxLength={100}
                              type="text"
                              value={profileForm.last_name || ''}
                              autoComplete="family-name"
                              onChange={(e) => handleProfileChange('last_name', e.target.value)}
                              className="form-input sm:text-sm"
                              disabled={savingProfile}
                            />
                          )}
                        </FormField>
                      </div>
                    </div>
                    <div className="mt-4 sm:max-w-sm">
                      <FormField
                        id={PROFILE_FIELDS.preferred_name.id}
                        label="Preferred Name"
                        error={profileErrors.errors.preferred_name}
                        labelClassName={PROFILE_LABEL_CLASS}
                        hint="The name you go by. Shown in place of your first name on shifts, events and rosters. Reports, training records and other official documents keep your legal first name."
                      >
                        {(field) => (
                          <input
                            {...field}
                            autoComplete="nickname"
                            maxLength={100}
                            type="text"
                            value={profileForm.preferred_name || ''}
                            autoComplete="nickname"
                            onChange={(e) => handleProfileChange('preferred_name', e.target.value)}
                            className="form-input sm:text-sm"
                            disabled={savingProfile}
                          />
                        )}
                      </FormField>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Contact Information
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <FormField
                          id={PROFILE_FIELDS.phone.id}
                          label="Phone"
                          error={profileErrors.errors.phone}
                          labelClassName={PROFILE_LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              autoComplete="tel"
                              maxLength={20}
                              type="tel"
                              value={profileForm.phone || ''}
                              autoComplete="tel"
                              onChange={(e) => handleProfileChange('phone', e.target.value)}
                              className="form-input sm:text-sm"
                              disabled={savingProfile}
                            />
                          )}
                        </FormField>
                      </div>
                      <div>
                        <FormField
                          id={PROFILE_FIELDS.mobile.id}
                          label="Mobile"
                          error={profileErrors.errors.mobile}
                          labelClassName={PROFILE_LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              autoComplete="tel"
                              maxLength={20}
                              type="tel"
                              value={profileForm.mobile || ''}
                              autoComplete="mobile tel"
                              onChange={(e) => handleProfileChange('mobile', e.target.value)}
                              className="form-input sm:text-sm"
                              disabled={savingProfile}
                            />
                          )}
                        </FormField>
                      </div>
                    </div>
                  </div>

                  {/* Department Information */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Department Information
                    </h3>
                    <p className="text-theme-text-muted mb-3 text-xs">
                      These fields can only be changed by a Membership Coordinator from the Members admin page.
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label
                          htmlFor="membershipNumber"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Membership Number
                        </label>
                        <input
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          id="membershipNumber"
                          type="text"
                          value={profileForm.membership_number || ''}
                          readOnly
                          className="form-input bg-theme-surface-secondary placeholder-theme-text-muted block cursor-not-allowed px-3 opacity-60 sm:text-sm"
                          disabled
                        />
                      </div>
                      <div>
                        <label htmlFor="rank" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Rank
                        </label>
                        <input
                          id="rank"
                          type="text"
                          value={
                            rankOptions.find((r) => r.value === profileForm.rank)?.label || profileForm.rank || '—'
                          }
                          readOnly
                          className="form-input bg-theme-surface-secondary block cursor-not-allowed px-3 opacity-60 sm:text-sm"
                          disabled
                        />
                      </div>
                      <div>
                        <label htmlFor="station" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Station
                        </label>
                        <input
                          id="station"
                          type="text"
                          value={profileForm.station || ''}
                          readOnly
                          className="form-input bg-theme-surface-secondary placeholder-theme-text-muted block cursor-not-allowed px-3 opacity-60 sm:text-sm"
                          disabled
                        />
                      </div>
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Address
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <FormField
                          id={PROFILE_FIELDS.address_street.id}
                          label="Street Address"
                          error={profileErrors.errors.address_street}
                          labelClassName={PROFILE_LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              autoComplete="street-address"
                              maxLength={255}
                              type="text"
                              value={profileForm.address_street || ''}
                              autoComplete="street-address"
                              onChange={(e) => handleProfileChange('address_street', e.target.value)}
                              className="form-input sm:text-sm"
                              disabled={savingProfile}
                            />
                          )}
                        </FormField>
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div className="col-span-2 sm:col-span-1">
                          <FormField
                            id={PROFILE_FIELDS.address_city.id}
                            label="City"
                            error={profileErrors.errors.address_city}
                            labelClassName={PROFILE_LABEL_CLASS}
                          >
                            {(field) => (
                              <input
                                {...field}
                                autoComplete="address-level2"
                                maxLength={100}
                                type="text"
                                value={profileForm.address_city || ''}
                                autoComplete="address-level2"
                                onChange={(e) => handleProfileChange('address_city', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingProfile}
                              />
                            )}
                          </FormField>
                        </div>
                        <div>
                          <FormField
                            id={PROFILE_FIELDS.address_state.id}
                            label="State"
                            error={profileErrors.errors.address_state}
                            labelClassName={PROFILE_LABEL_CLASS}
                          >
                            {(field) => (
                              <input
                                {...field}
                                autoComplete="address-level1"
                                maxLength={50}
                                type="text"
                                value={profileForm.address_state || ''}
                                autoComplete="address-level1"
                                onChange={(e) => handleProfileChange('address_state', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingProfile}
                              />
                            )}
                          </FormField>
                        </div>
                        <div>
                          <FormField
                            id={PROFILE_FIELDS.address_zip.id}
                            label="ZIP Code"
                            error={profileErrors.errors.address_zip}
                            labelClassName={PROFILE_LABEL_CLASS}
                          >
                            {(field) => (
                              <input
                                {...field}
                                autoComplete="postal-code"
                                maxLength={20}
                                type="text"
                                value={profileForm.address_zip || ''}
                                autoComplete="postal-code"
                                inputMode="numeric"
                                onChange={(e) => handleProfileChange('address_zip', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingProfile}
                              />
                            )}
                          </FormField>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="border-theme-surface-border border-t pt-4">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
                    >
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                    {profileErrors.formError && (
                      <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">
                        {profileErrors.formError}
                      </p>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Password Tab */}
          {activeTab === 'password' && (
            <div className="space-y-6">
              {forcePasswordChange && (
                <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-700 dark:text-yellow-400" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Password change required</p>
                    <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">
                      An administrator requires you to change your password before you continue. Set a new password
                      below.
                    </p>
                  </div>
                </div>
              )}
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Change Password</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Update your password to keep your account secure
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  void handlePasswordChange(e);
                }}
                className="space-y-4"
              >
                {/* Current Password */}
                <div>
                  <label htmlFor="currentPassword" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Current Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="currentPassword"
                      name="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      className="form-input pr-10 pl-10 sm:text-sm"
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={changingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden"
                      aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                    >
                      {showCurrentPassword ? (
                        <EyeOff className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label htmlFor="newPassword" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    New Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="newPassword"
                      name="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      className="form-input pr-10 pl-10 sm:text-sm"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={changingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden"
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {/* The rules, shown before typing starts: they are what someone needs
                      to choose a password (workflow review W04). */}
                  <div className="mt-3 space-y-2">
                    <p className="text-theme-text-secondary text-xs font-medium">Password must contain:</p>
                    <ul className="space-y-1 text-xs">
                      {PASSWORD_CHECKLIST.map(({ key, label }) => ({
                        label,
                        valid: passwordValidation.checks[key],
                      })).map((check) => (
                        <li key={check.label} className="flex items-center space-x-2">
                          {check.valid ? (
                            <CheckCircle
                              className="h-4 w-4 shrink-0 text-green-500 dark:text-green-400"
                              aria-hidden="true"
                            />
                          ) : (
                            <div
                              className="border-theme-surface-border h-4 w-4 shrink-0 rounded-full border-2"
                              aria-hidden="true"
                            />
                          )}
                          {/* The icon is decorative; this is the state a screen reader hears (W03-10). */}
                          <span className="sr-only">{check.valid ? 'Met: ' : 'Not met: '}</span>
                          <span
                            className={check.valid ? 'text-green-700 dark:text-green-300' : 'text-theme-text-muted'}
                          >
                            {check.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label htmlFor="confirmPassword" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      className="form-input pr-10 pl-10 sm:text-sm"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={changingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden"
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="mt-2 text-sm text-red-500 dark:text-red-300">Passwords do not match</p>
                  )}
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={changingPassword || !passwordValidation.isValid || newPassword !== confirmPassword}
                    className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
                  >
                    {changingPassword ? 'Changing Password...' : 'Change Password'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Security (MFA) Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Two-Factor Authentication</h2>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  Add a second step at sign-in after your password: a passkey on your phone or computer, an
                  authenticator app, or both. Either one is enough.
                </p>
                <h3 className="text-theme-text-primary mb-2 text-base font-semibold">Passkeys</h3>
                <PasskeySettingsCard
                  onChange={() => {
                    void useAuthStore.getState().loadUser();
                  }}
                />
              </div>
              <div>
                <h3 className="text-theme-text-primary mb-2 text-base font-semibold">Authenticator app</h3>
                <MfaSettingsCard
                  onChange={() => {
                    void useAuthStore.getState().loadUser();
                  }}
                />
              </div>
            </div>
          )}

          {/* Privacy Tab — what other members see, the optional consents, and
              the member's own data. These used to sit under Security, which
              is where nobody looks for "can Smith see my phone number". */}
          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <SettingsPanelHead
                    title="Profile visibility"
                    description="Choose which of your contact details other members can see on your profile and in the member directory. Leadership can always see everything."
                  />
                  <SaveStatusPill state={privacy.saveState} />
                </div>
                {privacy.loading || loadingProfile ? (
                  <div className="text-theme-text-muted py-4 text-sm">Loading…</div>
                ) : privacyControlsBlocked ? (
                  <div className="alert-danger" role="alert">
                    <p className="text-theme-alert-danger-text text-sm">
                      Couldn&apos;t load what you currently share, so the switches are off until it loads.
                    </p>
                    <button
                      type="button"
                      onClick={retryPrivacyLoads}
                      className="btn-secondary mt-3 text-sm font-medium"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <div className="divide-theme-surface-border divide-y">
                    {PROFILE_VISIBILITY_FIELDS.map((field) => {
                      const value = profileVisibilityValue(field);
                      return (
                        <div key={field} className="flex items-center justify-between gap-4 py-3.5">
                          <div className="min-w-0">
                            <p className="text-theme-text-primary text-sm font-medium">
                              {PROFILE_VISIBILITY_LABELS[field]}
                            </p>
                            <p className="text-theme-text-muted mt-0.5 text-[13px] break-words">
                              {value || 'Nothing on file'}
                            </p>
                          </div>
                          <VisibilityControl
                            field={field}
                            label={PROFILE_VISIBILITY_LABELS[field]}
                            visible={privacy.visibility[field]}
                            mode="toggle"
                            orgHidden={orgHidesField(field, orgContactVisibility)}
                            disabled={!privacy.ready || privacy.savingField === field}
                            onChange={(next) => void privacy.setField(field, next)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-theme-text-muted mt-3 text-[13px]">
                  The department can also turn work email, phone and mobile off for everyone. Your date of birth and
                  emergency contacts are never shown to other members.
                </p>
              </div>

              <div className="border-theme-surface-border border-t pt-6">
                <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Privacy Choices</h2>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  These are optional — nothing here is required for membership. If you have never answered, the
                  department treats it as a no.
                </p>
                <div className="space-y-4">
                  {consents.map((consent) => {
                    const label = CONSENT_LABELS[consent.consent_type];
                    if (!label) return null;
                    // W59-3: a checkbox left unticked records nothing, so a
                    // member could reach "no" only by ticking (recording a
                    // yes the consent ledger keeps) and unticking. Photo use
                    // and roster listing are an explicit Yes / No instead,
                    // with neither chosen until the member answers. SMS
                    // keeps its switch: it is the TCPA record and also sets
                    // the text-message preference (handleSmsToggle).
                    if (consent.consent_type !== 'sms_notifications') {
                      const saving = savingConsent === consent.consent_type;
                      return (
                        <fieldset key={consent.consent_type} disabled={saving}>
                          <legend className="text-theme-text-primary block text-sm font-medium">
                            {label.title}
                            {consent.granted === null && (
                              <span className="text-theme-text-muted ml-2 text-xs font-normal">(not answered)</span>
                            )}
                          </legend>
                          <span className="text-theme-text-secondary block text-sm">{label.description}</span>
                          <div className="mt-1 flex flex-wrap gap-x-6">
                            {[
                              { value: true, text: 'Yes' },
                              { value: false, text: 'No' },
                            ].map((option) => (
                              <label
                                key={option.text}
                                className="text-theme-text-primary touch:min-h-11 flex cursor-pointer items-center gap-2 text-sm"
                              >
                                <input
                                  type="radio"
                                  name={`consent-${consent.consent_type}`}
                                  className="form-checkbox"
                                  checked={consent.granted === option.value}
                                  onChange={() => void handleConsentToggle(consent.consent_type, option.value)}
                                />
                                {option.text}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      );
                    }
                    return (
                      <label key={consent.consent_type} className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={consent.granted === true}
                          disabled={savingConsent === consent.consent_type}
                          onChange={(e) => void handleConsentToggle(consent.consent_type, e.target.checked)}
                          className="form-checkbox mt-0.5"
                        />
                        <span>
                          <span className="text-theme-text-primary block text-sm font-medium">
                            {label.title}
                            {consent.granted === null && (
                              <span className="text-theme-text-muted ml-2 text-xs font-normal">(not answered)</span>
                            )}
                          </span>
                          <span className="text-theme-text-secondary block text-sm">{label.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="border-theme-surface-border border-t pt-6">
                <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Your Data</h2>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  Download a copy of everything the department stores about you — profile, training history, attendance,
                  and related records — as a JSON file.
                </p>
                <button
                  type="button"
                  onClick={() => void handleDownloadMyData()}
                  disabled={downloadingData}
                  className="btn-primary inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {downloadingData ? 'Preparing export…' : 'Download my data'}
                </button>
              </div>
            </div>
          )}

          {/* Emergency Contacts Tab */}
          {activeTab === 'emergency' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Emergency Contacts</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Who the department should contact on your behalf in an emergency
                </p>
              </div>

              {loadingProfile ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-theme-text-muted">Loading contacts...</div>
                </div>
              ) : (
                <div className="space-y-4">
                  {contactsForm.length === 0 ? (
                    <div className="border-theme-surface-border rounded-lg border border-dashed py-8 text-center">
                      <Heart className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
                      <p className="text-theme-text-muted mb-4 text-sm">No emergency contacts on file.</p>
                      <button
                        onClick={handleAddContact}
                        className="btn-primary inline-flex items-center gap-2 rounded-md text-sm font-medium"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add Emergency Contact
                      </button>
                    </div>
                  ) : (
                    <>
                      {contactsForm.map((ec, i) => (
                        <div key={i} className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-theme-text-secondary text-sm font-medium">Contact {i + 1}</span>
                            <div className="flex items-center gap-3">
                              <label className="text-theme-text-secondary flex cursor-pointer items-center gap-1.5 text-sm">
                                <input
                                  type="checkbox"
                                  checked={ec.is_primary}
                                  onChange={(e) => handleContactChange(i, 'is_primary', e.target.checked)}
                                  className="form-checkbox border-theme-surface-border"
                                />
                                Primary
                              </label>
                              <button
                                onClick={() => handleRemoveContact(i)}
                                className="touch-target-phone inline-flex items-center justify-center rounded-sm p-1 text-red-500 transition-colors hover:text-red-800 dark:hover:text-red-400"
                                aria-label={`Remove contact ${i + 1}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`contact-name-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Name <span className="text-red-500">*</span>
                              </label>
                              <input
                                id={`contact-name-${i}`}
                                type="text"
                                placeholder="Full name"
                                value={ec.name}
                                onChange={(e) => handleContactChange(i, 'name', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`contact-relationship-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Relationship <span className="text-red-500">*</span>
                              </label>
                              <input
                                id={`contact-relationship-${i}`}
                                type="text"
                                placeholder="e.g., Spouse, Parent"
                                value={ec.relationship}
                                onChange={(e) => handleContactChange(i, 'relationship', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`contact-phone-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Phone <span className="text-red-500">*</span>
                              </label>
                              <input
                                id={`contact-phone-${i}`}
                                type="tel"
                                placeholder="Phone number"
                                value={ec.phone}
                                onChange={(e) => handleContactChange(i, 'phone', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`contact-email-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Email
                              </label>
                              <input
                                id={`contact-email-${i}`}
                                type="email"
                                placeholder="Email address"
                                value={ec.email || ''}
                                onChange={(e) => handleContactChange(i, 'email', e.target.value)}
                                className="form-input sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <button
                        onClick={handleAddContact}
                        className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover touch-target-phone flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm font-medium transition-colors"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add Another Contact
                      </button>

                      {contactsError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
                          <p className="text-sm text-red-600 dark:text-red-400">{contactsError}</p>
                        </div>
                      )}

                      <div className="border-theme-surface-border border-t pt-4">
                        <button
                          onClick={() => {
                            void handleSaveEmergencyContacts();
                          }}
                          disabled={savingContacts}
                          className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
                        >
                          {savingContacts ? 'Saving...' : 'Save Emergency Contacts'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Appearance</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">Choose how The Logbook looks to you</p>
              </div>

              <div>
                <label className="text-theme-text-secondary mb-3 block text-sm font-medium">Theme</label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const isSelected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={`focus:ring-theme-focus-ring relative flex flex-col items-center rounded-lg border-2 p-4 transition-all focus:ring-2 focus:outline-hidden ${
                          isSelected
                            ? 'border-theme-accent-red bg-theme-accent-red-muted'
                            : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-border'
                        }`}
                        aria-pressed={isSelected}
                      >
                        <Icon
                          className={`mb-2 h-8 w-8 ${isSelected ? 'text-theme-accent-red' : 'text-theme-text-muted'}`}
                          aria-hidden="true"
                        />
                        <span
                          className={`text-sm font-medium ${
                            isSelected ? 'text-theme-accent-red' : 'text-theme-text-secondary'
                          }`}
                        >
                          {option.label}
                        </span>
                        <span className="text-theme-text-muted mt-1 text-center text-xs">{option.description}</span>
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <CheckCircle className="text-theme-accent-red h-5 w-5" aria-label="Selected" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-theme-surface-border border-t pt-6">
                <BottomNavigationSettings />
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Notification Preferences</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Email is how the department reaches you. Everything below adds to that email — a push alert on this
                  device, a text for urgent messages — so turning one off never leaves you without the notice itself.
                </p>
              </div>

              <div className="space-y-4">
                {/* Push Notifications Toggle — hidden entirely unless this
                  browser supports push AND the server has VAPID keys. On iOS
                  the API only exists once the PWA is on the home screen, so a
                  member browsing in Safari correctly sees nothing here. */}
                {push.supported && (
                  <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                    <div className="pr-4">
                      <span className="text-theme-text-primary text-sm font-medium">
                        Push Notifications on This Device
                      </span>
                      <p className="text-theme-text-secondary text-sm">
                        Get alerts on your lock screen even when The Logbook is closed. Enabled per device, so turn it
                        on wherever you want to be reached.
                      </p>
                      {push.error && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
                          {push.error}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={push.busy}
                      onClick={() => {
                        void (push.subscribed ? push.unsubscribe() : push.subscribe());
                      }}
                      className={`${
                        push.subscribed ? 'bg-red-800' : 'bg-theme-surface-border'
                      } focus:ring-theme-focus-ring focus:ring-offset-theme-bg toggle-track-md`}
                      role="switch"
                      aria-checked={push.subscribed}
                      aria-label="Push notifications on this device"
                    >
                      <span className={`${push.subscribed ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                    </button>
                  </div>
                )}

                {/* Email Notifications Toggle */}
                <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                  <div>
                    <label htmlFor="emailNotifications" className="text-theme-text-primary text-sm font-medium">
                      Email Notifications
                    </label>
                    <p className="text-theme-text-secondary text-sm">
                      Reminders, alerts and updates. Turning this off stops every email you can choose below; the ones
                      listed as always emailed still arrive.
                    </p>
                  </div>
                  <button
                    type="button"
                    id="emailNotifications"
                    onClick={() => setEmailNotifications(!emailNotifications)}
                    className={`${
                      emailNotifications ? 'bg-red-800' : 'bg-theme-surface-border'
                    } focus:ring-theme-focus-ring focus:ring-offset-theme-bg toggle-track-md`}
                    role="switch"
                    aria-checked={emailNotifications}
                  >
                    <span className={`${emailNotifications ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                  </button>
                </div>

                {/* SMS add-on. One switch writes both the consent and the
                  preference (see handleSmsAddOnToggle) and saves on the spot,
                  so it does not sit under the Save Preferences button with the
                  deferred toggles around it. */}
                <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                  <div className="pr-4">
                    <label htmlFor="smsNotifications" className="text-theme-text-primary text-sm font-medium">
                      Urgent Text Messages
                    </label>
                    <p className="text-theme-text-secondary text-sm">
                      Add a text message when an officer marks a department message urgent. You are emailed either way —
                      this only shortens how long it takes to reach you. Saved as soon as you switch it.
                    </p>
                    {!hasMobileOnFile && (
                      <p className="text-theme-text-muted mt-1 text-sm">
                        Add a mobile number on the Account tab before turning this on, or there is nowhere to text you.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    id="smsNotifications"
                    disabled={savingConsent === 'sms_notifications'}
                    onClick={() => {
                      void handleSmsAddOnToggle(!(smsConsentGranted && smsNotifications));
                    }}
                    className={`${
                      smsConsentGranted && smsNotifications ? 'bg-red-800' : 'bg-theme-surface-border'
                    } focus:ring-theme-focus-ring focus:ring-offset-theme-bg toggle-track-md disabled:opacity-50`}
                    role="switch"
                    aria-checked={smsConsentGranted && smsNotifications}
                  >
                    <span
                      className={`${
                        smsConsentGranted && smsNotifications ? 'translate-x-5' : 'translate-x-0'
                      } toggle-knob-md`}
                    />
                  </button>
                </div>

                {emailChoices.length > 0 && (
                  <section aria-labelledby="email-choices-heading" className="py-2">
                    <h3 id="email-choices-heading" className="text-theme-text-primary text-sm font-medium">
                      Emails you can turn off
                    </h3>
                    <p className="text-theme-text-secondary mb-2 text-sm">
                      {emailNotifications
                        ? 'Choose which of these reach your inbox. The notice still appears in your bell either way.'
                        : 'Email Notifications is off, so none of these are emailed to you. Turn it on to choose one by one.'}
                    </p>
                    <ul>
                      {emailChoices.map((choice) => (
                        <li
                          key={choice.key}
                          className="border-theme-surface-border flex items-center justify-between gap-4 border-b py-3"
                        >
                          <div>
                            <span className="text-theme-text-primary text-sm">{choice.label}</span>
                            <p className="text-theme-text-secondary text-xs">{choice.includes.join(' · ')}</p>
                          </div>
                          <SettingsToggle
                            checked={emailNotifications && choice.enabled}
                            disabled={!emailNotifications}
                            label={choice.label}
                            onChange={(next) =>
                              setEmailChoices((current) =>
                                current.map((c) => (c.key === choice.key ? { ...c, enabled: next } : c))
                              )
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {alwaysSent.length > 0 && (
                  <section aria-labelledby="always-sent-heading" className="py-2">
                    <h3 id="always-sent-heading" className="text-theme-text-primary text-sm font-medium">
                      Always emailed to you
                    </h3>
                    <p className="text-theme-text-secondary mb-2 text-sm">
                      Your department needs to be able to show you were told, so these arrive whatever you choose above.
                    </p>
                    <ul className="text-theme-text-secondary list-disc space-y-0.5 pl-5 text-sm">
                      {alwaysSent.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              <div className="pt-4">
                <button
                  onClick={() => {
                    void handleSavePreferences();
                  }}
                  disabled={savingPreferences}
                  className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
                >
                  {savingPreferences ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
          )}

          {/* App Tab */}
          {activeTab === 'app' && <AppVersionSection />}
        </>
      </SettingsLayout>
    </div>
  );
};

export default UserSettingsPage;
