import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Shield, Plus, Trash2, CheckCircle, AlertCircle, Phone, Mail, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, OnboardingFooter, ProgressIndicator } from '../components';
import { useOnboardingStorage } from '../hooks';
import { apiClient } from '../services/api-client';
import { isValidEmail } from '../utils/validation';

interface ITTeamMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

interface BackupAccessMethod {
  type: 'email' | 'phone' | 'secondary_admin';
  value: string;
  verified: boolean;
}

const ITTeamBackupAccess: React.FC = () => {
  const navigate = useNavigate();
  const { departmentName, logoPreview } = useOnboardingStorage();

  // IT Team Members
  const [itTeam, setItTeam] = useState<ITTeamMember[]>([
    { id: '1', name: '', email: '', phone: '', role: 'Primary IT Contact' },
  ]);

  // Backup Access Methods
  const [backupEmail, setBackupEmail] = useState('');
  const [backupPhone, setBackupPhone] = useState('');
  const [secondaryAdminEmail, setSecondaryAdminEmail] = useState('');

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

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

    setIsSaving(true);
    setErrors({});

    try {
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

      // SECURITY: Save IT team info to server
      const response = await apiClient.saveITTeam(itTeamData);

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      // SECURITY: Only store non-sensitive metadata in sessionStorage
      sessionStorage.setItem('itTeamConfigured', 'true');

      toast.success('IT team and backup access information saved securely');

      // Navigate to module selection
      navigate('/onboarding/module-selection');
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save IT team information';
      toast.error(errorMessage);
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-4xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-600 rounded-full mb-4">
              <Users className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              IT Team & Backup Access
            </h2>
            <p className="text-xl text-slate-300 mb-2">
              Configure system administration and recovery options
            </p>
            <p className="text-sm text-slate-400">
              Essential for system maintenance and emergency access
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* IT Team Section */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Users className="w-6 h-6 text-cyan-400" />
                  <h3 className="text-xl font-bold text-white">IT Team Contacts</h3>
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

              <p className="text-slate-400 text-sm mb-6">
                Add contact information for your IT support team. The first person listed will be the primary contact.
              </p>

              {itTeam.map((member, index) => (
                <div
                  key={member.id}
                  className="bg-slate-900/50 rounded-lg p-4 mb-4 border border-white/10"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-white font-semibold flex items-center">
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
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Full Name {index === 0 && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="text"
                        value={member.name}
                        onChange={(e) => updateITMember(member.id, 'name', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                          errors[index === 0 ? 'primaryName' : `member${index}Name`]
                            ? 'border-red-500 focus:ring-red-500/50'
                            : 'border-slate-700 focus:ring-cyan-600'
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
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Role/Title
                      </label>
                      <input
                        type="text"
                        value={member.role}
                        onChange={(e) => updateITMember(member.id, 'role', e.target.value)}
                        className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-600 transition-all"
                        placeholder="IT Manager"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Email {index === 0 && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="email"
                        value={member.email}
                        onChange={(e) => updateITMember(member.id, 'email', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                          errors[index === 0 ? 'primaryEmail' : `member${index}Email`]
                            ? 'border-red-500 focus:ring-red-500/50'
                            : 'border-slate-700 focus:ring-cyan-600'
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
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Phone {index === 0 && <span className="text-red-400">*</span>}
                      </label>
                      <input
                        type="tel"
                        value={member.phone}
                        onChange={(e) => updateITMember(member.id, 'phone', e.target.value)}
                        className={`w-full px-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                          errors[index === 0 ? 'primaryPhone' : `member${index}Phone`]
                            ? 'border-red-500 focus:ring-red-500/50'
                            : 'border-slate-700 focus:ring-cyan-600'
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
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Shield className="w-6 h-6 text-amber-400" />
                <h3 className="text-xl font-bold text-white">Backup Access Methods</h3>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/50 rounded-lg p-4 mb-6">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 text-sm font-medium mb-1">
                      Critical for Account Recovery
                    </p>
                    <p className="text-amber-200 text-sm">
                      These backup methods will be used to recover access if the primary admin account
                      is locked or credentials are lost. Keep this information current.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {/* Backup Recovery Email */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Backup Recovery Email <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="email"
                      value={backupEmail}
                      onChange={(e) => setBackupEmail(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                        errors.backupEmail
                          ? 'border-red-500 focus:ring-red-500/50'
                          : 'border-slate-700 focus:ring-cyan-600'
                      }`}
                      placeholder="backup-admin@example.com"
                    />
                  </div>
                  {errors.backupEmail && (
                    <p className="mt-1 text-sm text-red-400">{errors.backupEmail}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    Use a different email than the primary admin account
                  </p>
                </div>

                {/* Backup Phone */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Backup Phone Number <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="tel"
                      value={backupPhone}
                      onChange={(e) => setBackupPhone(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                        errors.backupPhone
                          ? 'border-red-500 focus:ring-red-500/50'
                          : 'border-slate-700 focus:ring-cyan-600'
                      }`}
                      placeholder="(555) 987-6543"
                    />
                  </div>
                  {errors.backupPhone && (
                    <p className="mt-1 text-sm text-red-400">{errors.backupPhone}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    For SMS verification and account recovery
                  </p>
                </div>

                {/* Secondary Admin Email (Optional) */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Secondary Admin Email <span className="text-slate-500">(Optional)</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="email"
                      value={secondaryAdminEmail}
                      onChange={(e) => setSecondaryAdminEmail(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-slate-800/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                        errors.secondaryAdminEmail
                          ? 'border-red-500 focus:ring-red-500/50'
                          : 'border-slate-700 focus:ring-cyan-600'
                      }`}
                      placeholder="secondary-admin@example.com"
                    />
                  </div>
                  {errors.secondaryAdminEmail && (
                    <p className="mt-1 text-sm text-red-400">{errors.secondaryAdminEmail}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    An additional admin who can help with account recovery
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="max-w-md mx-auto">
              <button
                type="submit"
                disabled={isSaving}
                className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                  isSaving
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                }`}
              >
                {isSaving ? 'Saving Securely...' : 'Continue to Module Selection'}
              </button>

              {/* Progress Indicator */}
              <ProgressIndicator currentStep={7} totalSteps={9} className="mt-6 pt-6 border-t border-white/10" />
            </div>
          </form>
        </div>
      </main>

      <OnboardingFooter departmentName={departmentName} />
    </div>
  );
};

export default ITTeamBackupAccess;
