import { describe, it, expect } from 'vitest';
import { fitNavItems } from './topNavigationOverflow';

describe('fitNavItems', () => {
  it('keeps every group when the row fits, without reserving room for More', () => {
    // 100 + 4 + 100 + 4 + 100 = 308: fits exactly, although adding a More
    // button would not.
    expect(fitNavItems([100, 100, 100], 80, 308, 4)).toBe(3);
  });

  it('keeps the leading groups that fit beside the More button', () => {
    // More (80) + 4 + 100 + 4 + 100 = 288 fits in 300; a third group would not.
    expect(fitNavItems([100, 100, 100], 80, 300, 4)).toBe(2);
  });

  it('moves everything into More when not even one group fits beside it', () => {
    expect(fitNavItems([100, 100], 80, 150, 4)).toBe(0);
  });

  it('stops at the first group that does not fit, keeping the order', () => {
    // A narrow group after a wide one is not pulled forward: the bar keeps the
    // navigation's order, and More holds a contiguous tail.
    expect(fitNavItems([60, 200, 40], 50, 200, 4)).toBe(1);
  });

  it('treats an unmeasured row as fitting', () => {
    // jsdom has no layout, so every width is 0; the bar must show every group
    // rather than hiding them all behind More.
    expect(fitNavItems([0, 0, 0], 0, 0, 4)).toBe(3);
  });

  it('handles a department with no groups', () => {
    expect(fitNavItems([], 80, 500, 4)).toBe(0);
  });
});
