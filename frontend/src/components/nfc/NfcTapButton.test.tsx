import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { NfcTapButton } from './NfcTapButton';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

let readers: FakeNDEFReader[] = [];

class FakeNDEFReader {
  onreading: ((event: NDEFReadingEvent) => void) | null = null;
  onreadingerror: ((event: Event) => void) | null = null;

  constructor() {
    readers.push(this);
  }

  signal: AbortSignal | undefined;

  scan(options?: { signal?: AbortSignal }) {
    this.signal = options?.signal;
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

  emitUrl(value: string) {
    const bytes = new TextEncoder().encode(value);
    this.onreading?.({
      serialNumber: '00:11:22',
      message: { records: [{ recordType: 'url', data: new DataView(bytes.buffer) }] },
    } as NDEFReadingEvent);
  }
}

function renderButton() {
  return render(
    <MemoryRouter>
      <NfcTapButton />
    </MemoryRouter>
  );
}

beforeEach(() => {
  readers = [];
  mockNavigate.mockClear();
  (window as { NDEFReader?: unknown }).NDEFReader = FakeNDEFReader;
});

afterEach(() => {
  delete (window as { NDEFReader?: unknown }).NDEFReader;
});

describe('NfcTapButton', () => {
  it('renders nothing when Web NFC is unavailable', () => {
    delete (window as { NDEFReader?: unknown }).NDEFReader;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the scan dialog and arms the reader on click', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: /tap tag/i }));

    expect(await screen.findByText(/hold the back of your phone/i)).toBeInTheDocument();
    expect(readers).toHaveLength(1);
  });

  it('navigates to the check-in route when a valid tag is tapped', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /tap tag/i }));
    await waitFor(() => expect(readers).toHaveLength(1));

    readers[0]?.emitUrl(`${window.location.origin}/events/abc123/check-in`);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events/abc123/check-in'));
    await waitFor(() => expect(screen.queryByText(/hold the back of your phone/i)).not.toBeInTheDocument());
    // No armed radio may survive behind the closed dialog.
    expect(readers[0]?.signal?.aborted).toBe(true);
  });

  it('rejects an off-origin tag, keeps scanning, and does not navigate', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /tap tag/i }));
    await waitFor(() => expect(readers).toHaveLength(1));

    readers[0]?.emitUrl('https://evil.example.com/events/abc123/check-in');

    expect(await screen.findByText(/not an event check-in tag/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // The dialog stays open so the member can try another tag.
    expect(screen.getByText(/hold the back of your phone/i)).toBeInTheDocument();
  });

  it('disarms the radio when the dialog is closed', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /tap tag/i }));
    await waitFor(() => expect(readers).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(readers[0]?.signal?.aborted).toBe(true));
    expect(screen.queryByText(/hold the back of your phone/i)).not.toBeInTheDocument();
  });

  it('recovers after an unrecognized tag when a valid one follows', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /tap tag/i }));
    await waitFor(() => expect(readers).toHaveLength(1));

    readers[0]?.emitUrl('https://evil.example.com/events/abc123/check-in');
    expect(await screen.findByText(/not an event check-in tag/i)).toBeInTheDocument();

    readers[0]?.emitUrl(`${window.location.origin}/events/good-id/check-in`);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events/good-id/check-in'));
  });
});
