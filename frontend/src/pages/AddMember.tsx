import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { UserPlus, Save, X, User, MapPin, Phone, Calendar, AlertCircle, Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { MemberFormData } from '../types/member';
import { userService, organizationService, roleService, locationsService } from '../services/api';
import type { Location } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { getTodayLocalDate } from '../utils/dateFormatting';
import { useRanks } from '../hooks/useRanks';
import { useConfirm } from '../contexts/ConfirmContext';

const AddMember: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const { rankOptions } = useRanks();
  const [isSaving, setIsSaving] = useState(false);
  const [membershipIdPreview, setMembershipIdPreview] = useState<string | null>(null);
  const [membershipIdOverride, setMembershipIdOverride] = useState('');
  const [formData, setFormData] = useState<MemberFormData>({
    firstName: '',
    lastName: '',
    middleName: '',
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
    membershipType: 'probationary',
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

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Password fields
  const [useCustomPassword, setUseCustomPassword] = useState(false);
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Dropdown data
  const [availablePositions, setAvailablePositions] = useState<{ id: string; name: string }[]>([]);
  const [availableStations, setAvailableStations] = useState<Location[]>([]);

  useEffect(() => {
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
        setAvailablePositions(roles.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
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

  const handleInputChange = (field: keyof MemberFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Required fields
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.membershipNumber.trim()) newErrors.membershipNumber = 'Membership number is required';

    // Address
    if (!formData.street.trim()) newErrors.street = 'Street address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state.trim()) newErrors.state = 'State is required';
    if (!formData.zipCode.trim()) newErrors.zipCode = 'ZIP code is required';

    // Contact
    if (!formData.primaryPhone.trim()) newErrors.primaryPhone = 'Primary phone is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    // Emergency Contact 1 (required)
    if (!formData.emergencyName1.trim()) newErrors.emergencyName1 = 'Emergency contact name is required';
    if (!formData.emergencyRelationship1.trim()) newErrors.emergencyRelationship1 = 'Relationship is required';
    if (!formData.emergencyPhone1.trim()) newErrors.emergencyPhone1 = 'Emergency phone is required';

    // Password (if custom password is set)
    if (useCustomPassword) {
      if (!initialPassword) {
        newErrors.password = 'Password is required when setting a custom password';
      } else if (initialPassword.length < 12) {
        newErrors.password = 'Password must be at least 12 characters';
      }
      if (initialPassword !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fill in all required fields');
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
        ...(formData.middleName ? { middle_name: formData.middleName } : {}),
        ...(membershipIdOverride || formData.membershipNumber
          ? { membership_number: membershipIdOverride || formData.membershipNumber }
          : {}),
        ...(formData.primaryPhone ? { phone: formData.primaryPhone } : {}),
        ...(formData.secondaryPhone ? { mobile: formData.secondaryPhone } : {}),
        ...(formData.dateOfBirth ? { date_of_birth: formData.dateOfBirth } : {}),
        ...(formData.joinDate ? { hire_date: formData.joinDate } : {}),
        ...(formData.rank ? { rank: formData.rank } : {}),
        ...(formData.station ? { station: formData.station } : {}),
        ...(formData.platoon ? { platoon: formData.platoon } : {}),
        ...(formData.street ? { address_street: formData.street } : {}),
        ...(formData.city ? { address_city: formData.city } : {}),
        ...(formData.state ? { address_state: formData.state } : {}),
        ...(formData.zipCode ? { address_zip: formData.zipCode } : {}),
        ...(useCustomPassword && initialPassword ? { password: initialPassword } : {}),
        ...(formData.role ? { role_ids: [formData.role] } : {}),
      };

      await userService.createMember(memberPayload);

      toast.success('Member added successfully!');
      void navigate('/members');
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'Failed to add member. Please try again.');
      toast.error(errorMessage);

      // Highlight the specific field if it's a duplicate membership number error
      if (errorMessage.toLowerCase().includes('membership number')) {
        setErrors((prev) => ({ ...prev, membershipNumber: errorMessage }));
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
        void navigate('/members');
      }
    } else {
      void navigate('/members');
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-theme-input-bg border-theme-surface-border border-b px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center space-x-3">
              <div className="shrink-0 rounded-lg bg-blue-600 p-2">
                <UserPlus className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Add New Member</h1>
                <p className="text-theme-text-muted text-sm">Enter member information</p>
              </div>
            </div>
            <button
              onClick={() => void handleCancel()}
              className="text-theme-text-secondary hover:text-theme-text-primary shrink-0 self-start text-sm transition-colors sm:self-auto"
            >
              ← Back to Members
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-6"
        >
          {/* Personal Information */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <User className="h-5 w-5 text-blue-700 dark:text-blue-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Personal Information</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  First Name <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.firstName ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="John"
                />
                {errors.firstName && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.firstName}</p>}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Middle Name</label>
                <input
                  type="text"
                  value={formData.middleName}
                  onChange={(e) => handleInputChange('middleName', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="Michael"
                />
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Last Name <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.lastName ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="Doe"
                />
                {errors.lastName && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.lastName}</p>}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Membership Number <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.membershipNumber}
                  onChange={(e) => handleInputChange('membershipNumber', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.membershipNumber ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="FF-001"
                />
                {errors.membershipNumber && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.membershipNumber}</p>
                )}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Date of Birth</label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* Membership ID - shown when membership IDs are enabled */}
            {membershipIdPreview && (
              <div className="mt-4">
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Membership ID</label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={membershipIdOverride}
                    onChange={(e) => setMembershipIdOverride(e.target.value)}
                    className="form-input max-w-xs flex-1"
                    placeholder={membershipIdPreview}
                  />
                  <span className="text-theme-text-muted text-sm">
                    {membershipIdOverride ? 'Manual override' : `Auto-assigned: ${membershipIdPreview}`}
                  </span>
                </div>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Leave blank to auto-assign the next ID. Enter a value to manually assign (e.g., for returning former
                  members).
                </p>
              </div>
            )}
          </div>

          {/* Home Address */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <MapPin className="h-5 w-5 text-green-700 dark:text-green-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Home Address</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Street Address <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.street}
                  onChange={(e) => handleInputChange('street', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.street ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="123 Main Street"
                />
                {errors.street && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.street}</p>}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div>
                  <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                    City <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className={`bg-theme-input-bg w-full border px-4 py-2 ${
                      errors.city ? 'border-red-500' : 'border-theme-input-border'
                    } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                    placeholder="Springfield"
                  />
                  {errors.city && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.city}</p>}
                </div>

                <div>
                  <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                    State <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => handleInputChange('state', e.target.value)}
                    className={`bg-theme-input-bg w-full border px-4 py-2 ${
                      errors.state ? 'border-red-500' : 'border-theme-input-border'
                    } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                    placeholder="IL"
                    maxLength={2}
                  />
                  {errors.state && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.state}</p>}
                </div>

                <div>
                  <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                    ZIP Code <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.zipCode}
                    onChange={(e) => handleInputChange('zipCode', e.target.value)}
                    className={`bg-theme-input-bg w-full border px-4 py-2 ${
                      errors.zipCode ? 'border-red-500' : 'border-theme-input-border'
                    } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                    placeholder="62701"
                  />
                  {errors.zipCode && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.zipCode}</p>}
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
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Primary Phone <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  value={formData.primaryPhone}
                  onChange={(e) => handleInputChange('primaryPhone', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.primaryPhone ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="(555) 123-4567"
                />
                {errors.primaryPhone && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.primaryPhone}</p>
                )}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Secondary Phone</label>
                <input
                  type="tel"
                  value={formData.secondaryPhone}
                  onChange={(e) => handleInputChange('secondaryPhone', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="(555) 987-6543"
                />
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Email <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.email ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="john.doe@example.com"
                />
                {errors.email && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.email}</p>}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Preferred Contact Method
                </label>
                <select
                  value={formData.preferredContact}
                  onChange={(e) => handleInputChange('preferredContact', e.target.value)}
                  className="form-input"
                >
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="text">Text</option>
                </select>
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
                  onChange={(e) => {
                    setUseCustomPassword(e.target.checked);
                    if (!e.target.checked) {
                      setInitialPassword('');
                      setConfirmPassword('');
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.password;
                        delete next.confirmPassword;
                        return next;
                      });
                    }
                  }}
                  className="form-checkbox"
                />
                <div>
                  <span className="text-theme-text-primary text-sm font-medium">Set initial password</span>
                  <p className="text-theme-text-muted text-xs">
                    If unchecked, a temporary password will be generated and emailed to the member.
                  </p>
                </div>
              </label>

              {useCustomPassword && (
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                      Password <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={initialPassword}
                        onChange={(e) => {
                          setInitialPassword(e.target.value);
                          if (errors.password) {
                            setErrors((prev) => {
                              const n = { ...prev };
                              delete n.password;
                              return n;
                            });
                          }
                        }}
                        className={`bg-theme-input-bg w-full border px-4 py-2 pr-10 ${
                          errors.password ? 'border-red-500' : 'border-theme-input-border'
                        } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                        placeholder="Minimum 12 characters"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.password}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                      Confirm Password <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (errors.confirmPassword) {
                          setErrors((prev) => {
                            const n = { ...prev };
                            delete n.confirmPassword;
                            return n;
                          });
                        }
                      }}
                      className={`bg-theme-input-bg w-full border px-4 py-2 ${
                        errors.confirmPassword ? 'border-red-500' : 'border-theme-input-border'
                      } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                    />
                    {errors.confirmPassword && (
                      <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.confirmPassword}</p>
                    )}
                  </div>
                </div>
              )}

              <p className="text-theme-text-muted text-xs">
                The member will be required to change their password on first login regardless of how it is set.
              </p>
            </div>
          </div>

          {/* Department Information */}
          <div className="card p-6">
            <div className="mb-4 flex items-center space-x-2">
              <Calendar className="h-5 w-5 text-orange-700 dark:text-orange-400" />
              <h2 className="text-theme-text-primary text-xl font-bold">Department Information</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Join Date</label>
                <input
                  type="date"
                  value={formData.joinDate}
                  onChange={(e) => handleInputChange('joinDate', e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="form-input"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="leave">On Leave</option>
                  <option value="retired">Retired</option>
                </select>
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Membership Type <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <select
                  value={formData.membershipType}
                  onChange={(e) => handleInputChange('membershipType', e.target.value)}
                  className="form-input"
                >
                  <option value="probationary">Probationary</option>
                  <option value="regular">Regular</option>
                  <option value="life">Life</option>
                  <option value="administrative">Administrative</option>
                </select>
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Rank</label>
                <select
                  value={formData.rank}
                  onChange={(e) => handleInputChange('rank', e.target.value)}
                  className="form-input"
                >
                  <option value="">Select Rank</option>
                  {rankOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Position</label>
                <select
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
              </div>

              <div className="md:col-span-2">
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Station</label>
                <select
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
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Platoon</label>
                <input
                  type="text"
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
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Name <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.emergencyName1}
                  onChange={(e) => handleInputChange('emergencyName1', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.emergencyName1 ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="Jane Doe"
                />
                {errors.emergencyName1 && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.emergencyName1}</p>
                )}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Relationship <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.emergencyRelationship1}
                  onChange={(e) => handleInputChange('emergencyRelationship1', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.emergencyRelationship1 ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="Spouse"
                />
                {errors.emergencyRelationship1 && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.emergencyRelationship1}</p>
                )}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">
                  Phone <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  value={formData.emergencyPhone1}
                  onChange={(e) => handleInputChange('emergencyPhone1', e.target.value)}
                  className={`bg-theme-input-bg w-full border px-4 py-2 ${
                    errors.emergencyPhone1 ? 'border-red-500' : 'border-theme-input-border'
                  } text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring rounded-lg focus:ring-2 focus:outline-hidden`}
                  placeholder="(555) 123-4567"
                />
                {errors.emergencyPhone1 && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.emergencyPhone1}</p>
                )}
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Email</label>
                <input
                  type="email"
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
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Name</label>
                <input
                  type="text"
                  value={formData.emergencyName2}
                  onChange={(e) => handleInputChange('emergencyName2', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="Bob Doe"
                />
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Relationship</label>
                <input
                  type="text"
                  value={formData.emergencyRelationship2}
                  onChange={(e) => handleInputChange('emergencyRelationship2', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="Parent"
                />
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Phone</label>
                <input
                  type="tel"
                  value={formData.emergencyPhone2}
                  onChange={(e) => handleInputChange('emergencyPhone2', e.target.value)}
                  className="form-input placeholder-theme-text-muted"
                  placeholder="(555) 987-6543"
                />
              </div>

              <div>
                <label className="text-theme-text-primary mb-2 block text-sm font-medium">Email</label>
                <input
                  type="email"
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
              className="flex items-center space-x-2 rounded-lg bg-linear-to-r from-blue-600 to-cyan-600 px-6 py-3 text-white shadow-lg transition-all hover:from-blue-700 hover:to-cyan-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
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
      </main>
    </div>
  );
};

export default AddMember;
