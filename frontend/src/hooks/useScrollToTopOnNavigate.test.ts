import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockLocation = { pathname: '/training', hash: '', search: '', state: null, key: 'k' };
let mockNavigationType = 'PUSH';

vi.mock('react-router', () => ({
  // Mirrors react-router's NavigationType enum, whose values are these strings.
  NavigationType: { Pop: 'POP', Push: 'PUSH', Replace: 'REPLACE' },
  useLocation: () => mockLocation,
  useNavigationType: () => mockNavigationType,
}));

import { useScrollToTopOnNavigate } from './useScrollToTopOnNavigate';

describe('useScrollToTopOnNavigate', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.pathname = '/training';
    mockLocation.hash = '';
    mockNavigationType = 'PUSH';
    Object.defineProperty(window, 'scrollTo', { writable: true, value: scrollTo });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('scrolls to the top on a pushed navigation', () => {
    renderHook(() => useScrollToTopOnNavigate());

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('scrolls to the top when the path changes', () => {
    const { rerender } = renderHook(() => useScrollToTopOnNavigate());
    scrollTo.mockClear();

    mockLocation.pathname = '/training/skills-testing';
    rerender();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('leaves scroll alone on back/forward so the list keeps its place', () => {
    mockNavigationType = 'POP';
    renderHook(() => useScrollToTopOnNavigate());

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('leaves scroll alone when the URL targets an anchor', () => {
    mockLocation.hash = '#section-3';
    renderHook(() => useScrollToTopOnNavigate());

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not re-scroll when nothing relevant changed', () => {
    const { rerender } = renderHook(() => useScrollToTopOnNavigate());
    scrollTo.mockClear();

    rerender();

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
