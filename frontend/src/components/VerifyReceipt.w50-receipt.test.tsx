/**
 * VerifyReceipt — the four states GET /elections/{id}/verify-receipt reports
 * (W50-53, W50-54).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockVerifyReceipt = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    verifyReceipt: (...args: unknown[]) => mockVerifyReceipt(...args) as unknown,
  },
}));

import { VerifyReceipt } from './VerifyReceipt';

const verify = async (receipt: string) => {
  const user = userEvent.setup();
  render(<VerifyReceipt electionId="el1" />);
  if (receipt) await user.type(screen.getByLabelText('Receipt'), receipt);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
};

describe('VerifyReceipt (W50-53, W50-54)', () => {
  beforeEach(() => {
    mockVerifyReceipt.mockReset();
  });

  it('calls the endpoint with the election id and the trimmed receipt', async () => {
    mockVerifyReceipt.mockResolvedValue({
      verified: true,
      counted: true,
      message: 'Your vote has been recorded and is counted',
    });

    await verify('  abc123  ');

    expect(mockVerifyReceipt).toHaveBeenCalledWith('el1', 'abc123');
  });

  it('reports a counted vote', async () => {
    mockVerifyReceipt.mockResolvedValue({
      verified: true,
      counted: true,
      message: 'Your vote has been recorded and is counted',
      voted_at: '2026-07-04T15:30:00Z',
      position: 'Chief',
    });

    await verify('abc123');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Vote counted');
    expect(status).toHaveTextContent('Your vote has been recorded and is counted');
    expect(status).toHaveTextContent('Position: Chief');
    expect(status).toHaveTextContent(/Recorded /);
  });

  it('reports a test vote as recorded but not counted, keyed off counted rather than verified', async () => {
    mockVerifyReceipt.mockResolvedValue({
      verified: true,
      counted: false,
      message: 'This was a test vote. It was recorded but is not counted toward the election results.',
    });

    await verify('abc123');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Test vote — not counted');
    expect(status).not.toHaveTextContent('Vote counted');
    expect(status).toHaveTextContent(/is not counted toward the election results/);
  });

  it('reports a voided vote distinctly from an unknown receipt', async () => {
    mockVerifyReceipt.mockResolvedValue({
      verified: false,
      counted: false,
      voided: true,
      message: 'This vote was voided by an officer',
      voted_at: '2026-07-04T15:30:00Z',
    });

    await verify('abc123');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Vote voided');
    expect(status).toHaveTextContent('This vote was voided by an officer');
    expect(status).not.toHaveTextContent('No matching vote');
  });

  it('reports an unknown receipt', async () => {
    mockVerifyReceipt.mockResolvedValue({
      verified: false,
      counted: false,
      message: 'No matching vote found for this receipt',
    });

    await verify('nope');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('No matching vote');
    expect(status).toHaveTextContent('No matching vote found for this receipt');
  });

  it('refuses an empty receipt without calling the endpoint', async () => {
    await verify('');

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enter the receipt/);
    expect(mockVerifyReceipt).not.toHaveBeenCalled();
  });

  it('shows the request error when the lookup fails', async () => {
    mockVerifyReceipt.mockRejectedValue(new Error('Too many requests'));

    await verify('abc123');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
