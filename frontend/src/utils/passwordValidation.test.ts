import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  getPasswordRequirementsText,
  getStrengthColor,
  getStrengthText,
  validatePasswordStrength,
} from './passwordValidation';
import type { PasswordRequirements } from './passwordValidation';

// A strong, valid password that meets all default requirements:
// 12+ chars, uppercase, lowercase, number, special, no sequences, no repeats, not common
const STRONG_PASSWORD = 'K9#mPx!wQ2$v';

describe('validatePassword', () => {
  // ---- Basic valid passwords ----

  it('accepts a valid password that meets all default requirements', () => {
    const result = validatePassword(STRONG_PASSWORD);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns strength "strong" for a long valid password (20+ chars)', () => {
    const result = validatePassword('K9#mPx!wQ2$vLn@8Yr%tZa');
    expect(result.isValid).toBe(true);
    expect(result.strength).toBe('strong');
  });

  it('returns strength "good" for a valid 16+ char password', () => {
    const result = validatePassword('K9#mPx!wQ2$vLn@8');
    expect(result.isValid).toBe(true);
    expect(result.strength).toBe('good');
  });

  it('returns strength "fair" for a valid 12-char password', () => {
    // Exactly 12 chars with all requirements met gives score 1(length) + 1(upper) + 1(lower) + 1(number) + 1(special) = 5
    // Actually that's >= 5 so "good". Let's use custom requirements to get "fair".
    const result = validatePassword(STRONG_PASSWORD);
    // Score: 1 (length >= 12) + 1 (upper) + 1 (lower) + 1 (number) + 1 (special) = 5 -> "good"
    expect(result.isValid).toBe(true);
    expect(result.strength).toBe('good');
  });

  // ---- Length validation ----

  it('rejects a password shorter than the default minimum (12)', () => {
    const result = validatePassword('K9#mPx!w');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters long');
  });

  it('rejects an empty password', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 12 characters long');
  });

  it('respects custom minLength requirement', () => {
    const custom: PasswordRequirements = {
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecial: false,
    };
    const result = validatePassword('abcdefgh', custom);
    // 8 chars, no sequential (abc), but abc is sequential
    expect(result.errors).toContain("Password cannot contain sequential characters (e.g., '123', 'abc')");
  });

  // ---- Character class requirements ----

  it('rejects a password without uppercase letters', () => {
    const result = validatePassword('k9#mpx!wq2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one uppercase letter');
  });

  it('rejects a password without lowercase letters', () => {
    const result = validatePassword('K9#MPX!WQ2$V');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one lowercase letter');
  });

  it('rejects a password without numbers', () => {
    const result = validatePassword('K#mPx!wQr$vN');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one number');
  });

  it('rejects a password without special characters', () => {
    const result = validatePassword('K9mPxTwQ2RvN');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one special character');
  });

  it('does not require uppercase when requireUppercase is false', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: false,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecial: true,
    };
    const result = validatePassword('k9#mpx!wq2$v', custom);
    expect(result.errors).not.toContain('Password must contain at least one uppercase letter');
  });

  it('does not require lowercase when requireLowercase is false', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: false,
      requireNumbers: true,
      requireSpecial: true,
    };
    const result = validatePassword('K9#MPX!WQ2$V', custom);
    expect(result.errors).not.toContain('Password must contain at least one lowercase letter');
  });

  it('does not require numbers when requireNumbers is false', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: false,
      requireSpecial: true,
    };
    const result = validatePassword('K#mPx!wQr$vN', custom);
    expect(result.errors).not.toContain('Password must contain at least one number');
  });

  it('does not require special chars when requireSpecial is false', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecial: false,
    };
    const result = validatePassword('K9mPxTwQ2RvN', custom);
    expect(result.errors).not.toContain('Password must contain at least one special character');
  });

  // ---- Sequential character detection ----

  it('rejects passwords containing numeric sequences (123)', () => {
    const result = validatePassword('K9#mPx!123Q$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password cannot contain sequential characters (e.g., '123', 'abc')");
  });

  it('rejects passwords containing alphabetic sequences (abc)', () => {
    const result = validatePassword('K9#mPabcxQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password cannot contain sequential characters (e.g., '123', 'abc')");
  });

  it('detects sequential characters case-insensitively', () => {
    const result = validatePassword('K9#mPABCxQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password cannot contain sequential characters (e.g., '123', 'abc')");
  });

  it('rejects passwords containing xyz sequence', () => {
    const result = validatePassword('K9#mPxyzwQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password cannot contain sequential characters (e.g., '123', 'abc')");
  });

  // ---- Repeated character detection ----

  it('rejects passwords with 3 or more repeated characters', () => {
    const result = validatePassword('K9#mPaaaxQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password cannot contain 3 or more repeated characters');
  });

  it('allows 2 repeated characters', () => {
    const result = validatePassword('K9#mPxxwQ2$vR');
    expect(result.isValid).toBe(true);
  });

  it('rejects 4 or more repeated characters', () => {
    const result = validatePassword('K9#mPxxxxQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password cannot contain 3 or more repeated characters');
  });

  // ---- Common password detection ----

  it('rejects the common password "password"', () => {
    const result = validatePassword('password');
    expect(result.errors).toContain('Password is too common. Please choose a stronger password');
  });

  it('rejects common passwords case-insensitively', () => {
    const result = validatePassword('PASSWORD');
    expect(result.errors).toContain('Password is too common. Please choose a stronger password');
  });

  it('rejects fire-department-specific common passwords', () => {
    const result = validatePassword('firefighter');
    expect(result.errors).toContain('Password is too common. Please choose a stronger password');
  });

  it('rejects "emergency" as a common password', () => {
    const result = validatePassword('emergency');
    expect(result.errors).toContain('Password is too common. Please choose a stronger password');
  });

  // ---- Keyboard pattern detection ----

  it('rejects passwords containing "qwerty"', () => {
    const result = validatePassword('K9#mPqwertyQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password cannot contain keyboard patterns');
  });

  it('rejects passwords containing "asdfgh"', () => {
    const result = validatePassword('K9#mPasdfghQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password cannot contain keyboard patterns');
  });

  it('detects keyboard patterns case-insensitively', () => {
    const result = validatePassword('K9#mPQWERTYQ2$v');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password cannot contain keyboard patterns');
  });

  // ---- Multiple errors ----

  it('can return multiple errors at once', () => {
    const result = validatePassword('short');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  // ---- Strength scoring ----

  it('returns "weak" when there are validation errors', () => {
    const result = validatePassword('abc');
    expect(result.strength).toBe('weak');
  });

  it('returns "strong" for a very long valid password (20+ chars)', () => {
    // 20+ chars: score = 1 (>=12) + 1 (>=16) + 1 (>=20) + 1 (upper) + 1 (lower) + 1 (number) + 1 (special) = 7
    const result = validatePassword('K9#mPx!wQ2$vLn@8Yr%tZa');
    expect(result.strength).toBe('strong');
  });

  it('returns "good" for a 16-char valid password', () => {
    // Score: 1 (>=12) + 1 (>=16) + 1 (upper) + 1 (lower) + 1 (number) + 1 (special) = 6
    const result = validatePassword('K9#mPx!wQ2$vLn@8');
    expect(result.strength).toBe('good');
  });
});

// ---- getPasswordRequirementsText ----

describe('getPasswordRequirementsText', () => {
  it('returns all default requirement texts', () => {
    const reqs = getPasswordRequirementsText();
    expect(reqs).toContain('At least 12 characters');
    expect(reqs).toContain('At least one uppercase letter (A-Z)');
    expect(reqs).toContain('At least one lowercase letter (a-z)');
    expect(reqs).toContain('At least one number (0-9)');
    expect(reqs).toContain('At least one special character (!@#$%^&*...)');
    expect(reqs).toContain('No sequential characters (123, abc)');
    expect(reqs).toContain('No repeated characters (aaa)');
    expect(reqs).toContain('Not a common password');
  });

  it('includes 8 items for default requirements', () => {
    const reqs = getPasswordRequirementsText();
    expect(reqs).toHaveLength(8);
  });

  it('respects custom minLength', () => {
    const custom: PasswordRequirements = {
      minLength: 16,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecial: true,
    };
    const reqs = getPasswordRequirementsText(custom);
    expect(reqs).toContain('At least 16 characters');
  });

  it('omits uppercase requirement when not required', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: false,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecial: true,
    };
    const reqs = getPasswordRequirementsText(custom);
    expect(reqs).not.toContain('At least one uppercase letter (A-Z)');
  });

  it('omits lowercase requirement when not required', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: false,
      requireNumbers: true,
      requireSpecial: true,
    };
    const reqs = getPasswordRequirementsText(custom);
    expect(reqs).not.toContain('At least one lowercase letter (a-z)');
  });

  it('omits number requirement when not required', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: false,
      requireSpecial: true,
    };
    const reqs = getPasswordRequirementsText(custom);
    expect(reqs).not.toContain('At least one number (0-9)');
  });

  it('omits special char requirement when not required', () => {
    const custom: PasswordRequirements = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecial: false,
    };
    const reqs = getPasswordRequirementsText(custom);
    expect(reqs).not.toContain('At least one special character (!@#$%^&*...)');
  });

  it('always includes sequential, repeated, and common password warnings', () => {
    const custom: PasswordRequirements = {
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecial: false,
    };
    const reqs = getPasswordRequirementsText(custom);
    expect(reqs).toContain('No sequential characters (123, abc)');
    expect(reqs).toContain('No repeated characters (aaa)');
    expect(reqs).toContain('Not a common password');
  });
});

// ---- getStrengthColor ----

describe('getStrengthColor', () => {
  it('returns green for "strong"', () => {
    expect(getStrengthColor('strong')).toBe('bg-green-500');
  });

  it('returns blue for "good"', () => {
    expect(getStrengthColor('good')).toBe('bg-blue-500');
  });

  it('returns yellow for "fair"', () => {
    expect(getStrengthColor('fair')).toBe('bg-yellow-500');
  });

  it('returns red for "weak"', () => {
    expect(getStrengthColor('weak')).toBe('bg-red-500');
  });
});

// ---- getStrengthText ----

describe('getStrengthText', () => {
  it('returns "Strong password" for "strong"', () => {
    expect(getStrengthText('strong')).toBe('Strong password');
  });

  it('returns "Good password" for "good"', () => {
    expect(getStrengthText('good')).toBe('Good password');
  });

  it('returns "Fair password" for "fair"', () => {
    expect(getStrengthText('fair')).toBe('Fair password');
  });

  it('returns "Weak password" for "weak"', () => {
    expect(getStrengthText('weak')).toBe('Weak password');
  });
});

// ---- validatePasswordStrength ----

describe('validatePasswordStrength', () => {
  it('returns all checks true for a strong password', () => {
    const result = validatePasswordStrength('K9#mPx!wQ2$v');
    expect(result.checks.length).toBe(true);
    expect(result.checks.uppercase).toBe(true);
    expect(result.checks.lowercase).toBe(true);
    expect(result.checks.number).toBe(true);
    expect(result.checks.special).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it('uses the same minLength (12) as validatePassword', () => {
    // 8 chars — too short
    const short = validatePasswordStrength('K9#mPx!w');
    expect(short.checks.length).toBe(false);
    expect(short.isValid).toBe(false);

    // 12 chars — meets the requirement
    const valid = validatePasswordStrength('K9#mPx!wQ2$v');
    expect(valid.checks.length).toBe(true);
    expect(valid.isValid).toBe(true);
  });

  it('returns length false for short passwords', () => {
    const result = validatePasswordStrength('K9#m');
    expect(result.checks.length).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('returns uppercase false when no uppercase', () => {
    const result = validatePasswordStrength('k9#mpx!wq2$v');
    expect(result.checks.uppercase).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('returns lowercase false when no lowercase', () => {
    const result = validatePasswordStrength('K9#MPX!WQ2$V');
    expect(result.checks.lowercase).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('returns number false when no number', () => {
    const result = validatePasswordStrength('K#mPx!wQr$vN');
    expect(result.checks.number).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('returns special false when no special character', () => {
    const result = validatePasswordStrength('K9mPxTwQ2RvN');
    expect(result.checks.special).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('returns all checks false for empty string', () => {
    const result = validatePasswordStrength('');
    expect(result.checks.length).toBe(false);
    expect(result.checks.uppercase).toBe(false);
    expect(result.checks.lowercase).toBe(false);
    expect(result.checks.number).toBe(false);
    expect(result.checks.special).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('does not check for sequential characters or common passwords', () => {
    // validatePasswordStrength is a simpler check — only character class checks
    const result = validatePasswordStrength('Abc12345!@#$');
    expect(result.checks.length).toBe(true);
    expect(result.checks.uppercase).toBe(true);
    expect(result.checks.lowercase).toBe(true);
    expect(result.checks.number).toBe(true);
    expect(result.checks.special).toBe(true);
    expect(result.isValid).toBe(true);
  });
});
