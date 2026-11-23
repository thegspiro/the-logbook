import { describe, expect, it } from 'vitest';
import { TONE, fillTone, readinessLabel, readinessTone } from './tones';

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

describe('readinessTone', () => {
  it.each([
    ['every essential seat filled, optional ones open', 2, 2, 2, 4, TONE.green],
    ['some essential seats open', 1, 2, 3, 4, TONE.amber],
    ['no essential seat filled, an optional one is', 0, 2, 1, 4, TONE.red],
    ['no essential seats: falls back to the fill, empty', 0, 0, 0, 3, TONE.red],
    ['no essential seats: falls back to the fill, full', 0, 0, 3, 3, TONE.green],
  ])('%s', (_case, ef, et, f, t, tone) => {
    expect(readinessTone(ef, et, f, t)).toBe(tone);
  });
});

describe('readinessLabel', () => {
  it('leads with the essential seats when some seats are optional', () => {
    expect(readinessLabel(3, 3, 5, 7)).toBe('Essential 3/3 · 5 of 7 filled');
  });

  it('says only the fill when every seat is essential, or none is', () => {
    expect(readinessLabel(5, 7, 5, 7)).toBe('5 of 7 seats filled');
    expect(readinessLabel(0, 0, 2, 3)).toBe('2 of 3 seats filled');
  });
});
