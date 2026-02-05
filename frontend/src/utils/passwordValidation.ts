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

// Common passwords to reject (subset - backend has full list)
const COMMON_PASSWORDS = [
  'password', '12345678', '123456789', '1234567890', 'qwerty', 'admin',
  'letmein', 'welcome', 'monkey', 'dragon', 'master', 'password123',
  'password1', 'password!', 'iloveyou', 'sunshine', 'princess', 'admin123',
  'qwerty123', 'login', 'passw0rd', 'baseball', 'football', 'shadow',
  'firefighter', 'firehouse', 'firedepart', 'rescue', 'engine', 'ladder',
  'station', 'department', 'emergency', 'medic', 'ems', 'ambulance'
];

// Sequential patterns to reject
const SEQUENTIAL_PATTERNS = [
  '012', '123', '234', '345', '456', '567', '678', '789',
  'abc', 'bcd', 'cde', 'def', 'efg', 'fgh', 'ghi', 'hij',
  'ijk', 'jkl', 'klm', 'lmn', 'mno', 'nop', 'opq', 'pqr',
  'qrs', 'rst', 'stu', 'tuv', 'uvw', 'vwx', 'wxy', 'xyz'
];

// Keyboard patterns to reject
const KEYBOARD_PATTERNS = [
  'qwerty', 'asdfgh', 'zxcvbn', 'qazwsx', 'qweasd', '!@#$%^',
  '1qaz2wsx', '1234qwer', 'asdf1234'
];

/**
 * Validate a password against HIPAA compliance requirements
 */
export function validatePassword(
  password: string,
  requirements: PasswordRequirements = DEFAULT_REQUIREMENTS
): PasswordValidationResult {
  const errors: string[] = [];
  let strengthScore = 0;

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
  if (requirements.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    errors.push('Password must contain at least one special character');
  } else if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    strengthScore += 1;
  }

  // Check for sequential characters
  const passwordLower = password.toLowerCase();
  for (const pattern of SEQUENTIAL_PATTERNS) {
    if (passwordLower.includes(pattern)) {
      errors.push("Password cannot contain sequential characters (e.g., '123', 'abc')");
      break;
    }
  }

  // Check for repeated characters (3+ in a row)
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password cannot contain 3 or more repeated characters');
  }

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
export function getPasswordRequirementsText(
  requirements: PasswordRequirements = DEFAULT_REQUIREMENTS
): string[] {
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
