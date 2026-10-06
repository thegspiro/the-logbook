import { describe, it, expect } from 'vitest';
import { safeRedirect } from './browserNavigation';

describe('safeRedirect', () => {
  it('accepts http(s) only', () => {
    expect(safeRedirect('https://claude.ai/cb?code=1')).toBe('https://claude.ai/cb?code=1');
    expect(safeRedirect('http://localhost:33418/callback?code=1')).toBe('http://localhost:33418/callback?code=1');
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect('data:text/html,hi')).toBeNull();
    expect(safeRedirect('not a url')).toBeNull();
  });
});
