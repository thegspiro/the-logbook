import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NfcTagWriteButton } from './NfcTagWriteButton';

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => {
      mockToastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      mockToastError(...args);
    },
  },
}));

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

const APPARATUS_URL = `${window.location.origin}/scheduling/checkin?apparatus=eng-4`;

beforeEach(() => {
  pending = [];
  mockToastSuccess.mockClear();
  mockToastError.mockClear();
  (window as { NDEFReader?: unknown }).NDEFReader = FakeNDEFReader;
});

afterEach(() => {
  delete (window as { NDEFReader?: unknown }).NDEFReader;
});

describe('NfcTagWriteButton', () => {
  it('renders nothing when Web NFC is unavailable', () => {
    delete (window as { NDEFReader?: unknown }).NDEFReader;
    const { container } = render(<NfcTagWriteButton url={APPARATUS_URL} label="Engine 4" />);
    expect(container).toBeEmptyDOMElement();
  });

  // The same rule gates both ends: a tag nothing would honour is not offered.
  it('renders nothing for a URL no tap could reach', () => {
    const { container } = render(
      <NfcTagWriteButton url={`${window.location.origin}/display/ABC123`} label="Bay 1 Kiosk" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an off-origin URL', () => {
    const { container } = render(
      <NfcTagWriteButton url="https://evil.example.com/scheduling/checkin?apparatus=eng-4" label="Engine 4" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('writes the apparatus URL and names the module in the toast', async () => {
    const user = userEvent.setup();
    render(<NfcTagWriteButton url={APPARATUS_URL} label="Engine 4" />);

    await user.click(screen.getByRole('button', { name: /write nfc tag/i }));

    expect(await screen.findByText(/hold to tag/i)).toBeInTheDocument();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]?.message).toEqual({ records: [{ recordType: 'url', data: APPARATUS_URL }] });

    pending[0]?.resolve();

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Tag written — opens Engine 4 shift check-in'));
  });

  it('surfaces a write failure instead of failing silently', async () => {
    const user = userEvent.setup();
    render(<NfcTagWriteButton url={APPARATUS_URL} label="Engine 4" />);

    await user.click(screen.getByRole('button', { name: /write nfc tag/i }));
    await waitFor(() => expect(pending).toHaveLength(1));

    const err = new Error('raw');
    err.name = 'NotReadableError';
    pending[0]?.reject(err);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('switched off')));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // Cleared back to idle so the next attempt is offered normally.
    expect(await screen.findByText(/write nfc tag/i)).toBeInTheDocument();
  });

  it('a second click cancels the pending write without a success toast', async () => {
    const user = userEvent.setup();
    render(<NfcTagWriteButton url={APPARATUS_URL} label="Engine 4" />);

    await user.click(screen.getByRole('button', { name: /write nfc tag/i }));
    await waitFor(() => expect(pending).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /hold to tag/i }));

    expect(await screen.findByText(/write nfc tag/i)).toBeInTheDocument();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
