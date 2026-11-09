import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Save, X, User, MapPin, Phone, Calendar, AlertCircle, Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { MemberFormData } from '../types/member';
import { userService, organizationService, roleService, locationsService } from '../services/api';
import { withoutRankMirrors } from '../utils/positions';
import type { Location } from '../services/api';
import { getErrorDetail, getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { getTodayLocalDate } from '../utils/dateFormatting';
import { useRanks } from '../hooks/useRanks';
import { useConfirm } from '../contexts/ConfirmContext';
import { useConnectedIntegrations } from '../hooks/useConnectedIntegrations';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../hooks/useFieldErrors';
import { ErrorSummary } from '../components/ux/ErrorSummary';
import { DraftRestoredNotice } from '../components/ux/DraftRestoredNotice';
import { useSessionDraft } from '../hooks/useSessionDraft';
import { FIELD_ERROR_CLASS } from '../components/ux/FormField';
import type { CreatedMember } from '../services/userServices';
import { PASSWORD_CHECKLIST, validatePasswordStrength } from '../utils/passwordValidation';
import { ADMINISTRATIVE_RANK_HINT } from '../utils/membership';
import { MemberClass, MemberStatus } from '../constants/enums';
import { MemberClassificationFields } from '../components/members/MemberClassificationFields';
import { useMembershipTierOptions } from '../hooks/useMembershipTierOptions';

/** The directories a new member's account can be created in, by integration type. */
const DIRECTORY_PRODUCTS: ReadonlyArray<readonly [string, string]> = [
  ['google-workspace', 'Google Workspace'],
  ['microsoft-365', 'Microsoft 365'],
];

/** One line for the officer about what happened in the directory. */
const directoryOutcome = (member: CreatedMember): { ok: boolean; message: string } | null => {
  const account = member.directory_account;
  if (!account) return null;
  if (account.status === 'created') {
    return {
      ok: true,
      message: `Member added with a ${account.provider_name} account at ${account.email}`,
    };
  }
  if (account.status === 'linked_existing') {
    return { ok: true, message: `Member added and linked to their ${account.provider_name} account` };
  }
  return {
    ok: false,
    message: `Member added, but the ${account.provider_name} account was not created${
      account.last_error ? `: ${account.last_error.replace(/\.+$/, '')}` : ''
    }. Retry from their profile.`,
  };
};

/** The create endpoint's refusal for a username already in the department. */
const USERNAME_TAKEN = 'Username already exists';
const MAX_USERNAME_ATTEMPTS = 20;

type AddMemberField =
  | 'firstName'
  | 'lastName'
  | 'membershipNumber'
  | 'street'
  | 'city'
  | 'state'
  | 'zipCode'
  | 'primaryPhone'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'emergencyName1'
  | 'emergencyRelationship1'
  | 'emergencyPhone1'
  | 'emergencyName2'
  | 'emergencyRelationship2'
  | 'emergencyPhone2';

// The fields a check or the server can refuse, in page order. The form keys
// are camelCase and the request's are snake_case, so each names the key a
// 422 reports against.
const ADD_MEMBER_FIELDS: FieldSpecs<AddMemberField> = {
  firstName: { id: 'add-firstName', label: 'First name', apiKeys: ['first_name'] },
  lastName: { id: 'add-lastName', label: 'Last name', apiKeys: ['last_name'] },
  membershipNumber: { id: 'add-membershipNumber', label: 'Membership number', apiKeys: ['membership_number'] },
  street: { id: 'add-street', label: 'Street address', apiKeys: ['address_street'] },
  city: { id: 'add-city', label: 'City', apiKeys: ['address_city'] },
  state: { id: 'add-state', label: 'State', apiKeys: ['address_state'] },
  zipCode: { id: 'add-zipCode', label: 'ZIP code', apiKeys: ['address_zip'] },
  primaryPhone: { id: 'add-primaryPhone', label: 'Primary phone', apiKeys: ['phone'] },
  email: { id: 'add-email', label: 'Email' },
  password: { id: 'add-password', label: 'Password' },
  confirmPassword: { id: 'add-confirm-password', label: 'Confirm password' },
  emergencyName1: { id: 'add-emergencyName1', label: 'Emergency contact name', apiKeys: ['emergency_contacts.0.name'] },
  emergencyRelationship1: {
    id: 'add-emergencyRelationship1',
    label: 'Emergency contact relationship',
    apiKeys: ['emergency_contacts.0.relationship'],
  },
  emergencyPhone1: {
    id: 'add-emergencyPhone1',
    label: 'Emergency contact phone',
    apiKeys: ['emergency_contacts.0.phone'],
  },
  emergencyName2: { id: 'add-emergencyName2', label: 'Second contact name', apiKeys: ['emergency_contacts.1.name'] },
  emergencyRelationship2: {
    id: 'add-emergencyRelationship2',
    label: 'Second contact relationship',
    apiKeys: ['emergency_contacts.1.relationship'],
  },
  emergencyPhone2: {
    id: 'add-emergencyPhone2',
    label: 'Second contact phone',
    apiKeys: ['emergency_contacts.1.phone'],
  },
};

/**
 * The local draft (useSessionDraft) leaves out the emergency contacts and the
 * date of birth: client-side storage is outside the controls the server puts
 * on PHI, so those are never drafted (owner decision 2026-11-06, forms review
 * F-6). Passwords are not part of formData and are never drafted either.
 */
type MemberDraft = Omit<
  MemberFormData,
  | 'dateOfBirth'
  | 'emergencyName1'
  | 'emergencyRelationship1'
  | 'emergencyPhone1'
  | 'emergencyEmail1'
  | 'emergencyName2'
  | 'emergencyRelationship2'
  | 'emergencyPhone2'
  | 'emergencyEmail2'
>;

const toDraft = (data: MemberFormData): MemberDraft => {
  const {
    dateOfBirth: _dob,
    emergencyName1: _n1,
    emergencyRelationship1: _r1,
    emergencyPhone1: _p1,
    emergencyEmail1: _e1,
    emergencyName2: _n2,
    emergencyRelationship2: _r2,
    emergencyPhone2: _p2,
    emergencyEmail2: _e2,
    ...kept
  } = data;
  return kept;
};

const AddMember: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const { rankOptions } = useRanks();
  const [isSaving, setIsSaving] = useState(false);
  const { isConnected } = useConnectedIntegrations();
  const directoryProduct = DIRECTORY_PRODUCTS.find(([type]) => isConnected(type))?.[1] ?? null;
  // Unticked by default: each account uses a license, and not every member
  // added here needs one (owner decision, 2026-10-20).
  const [createDirectoryAccount, setCreateDirectoryAccount] = useState(false);
  const creatingAccount = directoryProduct !== null && createDirectoryAccount;
  // The number the server will assign when Membership Number is left blank, or
  // null when the department assigns numbers by hand. It decides whether the
  // field is required: requiring it while auto-assignment is on meant the typed
  // value always won and the counter never issued a number from this screen.
  const [membershipIdPreview, setMembershipIdPreview] = useState<string | null>(null);
  const initialFormData = (): MemberFormData => ({
    firstName: '',
    lastName: '',
    middleName: '',
    preferredName: '',
    membershipNumber: '',
    dateOfBirth: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    preferredContact: 'phone',
    joinDate: getTodayLocalDate(tz),
    status: 'active',
    memberClass: MemberClass.OPERATIONAL,
    memberStatus: MemberStatus.PROBATIONARY,
    rank: '',
    role: '',
    station: '',
    platoon: '',
    emergencyName1: '',
    emergencyRelationship1: '',
    emergencyPhone1: '',
    emergencyEmail1: '',
    emergencyName2: '',
    emergencyRelationship2: '',
    emergencyPhone2: '',
    emergencyEmail2: '',
  });
  const [formData, setFormData] = useState<MemberFormData>(initialFormData);
  const draft = useSessionDraft<MemberDraft>({
    form: 'add-member',
    value: toDraft(formData),
    onRestore: (saved) => setFormData((prev) => ({ ...prev, ...saved })),
  });

  // The second contact is optional as a whole, but once begun its name,
  // relationship and phone are required (see validateForm), and the
  // asterisks and aria-required say so.
  const secondaryContactStarted = [
    formData.emergencyName2,
    formData.emergencyRelationship2,
    formData.emergencyPhone2,
    formData.emergencyEmail2,
  ].some((value) => value.trim());

  const fieldErrors = useFieldErrors(ADD_MEMBER_FIELDS);
  const errors = fieldErrors.errors;
  // Bumped on each refused save, which moves focus to the summary at the top:
  // the first errors on this form are a long scroll above the Save button.
  const [summaryFocus, setSummaryFocus] = useState(0);

  /**
   * Ties a control to its error the way FormField does: required announced,
   * invalid when flagged, and described by the error then any hint. The
   * markup stays hand-built here for the hint, the password toggle and the
   * optional second contact, which FormField's one-control layout does not fit.
   */
  const fieldA11y = (name: AddMemberField, opts: { required?: boolean; hintId?: string | undefined } = {}) => {
    const id = ADD_MEMBER_FIELDS[name].id;
    const describedBy = [errors[name] ? `${id}-error` : null, opts.hintId ?? null].filter(Boolean).join(' ');
    return {
      ...(opts.required ? { 'aria-required': true as const } : {}),
      ...(errors[name] ? { 'aria-invalid': true as const } : {}),
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    };
  };

  // Password fields
  const [useCustomPassword, setUseCustomPassword] = useState(false);
  // false: email cannot be sent, so the temporary password could never reach
  // the member and the server refuses a create without one. null: not known
  // yet, or the check failed — the form behaves as before and the server
  // still refuses if it has to.
  const [welcomeEmailAvailable, setWelcomeEmailAvailable] = useState<boolean | null>(null);
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordChecks = validatePasswordStrength(initialPassword).checks;

  // Dropdown data
  const [availablePositions, setAvailablePositions] = useState<{ id: string; name: string }[]>([]);
  const [availableStations, setAvailableStations] = useState<Location[]>([]);

  useEffect(() => {
    userService
      .getWelcomeEmailAvailability()
      .then(({ available }) => {
        setWelcomeEmailAvailable(available);
        if (!available) setUseCustomPassword(true);
      })
      .catch(() => {
        // Non-critical: the create itself is refused if a password is required.
      });

    organizationService
      .previewNextMembershipId()
      .then((data) => {
        if (data.enabled && data.next_id) {
          setMembershipIdPreview(data.next_id);
        }
      })
      .catch(() => {
        // Silently ignore - membership ID may not be configured
      });

    // Load positions (roles) for dropdown
    roleService
      .getRoles()
      .then((roles) => {
        setAvailablePositions(withoutRankMirrors(roles).map((r) => ({ id: r.id, name: r.name })));
      })
      .catch(() => {
        /* non-critical */
      });

    // Load stations for dropdown (exclude rooms — they belong to facilities, not station pickers)
    locationsService
      .getLocations({ is_active: true, exclude_rooms: true })
      .then((locs) => {
        setAvailableStations(locs.filter((l: Location) => l.address));
      })
      .catch(() => {
        /* non-critical */
      });
  }, []);

  // An administrative member holds no operational rank — the server refuses the
  // pair outright, since a rank carries its own default permissions.
  const isAdministrative = formData.memberClass === MemberClass.ADMINISTRATIVE;
  const { tiers } = useMembershipTierOptions();

  const handleInputChange = (field: keyof MemberFormData, value: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'memberClass' && value === MemberClass.ADMINISTRATIVE) {
        next.rank = '';
      }
      return next;
    });
    // Clear error when user starts typing
    if (field in ADD_MEMBER_FIELDS) fieldErrors.setError(field as AddMemberField, null);
  };

  const validateForm = (): boolean => {
    const newErrors: FieldErrors<AddMemberField> = {};

    // Required fields
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!membershipIdPreview && !formData.membershipNumber.trim()) {
      newErrors.membershipNumber = 'Membership number is required';
    }

    // Address
    if (!formData.street.trim()) newErrors.street = 'Street address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state.trim()) newErrors.state = 'State is required';
    if (!formData.zipCode.trim()) newErrors.zipCode = 'ZIP code is required';

    // Contact
    if (!formData.primaryPhone.trim()) newErrors.primaryPhone = 'Primary phone is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Enter a valid email address';
    }

    // Emergency Contact 1 (required)
    if (!formData.emergencyName1.trim()) newErrors.emergencyName1 = 'Emergency contact name is required';
    if (!formData.emergencyRelationship1.trim()) newErrors.emergencyRelationship1 = 'Relationship is required';
    if (!formData.emergencyPhone1.trim()) newErrors.emergencyPhone1 = 'Emergency phone is required';

    // Emergency Contact 2 is optional as a whole, but not field by field:
    // EmergencyContact requires name, relationship and phone. Filling only the
    // name posted an empty relationship, and the 422 that came back named a
    // field on a card the form labels "(Optional)" — so the whole member
    // creation failed for a contact nobody had to enter.
    // The email counts as "filled" too. Left out, an entry consisting only of
    // a second contact's email address passed validation silently and was then
    // dropped by the payload builder, which keys the whole contact off the
    // name — the address was typed, accepted, and never stored.
    const secondaryFilled = [
      formData.emergencyName2,
      formData.emergencyRelationship2,
      formData.emergencyPhone2,
      formData.emergencyEmail2,
    ].some((value) => value.trim());
    if (secondaryFilled) {
      if (!formData.emergencyName2.trim()) newErrors.emergencyName2 = 'Name is required';
      if (!formData.emergencyRelationship2.trim()) newErrors.emergencyRelationship2 = 'Relationship is required';
      if (!formData.emergencyPhone2.trim()) newErrors.emergencyPhone2 = 'Phone is required';
    }

    // Password (if custom password is set)
    if (useCustomPassword) {
      // The server's own rules (W03-4's shared list), so a password it will
      // refuse is caught here, at the field, rather than in a toast after the
      // whole form has been sent (workflow review W08).
      if (!initialPassword) {
        newErrors.password = 'Enter a password';
      } else if (!validatePasswordStrength(initialPassword).isValid) {
        newErrors.password = 'Password does not meet every rule listed below';
      }
      if (initialPassword !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    fieldErrors.setErrors(newErrors);
    fieldErrors.setFormError(null);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      setSummaryFocus((n) => n + 1);
      return;
    }

    setIsSaving(true);

    try {
      // Generate username from email (part before @)
      const emailPrefix = formData.email.split('@')[0] ?? '';
      const username = emailPrefix.toLowerCase().replace(/[^a-z0-9_]/g, '_');

      // Build emergency contacts array
      const emergencyContacts: Array<{
        name: string;
        relationship: string;
        phone: string;
        email?: string | undefined;
        is_primary: boolean;
      }> = [];

      // Primary emergency contact
      if (formData.emergencyName1) {
        emergencyContacts.push({
          name: formData.emergencyName1,
          relationship: formData.emergencyRelationship1,
          phone: formData.emergencyPhone1,
          ...(formData.emergencyEmail1 ? { email: formData.emergencyEmail1 } : {}),
          is_primary: true,
        });
      }

      // Secondary emergency contact (if provided)
      if (formData.emergencyName2) {
        emergencyContacts.push({
          name: formData.emergencyName2,
          relationship: formData.emergencyRelationship2,
          phone: formData.emergencyPhone2,
          ...(formData.emergencyEmail2 ? { email: formData.emergencyEmail2 } : {}),
          is_primary: false,
        });
      }

      // Call the API
      const memberPayload: Parameters<typeof userService.createMember>[0] = {
        username,
        email: formData.email,
        first_name: formData.firstName,
        last_name: formData.lastName,
        address_country: 'USA',
        emergency_contacts: emergencyContacts,
        send_welcome_email: !useCustomPassword,
        status: formData.status,
        ...(formData.middleName ? { middle_name: formData.middleName } : {}),
        ...(formData.preferredName.trim() ? { preferred_name: formData.preferredName.trim() } : {}),
        ...(formData.membershipNumber.trim() ? { membership_number: formData.membershipNumber.trim() } : {}),
        ...(formData.primaryPhone ? { phone: formData.primaryPhone } : {}),
        ...(formData.secondaryPhone ? { mobile: formData.secondaryPhone } : {}),
        ...(formData.dateOfBirth ? { date_of_birth: formData.dateOfBirth } : {}),
        ...(formData.joinDate ? { hire_date: formData.joinDate } : {}),
        // The pair, not a fused legacy string: it is the only way to state a
        // standing the legacy vocabulary cannot hold, such as an
        // administrative life member.
        member_class: formData.memberClass,
        member_status: formData.memberStatus,
        ...(formData.rank ? { rank: formData.rank } : {}),
        ...(formData.station ? { station: formData.station } : {}),
        ...(formData.platoon ? { platoon: formData.platoon } : {}),
        ...(formData.street ? { address_street: formData.street } : {}),
        ...(formData.city ? { address_city: formData.city } : {}),
        ...(formData.state ? { address_state: formData.state } : {}),
        ...(formData.zipCode ? { address_zip: formData.zipCode } : {}),
        ...(useCustomPassword && initialPassword ? { password: initialPassword } : {}),
        ...(formData.role ? { role_ids: [formData.role] } : {}),
        ...(creatingAccount ? { create_directory_account: true } : {}),
      };

      // The form has no username field; it is derived from the email. Two
      // addresses sharing a local part (casey@a.org, casey@b.org) derived the
      // same one, and the second member could not be added at all — the
      // refusal named a field the officer never saw (workflow review W08).
      // Try the next free suffix instead.
      let created: CreatedMember | null = null;
      for (let attempt = 1; ; attempt++) {
        const candidate = attempt === 1 ? username : `${username}_${attempt}`;
        try {
          created = await userService.createMember({ ...memberPayload, username: candidate });
          break;
        } catch (err: unknown) {
          if (attempt >= MAX_USERNAME_ATTEMPTS || getErrorDetail(err) !== USERNAME_TAKEN) throw err;
        }
      }

      draft.clear();
      const outcome = created ? directoryOutcome(created) : null;
      if (outcome && !outcome.ok) toast.error(outcome.message);
      else toast.success(outcome?.message ?? 'Member added');
      void navigate('/members');
    } catch (error: unknown) {
      // A 422 lands on the fields it names and the summary takes focus.
      const flagged = fieldErrors.setFromApiError(error, 'Unable to add member. Try again.');
      if (Object.keys(flagged).length > 0) {
        setSummaryFocus((n) => n + 1);
      } else {
        const errorMessage = getErrorMessage(error, 'Unable to add member. Try again.');
        fieldErrors.setFormError(null);
        toast.error(errorMessage);
        // A duplicate membership number comes back as a plain message, not a
        // field entry, so it is matched by its wording to mark the field.
        if (errorMessage.toLowerCase().includes('membership number')) {
          fieldErrors.setError('membershipNumber', errorMessage);
        }
      }

      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    if (Object.values(formData).some((val) => val !== '' && val !== 'active' && val !== 'phone')) {
      if (
        await confirm({
          title: 'Discard new member?',
          message: 'All unsaved changes will be lost.',
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
        })
      ) {
        draft.discard();
        void navigate('/members');
      }
    } else {
      void navigate('/members');
    }
  };

  return (
    <div className="min-h-screen">
      {/* Rendered only as the Add Member tab of Members Administration, whose
          section nav already names it; the title stays for heading navigation
          only. The old back link duplicated the form's own Cancel, which runs
          the same unsaved-changes check. */}
      <h2 className="sr-only">Add New Member</h2>

      <div data-page-main className="mx-auto max-w-4xl py-6 sm:py-8">
        <form
          noValidate
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-6"
        >
          {draft.restored && (
            <DraftRestoredNotice
              onDiscard={() => {
                draft.discard();
                setFormData(initialFormData());
                fieldErrors.clear();
              }}
            />
          )}
          <ErrorSummary
            items={fieldErrors.summary}
            formError={fieldErrors.formError}
            focusKey={summaryFocus}
            title="Fix these before saving"
          />
          {/* Personal Information */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <User className="h-5 w-5 text-blue-700 dark:text-blue-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Personal Information</h2>
            </div>

            <div className="field-grid gap-4">
              <div>
                <label htmlFor="add-firstName" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  First Name{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="text"
                  id="add-firstName"
                  autoComplete="off"
                  maxLength={100}
                  {...fieldA11y('firstName', { required: true })}
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className={`form-input ${errors.firstName ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="John"
                />
                {errors.firstName && (
                  <p id="add-firstName-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.firstName}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-middleName" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Middle Name
                </label>
                <input
                  type="text"
                  id="add-middleName"
                  autoComplete="off"
                  maxLength={100}
                  value={formData.middleName}
                  onChange={(e) => handleInputChange('middleName', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="Michael"
                />
              </div>

              <div>
                <label htmlFor="add-lastName" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Last Name{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="text"
                  id="add-lastName"
                  autoComplete="off"
                  maxLength={100}
                  {...fieldA11y('lastName', { required: true })}
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className={`form-input ${errors.lastName ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="Doe"
                />
                {errors.lastName && (
                  <p id="add-lastName-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.lastName}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 md:max-w-sm">
              <label htmlFor="add-preferredName" className="text-theme-text-primary mb-2 block text-sm font-medium">
                Preferred Name
              </label>
              <input
                type="text"
                id="add-preferredName"
                autoComplete="off"
                maxLength={100}
                value={formData.preferredName}
                onChange={(e) => handleInputChange('preferredName', e.target.value)}
                className="form-input placeholder-theme-text-muted"
                placeholder="Terry"
                aria-describedby="add-preferredName-help"
              />
              <p id="add-preferredName-help" className="text-theme-text-muted mt-1 text-xs">
                Optional. The name they go by, shown in place of the first name on shifts, events and rosters. Reports
                and official records keep the legal first name.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="add-membershipNumber"
                  className="text-theme-text-primary mb-2 block text-sm font-medium"
                >
                  Membership Number{' '}
                  {!membershipIdPreview && (
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      *
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  id="add-membershipNumber"
                  autoComplete="off"
                  maxLength={50}
                  {...fieldA11y('membershipNumber', {
                    required: !membershipIdPreview,
                    hintId: membershipIdPreview ? 'add-membershipNumber-hint' : undefined,
                  })}
                  value={formData.membershipNumber}
                  onChange={(e) => handleInputChange('membershipNumber', e.target.value)}
                  className={`form-input ${errors.membershipNumber ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder={membershipIdPreview ?? 'FF-001'}
                />
                {membershipIdPreview && (
                  <p id="add-membershipNumber-hint" className="text-theme-text-muted mt-1 text-xs">
                    Leave blank to assign {membershipIdPreview} automatically, or enter one yourself (for example, a
                    returning member&apos;s number).
                  </p>
                )}
                {errors.membershipNumber && (
                  <p id="add-membershipNumber-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.membershipNumber}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-dateOfBirth" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Date of Birth
                </label>
                <input
                  type="date"
                  id="add-dateOfBirth"
                  autoComplete="off"
                  value={formData.dateOfBirth}
                  onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          </div>

          {/* Home Address */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <MapPin className="h-5 w-5 text-green-700 dark:text-green-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Home Address</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="add-street" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Street Address{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="text"
                  id="add-street"
                  autoComplete="off"
                  maxLength={255}
                  {...fieldA11y('street', { required: true })}
                  value={formData.street}
                  onChange={(e) => handleInputChange('street', e.target.value)}
                  className={`form-input ${errors.street ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="123 Main Street"
                />
                {errors.street && (
                  <p id="add-street-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.street}
                  </p>
                )}
              </div>

              <div className="field-grid gap-4">
                <div>
                  <label htmlFor="add-city" className="text-theme-text-primary mb-2 block text-sm font-medium">
                    City{' '}
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      *
                    </span>
                  </label>
                  <input
                    type="text"
                    id="add-city"
                    autoComplete="off"
                    maxLength={100}
                    {...fieldA11y('city', { required: true })}
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className={`form-input ${errors.city ? 'border-red-500' : 'border-theme-input-border'}`}
                    placeholder="Springfield"
                  />
                  {errors.city && (
                    <p id="add-city-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                      {errors.city}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="add-state" className="text-theme-text-primary mb-2 block text-sm font-medium">
                    State{' '}
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      *
                    </span>
                  </label>
                  <input
                    type="text"
                    id="add-state"
                    autoComplete="off"
                    {...fieldA11y('state', { required: true })}
                    value={formData.state}
                    onChange={(e) => handleInputChange('state', e.target.value)}
                    className={`form-input ${errors.state ? 'border-red-500' : 'border-theme-input-border'}`}
                    placeholder="IL"
                    maxLength={2}
                  />
                  {errors.state && (
                    <p id="add-state-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                      {errors.state}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="add-zipCode" className="text-theme-text-primary mb-2 block text-sm font-medium">
                    ZIP Code{' '}
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      *
                    </span>
                  </label>
                  <input
                    type="text"
                    id="add-zipCode"
                    autoComplete="off"
                    maxLength={20}
                    {...fieldA11y('zipCode', { required: true })}
                    value={formData.zipCode}
                    onChange={(e) => handleInputChange('zipCode', e.target.value)}
                    className={`form-input ${errors.zipCode ? 'border-red-500' : 'border-theme-input-border'}`}
                    placeholder="62701"
                  />
                  {errors.zipCode && (
                    <p id="add-zipCode-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                      {errors.zipCode}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <Phone className="h-5 w-5 text-purple-700 dark:text-purple-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Contact Information</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="add-primaryPhone" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Primary Phone{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="tel"
                  id="add-primaryPhone"
                  autoComplete="off"
                  maxLength={20}
                  {...fieldA11y('primaryPhone', { required: true })}
                  value={formData.primaryPhone}
                  onChange={(e) => handleInputChange('primaryPhone', e.target.value)}
                  className={`form-input ${errors.primaryPhone ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="(555) 123-4567"
                />
                {errors.primaryPhone && (
                  <p id="add-primaryPhone-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.primaryPhone}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-secondaryPhone" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Secondary Phone
                </label>
                <input
                  type="tel"
                  id="add-secondaryPhone"
                  autoComplete="off"
                  maxLength={20}
                  value={formData.secondaryPhone}
                  onChange={(e) => handleInputChange('secondaryPhone', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="(555) 987-6543"
                />
              </div>

              <div>
                <label htmlFor="add-email" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  {creatingAccount ? 'Personal email' : 'Email'}{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="email"
                  id="add-email"
                  autoComplete="off"
                  {...fieldA11y('email', { required: true })}
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={`form-input ${errors.email ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="john.doe@example.com"
                />
                {errors.email && (
                  <p id="add-email-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.email}
                  </p>
                )}
                {directoryProduct && (
                  <label className="mt-3 flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={createDirectoryAccount}
                      onChange={(e) => setCreateDirectoryAccount(e.target.checked)}
                      className="form-checkbox mt-0.5"
                    />
                    <span>
                      <span className="text-theme-text-primary text-sm font-medium">
                        Create a {directoryProduct} account
                      </span>
                      <span className="text-theme-text-muted block text-xs">
                        At a department address made from their name, which becomes their sign-in email. The email above
                        is kept as their personal address, where the temporary passwords are sent.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Account Password */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <Lock className="h-5 w-5 text-yellow-700 dark:text-yellow-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Account Password</h2>
            </div>

            <div className="space-y-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={useCustomPassword}
                  disabled={welcomeEmailAvailable === false}
                  onChange={(e) => {
                    setUseCustomPassword(e.target.checked);
                    if (!e.target.checked) {
                      setInitialPassword('');
                      setConfirmPassword('');
                      fieldErrors.setError('password', null);
                      fieldErrors.setError('confirmPassword', null);
                    }
                  }}
                  className="form-checkbox"
                />
                <div>
                  <span className="text-theme-text-primary text-sm font-medium">Set initial password</span>
                  <p className="text-theme-text-muted text-xs">
                    {welcomeEmailAvailable === false
                      ? "Required: email isn't set up for this department, so a temporary password can't be sent. Set one here and give it to the member."
                      : 'Leave unchecked to email the member a temporary password.'}
                  </p>
                </div>
              </label>

              {useCustomPassword && (
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="add-password" className="text-theme-text-primary mb-2 block text-sm font-medium">
                      Password{' '}
                      <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                        *
                      </span>
                    </label>
                    <div className="relative">
                      <input
                        id="add-password"
                        {...fieldA11y('password', { required: true })}
                        type={showPassword ? 'text' : 'password'}
                        value={initialPassword}
                        onChange={(e) => {
                          setInitialPassword(e.target.value);
                          fieldErrors.setError('password', null);
                        }}
                        className={`form-input pr-12 ${errors.password ? 'border-red-500' : 'border-theme-input-border'}`}
                        placeholder="Minimum 12 characters"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex w-11 items-center justify-center"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p id="add-password-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                        {errors.password}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="add-confirm-password"
                      className="text-theme-text-primary mb-2 block text-sm font-medium"
                    >
                      Confirm Password{' '}
                      <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                        *
                      </span>
                    </label>
                    <input
                      id="add-confirm-password"
                      {...fieldA11y('confirmPassword', { required: true })}
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        fieldErrors.setError('confirmPassword', null);
                      }}
                      className={`form-input ${errors.confirmPassword ? 'border-red-500' : 'border-theme-input-border'}`}
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                    />
                    {errors.confirmPassword && (
                      <p id="add-confirm-password-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                        {errors.confirmPassword}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {useCustomPassword && (
                <ul className="space-y-1 text-xs" aria-label="Password rules">
                  {PASSWORD_CHECKLIST.map(({ key, label }) => {
                    const met = passwordChecks[key];
                    return (
                      <li key={key} className={met ? 'text-green-700 dark:text-green-300' : 'text-theme-text-muted'}>
                        {met ? '✓' : '○'} {label}
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="text-theme-text-muted text-xs">
                Either way, the member must change this password at first sign-in.
              </p>
            </div>
          </div>

          {/* Department Information. Status is sent (W08-1): a member can be
              added inactive or on leave. Preferred Contact Method is not
              offered — the department records no such field, and a control
              wired to nothing is worse than none (CLAUDE.md pitfall 19). */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <Calendar className="h-5 w-5 text-orange-700 dark:text-orange-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Department Information</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="add-status" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Status
                </label>
                <select
                  id="add-status"
                  aria-describedby="add-status-help"
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="form-input"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="leave">On Leave</option>
                </select>
                <p id="add-status-help" className="text-theme-text-muted mt-1 text-xs">
                  Retired or dropped is set from the member&rsquo;s profile once they are added, so their service
                  history is recorded.
                </p>
              </div>

              <div>
                <label htmlFor="add-joinDate" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Join Date
                </label>
                <input
                  type="date"
                  id="add-joinDate"
                  value={formData.joinDate}
                  onChange={(e) => handleInputChange('joinDate', e.target.value)}
                  className="form-input"
                />
              </div>

              <MemberClassificationFields
                idPrefix="add"
                memberClass={formData.memberClass}
                memberStatus={formData.memberStatus}
                onClassChange={(value) => handleInputChange('memberClass', value)}
                onStatusChange={(value) => handleInputChange('memberStatus', value)}
                tiers={tiers}
                required
              />

              <div>
                <label htmlFor="add-rank" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Rank
                </label>
                <select
                  id="add-rank"
                  aria-describedby="add-rank-help"
                  value={formData.rank}
                  onChange={(e) => handleInputChange('rank', e.target.value)}
                  className="form-input"
                  disabled={isAdministrative}
                >
                  <option value="">Select Rank</option>
                  {rankOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {/* Rank and Position share names (Chief, Captain) and both
                    carry access: a rank grants a few defaults of its own at
                    runtime, a position most of the rest. A new officer picking
                    the wrong one gives the new member the wrong access. */}
                <p id="add-rank-help" className="text-theme-text-muted mt-1 text-xs">
                  {isAdministrative
                    ? ADMINISTRATIVE_RANK_HINT
                    : 'Their title in the chain of command, such as Captain or Firefighter. A rank carries a few default permissions of its own.'}
                </p>
              </div>

              <div>
                <label htmlFor="add-role" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Position
                </label>
                <select
                  id="add-role"
                  aria-describedby="add-role-help"
                  value={formData.role}
                  onChange={(e) => handleInputChange('role', e.target.value)}
                  className="form-input"
                >
                  <option value="">Select Position</option>
                  {availablePositions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p id="add-role-help" className="text-theme-text-muted mt-1 text-xs">
                  The job they hold here, such as Secretary or Training Officer. Positions decide most of what they can
                  see and do in The Logbook. A rank such as Captain or Firefighter is set in the Rank field, not here.
                </p>
              </div>

              <div className="md:col-span-2">
                <label htmlFor="add-station" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Station
                </label>
                <select
                  id="add-station"
                  value={formData.station}
                  onChange={(e) => handleInputChange('station', e.target.value)}
                  className="form-input"
                >
                  <option value="">Select Station</option>
                  {availableStations.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="add-platoon" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Platoon
                </label>
                <input
                  type="text"
                  id="add-platoon"
                  value={formData.platoon}
                  onChange={(e) => handleInputChange('platoon', e.target.value)}
                  placeholder="e.g. A, B, C"
                  maxLength={20}
                  className="form-input"
                />
                <p className="text-theme-text-muted mt-1 text-xs">Duty platoon for shift rotations</p>
              </div>
            </div>
          </div>

          {/* Emergency Contact 1 */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Emergency Contact (Primary)</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="add-emergencyName1" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Name{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="text"
                  id="add-emergencyName1"
                  autoComplete="off"
                  maxLength={100}
                  {...fieldA11y('emergencyName1', { required: true })}
                  value={formData.emergencyName1}
                  onChange={(e) => handleInputChange('emergencyName1', e.target.value)}
                  className={`form-input ${errors.emergencyName1 ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="Jane Doe"
                />
                {errors.emergencyName1 && (
                  <p id="add-emergencyName1-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.emergencyName1}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="add-emergencyRelationship1"
                  className="text-theme-text-primary mb-2 block text-sm font-medium"
                >
                  Relationship{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="text"
                  id="add-emergencyRelationship1"
                  autoComplete="off"
                  maxLength={50}
                  {...fieldA11y('emergencyRelationship1', { required: true })}
                  value={formData.emergencyRelationship1}
                  onChange={(e) => handleInputChange('emergencyRelationship1', e.target.value)}
                  className={`form-input ${errors.emergencyRelationship1 ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="Spouse"
                />
                {errors.emergencyRelationship1 && (
                  <p id="add-emergencyRelationship1-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.emergencyRelationship1}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-emergencyPhone1" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Phone{' '}
                  <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                    *
                  </span>
                </label>
                <input
                  type="tel"
                  id="add-emergencyPhone1"
                  autoComplete="off"
                  maxLength={20}
                  {...fieldA11y('emergencyPhone1', { required: true })}
                  value={formData.emergencyPhone1}
                  onChange={(e) => handleInputChange('emergencyPhone1', e.target.value)}
                  className={`form-input ${errors.emergencyPhone1 ? 'border-red-500' : 'border-theme-input-border'}`}
                  placeholder="(555) 123-4567"
                />
                {errors.emergencyPhone1 && (
                  <p id="add-emergencyPhone1-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.emergencyPhone1}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-emergencyEmail1" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Email
                </label>
                <input
                  type="email"
                  id="add-emergencyEmail1"
                  autoComplete="off"
                  value={formData.emergencyEmail1}
                  onChange={(e) => handleInputChange('emergencyEmail1', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="jane.doe@example.com"
                />
              </div>
            </div>
          </div>

          {/* Emergency Contact 2 (Optional) */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-yellow-700 dark:text-yellow-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Emergency Contact (Secondary)</h2>
              <span className="text-theme-text-muted text-sm">(Optional)</span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="add-emergencyName2" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Name
                  {secondaryContactStarted && (
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      {' '}
                      *
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  id="add-emergencyName2"
                  autoComplete="off"
                  maxLength={100}
                  {...fieldA11y('emergencyName2', { required: secondaryContactStarted })}
                  value={formData.emergencyName2}
                  onChange={(e) => handleInputChange('emergencyName2', e.target.value)}
                  className={`form-input placeholder-theme-text-muted ${errors.emergencyName2 ? 'border-red-500' : ''}`}
                  placeholder="Bob Doe"
                />
                {errors.emergencyName2 && (
                  <p id="add-emergencyName2-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.emergencyName2}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="add-emergencyRelationship2"
                  className="text-theme-text-primary mb-2 block text-sm font-medium"
                >
                  Relationship
                  {secondaryContactStarted && (
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      {' '}
                      *
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  id="add-emergencyRelationship2"
                  autoComplete="off"
                  maxLength={50}
                  {...fieldA11y('emergencyRelationship2', { required: secondaryContactStarted })}
                  value={formData.emergencyRelationship2}
                  onChange={(e) => handleInputChange('emergencyRelationship2', e.target.value)}
                  className={`form-input placeholder-theme-text-muted ${errors.emergencyRelationship2 ? 'border-red-500' : ''}`}
                  placeholder="Parent"
                />
                {errors.emergencyRelationship2 && (
                  <p id="add-emergencyRelationship2-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.emergencyRelationship2}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-emergencyPhone2" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Phone
                  {secondaryContactStarted && (
                    <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                      {' '}
                      *
                    </span>
                  )}
                </label>
                <input
                  type="tel"
                  id="add-emergencyPhone2"
                  autoComplete="off"
                  maxLength={20}
                  {...fieldA11y('emergencyPhone2', { required: secondaryContactStarted })}
                  value={formData.emergencyPhone2}
                  onChange={(e) => handleInputChange('emergencyPhone2', e.target.value)}
                  className={`form-input placeholder-theme-text-muted ${errors.emergencyPhone2 ? 'border-red-500' : ''}`}
                  placeholder="(555) 987-6543"
                />
                {errors.emergencyPhone2 && (
                  <p id="add-emergencyPhone2-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.emergencyPhone2}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-emergencyEmail2" className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Email
                </label>
                <input
                  type="email"
                  id="add-emergencyEmail2"
                  autoComplete="off"
                  value={formData.emergencyEmail2}
                  onChange={(e) => handleInputChange('emergencyEmail2', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="bob.doe@example.com"
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="border-theme-surface-border flex items-center justify-between border-t pt-6">
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={isSaving}
              className="bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary flex items-center space-x-2 rounded-lg px-6 py-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-5 w-5" />
              <span>Cancel</span>
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center space-x-2 rounded-lg bg-linear-to-r from-blue-700 to-cyan-700 px-6 py-3 text-white shadow-lg transition-all hover:from-blue-800 hover:to-cyan-800 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  <span>Save Member</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddMember;
