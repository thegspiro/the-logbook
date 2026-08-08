import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardInset } from './useKeyboardInset';

interface FakeViewport {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners: Record<string, () => void> = {};
  const vv: FakeViewport = {
    height,
    offsetTop,
    addEventListener: vi.fn((evt: string, cb: () => void) => {
      listeners[evt] = cb;
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  return vv;
}

function inset(): string {
  return document.documentElement.style.getPropertyValue('--keyboard-inset');
}

describe('useKeyboardInset', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--keyboard-inset');
    vi.restoreAllMocks();
  });

  it('reports the keyboard height when the visual viewport shrinks', () => {
    installViewport(500);
    renderHook(() => useKeyboardInset());
    expect(inset()).toBe('300px');
  });

  it('reports zero when no keyboard is open', () => {
    installViewport(800);
    renderHook(() => useKeyboardInset());
    expect(inset()).toBe('0px');
  });

  it('ignores sub-keyboard deltas from toolbar transitions', () => {
    // A retracting URL bar changes the visual viewport by well under a
    // keyboard's height; treating that as a keyboard would jitter the layout.
    installViewport(740);
    renderHook(() => useKeyboardInset());
    expect(inset()).toBe('0px');
  });

  it('accounts for a visual viewport scrolled within the layout viewport', () => {
    installViewport(500, 100);
    renderHook(() => useKeyboardInset());
    expect(inset()).toBe('200px');
  });

  it('cleans up the property and listeners on unmount', () => {
    const vv = installViewport(500);
    const { unmount } = renderHook(() => useKeyboardInset());
    unmount();
    expect(inset()).toBe('');
    expect(vv.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('is a no-op where visualViewport is unavailable', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    expect(() => renderHook(() => useKeyboardInset())).not.toThrow();
    expect(inset()).toBe('');
  });
});
