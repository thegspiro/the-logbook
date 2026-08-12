import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Users, Shield, Plus, Trash2, AlertCircle, Phone, Mail, User } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  ErrorAlert,
  AutoSaveNotification,
} from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';
import { apiClient } from '../services/api-client';
import { isValidEmail, isValidPhoneNumber } from '../utils/validation';

interface ITTeamMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

const ITTeamBackupAccess: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);
  const { execute, isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

  // Use Zustand store for persisted IT Team data
  const itTeam = useOnboardingStore((state) => state.itTeamMembers);
  const setItTeam = useOnboardingStore((state) => state.setITTeamMembers);
  const backupEmail = useOnboardingStore((state) => state.backupEmail);
  const setBackupEmail = useOnboardingStore((state) => state.setBackupEmail);
  const backupPhone = useOnboardingStore((state) => state.backupPhone);
  const setBackupPhone = useOnboardingStore((state) => state.setBackupPhone);
  const secondaryAdminEmail = useOnboardingStore((state) => state.secondaryAdminEmail);
  const setSecondaryAdminEmail = useOnboardingStore((state) => state.setSecondaryAdminEmail);

  // System Owner info for auto-populating primary IT contact
  const systemOwnerFirstName = useOnboardingStore((state) => state.systemOwnerFirstName);
  const systemOwnerLastName = useOnboardingStore((state) => state.systemOwnerLastName);
  const systemOwnerEmail = useOnboardingStore((state) => state.systemOwnerEmail);

  // Validation errors (local state - no need to persist)
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
      return;
    }

    // Auto-populate primary IT contact from System Owner if the fields are empty
    const primary = itTeam[0];
    if (systemOwnerFirstName && primary) {
      if (!primary.name && !primary.email) {
        const updatedPrimary: ITTeamMember = {
          ...primary,
          name: `${systemOwnerFirstName} ${systemOwnerLastName}`.trim(),
          email: systemOwnerEmail,
          role: 'IT Manager',
        };
        setItTeam([updatedPrimary, ...itTeam.slice(1)]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, departmentName]);

  const addITMember = () => {
    const newMember: ITTeamMember = {
      id: Date.now().toString(),
      name: '',
      email: '',
      phone: '',
      role: 'IT Support',
    };
    setItTeam([...itTeam, newMember]);
  };

  const removeITMember = (id: string) => {
    if (itTeam.length > 1) {
      setItTeam(itTeam.filter((member) => member.id !== id));
    }
  };

  const updateITMember = (id: string, field: keyof ITTeamMember, value: string) => {
    setItTeam(itTeam.map((member) => (member.id === id ? { ...member, [field]: value } : member)));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate primary IT contact (first member)
    const primaryContact = itTeam[0];
    if (!primaryContact) {
      newErrors.primaryName = 'Primary contact is required';
      newErrors.primaryEmail = 'Primary contact email is required';
      newErrors.primaryPhone = 'Primary contact phone is required';
    } else {
      if (!primaryContact.name.trim()) {
        newErrors.primaryName = 'Primary contact name is required';
      }
      if (!primaryContact.email.trim()) {
        newErrors.primaryEmail = 'Primary contact email is required';
      } else if (!isValidEmail(primaryContact.email)) {
        newErrors.primaryEmail = 'Invalid email address';
      }
      if (!primaryContact.phone.trim()) {
        newErrors.primaryPhone = 'Primary contact phone is required';
      } else if (!isValidPhoneNumber(primaryContact.phone)) {
        newErrors.primaryPhone = 'Invalid phone number format';
      }
    }

    // Validate backup email
    if (!backupEmail.trim()) {
      newErrors.backupEmail = 'Backup recovery email is required';
    } else if (!isValidEmail(backupEmail)) {
      newErrors.backupEmail = 'Invalid email address';
    }

    // Validate backup phone
    if (!backupPhone.trim()) {
      newErrors.backupPhone = 'Backup phone number is required';
    } else if (!isValidPhoneNumber(backupPhone)) {
      newErrors.backupPhone = 'Invalid phone number format';
    }

    // Validate secondary admin email (optional but must be valid if provided)
    if (secondaryAdminEmail && !isValidEmail(secondaryAdminEmail)) {
      newErrors.secondaryAdminEmail = 'Invalid email address';
    }

    // Validate additional IT members
    itTeam.slice(1).forEach((member, index) => {
      if (member.name || member.email || member.phone) {
        // If any field is filled, all should be filled
        if (!member.name.trim()) {
          newErrors[`member${index + 1}Name`] = 'Name is required';
        }
        if (!member.email.trim()) {
          newErrors[`member${index + 1}Email`] = 'Email is required';
        } else if (!isValidEmail(member.email)) {
          newErrors[`member${index + 1}Email`] = 'Invalid email address';
        }
        if (!member.phone.trim()) {
          newErrors[`member${index + 1}Phone`] = 'Phone is required';
        } else if (!isValidPhoneNumber(member.phone)) {
          newErrors[`member${index + 1}Phone`] = 'Invalid phone number format';
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setErrors({});

    // Prepare data to save
    const itTeamData = {
      it_team: itTeam
        .filter((member) => member.name && member.email && member.phone)
        .map((member) => ({
          name: member.name,
          email: member.email,
          phone: member.phone,
          role: member.role,
        })),
      backup_access: {
        email: backupEmail,
        phone: backupPhone,
        secondary_admin_email: secondaryAdminEmail || undefined,
      },
    };

    const { data: _data, error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveITTeam(itTeamData);

        if (response.error) {
          throw new Error(response.error);
        }

        toast.success('IT team and backup access information saved securely');
        void navigate('/onboarding/positions');
        return response;
      },
      {
        step: 'IT Team & Backup Access',
        action: 'Save IT team and backup access info',
      }
    );

    if (apiError) {
      return;
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Mail aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      <main className="flex flex-1 items-center justify-center p-4 py-8">
        <div className="w-full max-w-4xl">
          {/* Navigation Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <BackButton to="/onboarding/system-owner" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-cyan-600">
              <Users aria-hidden="true" className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">IT Team & Backup Access</h2>
            <p className="text-theme-text-secondary mb-2 text-xl">
              Configure system administration and recovery options
            </p>
            <p className="text-theme-text-muted text-sm">Essential for system maintenance and emergency access</p>
          </div>

          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-6"
          >
            {/* IT Team Section */}
            <div className="card p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center space-x-3">
                  <Users aria-hidden="true" className="text-theme-accent-cyan h-6 w-6 shrink-0" />
                  <h3 className="text-theme-text-primary text-xl font-bold">IT Team Contacts</h3>
                </div>
                <button
                  type="button"
                  onClick={addITMember}
                  className="flex shrink-0 items-center space-x-2 self-start rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700 sm:self-auto"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  <span>Add Member</span>
                </button>
              </div>

              <p className="text-theme-text-muted mb-6 text-sm">
                Add contact information for your IT support team. The first person listed will be the primary contact.
              </p>

              {itTeam.map((member, index) => (
                <div key={member.id} className="card-secondary mb-4 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-theme-text-primary flex items-center font-semibold">
                      <User aria-hidden="true" className="mr-2 h-4 w-4" />
                      {index === 0 ? 'Primary IT Contact' : `IT Team Member ${index + 1}`}
                      {index === 0 && <span className="text-theme-accent-red ml-2 text-xs">*Required</span>}
                    </h4>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => removeITMember(member.id)}
                        className="text-theme-accent-red hover:text-theme-accent-red transition-colors"
                        aria-label="Remove team member"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Name */}
                    <div>
                      <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                        Full Name {index === 0 && <span className="text-theme-accent-red">*</span>}
                      </label>
                      <input
                        type="text"
                        value={member.name}
                        onChange={(e) => updateITMember(member.id, 'name', e.target.value)}
                        className={`bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted w-full rounded-lg border px-4 py-3 transition-all focus:ring-2 focus:outline-hidden ${
                          errors[index === 0 ? 'primaryName' : `member${index}Name`]
                            ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                            : 'border-theme-input-border focus:ring-theme-focus-ring'
                        }`}
                        placeholder="John Doe"
                      />
                      {errors[index === 0 ? 'primaryName' : `member${index}Name`] && (
                        <p className="text-theme-accent-red mt-1 text-sm">
                          {errors[index === 0 ? 'primaryName' : `member${index}Name`]}
                        </p>
                      )}
                    </div>

                    {/* Role */}
                    <div>
                      <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Role/Title</label>
                      <input
                        type="text"
                        value={member.role}
                        onChange={(e) => updateITMember(member.id, 'role', e.target.value)}
                        className="form-input placeholder-theme-text-muted py-3 transition-all"
                        placeholder="IT Manager"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                        Email {index === 0 && <span className="text-theme-accent-red">*</span>}
                      </label>
                      <input
                        type="email"
                        value={member.email}
                        onChange={(e) => updateITMember(member.id, 'email', e.target.value)}
                        className={`bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted w-full rounded-lg border px-4 py-3 transition-all focus:ring-2 focus:outline-hidden ${
                          errors[index === 0 ? 'primaryEmail' : `member${index}Email`]
                            ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                            : 'border-theme-input-border focus:ring-theme-focus-ring'
                        }`}
                        placeholder="john@example.com"
                      />
                      {errors[index === 0 ? 'primaryEmail' : `member${index}Email`] && (
                        <p className="text-theme-accent-red mt-1 text-sm">
                          {errors[index === 0 ? 'primaryEmail' : `member${index}Email`]}
                        </p>
                      )}
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                        Phone {index === 0 && <span className="text-theme-accent-red">*</span>}
                      </label>
                      <input
                        type="tel"
                        value={member.phone}
                        onChange={(e) => updateITMember(member.id, 'phone', e.target.value)}
                        className={`bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted w-full rounded-lg border px-4 py-3 transition-all focus:ring-2 focus:outline-hidden ${
                          errors[index === 0 ? 'primaryPhone' : `member${index}Phone`]
                            ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                            : 'border-theme-input-border focus:ring-theme-focus-ring'
                        }`}
                        placeholder="(555) 123-4567"
                      />
                      {errors[index === 0 ? 'primaryPhone' : `member${index}Phone`] && (
                        <p className="text-theme-accent-red mt-1 text-sm">
                          {errors[index === 0 ? 'primaryPhone' : `member${index}Phone`]}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Backup Access Section */}
            <div className="card p-6">
              <div className="mb-4 flex items-center space-x-3">
                <Shield aria-hidden="true" className="text-theme-alert-warning-icon h-6 w-6" />
                <h3 className="text-theme-text-primary text-xl font-bold">Backup Access Methods</h3>
              </div>

              <div className="alert-warning mb-6">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-theme-alert-warning-title mb-1 text-sm font-medium">
                      Critical for Account Recovery
                    </p>
                    <p className="text-theme-alert-warning-text text-sm">
                      These backup methods will be used to recover access if the primary admin account is locked or
                      credentials are lost. Keep this information current.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {/* Backup Recovery Email */}
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Backup Recovery Email <span className="text-theme-accent-red">*</span>
                  </label>
                  <div className="relative">
                    <Mail
                      aria-hidden="true"
                      className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
                    />
                    <input
                      type="email"
                      value={backupEmail}
                      onChange={(e) => setBackupEmail(e.target.value)}
                      className={`form-input placeholder-theme-text-muted py-3 pr-4 pl-12 transition-all ${
                        errors.backupEmail
                          ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                          : 'border-theme-input-border focus:ring-theme-focus-ring'
                      }`}
                      placeholder="backup-admin@example.com"
                    />
                  </div>
                  {errors.backupEmail && <p className="text-theme-accent-red mt-1 text-sm">{errors.backupEmail}</p>}
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Use a different email than the primary admin account
                  </p>
                </div>

                {/* Backup Phone */}
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Backup Phone Number <span className="text-theme-accent-red">*</span>
                  </label>
                  <div className="relative">
                    <Phone
                      aria-hidden="true"
                      className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
                    />
                    <input
                      type="tel"
                      value={backupPhone}
                      onChange={(e) => setBackupPhone(e.target.value)}
                      className={`form-input placeholder-theme-text-muted py-3 pr-4 pl-12 transition-all ${
                        errors.backupPhone
                          ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                          : 'border-theme-input-border focus:ring-theme-focus-ring'
                      }`}
                      placeholder="(555) 987-6543"
                    />
                  </div>
                  {errors.backupPhone && <p className="text-theme-accent-red mt-1 text-sm">{errors.backupPhone}</p>}
                  <p className="text-theme-text-muted mt-1 text-xs">For SMS verification and account recovery</p>
                </div>

                {/* Secondary Admin Email (Optional) */}
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Secondary Admin Email <span className="text-theme-text-muted">(Optional)</span>
                  </label>
                  <div className="relative">
                    <User
                      aria-hidden="true"
                      className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
                    />
                    <input
                      type="email"
                      value={secondaryAdminEmail}
                      onChange={(e) => setSecondaryAdminEmail(e.target.value)}
                      className={`form-input placeholder-theme-text-muted py-3 pr-4 pl-12 transition-all ${
                        errors.secondaryAdminEmail
                          ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                          : 'border-theme-input-border focus:ring-theme-focus-ring'
                      }`}
                      placeholder="secondary-admin@example.com"
                    />
                  </div>
                  {errors.secondaryAdminEmail && (
                    <p className="text-theme-accent-red mt-1 text-sm">{errors.secondaryAdminEmail}</p>
                  )}
                  <p className="text-theme-text-muted mt-1 text-xs">
                    An additional admin who can help with account recovery
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="mx-auto max-w-md">
              {error && (
                <div className="mb-6">
                  <ErrorAlert
                    message={error}
                    canRetry={canRetry}
                    onRetry={() => {
                      void handleSubmit({ preventDefault: () => {} } as React.FormEvent);
                    }}
                    onDismiss={clearError}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className={`w-full rounded-lg px-8 py-4 text-lg font-semibold transition-all duration-300 ${
                  isSaving
                    ? 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                    : 'transform bg-linear-to-r from-red-600 to-orange-600 text-white shadow-lg hover:scale-105 hover:from-red-700 hover:to-orange-700 hover:shadow-xl'
                }`}
              >
                {isSaving ? 'Saving Securely...' : 'Continue to Module Selection'}
              </button>
            </div>

            {/* Progress Indicator */}
            <ProgressIndicator step="it_team" className="border-theme-nav-border mt-6 border-t pt-6" />
            <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </form>
        </div>
      </main>

      <footer className="bg-theme-nav-bg border-theme-nav-border border-t px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default ITTeamBackupAccess;
