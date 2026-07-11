import { describe, it, expect, vi, afterEach } from 'vitest';
import { prefersPdfOverBrowserPrint } from './printEnvironment';

function mockPointer(coarseNoHover: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarseNoHover && query.includes('coarse'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('prefersPdfOverBrowserPrint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true on a coarse-pointer / no-hover (touch) device', () => {
    mockPointer(true);
    expect(prefersPdfOverBrowserPrint()).toBe(true);
  });

  it('returns false on a device with a fine pointer / hover (desktop)', () => {
    mockPointer(false);
    expect(prefersPdfOverBrowserPrint()).toBe(false);
  });
});
