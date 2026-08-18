import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NfcTagWriter } from './NfcTagWriter';

interface PendingWrite {
  message: unknown;
  resolve: () => void;
  reject: (err: unknown) => void;
}

let pending: PendingWrite[] = [];

class FakeNDEFReader {
  onreading = null;
  onreadingerror = null;

  write(message: unknown, options?: { signal?: AbortSignal }) {
    return new Promise<void>((resolve, reject) => {
      pending.push({ message, resolve, reject });
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

const URL_UNDER_TEST = 'https://logbook.example.org/events/abc123/check-in';

beforeEach(() => {
  pending = [];
  (window as { NDEFReader?: unknown }).NDEFReader = FakeNDEFReader;
});

afterEach(() => {
  delete (window as { NDEFReader?: unknown }).NDEFReader;
});

describe('NfcTagWriter', () => {
  it('degrades to an explanatory hint instead of vanishing when NFC is unsupported', () => {
    delete (window as { NDEFReader?: unknown }).NDEFReader;
    render(<NfcTagWriter url={URL_UNDER_TEST} targetLabel="Monthly Drill" />);

    expect(screen.getByText(/NFC tags:/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write tag/i })).not.toBeInTheDocument();
  });

  it('writes the check-in URL as a url record and confirms success', async () => {
    const user = userEvent.setup();
    render(<NfcTagWriter url={URL_UNDER_TEST} targetLabel="Monthly Drill" />);

    await user.click(screen.getByRole('button', { name: /write tag/i }));

    expect(await screen.findByText(/hold the back of your phone/i)).toBeInTheDocument();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]?.message).toEqual({ records: [{ recordType: 'url', data: URL_UNDER_TEST }] });

    pending[0]?.resolve();

    expect(await screen.findByText(/tag written/i)).toBeInTheDocument();
    expect(screen.getByText(/Tapping it now opens Monthly Drill check-in/i)).toBeInTheDocument();
  });

  it('shows actionable copy when the radio is off, and offers a retry', async () => {
    const user = userEvent.setup();
    render(<NfcTagWriter url={URL_UNDER_TEST} targetLabel="Monthly Drill" />);

    await user.click(screen.getByRole('button', { name: /write tag/i }));
    await waitFor(() => expect(pending).toHaveLength(1));

    const err = new Error('raw');
    err.name = 'NotReadableError';
    pending[0]?.reject(err);

    expect(await screen.findByText(/switched off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('cancelling returns to the idle prompt without reporting an error', async () => {
    const user = userEvent.setup();
    render(<NfcTagWriter url={URL_UNDER_TEST} targetLabel="Monthly Drill" />);

    await user.click(screen.getByRole('button', { name: /write tag/i }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(await screen.findByRole('button', { name: /write tag/i })).toBeInTheDocument();
    expect(screen.queryByText(/hold the back of your phone/i)).not.toBeInTheDocument();
  });

  it('warns that writing overwrites whatever the tag already held', () => {
    render(<NfcTagWriter url={URL_UNDER_TEST} targetLabel="Monthly Drill" />);
    expect(screen.getByText(/replaces any link already on the tag/i)).toBeInTheDocument();
  });
});
