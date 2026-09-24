import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let capturedOnScan: ((text: string) => void) | null = null;

vi.mock('../../../hooks/useHtml5Scanner', () => ({
  useHtml5Scanner: ({ onScan }: { onScan: (text: string) => void }) => {
    capturedOnScan = onScan;
    return {
      scanning: false,
      startScanner: vi.fn(),
      stopScanner: vi.fn(),
      flashlightSupported: false,
      flashlightOn: false,
      toggleFlashlight: vi.fn(),
    };
  },
}));

import { ScanCodeField } from './ScanCodeField';

describe('ScanCodeField', () => {
  const onCode = vi.fn();

  beforeEach(() => {
    onCode.mockReset();
    onCode.mockReturnValue(true);
    capturedOnScan = null;
  });

  const open = () => render(<ScanCodeField viewportId="test-viewport" label="Scan a code" onCode={onCode} />);

  it('submits what a handheld scanner types, trimmed', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Scan a code'), '  SA-000001 {Enter}');

    expect(onCode).toHaveBeenCalledWith('SA-000001');
    expect(screen.getByLabelText('Scan a code')).toHaveValue('');
  });

  it('ignores the camera re-reading one label while it stays in view', () => {
    open();

    act(() => {
      capturedOnScan?.('SA-000001');
      capturedOnScan?.('SA-000001');
      capturedOnScan?.('SA-000002');
    });

    expect(onCode.mock.calls).toEqual([['SA-000001'], ['SA-000002']]);
  });

  it('ignores an empty submission', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Scan a code'), '   {Enter}');

    expect(onCode).not.toHaveBeenCalled();
  });

  it('flashes success once an async handler recognises the code, and not when it does not', async () => {
    const user = userEvent.setup();
    onCode.mockImplementation((code: string) => Promise.resolve(code === 'SA-000001'));
    open();

    await user.type(screen.getByLabelText('Scan a code'), 'NOPE{Enter}');
    expect(screen.queryByTestId('scan-success-flash')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Scan a code'), 'SA-000001{Enter}');
    expect(await screen.findByTestId('scan-success-flash')).toBeInTheDocument();
  });

  it('names the submit button as the caller asks', () => {
    render(<ScanCodeField viewportId="v2" label="Scan" submitLabel="Check" onCode={onCode} />);
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument();
  });
});
