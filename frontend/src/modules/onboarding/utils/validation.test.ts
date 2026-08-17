import { describe, it, expect } from 'vitest';
import { checkPasswordStrength, isValidEmail, isValidImageFile, isValidPort, isValidPhoneNumber } from './validation';
import { MAX_AVATAR_SIZE } from '../../../constants/config';

/** Build a File of a given size without allocating the bytes twice. */
function fileOf(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('onboarding validation utils', () => {
  describe('checkPasswordStrength', () => {
    it('counts every rule as passed for a strong password', () => {
      const { checks, passedChecks } = checkPasswordStrength('Str0ng!Passw0rd');
      expect(checks).toEqual({
        length: true,
        uppercase: true,
        lowercase: true,
        number: true,
        special: true,
      });
      expect(passedChecks).toBe(5);
    });

    it('reports every rule as failed for an empty password', () => {
      const { checks, passedChecks } = checkPasswordStrength('');
      expect(Object.values(checks).every((v) => v === false)).toBe(true);
      expect(passedChecks).toBe(0);
    });

    // The length rule is `>= 12`; a boundary that drifts by one is invisible to
    // any test that does not sit exactly on it.
    it('requires 12 characters, not 11', () => {
      expect(checkPasswordStrength('Aa1!' + 'x'.repeat(7)).checks.length).toBe(false);
      expect(checkPasswordStrength('Aa1!' + 'x'.repeat(8)).checks.length).toBe(true);
    });

    it.each([
      ['uppercase', 'aa1!aaaaaaaaaa', 'uppercase'],
      ['lowercase', 'AA1!AAAAAAAAAA', 'lowercase'],
      ['number', 'Aa!!aaaaaaaaaa', 'number'],
      ['special', 'Aa11aaaaaaaaaa', 'special'],
    ] as const)('detects a password missing a %s character', (_label, password, rule) => {
      const { checks } = checkPasswordStrength(password);
      expect(checks[rule]).toBe(false);
      expect(checkPasswordStrength(password).passedChecks).toBe(4);
    });
  });

  describe('isValidEmail', () => {
    it('accepts a normal address', () => {
      expect(isValidEmail('chief@fallschurchfire.org')).toBe(true);
    });

    it('rejects an address with no domain', () => {
      expect(isValidEmail('chief@')).toBe(false);
    });

    it('rejects an address carrying a newline, which would allow header injection', () => {
      expect(isValidEmail('chief@example.com\nBcc: evil@example.com')).toBe(false);
    });
  });

  describe('isValidImageFile', () => {
    it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s', (type) => {
      const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
      expect(isValidImageFile(fileOf(`logo.${ext}`, type, 1024))).toEqual({ valid: true });
    });

    // SVG is excluded deliberately: it is a document format that can carry
    // script, so an uploaded logo would become stored XSS.
    it('rejects SVG, which can carry script', () => {
      const result = isValidImageFile(fileOf('logo.svg', 'image/svg+xml', 1024));
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/valid image file/i);
    });

    it('rejects a non-image MIME type', () => {
      expect(isValidImageFile(fileOf('logo.exe', 'application/x-msdownload', 1024)).valid).toBe(false);
    });

    // MIME type is attacker-controlled, so the extension is checked too. A file
    // claiming image/png but named .php must not pass.
    it('rejects a valid MIME type carrying a mismatched extension', () => {
      const result = isValidImageFile(fileOf('logo.php', 'image/png', 1024));
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid file extension');
    });

    it('rejects a file with no extension at all', () => {
      expect(isValidImageFile(fileOf('logo', 'image/png', 1024)).error).toBe('Invalid file extension');
    });

    it('rejects a file over the maximum size', () => {
      const result = isValidImageFile(fileOf('logo.png', 'image/png', MAX_AVATAR_SIZE + 1));
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/less than 5MB/i);
    });

    it('accepts a file at exactly the maximum size', () => {
      expect(isValidImageFile(fileOf('logo.png', 'image/png', MAX_AVATAR_SIZE)).valid).toBe(true);
    });

    it('accepts but warns about a file over the 2MB recommendation', () => {
      const result = isValidImageFile(fileOf('logo.png', 'image/png', 2 * 1024 * 1024 + 1));
      expect(result.valid).toBe(true);
      expect(result.warning).toMatch(/large/i);
    });

    it('does not warn at exactly the 2MB recommendation', () => {
      expect(isValidImageFile(fileOf('logo.png', 'image/png', 2 * 1024 * 1024))).toEqual({
        valid: true,
      });
    });

    it('matches the extension case-insensitively', () => {
      expect(isValidImageFile(fileOf('LOGO.PNG', 'image/png', 1024)).valid).toBe(true);
    });
  });

  describe('isValidPort', () => {
    it.each([1, 25, 587, 65535])('accepts %i', (port) => {
      expect(isValidPort(port)).toBe(true);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['above the 16-bit range', 65536],
      ['fractional', 587.5],
      ['NaN', Number.NaN],
    ])('rejects %s', (_label, port) => {
      expect(isValidPort(port)).toBe(false);
    });
  });

  describe('isValidPhoneNumber', () => {
    it('accepts a formatted US number', () => {
      expect(isValidPhoneNumber('(703) 555-0100')).toBe(true);
    });

    it('rejects a number containing letters', () => {
      expect(isValidPhoneNumber('703-555-CALL')).toBe(false);
    });
  });
});
