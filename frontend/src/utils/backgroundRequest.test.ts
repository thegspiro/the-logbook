import { describe, it, expect } from 'vitest';
import { BACKGROUND_REQUEST_CONFIG } from './backgroundRequest';

describe('BACKGROUND_REQUEST_CONFIG', () => {
  it('carries the header the server reads to leave the idle timer alone', () => {
    // backend/app/api/dependencies.py reads this exact name and value.
    expect(BACKGROUND_REQUEST_CONFIG.headers).toEqual({ 'X-Background-Request': '1' });
  });
});
