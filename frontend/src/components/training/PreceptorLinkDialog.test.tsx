import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { PreceptorLink } from '../../types/training';

const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockSend = vi.fn();
const mockRevoke = vi.fn();
vi.mock('../../services/api', () => ({
  shiftEvaluationService: {
    getPreceptorLink: (...a: unknown[]) => mockGet(...a) as unknown,
    createPreceptorLink: (...a: unknown[]) => mockCreate(...a) as unknown,
    sendPreceptorLink: (...a: unknown[]) => mockSend(...a) as unknown,
    revokePreceptorLink: (...a: unknown[]) => mockRevoke(...a) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PreceptorLinkDialog } from './PreceptorLinkDialog';

const link = (overrides: Partial<PreceptorLink> = {}): PreceptorLink => ({
  id: 'link-1',
  scope_key: 'en-1',
  url: 'https://logbook.test/shift-evaluation/token-1',
  expires_at: '2026-11-17T19:00:00Z',
  created_at: '2026-11-10T19:00:00Z',
  created_by_member: true,
  preceptor_email: null,
  last_sent_at: null,
  email_sent: false,
  ...overrides,
});

const renderDialog = () =>
  renderWithRouter(
    <PreceptorLinkDialog isOpen onClose={vi.fn()} entryId="entry-1" shiftLabel="ACFD Medic 101 · Nov 10, 2026" />
  );

describe('PreceptorLinkDialog', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue(null);
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(link());
    mockSend.mockReset();
    mockSend.mockResolvedValue(link({ preceptor_email: 'p@acfd.test', last_sent_at: '2026-11-10T20:00:00Z' }));
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue(undefined);
  });

  it('makes a link and shows it as a QR code and a link to copy', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByText('No link is open for this shift.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make link' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('entry-1', undefined));
    expect(await screen.findByLabelText('QR code for the preceptor link')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Link' })).toHaveValue('https://logbook.test/shift-evaluation/token-1');
  });

  it('makes and emails a link in one step', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(link({ email_sent: true, preceptor_email: 'p@acfd.test' }));
    renderDialog();

    await user.type(await screen.findByLabelText(/Preceptor.s email/), 'p@acfd.test');
    await user.click(screen.getByRole('button', { name: 'Make and email link' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('entry-1', 'p@acfd.test'));
  });

  it('emails the open link', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(link());
    renderDialog();

    await user.type(await screen.findByLabelText(/Preceptor.s email/), 'p@acfd.test');
    await user.click(screen.getByRole('button', { name: 'Email' }));

    await waitFor(() => expect(mockSend).toHaveBeenCalledWith('entry-1', 'p@acfd.test'));
    expect(await screen.findByText(/Emailed to p@acfd.test/)).toBeInTheDocument();
  });

  it('turns the open link off only after confirming', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(link());
    renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Turn off link' }));
    expect(mockRevoke).not.toHaveBeenCalled();
    // The confirm dialog opens over this one with its own "Turn off link".
    const buttons = await screen.findAllByRole('button', { name: 'Turn off link' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('entry-1'));
    expect(await screen.findByText('No link is open for this shift.')).toBeInTheDocument();
  });
});
