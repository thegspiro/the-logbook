import React, { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  validatePassword,
  getPasswordRequirementsText,
  getStrengthColor,
  getStrengthText,
} from '../utils/passwordValidation';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { register, isLoading, error } = useAuthStore();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    badgeNumber: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [showPasswordRequirements, setShowPasswordRequirements] = useState(false);

  // Validate password in real-time
  const passwordValidation = useMemo(() => {
    if (!formData.password) {
      return { isValid: false, errors: [], strength: 'weak' as const };
    }
    return validatePassword(formData.password);
  }, [formData.password]);

  const passwordRequirements = useMemo(() => getPasswordRequirementsText(), []);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Username validation
    if (!formData.username.trim()) {
      errors.username = 'Username is required';
    } else if (formData.username.length < 3) {
      errors.username = 'Username must be at least 3 characters';
    } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    // Password validation using strong policy
    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (!passwordValidation.isValid) {
      errors.password = passwordValidation.errors[0]; // Show first error
    }

    // Confirm password validation
    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    // First name validation
    if (!formData.firstName.trim()) {
      errors.firstName = 'First name is required';
    }

    // Last name validation
    if (!formData.lastName.trim()) {
      errors.lastName = 'Last name is required';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      await register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        first_name: formData.firstName,
        last_name: formData.lastName,
        badge_number: formData.badgeNumber || undefined,
      });
      navigate('/');
    } catch (_err) {
      // Error is handled by the store and displayed via error state
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error for this field when user starts typing
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8" id="main-content">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="mt-6 text-center text-3xl font-extrabold text-theme-text-primary">
            Create account
          </h1>
          <p className="mt-2 text-center text-sm text-theme-text-secondary">
            This page is for administrator use only
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit} aria-label="Registration form">
          {error && (
            <div className="rounded-md bg-red-50 p-4" role="alert" aria-live="polite">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-700 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-800">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-theme-text-secondary">
                Username <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                aria-invalid={formErrors.username ? 'true' : 'false'}
                aria-describedby={formErrors.username ? 'username-error' : undefined}
                className={`mt-1 appearance-none relative block w-full px-3 py-2 border ${
                  formErrors.username ? 'border-red-300' : 'border-theme-input-border'
                } placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="Choose a username"
                value={formData.username}
                onChange={handleChange}
                disabled={isLoading}
              />
              {formErrors.username && (
                <p id="username-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.username}</p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-theme-text-secondary">
                Email address <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-invalid={formErrors.email ? 'true' : 'false'}
                aria-describedby={formErrors.email ? 'email-error' : undefined}
                className={`mt-1 appearance-none relative block w-full px-3 py-2 border ${
                  formErrors.email ? 'border-red-300' : 'border-theme-input-border'
                } placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="you@example.com"
                value={formData.email}
                onChange={handleChange}
                disabled={isLoading}
              />
              {formErrors.email && (
                <p id="email-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.email}</p>
              )}
            </div>

            <fieldset className="grid grid-cols-2 gap-4">
              <legend className="sr-only">Name</legend>
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-theme-text-secondary">
                  First name <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  required
                  aria-invalid={formErrors.firstName ? 'true' : 'false'}
                  aria-describedby={formErrors.firstName ? 'firstName-error' : undefined}
                  className={`mt-1 appearance-none relative block w-full px-3 py-2 border ${
                    formErrors.firstName ? 'border-red-300' : 'border-theme-input-border'
                  } placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                  placeholder="John"
                  value={formData.firstName}
                  onChange={handleChange}
                  disabled={isLoading}
                />
                {formErrors.firstName && (
                  <p id="firstName-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.firstName}</p>
                )}
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-theme-text-secondary">
                  Last name <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  required
                  aria-invalid={formErrors.lastName ? 'true' : 'false'}
                  aria-describedby={formErrors.lastName ? 'lastName-error' : undefined}
                  className={`mt-1 appearance-none relative block w-full px-3 py-2 border ${
                    formErrors.lastName ? 'border-red-300' : 'border-theme-input-border'
                  } placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                  placeholder="Doe"
                  value={formData.lastName}
                  onChange={handleChange}
                  disabled={isLoading}
                />
                {formErrors.lastName && (
                  <p id="lastName-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.lastName}</p>
                )}
              </div>
            </fieldset>

            <div>
              <label htmlFor="badgeNumber" className="block text-sm font-medium text-theme-text-secondary">
                Badge number (optional)
              </label>
              <input
                id="badgeNumber"
                name="badgeNumber"
                type="text"
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-theme-input-border placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="1234"
                value={formData.badgeNumber}
                onChange={handleChange}
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-theme-text-secondary">
                Password <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={formErrors.password ? 'true' : 'false'}
                aria-describedby="password-requirements password-strength"
                className={`mt-1 appearance-none relative block w-full px-3 py-2 border ${
                  formErrors.password ? 'border-red-300' : 'border-theme-input-border'
                } placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="Create a strong password"
                value={formData.password}
                onChange={handleChange}
                onFocus={() => setShowPasswordRequirements(true)}
                disabled={isLoading}
              />

              {/* Password strength indicator */}
              {formData.password && (
                <div className="mt-2" id="password-strength">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-theme-surface-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${getStrengthColor(passwordValidation.strength)}`}
                        style={{
                          width: passwordValidation.strength === 'strong' ? '100%' :
                                 passwordValidation.strength === 'good' ? '75%' :
                                 passwordValidation.strength === 'fair' ? '50%' : '25%'
                        }}
                      />
                    </div>
                    <span className="text-xs text-theme-text-secondary">{getStrengthText(passwordValidation.strength)}</span>
                  </div>
                </div>
              )}

              {formErrors.password && (
                <p className="mt-1 text-sm text-red-600" role="alert">{formErrors.password}</p>
              )}

              {/* Password requirements dropdown */}
              {showPasswordRequirements && (
                <div id="password-requirements" className="mt-2 p-3 bg-theme-surface-secondary rounded-md border border-theme-surface-border">
                  <p className="text-xs font-medium text-theme-text-secondary mb-2">Password requirements:</p>
                  <ul className="text-xs text-theme-text-secondary space-y-1">
                    {passwordRequirements.map((req, index) => (
                      <li key={index} className="flex items-center gap-1">
                        <span className="text-theme-text-muted">-</span>
                        {req}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-theme-text-secondary">
                Confirm password <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={formErrors.confirmPassword ? 'true' : 'false'}
                aria-describedby={formErrors.confirmPassword ? 'confirmPassword-error' : undefined}
                className={`mt-1 appearance-none relative block w-full px-3 py-2 border ${
                  formErrors.confirmPassword ? 'border-red-300' : 'border-theme-input-border'
                } placeholder-theme-text-muted text-theme-text-primary rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="Confirm your password"
                value={formData.confirmPassword}
                onChange={handleChange}
                disabled={isLoading}
              />
              {formErrors.confirmPassword && (
                <p id="confirmPassword-error" className="mt-1 text-sm text-red-600" role="alert">{formErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading || !passwordValidation.isValid}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-theme-text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </button>
          </div>

          <div className="text-center">
            <p className="text-sm text-theme-text-secondary">
              <Link
                to="/login"
                className="font-medium text-indigo-600 hover:text-indigo-700 dark:hover:text-indigo-500"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </form>
      </div>
    </main>
  );
};
