import { describe, expect, it } from 'vitest';
import { TONE, fillTone } from './tones';

describe('fillTone', () => {
  it.each([
    [7, 7, TONE.green],
    [5, 7, TONE.amber],
    [1, 7, TONE.amber],
    [0, 7, TONE.red],
    [0, 0, TONE.slate],
  ])('%i of %i seats is the right tone', (filled, total, tone) => {
    expect(fillTone(filled, total)).toBe(tone);
  });

  it('no longer marks a nearly full night as red', () => {
    expect(fillTone(5, 7)).not.toBe(TONE.red);
  });
});
