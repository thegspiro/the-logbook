import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollOverflow } from './useScrollOverflow';

/** jsdom does no layout, so the three scroll metrics are pinned by hand. */
const makeScroller = (scrollHeight: number, clientHeight: number, scrollTop = 0) => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  el.scrollTop = scrollTop;
  document.body.appendChild(el);
  return el;
};

const scrollTo = (el: HTMLElement, top: number) => {
  act(() => {
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll'));
  });
};

describe('useScrollOverflow', () => {
  it('reports nothing hidden when the content fits', () => {
    const el = makeScroller(300, 300);
    const { result } = renderHook(() => useScrollOverflow({ current: el }));
    expect(result.current).toEqual({ canScrollUp: false, canScrollDown: false });
  });

  it('reports content below when the list is cut off at the top', () => {
    const el = makeScroller(900, 300);
    const { result } = renderHook(() => useScrollOverflow({ current: el }));
    expect(result.current).toEqual({ canScrollUp: false, canScrollDown: true });
  });

  it('tracks scroll position through the middle to the bottom', () => {
    const el = makeScroller(900, 300);
    const { result } = renderHook(() => useScrollOverflow({ current: el }));

    scrollTo(el, 300);
    expect(result.current).toEqual({ canScrollUp: true, canScrollDown: true });

    scrollTo(el, 600);
    expect(result.current).toEqual({ canScrollUp: true, canScrollDown: false });
  });

  it('treats a sub-pixel shortfall at the bottom as the bottom', () => {
    const el = makeScroller(900, 300);
    const { result } = renderHook(() => useScrollOverflow({ current: el }));
    scrollTo(el, 599);
    expect(result.current.canScrollDown).toBe(false);
  });

  it('does nothing without an element', () => {
    const { result } = renderHook(() => useScrollOverflow({ current: null }));
    expect(result.current).toEqual({ canScrollUp: false, canScrollDown: false });
  });
});
