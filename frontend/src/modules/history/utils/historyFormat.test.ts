import { describe, expect, it } from 'vitest';
import { formatPartialDate, formatPeriod, sanitizeArchiveHtml } from './historyFormat';

describe('formatPartialDate', () => {
  it('shows only as much of the date as is known', () => {
    expect(formatPartialDate('1962-01-01', 'year', false)).toBe('1962');
    expect(formatPartialDate('1962-07-01', 'month', false)).toBe('July 1962');
    expect(formatPartialDate('1962-07-14', 'day', false)).toBe('Jul 14, 1962');
  });

  it('marks an approximate date', () => {
    expect(formatPartialDate('1923-01-01', 'year', true)).toBe('c. 1923');
  });

  it('is empty for no date', () => {
    expect(formatPartialDate(null, 'year', false)).toBe('');
  });
});

describe('formatPeriod', () => {
  const base = {
    start_date: '1951-01-01',
    start_precision: 'year' as const,
    start_circa: false,
    end_date: '1972-01-01',
    end_precision: 'year' as const,
    end_circa: false,
    is_ongoing: false,
  };

  it('spans start to end', () => {
    expect(formatPeriod(base)).toBe('1951 – 1972');
  });

  it('reads present for someone still serving', () => {
    expect(formatPeriod({ ...base, end_date: null, is_ongoing: true })).toBe('1951 – present');
  });
});

describe('sanitizeArchiveHtml', () => {
  it('keeps the archive subset and drops scripts, images and handlers', () => {
    const clean = sanitizeArchiveHtml(
      '<h2>Life</h2><p onclick="x()">Text</p><script>alert(1)</script><img src="x"><a href="javascript:alert(1)">bad</a>'
    );
    expect(clean).toContain('<h2>Life</h2>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('<img');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
  });
});
