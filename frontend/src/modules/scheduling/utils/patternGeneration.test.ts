import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSuccess = vi.fn();
const mockError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockError(...a);
    },
  },
}));

import { generationSummary, reportGeneration } from './patternGeneration';

beforeEach(() => {
  mockSuccess.mockReset();
  mockError.mockReset();
});

describe('generationSummary', () => {
  it('counts what was created', () => {
    expect(generationSummary({ shifts_created: 1 })).toBe('Generated 1 shift');
    expect(generationSummary({ shifts_created: 11 })).toBe('Generated 11 shifts');
  });

  it('explains zero rather than reporting it as a result', () => {
    expect(generationSummary({ shifts_created: 0 })).toMatch(/^No new shifts\./);
  });
});

describe('reportGeneration', () => {
  it('reports every unfilled driver seat the backend names', () => {
    reportGeneration({ shifts_created: 3, driver_warnings: ['2026-10-04: a', '2026-10-07: b'] });

    expect(mockSuccess).toHaveBeenCalledWith('Generated 3 shifts');
    expect(mockError).toHaveBeenCalledWith('2 driver seats were left unfilled: 2026-10-04: a; 2026-10-07: b', {
      duration: 8000,
    });
  });

  it('stays quiet about drivers when there is nothing to report', () => {
    reportGeneration({ shifts_created: 3, driver_warnings: [] });
    reportGeneration({ shifts_created: 3 });
    expect(mockError).not.toHaveBeenCalled();
  });
});
