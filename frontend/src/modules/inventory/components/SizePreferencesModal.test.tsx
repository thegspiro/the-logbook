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

  it("self-service mode: loads the signed-in user's sizes", async () => {
    mockGetMy.mockResolvedValue({ pant_waist: '34', shirt_size: 'l' });
    render(<SizePreferencesModal isOpen onClose={onClose} />);

    expect(await screen.findByText('My Sizes')).toBeInTheDocument();
    expect(await pantWaist()).toHaveValue('34');
    expect(mockGetMy).toHaveBeenCalledTimes(1);
    expect(mockGetMember).not.toHaveBeenCalled();
  });

  it("admin mode: loads a specific member's sizes and titles with their name", async () => {
    render(<SizePreferencesModal isOpen onClose={onClose} userId="u-1" memberName="Jane Doe" />);

    expect(await screen.findByText('Sizes — Jane Doe')).toBeInTheDocument();
    expect(mockGetMember).toHaveBeenCalledWith('u-1');
    expect(mockGetMy).not.toHaveBeenCalled();
  });

  it('starts from a blank, save-ready form when no preferences exist yet (404)', async () => {
    mockGetMy.mockRejectedValue({ response: { status: 404, data: { detail: 'Not found' } } });
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);

    expect(await pantWaist()).toHaveValue('');
    // A 404 is the expected "nothing stored yet" case — Save must stay
    // enabled so a member can create their first row.
    expect(screen.getByRole('button', { name: 'Save Sizes' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));
    await waitFor(() => expect(mockUpsertMy).toHaveBeenCalledTimes(1));
  });

  it('blocks saving after a non-404 load failure, instead of clearing unseen preferences', async () => {
    // Regression test for the bug Codex found on the pass-4 correction round
    // (PR #2422): before this fix, ANY load failure — not just the expected
    // 404 — fell through to the same blank, save-ready form. Once INV-25
    // made every blank field serialize as an explicit `null` (rather than an
    // omitted key), saving that blank form after a transient failure (a
    // timeout, a 500) actively cleared every preference the failed load
    // never got a chance to see.
    mockGetMy.mockRejectedValue({ response: { status: 500, data: { detail: 'boom' } } });
    render(<SizePreferencesModal isOpen onClose={onClose} />);

    expect(await pantWaist()).toHaveValue('');
    const saveButton = await screen.findByRole('button', { name: 'Save Sizes' });
    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load current sizes/i);

    // Even a direct click must not fire the clearing payload while disabled.
    await userEvent.setup().click(saveButton);
    expect(mockUpsertMy).not.toHaveBeenCalled();
  });

  it('recovers from a blocked save once "Try again" succeeds', async () => {
    mockGetMy.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'boom' } } });
    mockGetMy.mockResolvedValueOnce({ pant_waist: '34' });
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Sizes' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(pantWaist()).resolves.toHaveValue('34'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Sizes' })).not.toBeDisabled();
  });

  it('saves: trims values and sends explicit null for empty fields (update payload, not create)', async () => {
    mockGetMy.mockResolvedValue({
      shirt_size: 'l',
      pant_waist: ' 34 ', // should be trimmed
      boot_width: '   ', // whitespace-only -> null
      jacket_size: null, // null -> null
    });
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockUpsertMy).toHaveBeenCalledTimes(1));
    const payload = mockUpsertMy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.shirt_size).toBe('l');
    expect(payload.pant_waist).toBe('34'); // trimmed
    // Every blank field is an explicit `null`, never an omitted/`undefined`
    // key -- this is an upsert of an existing row, and the backend's
    // `exclude_unset=True` dump would otherwise leave the old value in place
    // behind a success toast (CLAUDE.md pitfall #1's update-path shape).
    expect(payload.boot_width).toBeNull(); // whitespace coerced to null
    expect(payload.jacket_size).toBeNull(); // null stays null
    expect(payload.hat_size).toBeNull(); // never set -> still sent as null
    expect(mockToastSuccess).toHaveBeenCalledWith('Sizes saved');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clearing a stored fit back to "No preference" sends an explicit null, not a dropped key', async () => {
    // Regression test for the bug Codex found on PR #2422: a member with a
    // stored garment_fit selecting "No preference" must actually clear the
    // stored value, not silently leave it in place because the key never
    // left the browser.
    mockGetMy.mockResolvedValue({ shirt_size: 'l', garment_fit: 'mens' });
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    // The Fit field is prefilled, so the "Additional sizes" disclosure opens
    // automatically -- no need to expand it by hand.
    const fitSelect = await screen.findByLabelText('Fit');
    expect(fitSelect).toHaveValue('mens');
    await user.selectOptions(fitSelect, 'No preference');

    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockUpsertMy).toHaveBeenCalledTimes(1));
    const payload = mockUpsertMy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.garment_fit).toBeNull();
    expect('garment_fit' in payload).toBe(true);
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
    render(<SizePreferencesModal isOpen onClose={onClose} userId="u-1" memberName="Jane Doe" />);
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

  it('keeps the detail sizes behind a disclosure, collapsed when the member has none', async () => {
    mockGetMy.mockResolvedValue({ shirt_size: 'l', pant_waist: '34' });
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    const toggle = screen.getByRole('button', { name: /Additional sizes/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the disclosure when the member already has detail sizes stored', async () => {
    mockGetMy.mockResolvedValue({ shirt_size: 'l', glove_size: 'm' });
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Additional sizes/ })).toHaveAttribute('aria-expanded', 'true')
    );
  });

  it('saves detail sizes entered through the disclosure', async () => {
    const user = userEvent.setup();
    render(<SizePreferencesModal isOpen onClose={onClose} />);
    await pantWaist();

    await user.click(screen.getByRole('button', { name: /Additional sizes/ }));
    await user.type(screen.getByPlaceholderText('e.g. 7 1/4'), '7 1/2');
    await user.click(screen.getByRole('button', { name: 'Save Sizes' }));

    await waitFor(() => expect(mockUpsertMy).toHaveBeenCalledTimes(1));
    const payload = mockUpsertMy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.hat_size).toBe('7 1/2');
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
