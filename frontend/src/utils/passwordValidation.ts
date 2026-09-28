/**
 * Password Validation Utility
 *
 * Validates passwords against HIPAA/NIST SP 800-63B requirements.
 * This should match the backend validation in backend/app/core/security.py
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'fair' | 'good' | 'strong';
}

export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecial: boolean;
}

// Default requirements matching backend config
const DEFAULT_REQUIREMENTS: PasswordRequirements = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecial: true,
};

const PASSWORD_MAX_LENGTH = 128;

// Common passwords to reject (subset - backend has full list)
const COMMON_PASSWORDS = [
  'password',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'admin',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'master',
  'password123',
  'password1',
  'password!',
  'iloveyou',
  'sunshine',
  'princess',
  'admin123',
  'qwerty123',
  'login',
  'passw0rd',
  'baseball',
  'football',
  'shadow',
  'firefighter',
  'firehouse',
  'firedepart',
  'rescue',
  'engine',
  'ladder',
  'station',
  'department',
  'emergency',
  'medic',
  'ems',
  'ambulance',
];

// Sequential patterns to reject
const SEQUENTIAL_PATTERNS = [
  '012',
  '123',
  '234',
  '345',
  '456',
  '567',
  '678',
  '789',
  'abc',
  'bcd',
  'cde',
  'def',
  'efg',
  'fgh',
  'ghi',
  'hij',
  'ijk',
  'jkl',
  'klm',
  'lmn',
  'mno',
  'nop',
  'opq',
  'pqr',
  'qrs',
  'rst',
  'stu',
  'tuv',
  'uvw',
  'vwx',
  'wxy',
  'xyz',
];

// Keyboard patterns to reject
const KEYBOARD_PATTERNS = [
  'qwerty',
  'asdfgh',
  'zxcvbn',
  'qazwsx',
  'qweasd',
  '!@#$%^',
  '1qaz2wsx',
  '1234qwer',
  'asdf1234',
];

/**
 * An ascending run of three such as "123" or "abc", which the backend's
 * `validate_password_strength` refuses. Exported so a screen that lists the
 * rules can check this one before submitting instead of after.
 */
export function hasSequentialCharacters(password: string): boolean {
  const passwordLower = password.toLowerCase();
  return SEQUENTIAL_PATTERNS.some((pattern) => passwordLower.includes(pattern));
}

/** The same character three or more times in a row, which the backend refuses. */
export function hasRepeatedCharacters(password: string): boolean {
  return /(.)\1{2,}/.test(password);
}

/**
 * Validate a password against HIPAA compliance requirements
 */
export function validatePassword(
  password: string,
  requirements: PasswordRequirements = DEFAULT_REQUIREMENTS
): PasswordValidationResult {
  const errors: string[] = [];
  let strengthScore = 0;

  // Check max length to prevent DoS
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      isValid: false,
      errors: [`Password must be no more than ${PASSWORD_MAX_LENGTH} characters long`],
      strength: 'weak' as const,
    };
  }

  // Check length
  if (password.length < requirements.minLength) {
    errors.push(`Password must be at least ${requirements.minLength} characters long`);
  } else {
    strengthScore += 1;
    if (password.length >= 16) strengthScore += 1;
    if (password.length >= 20) strengthScore += 1;
  }

  // Check uppercase
  if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  } else if (/[A-Z]/.test(password)) {
    strengthScore += 1;
  }

  // Check lowercase
  if (requirements.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  } else if (/[a-z]/.test(password)) {
    strengthScore += 1;
  }

  // Check numbers
  if (requirements.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  } else if (/\d/.test(password)) {
    strengthScore += 1;
  }

  // Check special characters
  if (requirements.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password)) {
    errors.push('Password must contain at least one special character');
  } else if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password)) {
    strengthScore += 1;
  }

  if (hasSequentialCharacters(password)) {
    errors.push("Password cannot contain sequential characters (e.g., '123', 'abc')");
  }

  if (hasRepeatedCharacters(password)) {
    errors.push('Password cannot contain 3 or more repeated characters');
  }

  const passwordLower = password.toLowerCase();

  // Check for common passwords
  if (COMMON_PASSWORDS.includes(passwordLower)) {
    errors.push('Password is too common. Please choose a stronger password');
  }

  // Check for keyboard patterns
  for (const pattern of KEYBOARD_PATTERNS) {
    if (passwordLower.includes(pattern)) {
      errors.push('Password cannot contain keyboard patterns');
      break;
    }
  }

  // Calculate strength
  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
  if (errors.length === 0) {
    if (strengthScore >= 7) {
      strength = 'strong';
    } else if (strengthScore >= 5) {
      strength = 'good';
    } else if (strengthScore >= 3) {
      strength = 'fair';
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
  };
}

/**
 * Get password requirements as human-readable text
 */
export function getPasswordRequirementsText(requirements: PasswordRequirements = DEFAULT_REQUIREMENTS): string[] {
  const reqs: string[] = [];

  reqs.push(`At least ${requirements.minLength} characters`);

  if (requirements.requireUppercase) {
    reqs.push('At least one uppercase letter (A-Z)');
  }

  if (requirements.requireLowercase) {
    reqs.push('At least one lowercase letter (a-z)');
  }

  if (requirements.requireNumbers) {
    reqs.push('At least one number (0-9)');
  }

  if (requirements.requireSpecial) {
    reqs.push('At least one special character (!@#$%^&*...)');
  }

  reqs.push('No sequential characters (123, abc)');
  reqs.push('No repeated characters (aaa)');
  reqs.push('Not a common password');

  return reqs;
}

/**
 * Get strength color for UI display
 */
export function getStrengthColor(strength: PasswordValidationResult['strength']): string {
  switch (strength) {
    case 'strong':
      return 'bg-green-500';
    case 'good':
      return 'bg-blue-500';
    case 'fair':
      return 'bg-yellow-500';
    case 'weak':
    default:
      return 'bg-red-500';
  }
}

/**
 * Get strength text for UI display
 */
export function getStrengthText(strength: PasswordValidationResult['strength']): string {
  switch (strength) {
    case 'strong':
      return 'Strong password';
    case 'good':
      return 'Good password';
    case 'fair':
      return 'Fair password';
    case 'weak':
    default:
      return 'Weak password';
  }
}

/**
 * Validate password strength and return individual checks
 * Useful for displaying password requirements checklist in the UI
 *
 * `noSequence` and `noRepeat` are rules the backend enforces
 * (`validate_password_strength`). Without them a password could tick every
 * listed rule, be refused after submitting, and — on the reset page — spend
 * one of the three attempts the reset endpoints allow per five minutes
 * (workflow review W03). They read as met only once something is typed.
 */
export function validatePasswordStrength(password: string) {
  const checks = {
    length: password.length >= DEFAULT_REQUIREMENTS.minLength,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password),
    noSequence: password.length > 0 && !hasSequentialCharacters(password),
    noRepeat: password.length > 0 && !hasRepeatedCharacters(password),
  };

  const isValid = Object.values(checks).every(Boolean);

  return {
    checks,
    isValid,
  };
}

export type PasswordCheckKey = keyof ReturnType<typeof validatePasswordStrength>['checks'];

/**
 * The rules `validatePasswordStrength` checks, labelled for a checklist.
 *
 * One list for every screen that shows one. The reset and change-password
 * screens each typed their own, and both said "At least 8 characters" while
 * the check (and the server) required 12.
 */
export const PASSWORD_CHECKLIST: ReadonlyArray<{ key: PasswordCheckKey; label: string }> = [
  { key: 'length', label: `At least ${DEFAULT_REQUIREMENTS.minLength} characters` },
  { key: 'uppercase', label: 'One uppercase letter' },
  { key: 'lowercase', label: 'One lowercase letter' },
  { key: 'number', label: 'One number' },
  { key: 'special', label: 'One special character' },
  { key: 'noSequence', label: 'No runs like 123 or abc' },
  { key: 'noRepeat', label: 'No character three times in a row' },
];
