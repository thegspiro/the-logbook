import { describe, it, expect } from 'vitest';
import { AxiosHeaders } from 'axios';
import { readDeleteOutcome } from './deleteOutcome';

describe('readDeleteOutcome', () => {
  it('reads a deactivation from the header axios hands back', () => {
    const headers = new AxiosHeaders({ 'X-Delete-Outcome': 'deactivated' });
    expect(readDeleteOutcome({ headers })).toBe('deactivated');
  });

  it('reads a deletion', () => {
    expect(readDeleteOutcome({ headers: { 'x-delete-outcome': 'deleted' } })).toBe('deleted');
  });

  it('treats a missing or unknown header as a deletion, as before the header existed', () => {
    expect(readDeleteOutcome({ headers: {} })).toBe('deleted');
    expect(readDeleteOutcome({ headers: { 'x-delete-outcome': 'archived' } })).toBe('deleted');
    expect(readDeleteOutcome(undefined)).toBe('deleted');
  });
});
