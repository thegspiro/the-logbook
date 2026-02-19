import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Shield, Plus, Trash2, AlertCircle, Phone, Mail, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { ProgressIndicator, BackButton, ResetProgressButton, ErrorAlert, AutoSaveNotification } from '../components';
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
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const { execute, isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

  // Use Zustand store for persisted IT Team data
  const itTeam = useOnboardingStore(state => state.itTeamMembers);
  const setItTeam = useOnboardingStore(state => state.setITTeamMembers);
  const backupEmail = useOnboardingStore(state => state.backupEmail);
  const setBackupEmail = useOnboardingStore(state => state.setBackupEmail);
  const backupPhone = useOnboardingStore(state => state.backupPhone);
  const setBackupPhone = useOnboardingStore(state => state.setBackupPhone);
  const secondaryAdminEmail = useOnboardingStore(state => state.secondaryAdminEmail);
  const setSecondaryAdminEmail = useOnboardingStore(state => state.setSecondaryAdminEmail);

  // Validation errors (local state - no need to persist)
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!departmentName) {
      navigate('/onboarding/start');
      return;
    }
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
    setItTeam(
      itTeam.map((member) =>
        member.id === id ? { ...member, [field]: value } : member
      )
    );
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
        navigate('/onboarding/roles');
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
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <header className="bg-theme-nav-bg backdrop-blur-sm border-b border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img src={logoPreview} alt={`${departmentName} logo`} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
              <Mail className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
            <p className="text-theme-text-muted text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-4xl w-full">
          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mb-6">
            <BackButton to="/onboarding/authentication" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-600 rounded-full mb-4">
              <Users className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              IT Team & Backup Access
            </h2>
            <p className="text-xl text-theme-text-secondary mb-2">
              Configure system administration and recovery options
            </p>
            <p className="text-sm text-theme-text-muted">
              Essential for system maintenance and emergency access
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* IT Team Section */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Users className="w-6 h-6 text-cyan-400" />
                  <h3 className="text-xl font-bold text-theme-text-primary">IT Team Contacts</h3>
                </div>
                <button
                  type="button"
                  onClick={addITMember}
                  className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Member</span>
                </button>
              </div>

              <p className="text-theme-text-muted text-sm mb-6">
                Add contact information for your IT support team. The first person listed will be the primary contact.
              </p>

              {itTeam.map((member, index) => (
                <div
                  key={member.id}
                  className="bg-theme-surface-secondary rounded-lg p-4 mb-4 border border-theme-surface-border"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-theme-text-primary font-semibold flex items-center">
                      <User className="w-4 h-4 mr-2" />
                      {index === 0 ? 'Primary IT Contact' : `IT Team Member ${index + 1}`}
                      {index === 0 && <span className="ml-2 text-xs text-red-400">*Required</span>}
                    </h4>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => removeITMember(member.id)}
                        className="text-red-400 hover:text-red-300 transition-colors"
                        aria-label="Remove team member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Name */}
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        Full Name {index === 0 && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="text"
                        value={member.name}
                        onChange={(e) => updateITMember(member.id, 'name', e.target.value)}
                        className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                          errors[index === 0 ? 'primaryName' : `member${index}Name`]
                            ? 'border-red-500 focus:ring-red-500/50'
                            : 'border-theme-input-border focus:ring-cyan-600'
                        }`}
                        placeholder="John Doe"
                      />
                      {errors[index === 0 ? 'primaryName' : `member${index}Name`] && (
                        <p className="mt-1 text-sm text-red-400">
                          {errors[index === 0 ? 'primaryName' : `member${index}Name`]}
                        </p>
                      )}
                    </div>

                    {/* Role */}
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        Role/Title
                      </label>
                      <input
                        type="text"
                        value={member.role}
                        onChange={(e) => updateITMember(member.id, 'role', e.target.value)}
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-cyan-600 transition-all"
                        placeholder="IT Manager"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        Email {index === 0 && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="email"
                        value={member.email}
                        onChange={(e) => updateITMember(member.id, 'email', e.target.value)}
                        className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                          errors[index === 0 ? 'primaryEmail' : `member${index}Email`]
                            ? 'border-red-500 focus:ring-red-500/50'
                            : 'border-theme-input-border focus:ring-cyan-600'
                        }`}
                        placeholder="john@example.com"
                      />
                      {errors[index === 0 ? 'primaryEmail' : `member${index}Email`] && (
                        <p className="mt-1 text-sm text-red-400">
                          {errors[index === 0 ? 'primaryEmail' : `member${index}Email`]}
                        </p>
                      )}
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                        Phone {index === 0 && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="tel"
                        value={member.phone}
                        onChange={(e) => updateITMember(member.id, 'phone', e.target.value)}
                        className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                          errors[index === 0 ? 'primaryPhone' : `member${index}Phone`]
                            ? 'border-red-500 focus:ring-red-500/50'
                            : 'border-theme-input-border focus:ring-cyan-600'
                        }`}
                        placeholder="(555) 123-4567"
                      />
                      {errors[index === 0 ? 'primaryPhone' : `member${index}Phone`] && (
                        <p className="mt-1 text-sm text-red-400">
                          {errors[index === 0 ? 'primaryPhone' : `member${index}Phone`]}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Backup Access Section */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Shield className="w-6 h-6 text-theme-alert-warning-icon" />
                <h3 className="text-xl font-bold text-theme-text-primary">Backup Access Methods</h3>
              </div>

              <div className="alert-warning mb-6">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-theme-alert-warning-icon flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-theme-alert-warning-title text-sm font-medium mb-1">
                      Critical for Account Recovery
                    </p>
                    <p className="text-theme-alert-warning-text text-sm">
                      These backup methods will be used to recover access if the primary admin account
                      is locked or credentials are lost. Keep this information current.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {/* Backup Recovery Email */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Backup Recovery Email <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
                    <input
                      type="email"
                      value={backupEmail}
                      onChange={(e) => setBackupEmail(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                        errors.backupEmail
                          ? 'border-red-500 focus:ring-red-500/50'
                          : 'border-theme-input-border focus:ring-cyan-600'
                      }`}
                      placeholder="backup-admin@example.com"
                    />
                  </div>
                  {errors.backupEmail && (
                    <p className="mt-1 text-sm text-red-400">{errors.backupEmail}</p>
                  )}
                  <p className="mt-1 text-xs text-theme-text-muted">
                    Use a different email than the primary admin account
                  </p>
                </div>

                {/* Backup Phone */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Backup Phone Number <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
                    <input
                      type="tel"
                      value={backupPhone}
                      onChange={(e) => setBackupPhone(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                        errors.backupPhone
                          ? 'border-red-500 focus:ring-red-500/50'
                          : 'border-theme-input-border focus:ring-cyan-600'
                      }`}
                      placeholder="(555) 987-6543"
                    />
                  </div>
                  {errors.backupPhone && (
                    <p className="mt-1 text-sm text-red-400">{errors.backupPhone}</p>
                  )}
                  <p className="mt-1 text-xs text-theme-text-muted">
                    For SMS verification and account recovery
                  </p>
                </div>

                {/* Secondary Admin Email (Optional) */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Secondary Admin Email <span className="text-theme-text-muted">(Optional)</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
                    <input
                      type="email"
                      value={secondaryAdminEmail}
                      onChange={(e) => setSecondaryAdminEmail(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                        errors.secondaryAdminEmail
                          ? 'border-red-500 focus:ring-red-500/50'
                          : 'border-theme-input-border focus:ring-cyan-600'
                      }`}
                      placeholder="secondary-admin@example.com"
                    />
                  </div>
                  {errors.secondaryAdminEmail && (
                    <p className="mt-1 text-sm text-red-400">{errors.secondaryAdminEmail}</p>
                  )}
                  <p className="mt-1 text-xs text-theme-text-muted">
                    An additional admin who can help with account recovery
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="max-w-md mx-auto">
              {error && (
                <div className="mb-6">
                  <ErrorAlert message={error} canRetry={canRetry} onRetry={handleSubmit} onDismiss={clearError} />
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                  isSaving
                    ? 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                    : 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                }`}
              >
                {isSaving ? 'Saving Securely...' : 'Continue to Module Selection'}
              </button>

              {/* Progress Indicator */}
              <ProgressIndicator currentStep={7} totalSteps={10} className="mt-6 pt-6 border-t border-theme-nav-border" />
              <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
            </div>
          </form>
        </div>
      </main>

      <footer className="bg-theme-nav-bg backdrop-blur-sm border-t border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">© {currentYear} {departmentName}. All rights reserved.</p>
          <p className="text-theme-text-muted text-xs mt-1">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default ITTeamBackupAccess;
