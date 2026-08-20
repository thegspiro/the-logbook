import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNfcWriter } from './useNfcWriter';

interface WriteCall {
  message: unknown;
  signal: AbortSignal | undefined;
  resolve: () => void;
  reject: (err: unknown) => void;
}

let writeCalls: WriteCall[] = [];

function installReader() {
  class FakeNDEFReader {
    onreading = null;
    onreadingerror = null;
    write(message: unknown, options?: { signal?: AbortSignal }) {
      return new Promise<void>((resolve, reject) => {
        writeCalls.push({ message, signal: options?.signal, resolve, reject });
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    scan() {
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
  }
  (window as { NDEFReader?: unknown }).NDEFReader = FakeNDEFReader;
}

beforeEach(() => {
  writeCalls = [];
});

afterEach(() => {
  delete (window as { NDEFReader?: unknown }).NDEFReader;
  vi.unstubAllGlobals();
});

describe('useNfcWriter', () => {
  it('reports unsupported when Web NFC is missing and refuses to write', async () => {
    const { result } = renderHook(() => useNfcWriter());
    expect(result.current.supported).toBe(false);
    expect(result.current.unavailableReason).toMatch(/NFC/);

    let written: boolean | undefined;
    await act(async () => {
      written = await result.current.writeUrl('https://example.org/events/a/check-in');
    });

    expect(written).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/NFC/);
  });

  it('stays in "waiting" until a tag is actually tapped', async () => {
    installReader();
    const { result } = renderHook(() => useNfcWriter());

    act(() => {
      void result.current.writeUrl('https://example.org/events/a/check-in');
    });

    await waitFor(() => expect(result.current.status).toBe('waiting'));
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.message).toEqual({
      records: [{ recordType: 'url', data: 'https://example.org/events/a/check-in' }],
    });

    await act(async () => {
      writeCalls[0]?.resolve();
    });

    await waitFor(() => expect(result.current.status).toBe('success'));
  });

  it('maps a write failure to actionable copy', async () => {
    installReader();
    const { result } = renderHook(() => useNfcWriter());

    act(() => {
      void result.current.writeUrl('https://example.org/events/a/check-in');
    });
    await waitFor(() => expect(writeCalls).toHaveLength(1));

    const err = new Error('raw detail');
    err.name = 'NotReadableError';
    await act(async () => {
      writeCalls[0]?.reject(err);
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('switched off');
  });

  it('cancel aborts the pending write and returns to idle rather than reporting an error', async () => {
    installReader();
    const { result } = renderHook(() => useNfcWriter());

    act(() => {
      void result.current.writeUrl('https://example.org/events/a/check-in');
    });
    await waitFor(() => expect(result.current.status).toBe('waiting'));

    await act(async () => {
      result.current.cancel();
    });

    expect(writeCalls[0]?.signal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.error).toBeNull();
  });

  it('a second write aborts the first so only one reader stays armed', async () => {
    installReader();
    const { result } = renderHook(() => useNfcWriter());

    act(() => {
      void result.current.writeUrl('https://example.org/events/a/check-in');
    });
    await waitFor(() => expect(writeCalls).toHaveLength(1));

    act(() => {
      void result.current.writeUrl('https://example.org/events/b/check-in');
    });
    await waitFor(() => expect(writeCalls).toHaveLength(2));

    expect(writeCalls[0]?.signal?.aborted).toBe(true);
    expect(writeCalls[1]?.signal?.aborted).toBe(false);
  });

  it('disarms the radio when the component unmounts mid-write', async () => {
    installReader();
    const { result, unmount } = renderHook(() => useNfcWriter());

    act(() => {
      void result.current.writeUrl('https://example.org/events/a/check-in');
    });
    await waitFor(() => expect(writeCalls).toHaveLength(1));

    unmount();
    expect(writeCalls[0]?.signal?.aborted).toBe(true);
  });

  it('reset clears a previous result', async () => {
    installReader();
    const { result } = renderHook(() => useNfcWriter());

    act(() => {
      void result.current.writeUrl('https://example.org/events/a/check-in');
    });
    await waitFor(() => expect(writeCalls).toHaveLength(1));
    await act(async () => {
      writeCalls[0]?.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe('success'));

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });
});
