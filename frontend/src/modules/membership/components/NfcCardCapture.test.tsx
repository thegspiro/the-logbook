import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockWriteText = vi.fn();
const mockCancelWrite = vi.fn();
let scannerSupported = true;
let onTagCallback: ((tag: { serialNumber: string; payload: string | null }) => void) | null = null;

vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: { serialNumber: string; payload: string | null }) => void }) => {
    onTagCallback = options.onTag ?? null;
    return {
      supported: scannerSupported,
      unavailableReason: scannerSupported ? null : 'No NFC here',
      scanning: false,
      error: null,
      start: mockStart,
      stop: mockStop,
    };
  },
}));

vi.mock('../../../hooks/useNfcWriter', () => ({
  useNfcWriter: () => ({
    supported: scannerSupported,
    unavailableReason: null,
    status: 'idle',
    error: null,
    writeUrl: vi.fn(),
    writeText: (...args: unknown[]) => mockWriteText(...args) as unknown,
    cancel: mockCancelWrite,
    reset: vi.fn(),
  }),
}));

import { NfcCardCapture } from './NfcCardCapture';
import { NfcCredentialType } from '../../../constants/enums';
import { CARD_CODE_PREFIX } from '../constants/idCards';

beforeEach(() => {
  vi.clearAllMocks();
  scannerSupported = true;
  onTagCallback = null;
  mockStart.mockResolvedValue(undefined);
  mockWriteText.mockResolvedValue(true);
});

describe('NfcCardCapture', () => {
  it('writes a minted code to a blank card and reports it as written', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NfcCardCapture value="" onChange={onChange} credentialType={NfcCredentialType.SERIAL} />);

    await user.click(screen.getByRole('button', { name: /write a code to a blank card/i }));

    await waitFor(() => expect(mockWriteText).toHaveBeenCalled());
    const written = mockWriteText.mock.calls[0]?.[0] as string;
    expect(written.startsWith(CARD_CODE_PREFIX)).toBe(true);
    expect(onChange).toHaveBeenCalledWith(written, NfcCredentialType.WRITTEN);
  });

  it('does not bind a code the tag never took', async () => {
    // A registration written first and a write that then failed would leave a
    // member holding a blank card the system believes is theirs.
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockWriteText.mockResolvedValue(false);
    render(<NfcCardCapture value="" onChange={onChange} credentialType={NfcCredentialType.SERIAL} />);

    await user.click(screen.getByRole('button', { name: /write a code to a blank card/i }));

    await waitFor(() => expect(mockWriteText).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('records a printed card by its chip serial', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NfcCardCapture value="" onChange={onChange} credentialType={NfcCredentialType.SERIAL} />);

    await user.click(screen.getByRole('button', { name: /read a printed card/i }));
    onTagCallback?.({ serialNumber: '04:a2:24:5b', payload: null });

    expect(onChange).toHaveBeenCalledWith('04A2245B', NfcCredentialType.SERIAL);
  });

  it('keeps the typed field on a device with no NFC radio', () => {
    // Cards are issued from a desk as often as from a phone, and a USB reader
    // types the serial straight into this box.
    scannerSupported = false;
    render(<NfcCardCapture value="" onChange={vi.fn()} credentialType={NfcCredentialType.SERIAL} />);

    expect(screen.getByLabelText(/card serial number/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write a code/i })).not.toBeInTheDocument();
  });

  it('treats a hand-typed value as a chip serial, never as a minted code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NfcCardCapture value="" onChange={onChange} credentialType={NfcCredentialType.SERIAL} />);

    await user.type(screen.getByLabelText(/card serial number/i), '0');

    expect(onChange).toHaveBeenLastCalledWith('0', NfcCredentialType.SERIAL);
  });

  it('disarms both radios on unmount', () => {
    // An orphaned scan reads cards against a form nobody can see; an orphaned
    // write silently overwrites the next tag that passes the phone.
    const { unmount } = render(
      <NfcCardCapture value="" onChange={vi.fn()} credentialType={NfcCredentialType.SERIAL} />
    );
    unmount();

    expect(mockStop).toHaveBeenCalled();
    expect(mockCancelWrite).toHaveBeenCalled();
  });
});
