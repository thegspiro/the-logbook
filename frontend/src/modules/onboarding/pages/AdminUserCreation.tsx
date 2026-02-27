import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, CheckCircle, XCircle, Info, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, BackButton, ResetProgressButton, ErrorAlert, AutoSaveNotification } from '../components';
import { useApiRequest } from '../hooks';
import { useOnboardingStore } from '../store';
import { apiClient } from '../services/api-client';
import { isValidEmail } from '../utils/validation';

const SystemOwnerCreation: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const { execute, isLoading: isSaving, error, canRetry, clearError } = useApiRequest();

  // Form fields
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    membershipNumber: '',
    password: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!departmentName) {
      navigate('/onboarding/start');
      return;
    }
  }, [navigate, departmentName]);

  // Password strength checker
  const checkPasswordStrength = (password: string) => {
    const checks = {
      length: password.length >= 12,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
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
        if (!isValidEmail(value))
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
    setFormData((prev) => {
      const newData = { ...prev, [name]: value };

      // Also revalidate confirm password if password changes
      if (name === 'password' && touched.confirmPassword) {
        // Validate confirmPassword against the NEW password value
        const confirmError = newData.confirmPassword !== value
          ? 'Passwords do not match'
          : '';
        setErrors((prevErrors) => ({ ...prevErrors, confirmPassword: confirmError }));
      }

      return newData;
    });

    // Validate on change if field was touched
    if (touched[name]) {
      const error = validateField(name, value);
      setErrors((prev) => ({ ...prev, [name]: error }));
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

    setErrors({});
    clearError();

    const { data: _data, error: apiError } = await execute(
      async () => {
        // SECURITY CRITICAL: Send password to server (NEVER sessionStorage!)
        // Password will be hashed with Argon2id server-side
        const response = await apiClient.createSystemOwner({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          password_confirm: formData.confirmPassword,
          first_name: formData.firstName,
          last_name: formData.lastName,
          membership_number: formData.membershipNumber || undefined,
        });

        if (response.error) {
          // Parse error to provide field-specific context
          let errorMessage = response.error;

          // Add helpful context for common errors
          if (errorMessage.toLowerCase().includes('username') && errorMessage.toLowerCase().includes('exists')) {
            errorMessage += ` Try adding numbers or your organization name (e.g., ${formData.username}2, ${formData.username}_fcvfd)`;
          } else if (errorMessage.toLowerCase().includes('email') && errorMessage.toLowerCase().includes('exists')) {
            errorMessage += ' Use a different email address or reset password if this is your account.';
          } else if (errorMessage.toLowerCase().includes('password')) {
            errorMessage += ' Check the password requirements above.';
          }

          throw new Error(errorMessage);
        }

        toast.success('System Owner account created!');

        // Save system owner info to the onboarding store so the
        // IT Team step can auto-populate the primary contact.
        // Must happen before clearing form data.
        useOnboardingStore.getState().setSystemOwnerInfo({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
        });

        // SECURITY: Clear password from memory immediately (apiClient already does this)
        setFormData({
          username: '',
          email: '',
          firstName: '',
          lastName: '',
          membershipNumber: '',
          password: '',
          confirmPassword: '',
        });

        // Load user into auth store so the session persists through
        // the remaining onboarding steps.
        const { useAuthStore } = await import('../../../stores/authStore');
        await useAuthStore.getState().loadUser();

        // Continue to IT Team & Backup Access step
        navigate('/onboarding/it-team');

        return response;
      },
      {
        step: 'System Owner Creation',
        action: 'Create system owner account',
        userContext: `Username: ${formData.username}, Email: ${formData.email}`,
      }
    );

    if (apiError) {
      // SECURITY: Clear passwords on error
      setFormData(prev => ({
        ...prev,
        password: '',
        confirmPassword: '',
      }));
    }
  };

  const currentYear = new Date().getFullYear();
  const requiredFields = ['username', 'email', 'firstName', 'lastName', 'password', 'confirmPassword'] as const;
  const isFormValid =
    requiredFields.every((key) => formData[key].trim() !== '') &&
    Object.values(errors).every((error) => error === '') &&
    passwordStrength.passedChecks === 5;

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} icon={<Mail aria-hidden="true" className="w-6 h-6 text-white" />} />

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="max-w-2xl w-full">
          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mb-6">
            <BackButton to="/onboarding/authentication" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-full mb-4">
              <Shield aria-hidden="true" className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              Create System Owner Account
            </h2>
            <p className="text-xl text-theme-text-secondary mb-2">
              Set up the IT Manager / System Owner account
            </p>
            <p className="text-sm text-theme-text-muted">
              This account will have full access to all system settings and configurations
            </p>
          </div>

          {/* System Owner Clarification */}
          <div className="alert-purple mb-6">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-theme-alert-purple-icon flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-theme-alert-purple-title text-sm font-medium mb-1">
                  System Owner / IT Manager
                </p>
                <p className="text-theme-alert-purple-text text-sm mb-2">
                  This creates the <strong>System Owner</strong> account -- the IT Manager responsible for system and technical administration.
                  This is different from members who hold organizational positions.
                </p>
                <ul className="text-theme-alert-purple-text text-sm space-y-1 list-disc list-inside ml-2">
                  <li><strong>System Owner (IT Manager):</strong> Full technical access to all system settings (what you're creating now)</li>
                  <li><strong>Organizational Positions:</strong> President, Secretary, and other positions are managed separately in the Members module</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Security Notice */}
          <div className="alert-info mb-6">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-theme-alert-info-icon flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-theme-alert-info-title text-sm font-medium mb-1">
                  Security Requirements
                </p>
                <p className="text-theme-alert-info-text text-sm">
                  Your password will be encrypted using Argon2id hashing and
                  stored securely. Choose a strong password that meets all
                  requirements below.
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
            {/* Personal Information */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
              <h3 className="text-xl font-bold text-theme-text-primary mb-4">
                System Owner Information
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                {/* First Name */}
                <div>
                  <label
                    htmlFor="firstName"
                    className="block text-sm font-medium text-theme-text-secondary mb-2"
                  >
                    First Name <span className="text-theme-accent-red">*</span>
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                      errors.firstName && touched.firstName
                        ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                        : 'border-theme-input-border focus:ring-theme-focus-ring'
                    }`}
                    placeholder="John"
                    aria-invalid={errors.firstName && touched.firstName ? 'true' : 'false'}
                    aria-describedby={errors.firstName && touched.firstName ? 'firstName-error' : undefined}
                  />
                  {errors.firstName && touched.firstName && (
                    <p id="firstName-error" className="mt-1 text-sm text-theme-accent-red flex items-center">
                      <XCircle className="w-4 h-4 mr-1" />
                      {errors.firstName}
                    </p>
                  )}
                </div>

                {/* Last Name */}
                <div>
                  <label
                    htmlFor="lastName"
                    className="block text-sm font-medium text-theme-text-secondary mb-2"
                  >
                    Last Name <span className="text-theme-accent-red">*</span>
                  </label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                      errors.lastName && touched.lastName
                        ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                        : 'border-theme-input-border focus:ring-theme-focus-ring'
                    }`}
                    placeholder="Doe"
                    aria-invalid={errors.lastName && touched.lastName ? 'true' : 'false'}
                    aria-describedby={errors.lastName && touched.lastName ? 'lastName-error' : undefined}
                  />
                  {errors.lastName && touched.lastName && (
                    <p id="lastName-error" className="mt-1 text-sm text-theme-accent-red flex items-center">
                      <XCircle className="w-4 h-4 mr-1" />
                      {errors.lastName}
                    </p>
                  )}
                </div>
              </div>

              {/* Membership Number (Optional) */}
              <div className="mt-4">
                <label
                  htmlFor="membershipNumber"
                  className="block text-sm font-medium text-theme-text-secondary mb-2"
                >
                  Membership Number <span className="text-theme-text-muted">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="membershipNumber"
                  name="membershipNumber"
                  value={formData.membershipNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring transition-all"
                  placeholder="e.g., FF-1234"
                />
              </div>
            </div>

            {/* Account Credentials */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
              <h3 className="text-xl font-bold text-theme-text-primary mb-4">
                Account Credentials
              </h3>

              {/* Username */}
              <div className="mb-4">
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-theme-text-secondary mb-2"
                >
                  Username <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                    errors.username && touched.username
                      ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                      : 'border-theme-input-border focus:ring-theme-focus-ring'
                  }`}
                  placeholder="johndoe"
                  autoComplete="username"
                  aria-invalid={errors.username && touched.username ? 'true' : 'false'}
                  aria-describedby={errors.username && touched.username ? 'username-error' : undefined}
                />
                {errors.username && touched.username && (
                  <p id="username-error" className="mt-1 text-sm text-theme-accent-red flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.username}
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="mb-4">
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-theme-text-secondary mb-2"
                >
                  Email Address <span className="text-theme-accent-red">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                    errors.email && touched.email
                      ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                      : 'border-theme-input-border focus:ring-theme-focus-ring'
                  }`}
                  placeholder="itmanager@example.com"
                  autoComplete="email"
                  aria-invalid={errors.email && touched.email ? 'true' : 'false'}
                  aria-describedby={errors.email && touched.email ? 'email-error' : undefined}
                />
                {errors.email && touched.email && (
                  <p id="email-error" className="mt-1 text-sm text-theme-accent-red flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="mb-4">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-theme-text-secondary mb-2"
                >
                  Password <span className="text-theme-accent-red">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 pr-12 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                      errors.password && touched.password
                        ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                        : 'border-theme-input-border focus:ring-theme-focus-ring'
                    }`}
                    placeholder="Enter a strong password"
                    autoComplete="new-password"
                    aria-invalid={errors.password && touched.password ? 'true' : 'false'}
                    aria-describedby="password-requirements password-error"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
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
                  <p id="password-error" className="mt-1 text-sm text-theme-accent-red flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.password}
                  </p>
                )}

                {/* Password Strength Indicators */}
                <div id="password-requirements" className="mt-3 space-y-2">
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.length ? (
                        <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-theme-text-muted mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.length
                            ? 'text-theme-accent-green'
                            : 'text-theme-text-muted'
                        }
                      >
                        At least 12 characters
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.uppercase ? (
                        <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-theme-text-muted mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.uppercase
                            ? 'text-theme-accent-green'
                            : 'text-theme-text-muted'
                        }
                      >
                        One uppercase letter
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.lowercase ? (
                        <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-theme-text-muted mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.lowercase
                            ? 'text-theme-accent-green'
                            : 'text-theme-text-muted'
                        }
                      >
                        One lowercase letter
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.number ? (
                        <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-theme-text-muted mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.number
                            ? 'text-theme-accent-green'
                            : 'text-theme-text-muted'
                        }
                      >
                        One number
                      </span>
                    </div>
                    <div className="flex items-center text-sm">
                      {passwordStrength.checks.special ? (
                        <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green mr-2" />
                      ) : (
                        <XCircle className="w-4 h-4 text-theme-text-muted mr-2" />
                      )}
                      <span
                        className={
                          passwordStrength.checks.special
                            ? 'text-theme-accent-green'
                            : 'text-theme-text-muted'
                        }
                      >
                        One special character (!@#$%^&*...)
                      </span>
                    </div>
                  </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-theme-text-secondary mb-2"
                >
                  Confirm Password <span className="text-theme-accent-red">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 pr-12 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 transition-all ${
                      errors.confirmPassword && touched.confirmPassword
                        ? 'border-theme-accent-red focus:ring-theme-focus-ring'
                        : 'border-theme-input-border focus:ring-theme-focus-ring'
                    }`}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    aria-invalid={errors.confirmPassword && touched.confirmPassword ? 'true' : 'false'}
                    aria-describedby={errors.confirmPassword && touched.confirmPassword ? 'confirmPassword-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
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
                  <p id="confirmPassword-error" className="mt-1 text-sm text-theme-accent-red flex items-center">
                    <XCircle className="w-4 h-4 mr-1" />
                    {errors.confirmPassword}
                  </p>
                )}
                {!errors.confirmPassword &&
                  formData.confirmPassword &&
                  formData.password === formData.confirmPassword && (
                    <p className="mt-1 text-sm text-theme-accent-green flex items-center">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Passwords match
                    </p>
                  )}
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
                disabled={!isFormValid || isSaving}
                className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                  isFormValid && !isSaving
                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                    : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                }`}
                aria-label="Create System Owner account and continue setup"
              >
                {isSaving ? 'Creating System Owner Account...' : 'Create Account & Continue'}
              </button>

              {/* Help Text */}
              <p className="text-center text-theme-text-muted text-sm mt-4">
                You'll be logged in automatically and continue with IT team setup
              </p>

              {/* Progress Indicator */}
              <div className="mt-6 pt-6 border-t border-theme-nav-border">
                <div className="flex items-center justify-between text-sm text-theme-text-muted mb-2">
                  <span>Setup Progress</span>
                  <span>Step 7 of 10</span>
                </div>
                <div className="w-full bg-theme-surface rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: '70%' }}
                    role="progressbar"
                    aria-valuenow={70}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Setup progress: 70 percent complete"
                  />
                </div>
                <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
              </div>
            </div>
          </form>
        </div>
      </main>

      {/* Footer with Department Name and Copyright */}
      <footer className="bg-theme-nav-bg backdrop-blur-sm border-t border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </div>
  );
};

// Backward-compatible alias
export const AdminUserCreation = SystemOwnerCreation;

export default SystemOwnerCreation;
