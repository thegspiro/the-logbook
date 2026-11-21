import { describe, it, expect } from 'vitest';
import { isValidLogoUrl } from './logoUrl';

describe('isValidLogoUrl', () => {
  it('accepts web addresses, same-origin paths and raster images', () => {
    expect(isValidLogoUrl('https://example.org/logo.png')).toBe(true);
    expect(isValidLogoUrl('http://example.org/logo.png')).toBe(true);
    expect(isValidLogoUrl('/api/v1/branding/logo')).toBe(true);
    expect(isValidLogoUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isValidLogoUrl('data:image/webp;base64,AAAA')).toBe(true);
  });

  it('refuses anything that can run script', () => {
    expect(isValidLogoUrl('javascript:alert(1)')).toBe(false);
    expect(isValidLogoUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidLogoUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
  });
});
