import { describe, it, expect } from 'vitest';
import { newSlotKey } from './signatureSlotKey';

// The server accepts a key that starts with a letter and is at most 50 characters of a-z, 0-9 and _.
const accepted = /^[a-z][a-z0-9_]{0,49}$/;

describe('newSlotKey', () => {
  it('derives a key from the title', () => {
    expect(newSlotKey('Recording Secretary', new Set())).toBe('recording_secretary');
  });

  it('starts with a letter even when the title starts with a number', () => {
    const key = newSlotKey('2nd Witness', new Set());
    expect(key).toMatch(accepted);
    expect(key).toBe('slot_2nd_witness');
  });

  it('stays within the length the server accepts', () => {
    expect(newSlotKey('x'.repeat(200), new Set())).toMatch(accepted);
  });

  it('keeps a long title with a repeat within the limit', () => {
    const first = newSlotKey('y'.repeat(200), new Set());
    const second = newSlotKey('y'.repeat(200), new Set([first]));
    expect(second).not.toBe(first);
    expect(second).toMatch(accepted);
  });

  it('does not reuse a key that is taken', () => {
    expect(newSlotKey('Clerk', new Set(['clerk']))).toBe('clerk_2');
    expect(newSlotKey('Clerk', new Set(['clerk', 'clerk_2']))).toBe('clerk_3');
  });

  it('copes with a title that has no letters or digits', () => {
    expect(newSlotKey('???', new Set())).toMatch(accepted);
  });
});
