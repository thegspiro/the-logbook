import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, CheckCircle, XCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';

const AdminUserCreation: React.FC = () => {
  const [departmentName, setDepartmentName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const navigate = useNavigate();

  // Form fields
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    badgeNumber: '',
    password: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Get department info from session storage
    const name = sessionStorage.getItem('departmentName');
    const logoData = sessionStorage.getItem('logoData');

    if (!name) {
      // If no department name, redirect back to start
      navigate('/onboarding/start');
      return;
    }

    setDepartmentName(name);
    if (logoData) {
      setLogoPreview(logoData);
    }
  }, [navigate]);

  // Password strength checker
  const checkPasswordStrength = (password: string) => {
    const checks = {
      length: password.length >= 12,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };

    const passedChecks = Object.values(checks).filter(Boolean).length;
    return { checks, passedChecks };
  };

  const passwordStrength = checkPasswordStrength(formData.password);

  // Form validation
  const validateField = (name: string, value: string): string => {
    switch (name) {
      case 'username':
        if (!value.trim()) return 'Username is required';
        if (value.length < 3) return 'Username must be at least 3 characters';
        if (!/^[a-zA-Z0-9_-]+$/.test(value))
          return 'Username can only contain letters, numbers, hyphens, and underscores';
        return '';

      case 'email':
        if (!value.trim()) return 'Email is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          return 'Please enter a valid email address';
        return '';

      case 'firstName':
        if (!value.trim()) return 'First name is required';
        return '';

      case 'lastName':
        if (!value.trim()) return 'Last name is required';
        return '';

      case 'password':
        if (!value) return 'Password is required';
        if (value.length < 12) return 'Password must be at least 12 characters';
        if (!passwordStrength.checks.uppercase)
          return 'Password must contain at least one uppercase letter';
        if (!passwordStrength.checks.lowercase)
          return 'Password must contain at least one lowercase letter';
        if (!passwordStrength.checks.number)
          return 'Password must contain at least one number';
        if (!passwordStrength.checks.special)
          return 'Password must contain at least one special character';
        return '';

      case 'confirmPassword':
        if (!value) return 'Please confirm your password';
        if (value !== formData.password) return 'Passwords do not match';
        return '';

      default:
        return '';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Validate on change if field was touched
    if (touched[name]) {
      const error = validateField(name, value);
      setErrors((prev) => ({ ...prev, [name]: error }));
    }

    // Also revalidate confirm password if password changes
    if (name === 'password' && touched.confirmPassword) {
      const confirmError = validateField(
        'confirmPassword',
        formData.confirmPassword
      );
      setErrors((prev) => ({ ...prev, confirmPassword: confirmError }));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    const error = validateField(name, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: Record<string, string> = {};
    Object.keys(formData).forEach((key) => {
      const error = validateField(key, formData[key as keyof typeof formData]);
      if (error) newErrors[key] = error;
    });

    // Mark all fields as touched
    const allTouched: Record<string, boolean> = {};
    Object.keys(formData).forEach((key) => {
      allTouched[key] = true;
    });
    setTouched(allTouched);

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSaving(true);
    setErrors({});

    try {
      // SECURITY CRITICAL: Send password to server (NEVER sessionStorage!)
      // Password will be hashed with Argon2id server-side
      const response = await apiClient.createAdminUser({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        password_confirm: formData.confirmPassword,
        first_name: formData.firstName,
        last_name: formData.lastName,
        badge_number: formData.badgeNumber || undefined,
      });

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      // SECURITY: Clear password from memory immediately (apiClient already does this)
      setFormData({
        username: '',
        email: '',
        firstName: '',
        lastName: '',
        badgeNumber: '',
        password: '',
        confirmPassword: '',
      });

      toast.success('Admin account created! Setting up your dashboard...');

      // Complete onboarding and finalize setup
      const completeResponse = await apiClient.completeOnboarding();

      if (completeResponse.error) {
        toast.error('Account created but setup incomplete. Please contact support.');
        setIsSaving(false);
        return;
      }

      // Clear all onboarding data from sessionStorage
      sessionStorage.removeItem('departmentName');
      sessionStorage.removeItem('logoData');
      sessionStorage.removeItem('navigationLayout');
      sessionStorage.removeItem('emailPlatform');
      sessionStorage.removeItem('emailConfigured');
      sessionStorage.removeItem('fileStoragePlatform');
      sessionStorage.removeItem('authPlatform');
      sessionStorage.removeItem('itTeamConfigured');

      toast.success('Welcome to your department dashboard!');

      // Navigate to main dashboard (user is now authenticated)
      navigate('/dashboard');
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create admin user';
      toast.error(errorMessage);
      setIsSaving(false);

      // SECURITY: Clear passwords on error
      setFormData(prev => ({
        ...prev,
        password: '',
        confirmPassword: '',
      }));
    }
  };

  const currentYear = new Date().getFullYear();
  const isFormValid =
    Object.values(formData).every((value) => value.trim() !== '') &&
    Object.values(errors).every((error) => error === '') &&
    passwordStrength.passedChecks === 5;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex flex-col">
      {/* Header with Logo */}
      <header className="bg-slate-900/50 backdrop-blur-sm border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img
                src={logoPreview}
                alt={`${departmentName} logo`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
              <Shield className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-white text-lg font-semibold">{departmentName}</h1>
            <p className="text-slate-400 text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-2xl w-full">
          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-full mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              Create Admin Account
            </h2>
            <p className="text-xl text-slate-300 mb-2">
              Set up the primary administrator account
            </p>
            <p className="text-sm text-slate-400">
              This account will have full access to all system settings
            </p>
          </div>

          {/* Security Notice */}
          <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-6">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-300 text-sm font-medium mb-1">
                  Security Requirements
                </p>
                <p className="text-blue-200 text-sm">
                  Your password will be encrypted using Argon2id hashing and
                  stored securely. Choose a strong password that meets all
                  requirements below.
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Information */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
              <h3 className="text-xl font-bold text-white mb-4">
                Personal Information
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                {/* First Name */}
                <div>
                  <label
                    htmlFor="firstName"
                    className="block text-sm font-medium text-slate-300 mb-2"
                  >
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                      errors.firstName && touched.firstName
                        ? 'border-red-500 focus:ring-red-500/50'
                        : 'border-slate-700 focus:ring-red-600'
                    }`}
                    placeholder="John"
                    aria-invalid={errors.firstName && touched.firstName ? 'true' : 'false'}
                    aria-describedby={errors.firstName && touched.firstName ? 'firstName-error' : undefined}
                  />
                  {errors.firstName && touched.firstName && (
                    <p id="firstName-error" className="mt-1 text-sm text-red-400 flex items-center">
                      <XCircle className="w-4 h-4 mr-1" />
                      {errors.firstName}
                    </p>
                  )}
                </div>

                {/* Last Name */}
                <div>
                  <label
                    htmlFor="lastName"
                    className="block text-sm font-medium text-slate-300 mb-2"
                  >
                    Last Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                      errors.lastName && touched.lastName
                        ? 'border-red-500 focus:ring-red-500/50'
                        : 'border-slate-700 focus:ring-red-600'
                    }`}
                    placeholder="Doe"
                    aria-invalid={errors.lastName && touched.lastName ? 'true' : 'false'}
                    aria-describedby={errors.lastName && touched.lastName ? 'lastName-error' : undefined}
                  />
                  {errors.lastName && touched.lastName && (
                    <p id="lastName-error" className="mt-1 text-sm text-red-400 flex items-center">
                      <XCircle className="w-4 h-4 mr-1" />
                      {errors.lastName}
                    </p>
                  )}
                </div>
              </div>

              {/* Badge Number (Optional) */}
              <div className="mt-4">
                <label
                  htmlFor="badgeNumber"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Badge Number <span className="text-slate-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="badgeNumber"
                  name="badgeNumber"
                  value={formData.badgeNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-600 transition-all"
                  placeholder="e.g., FF-1234"
                />
              </div>
            </div>

            {/* Account Credentials */}
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
              <h3 className="text-xl font-bold text-white mb-4">
                Account Credentials
              </h3>

              {/* Username */}
              <div className="mb-4">
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Username <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                    errors.username && touched.username
                      ? 'border-red-500 focus:ring-red-500/50'
                      : 'border-slate-700 focus:ring-red-600'
                  }`}
                  placeholder="johndoe"
                  autoComplete="username"
                  aria-invalid={errors.username && touched.username ? 'true' : 'false'}
                  aria-describedby={errors.username && touched.username ? 'username-error' : undefined}
                />
                {errors.username && touched.username && (
                  <p id="username-error" className="mt-1 text-sm text-red-400 flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.username}
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="mb-4">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Email Address <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                    errors.email && touched.email
                      ? 'border-red-500 focus:ring-red-500/50'
                      : 'border-slate-700 focus:ring-red-600'
                  }`}
                  placeholder="admin@example.com"
                  autoComplete="email"
                  aria-invalid={errors.email && touched.email ? 'true' : 'false'}
                  aria-describedby={errors.email && touched.email ? 'email-error' : undefined}
                />
                {errors.email && touched.email && (
                  <p id="email-error" className="mt-1 text-sm text-red-400 flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="mb-4">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 pr-12 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                      errors.password && touched.password
                        ? 'border-red-500 focus:ring-red-500/50'
                        : 'border-slate-700 focus:ring-red-600'
                    }`}
                    placeholder="Enter a strong password"
                    autoComplete="new-password"
                    aria-invalid={errors.password && touched.password ? 'true' : 'false'}
                    aria-describedby="password-requirements password-error"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {errors.password && touched.password && (
                  <p id="password-error" className="mt-1 text-sm text-red-400 flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.password}
                  </p>
                )}

                {/* Password Strength Indicators */}
                {formData.password && (
                  <div id="password-requirements" className="mt-3 space-y-2">
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.length ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600 mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.length
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }
                      >
                        At least 12 characters
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.uppercase ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600 mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.uppercase
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }
                      >
                        One uppercase letter
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.lowercase ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600 mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.lowercase
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }
                      >
                        One lowercase letter
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.number ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600 mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.number
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }
                      >
                        One number
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.special ? (
                        <CheckCircle className="w-4 h-4 text-green-400 mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600 mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.special
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }
                      >
                        One special character (!@#$%^&*...)
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Confirm Password <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 pr-12 bg-slate-900/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all ${
                      errors.confirmPassword && touched.confirmPassword
                        ? 'border-red-500 focus:ring-red-500/50'
                        : 'border-slate-700 focus:ring-red-600'
                    }`}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    aria-invalid={errors.confirmPassword && touched.confirmPassword ? 'true' : 'false'}
                    aria-describedby={errors.confirmPassword && touched.confirmPassword ? 'confirmPassword-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {errors.confirmPassword && touched.confirmPassword && (
                  <p id="confirmPassword-error" className="mt-1 text-sm text-red-400 flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.confirmPassword}
                  </p>
                )}
                {!errors.confirmPassword &&
                  formData.confirmPassword &&
                  formData.password === formData.confirmPassword && (
                    <p className="mt-1 text-sm text-green-400 flex items-center">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Passwords match
                    </p>
                  )}
              </div>
            </div>

            {/* Submit Button */}
            <div className="max-w-md mx-auto">
              <button
                type="submit"
                disabled={!isFormValid || isSaving}
                className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                  isFormValid && !isSaving
                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                }`}
                aria-label="Create admin account and access dashboard"
              >
                {isSaving ? 'Creating Account & Finalizing Setup...' : 'Create Account & Access Dashboard'}
              </button>

              {/* Help Text */}
              <p className="text-center text-slate-400 text-sm mt-4">
                You'll be logged in automatically and redirected to your dashboard
              </p>

              {/* Progress Indicator */}
              <div className="mt-6 pt-6 border-t border-white/10">
                <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
                  <span>Setup Progress</span>
                  <span>Step 9 of 9</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: '100%' }}
                    role="progressbar"
                    aria-valuenow={100}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Setup progress: 100 percent complete"
                  />
                </div>
              </div>
            </div>
          </form>
        </div>
      </main>

      {/* Footer with Department Name and Copyright */}
      <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-slate-300 text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </div>
  );
};

export default AdminUserCreation;
