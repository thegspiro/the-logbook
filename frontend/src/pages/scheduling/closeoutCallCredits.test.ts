import { describe, expect, it } from 'vitest';
import { MAX_MEMBER_CALL_CREDITS, boundMemberCallCredits } from './closeoutCallCredits';

const credit = (i: number, call_count: number) => ({ user_id: `u${i}`, call_count });

describe('boundMemberCallCredits', () => {
  it('matches the server cap', () => {
    expect(MAX_MEMBER_CALL_CREDITS).toBe(100);
  });

  it('sends every member when the crew fits under the cap', () => {
    const credits = [credit(1, 4), credit(2, 3)];
    expect(boundMemberCallCredits(credits, 4)).toEqual({ credits, error: null });
  });

  it('sends only the members adjusted down when the crew is over the cap', () => {
    // A member left out is credited with the apparatus count by the server, so
    // only the exceptions need to travel.
    const credits = Array.from({ length: 150 }, (_, i) => credit(i, i === 7 ? 1 : 5));
    expect(boundMemberCallCredits(credits, 5)).toEqual({ credits: [credit(7, 1)], error: null });
  });

  it('refuses when more members were adjusted than one close-out can carry', () => {
    const credits = Array.from({ length: 120 }, (_, i) => credit(i, 1));
    const result = boundMemberCallCredits(credits, 5);
    expect(result.credits).toEqual([]);
    expect(result.error).toBe(
      'A close-out can adjust the call credit of at most 100 members. 120 are adjusted; credit the rest with the full count.'
    );
  });
});
