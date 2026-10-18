import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockStatus = vi.fn();
const mockSign = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getSignatureStatus: (...a: unknown[]) => mockStatus(...a) as unknown,
    sign: (...a: unknown[]) => mockSign(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { SignaturesPanel } from './SignaturesPanel';
import type { MinutesStatus, SignatureStatus } from '../types/minutes';

const unsigned: SignatureStatus = {
  version: 1,
  slots: [
    { key: 'recording_secretary', title: 'Recording Secretary', can_sign: true, signature: null },
    { key: 'presiding_officer', title: 'Presiding Officer', can_sign: false, signature: null },
  ],
};

const signedOne: SignatureStatus = {
  version: 1,
  slots: [
    {
      key: 'recording_secretary',
      title: 'Recording Secretary',
      can_sign: false,
      signature: {
        id: 's1',
        slot_key: 'recording_secretary',
        slot_title: 'Recording Secretary',
        signed_name: 'Pat Chief',
        signed_at: '2026-10-16T01:30:00Z',
        intact: true,
      },
    },
    { key: 'presiding_officer', title: 'Presiding Officer', can_sign: false, signature: null },
  ],
};

describe('SignaturesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockReset();
    mockStatus.mockResolvedValue(unsigned);
    mockSign.mockReset();
    mockSign.mockResolvedValue({});
  });

  const show = (status: MinutesStatus = 'approved') =>
    render(<SignaturesPanel minutesId="m1" minutesTitle="October meeting" status={status} version="v1" defaultOpen />);

  it.each<MinutesStatus>(['draft', 'submitted', 'rejected'])(
    'asks for nothing before the minutes are adopted (%s)',
    async (status) => {
      show(status);
      expect(screen.queryByRole('heading', { name: /Signatures/ })).toBeNull();
      expect(mockStatus).not.toHaveBeenCalled();
    }
  );

  it('lists each slot and how many are signed', async () => {
    show();
    expect(await screen.findByText('Recording Secretary')).toBeInTheDocument();
    expect(screen.getByText('Presiding Officer')).toBeInTheDocument();
    expect(screen.getByText(/0 of 2 signed · adopted version 1/)).toBeInTheDocument();
  });

  it('offers to sign only the slots the member may sign', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Sign as Recording Secretary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign as Presiding Officer' })).toBeNull();
    expect(screen.getAllByText('Waiting for a signature')).toHaveLength(2);
  });

  it('shows who signed and when, in the department’s zone', async () => {
    mockStatus.mockResolvedValue(signedOne);
    show();

    expect(await screen.findByText('Pat Chief')).toBeInTheDocument();
    expect(screen.getByText(/October 15, 2026 at 8:30 PM/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 signed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign as/ })).toBeNull();
  });

  it('warns when a signature was given on a different version', async () => {
    mockStatus.mockResolvedValue({
      ...signedOne,
      slots: signedOne.slots.map((slot) =>
        slot.signature ? { ...slot, signature: { ...slot.signature, intact: false } } : slot
      ),
    });
    show();

    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the version now on file');
  });

  it('opens the signing dialog for the slot and reloads after a signature', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Sign as Recording Secretary' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Sign as Recording Secretary' })).toBeInTheDocument();

    mockStatus.mockResolvedValue(signedOne);
    await user.type(within(dialog).getByLabelText('Type your full name'), 'Pat Chief');
    await user.type(within(dialog).getByLabelText('Confirm your password'), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Sign the minutes' }));

    expect(mockSign).toHaveBeenCalledWith('m1', 'recording_secretary', 'Pat Chief', 'secret');
    expect(await screen.findByText(/1 of 2 signed/)).toBeInTheDocument();
  });

  it('shows nothing when the department has asked for no signatures or the status cannot be read', async () => {
    mockStatus.mockResolvedValue({ version: 1, slots: [] });
    const { container } = show();
    await vi.waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
