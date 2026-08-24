import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNfcScanner } from './useNfcScanner';

let readers: FakeNDEFReader[] = [];
let scanBehavior: 'resolve' | 'reject' = 'resolve';
let scanRejection: Error | null = null;

class FakeNDEFReader {
  onreading: ((event: NDEFReadingEvent) => void) | null = null;
  onreadingerror: ((event: Event) => void) | null = null;
  signal: AbortSignal | undefined;

  constructor() {
    readers.push(this);
  }

  scan(options?: { signal?: AbortSignal }) {
    this.signal = options?.signal;
    if (scanBehavior === 'reject') return Promise.reject(scanRejection);
    return Promise.resolve();
  }

  write() {
    return Promise.resolve();
  }
  makeReadOnly() {
    return Promise.resolve();
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }

  /** Simulates a tag being tapped, carrying a single url record. */
  emitUrl(value: string) {
    const bytes = new TextEncoder().encode(value);
    this.onreading?.({
      serialNumber: '00:11:22',
      message: {
        records: [{ recordType: 'url', data: new DataView(bytes.buffer) }],
      },
    } as NDEFReadingEvent);
  }
}

function installReader() {
  (window as { NDEFReader?: unknown }).NDEFReader = FakeNDEFReader;
}

beforeEach(() => {
  readers = [];
  scanBehavior = 'resolve';
  scanRejection = null;
});

afterEach(() => {
  delete (window as { NDEFReader?: unknown }).NDEFReader;
  vi.unstubAllGlobals();
});

describe('useNfcScanner', () => {
  it('reports unsupported and surfaces a reason without starting a scan', async () => {
    const onRead = vi.fn();
    const { result } = renderHook(() => useNfcScanner({ onRead }));

    expect(result.current.supported).toBe(false);
    await act(async () => {
      await result.current.start();
    });

    expect(readers).toHaveLength(0);
    expect(result.current.scanning).toBe(false);
    expect(result.current.error).toMatch(/NFC/);
  });

  it('starts scanning and forwards the tag payload', async () => {
    installReader();
    const onRead = vi.fn();
    const { result } = renderHook(() => useNfcScanner({ onRead }));

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.scanning).toBe(true));

    act(() => {
      readers[0]?.emitUrl('https://logbook.example.org/events/abc/check-in');
    });

    expect(onRead).toHaveBeenCalledWith('https://logbook.example.org/events/abc/check-in');
  });

  it('ignores a tag with no readable text instead of dropping the scan', async () => {
    installReader();
    const onRead = vi.fn();
    const { result } = renderHook(() => useNfcScanner({ onRead }));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      readers[0]?.onreading?.({
        serialNumber: '1',
        message: { records: [{ recordType: 'mime' }] },
      } as NDEFReadingEvent);
    });

    expect(onRead).not.toHaveBeenCalled();
    expect(result.current.scanning).toBe(true);
  });

  it('reports the serial number of every tag, text or not', async () => {
    // An ID card's tag ships blank — no NDEF records at all — so its serial
    // number is the only thing that identifies the member holding it.
    installReader();
    const onTag = vi.fn();
    const onRead = vi.fn();
    const { result } = renderHook(() => useNfcScanner({ onRead, onTag }));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      readers[0]?.onreading?.({
        serialNumber: '04:a2:24:5b',
        message: { records: [] },
      } as unknown as NDEFReadingEvent);
    });

    expect(onTag).toHaveBeenCalledWith({ serialNumber: '04:a2:24:5b', payload: null });
    expect(onRead).not.toHaveBeenCalled();
    expect(result.current.scanning).toBe(true);
  });

  it('reports both the serial and the payload for a tag carrying text', async () => {
    installReader();
    const onTag = vi.fn();
    const { result } = renderHook(() => useNfcScanner({ onTag }));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      readers[0]?.emitUrl('https://logbook.example.org/events/abc/check-in');
    });

    expect(onTag).toHaveBeenCalledWith({
      serialNumber: '00:11:22',
      payload: 'https://logbook.example.org/events/abc/check-in',
    });
  });

  it('calls the latest onRead without restarting the scan', async () => {
    installReader();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onRead }) => useNfcScanner({ onRead }), {
      initialProps: { onRead: first },
    });

    await act(async () => {
      await result.current.start();
    });
    rerender({ onRead: second });

    act(() => {
      readers[0]?.emitUrl('https://logbook.example.org/events/abc/check-in');
    });

    expect(readers).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('https://logbook.example.org/events/abc/check-in');
  });

  it('does not arm a second reader when start is called twice', async () => {
    installReader();
    const { result } = renderHook(() => useNfcScanner({ onRead: vi.fn() }));

    await act(async () => {
      await result.current.start();
      await result.current.start();
    });

    expect(readers).toHaveLength(1);
  });

  it('stop aborts the scan', async () => {
    installReader();
    const { result } = renderHook(() => useNfcScanner({ onRead: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });

    expect(readers[0]?.signal?.aborted).toBe(true);
    expect(result.current.scanning).toBe(false);
  });

  it('disarms the radio on unmount', async () => {
    installReader();
    const { result, unmount } = renderHook(() => useNfcScanner({ onRead: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });
    unmount();

    expect(readers[0]?.signal?.aborted).toBe(true);
  });

  it('maps a scan failure to actionable copy and allows a retry', async () => {
    installReader();
    const denied = new Error('raw');
    denied.name = 'NotAllowedError';
    scanBehavior = 'reject';
    scanRejection = denied;

    const { result } = renderHook(() => useNfcScanner({ onRead: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.error).toContain('permission'));
    expect(result.current.scanning).toBe(false);

    // The failed attempt must not leave a stale controller blocking a retry.
    scanBehavior = 'resolve';
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => expect(result.current.scanning).toBe(true));
  });

  it('surfaces a reading error from a damaged tag', async () => {
    installReader();
    const { result } = renderHook(() => useNfcScanner({ onRead: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      readers[0]?.onreadingerror?.(new Event('readingerror'));
    });

    await waitFor(() => expect(result.current.error).toContain('could not be read'));
  });
});
