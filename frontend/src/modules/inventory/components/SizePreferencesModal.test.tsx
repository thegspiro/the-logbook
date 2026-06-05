import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SizePreferencesModal } from './SizePreferencesModal';

const mockGetMy = vi.fn();
const mockGetMember = vi.fn();
const mockUpsertMy = vi.fn();
const mockUpsertMember = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getMySizePreferences: (...args: unknown[]) => mockGetMy(...args) as unknown,
    getMemberSizePreferences: (...args: unknown[]) => mockGetMember(...args) as unknown,
    upsertMySizePreferences: (...args: unknown[]) => mockUpsertMy(...args) as unknown,
    upsertMemberSizePreferences: (...args: unknown[]) => mockUpsertMember(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]): void => {
      mockToastSuccess(...args);
    },
    error: (...args: unknown[]): void => {
      mockToastError(...args);
    },
  },
}));

describe('SizePreferencesModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMy.mockResolvedValue({});
    mockGetMember.mockResolvedValue({});
    mockUpsertMy.mockResolvedValue({});
    mockUpsertMember.mockResolvedValue({});
  });

  // Wait for the load() to resolve and the form (not the spinner) to render.
  const pantWaist = () => screen.findByPlaceholderText('e.g. 34');

  it('does not render when closed', () => {
    render(<SizePreferencesModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByText('My Sizes')).not.toBeInTheDocument();
    expect(mockGetMy).not.toHaveBeenCalled();
  });

  it('self-service mode: loads the signed-in user\'s sizes', async () => {
    mockGetMy.mockResolvedValue({ pant_waist: '34', shirt_size: 'l' });
    render(<SizePreferencesModal isOpen onClose={onClose} />);

    expect(await screen.findByText('My Sizes')).toBeInTheDocument();
    expect(await pantWaist()).toHaveValue('34');
    expect(mockGetMy).toHaveBeenCalledTimes(1);
    expect(mockGetMember).not.toHaveBeenCalled();
  });

  it('admin mode: loads a specific member\'s sizes and titles with their name', async () => {
    render(
      <SizePreferencesModal isOpen onClose={onClose} userId="u-1" memberName="Jane Doe" />,
    );

    expect(await screen.findByText('Sizes — Jane Doe')).toBeInTheDocument();
    expect(mockGetMember).toHaveBeenCalledWith('u-1');
    expect(mockGetMy).not.toHaveBeenCalled();
  });

  it('starts from a blank form when no preferences exist (load rejects)', async () => {
    mockGetMy.mockRejectedValue(new Error('404'));
    render(<SizePreferencesModal isOpen onClose={onClose} />);

    expect(await pantWaist()).toHaveValue('');
  });

  it('saves: trims values and omits empty fields as undefined', async () => {
    mockGetMy.mockResolvedValue({
      shirt_size: 'l',
      pant_waist: ' 34 ', // should be trimmed
      boot_width: '   ', // whitespace-only -> undefined
      jacket_size: null, // null -> undefined
    });
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockUpsertMy).toHaveBeenCalledTimes(1));
    const payload = mockUpsertMy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.shirt_size).toBe('l');
    expect(payload.pant_waist).toBe('34'); // trimmed
    expect(payload.boot_width).toBeUndefined(); // whitespace coerced away
    expect(payload.jacket_size).toBeUndefined(); // null coerced away
    expect(payload.hat_size).toBeUndefined(); // never set
    expect(mockToastSuccess).toHaveBeenCalledWith('Sizes saved');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves typed input in the payload', async () => {
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    const input = await pantWaist();

    await user.type(input, '36');
    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockUpsertMy).toHaveBeenCalledTimes(1));
    const payload = mockUpsertMy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.pant_waist).toBe('36');
  });

  it('admin save targets the member upsert endpoint', async () => {
    const user = userEvent.setup();
    render(
      <SizePreferencesModal isOpen onClose={onClose} userId="u-1" memberName="Jane Doe" />,
    );
    await pantWaist();

    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockUpsertMember).toHaveBeenCalledTimes(1));
    expect(mockUpsertMember.mock.calls[0]?.[0]).toBe('u-1');
    expect(mockUpsertMy).not.toHaveBeenCalled();
  });

  it('shows an error toast and stays open when saving fails', async () => {
    mockUpsertMy.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel closes without saving', async () => {
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUpsertMy).not.toHaveBeenCalled();
  });
});
