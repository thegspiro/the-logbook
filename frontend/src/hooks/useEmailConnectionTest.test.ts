import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    // Block bodies: an expression body would return the spy's `any` and trip
    // `@typescript-eslint/no-unsafe-return`, and nothing here reads a toast id.
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

import { useEmailConnectionTest } from './useEmailConnectionTest';
import type { EmailConnectionTestResult, EmailServiceSettings } from '../types/user';

const settings = (overrides: Partial<EmailServiceSettings> = {}): EmailServiceSettings => ({
  enabled: true,
  platform: 'gmail',
  smtp_port: 587,
  smtp_encryption: 'tls',
  use_tls: true,
  from_email: 'chief@example.org',
  ...overrides,
});

/** A promise the test resolves when it chooses, standing in for a slow provider. */
const deferred = () => {
  let settle!: (result: EmailConnectionTestResult) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<EmailConnectionTestResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
};

const passed: EmailConnectionTestResult = { success: true, message: 'Signed in', details: {} };

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('useEmailConnectionTest', () => {
  it('reports a passing test', async () => {
    const test = vi.fn().mockResolvedValue(passed);
    const { result } = renderHook(() => useEmailConnectionTest(settings(), test));

    await act(async () => {
      await result.current.runTest();
    });

    expect(toastSuccess).toHaveBeenCalledWith('Signed in');
    expect(result.current.testing).toBe(false);
  });

  it('reports a failing test with the reason the provider gave', async () => {
    const test = vi.fn().mockResolvedValue({
      success: false,
      message: 'SMTP authentication failed.',
      details: {},
    });
    const { result } = renderHook(() => useEmailConnectionTest(settings(), test));

    await act(async () => {
      await result.current.runTest();
    });

    expect(toastError).toHaveBeenCalledWith('SMTP authentication failed.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('holds the testing flag for the life of the request', async () => {
    const { promise, settle } = deferred();
    const test = vi.fn().mockReturnValue(promise);
    const { result } = renderHook(() => useEmailConnectionTest(settings(), test));

    act(() => {
      void result.current.runTest();
    });
    await waitFor(() => expect(result.current.testing).toBe(true));

    await act(async () => {
      settle(passed);
      await promise;
    });
    expect(result.current.testing).toBe(false);
  });

  it('sends the settings as they were when the test started', async () => {
    const { promise, settle } = deferred();
    const test = vi.fn().mockReturnValue(promise);
    const original = settings({ google_app_password: 'original' });
    const { result, rerender } = renderHook(({ current }) => useEmailConnectionTest(current, test), {
      initialProps: { current: original },
    });

    act(() => {
      void result.current.runTest();
    });
    rerender({ current: settings({ google_app_password: 'edited-mid-test' }) });
    await act(async () => {
      settle(passed);
      await promise;
    });

    expect(test).toHaveBeenCalledWith(original);
  });

  // The defect this guard exists for: a 30-second test can outlive the form
  // it describes, and a success toast over a since-replaced password would
  // vouch for a configuration nobody has tested.
  it('discards a passing result when the form changed while it ran', async () => {
    const { promise, settle } = deferred();
    const test = vi.fn().mockReturnValue(promise);
    const { result, rerender } = renderHook(({ current }) => useEmailConnectionTest(current, test), {
      initialProps: { current: settings({ google_app_password: 'original' }) },
    });

    act(() => {
      void result.current.runTest();
    });
    rerender({ current: settings({ google_app_password: 'edited-mid-test' }) });
    await act(async () => {
      settle(passed);
      await promise;
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Email settings changed while the test was running. Test again.');
    expect(result.current.testing).toBe(false);
  });

  it('discards a failing result the same way', async () => {
    const { promise, settle } = deferred();
    const test = vi.fn().mockReturnValue(promise);
    const { result, rerender } = renderHook(({ current }) => useEmailConnectionTest(current, test), {
      initialProps: { current: settings() },
    });

    act(() => {
      void result.current.runTest();
    });
    rerender({ current: settings({ from_email: 'someone-else@example.org' }) });
    await act(async () => {
      settle({ success: false, message: 'SMTP authentication failed.', details: {} });
      await promise;
    });

    expect(toastError).toHaveBeenCalledWith('Email settings changed while the test was running. Test again.');
    expect(toastError).not.toHaveBeenCalledWith('SMTP authentication failed.');
  });

  // A re-render that does not change the settings must not read as an edit,
  // or every test on a page that re-renders would report itself stale.
  it('reports normally when the form is unchanged', async () => {
    const { promise, settle } = deferred();
    const test = vi.fn().mockReturnValue(promise);
    const unchanged = settings();
    const { result, rerender } = renderHook(({ current }) => useEmailConnectionTest(current, test), {
      initialProps: { current: unchanged },
    });

    act(() => {
      void result.current.runTest();
    });
    rerender({ current: unchanged });
    await act(async () => {
      settle(passed);
      await promise;
    });

    expect(toastSuccess).toHaveBeenCalledWith('Signed in');
  });

  it('names the rate limit rather than failing generically', async () => {
    const test = vi.fn().mockRejectedValue({ response: { status: 429 } });
    const { result } = renderHook(() => useEmailConnectionTest(settings(), test));

    await act(async () => {
      await result.current.runTest();
    });

    expect(toastError).toHaveBeenCalledWith('Too many connection tests. Wait a minute and try again.');
  });

  it('names a permission failure', async () => {
    const test = vi.fn().mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(() => useEmailConnectionTest(settings(), test));

    await act(async () => {
      await result.current.runTest();
    });

    expect(toastError).toHaveBeenCalledWith('Permission denied.');
  });

  it('releases the testing flag when the request throws', async () => {
    const test = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useEmailConnectionTest(settings(), test));

    await act(async () => {
      await result.current.runTest();
    });

    expect(result.current.testing).toBe(false);
    expect(toastError).toHaveBeenCalled();
  });
});
