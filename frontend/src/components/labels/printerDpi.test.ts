import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { loadPrinterDpiOverride, savePrinterDpiOverride, usePrinterDpi } from './printerDpi';

describe('printer resolution setting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is Auto until chosen, and Auto follows the label size', () => {
    expect(loadPrinterDpiOverride('rollo_2x1')).toBeNull();

    const { result } = renderHook(() => usePrinterDpi('dymo_30252'));

    expect(result.current.override).toBeNull();
    expect(result.current.dpi).toBe(300);
  });

  it('remembers a choice per label size, so a Dymo and a Rollo can differ', () => {
    savePrinterDpiOverride('zebra_2x1', 300);
    savePrinterDpiOverride('rollo_2x1', 203);

    expect(loadPrinterDpiOverride('zebra_2x1')).toBe(300);
    expect(loadPrinterDpiOverride('rollo_2x1')).toBe(203);
    expect(loadPrinterDpiOverride('dymo_30252')).toBeNull();
  });

  it('uses the chosen resolution, and Auto again once it is cleared', () => {
    const { result } = renderHook(() => usePrinterDpi('zebra_2x1'));
    expect(result.current.dpi).toBe(203);

    act(() => result.current.setOverride(300));
    expect(result.current.dpi).toBe(300);
    expect(loadPrinterDpiOverride('zebra_2x1')).toBe(300);

    act(() => result.current.setOverride(null));
    expect(result.current.dpi).toBe(203);
    expect(loadPrinterDpiOverride('zebra_2x1')).toBeNull();
  });

  it('reloads when the label size changes', () => {
    savePrinterDpiOverride('zebra_2x1', 600);
    const { result, rerender } = renderHook(({ id }) => usePrinterDpi(id), { initialProps: { id: 'rollo_2x1' } });
    expect(result.current.override).toBeNull();

    rerender({ id: 'zebra_2x1' });

    expect(result.current.override).toBe(600);
    expect(result.current.dpi).toBe(600);
  });

  it('ignores a stored value that is not one of the offered resolutions', () => {
    localStorage.setItem('labels:printerDpi', JSON.stringify({ rollo_2x1: 150, zebra_2x1: '300', dymo_30252: 300 }));

    expect(loadPrinterDpiOverride('rollo_2x1')).toBeNull();
    expect(loadPrinterDpiOverride('zebra_2x1')).toBeNull();
    expect(loadPrinterDpiOverride('dymo_30252')).toBe(300);
  });

  it('treats malformed storage as Auto', () => {
    localStorage.setItem('labels:printerDpi', 'not json');

    expect(loadPrinterDpiOverride('rollo_2x1')).toBeNull();
  });
});
