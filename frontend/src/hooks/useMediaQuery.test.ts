import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useMediaQuery } from './useMediaQuery';

/**
 * The hook exists to decide *what is rendered* at a breakpoint, so the two
 * things worth pinning are that it reports the query's current state on the
 * very first render — a wrong first answer swaps the layout out from under the
 * reader a frame later — and that it stops listening when the caller unmounts.
 */
type Listener = (event: MediaQueryListEvent) => void;

const createMatchMedia = (initial: boolean) => {
  const listeners = new Set<Listener>();
  const list = {
    matches: initial,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_: string, listener: Listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_: string, listener: Listener) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
  };
  const change = (matches: boolean) => {
    list.matches = matches;
    listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
  };
  return { list, change, listeners };
};

describe('useMediaQuery', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the query state on the first render, not after an effect', () => {
    const { list } = createMatchMedia(true);
    Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => list) });

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    expect(result.current).toBe(true);
  });

  it('follows the query when the viewport changes', () => {
    const { list, change } = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => list) });

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);

    act(() => change(true));

    expect(result.current).toBe(true);
  });

  it('stops listening when the caller unmounts', () => {
    const { list, listeners } = createMatchMedia(true);
    Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => list) });

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(listeners.size).toBe(1);

    unmount();

    expect(listeners.size).toBe(0);
  });

  it('degrades to false where matchMedia does not exist', () => {
    // A prerender pass, or a jsdom that was never given the API — the caller
    // gets a layout that still works rather than a crash on first paint.
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined });

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    expect(result.current).toBe(false);
  });
});
