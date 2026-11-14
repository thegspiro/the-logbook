/**
 * MoveNfcTagDialog names the kind of place a tag moves to, so its wording is
 * built from a noun — and "a item" is what a fixed "a" made of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const mockGetNfcMoveTargets = vi.fn();
const mockMoveNfcTag = vi.fn();
vi.mock('../../../services/api', () => ({
  inventoryService: {
    getNfcMoveTargets: (...a: unknown[]) => mockGetNfcMoveTargets(...a) as unknown,
    moveNfcTag: (...a: unknown[]) => mockMoveNfcTag(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { InventoryNfcTagKind, InventoryNfcTagStatus, NfcCredentialType } from '../../../constants/enums';
import type { InventoryNfcRegisterTag } from '../types/nfc';
import { MoveNfcTagDialog } from './MoveNfcTagDialog';

// The app shell mounts ConfirmProvider; the dialog needs it to ask before discarding a choice.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

const tag = (kind: InventoryNfcTagKind): InventoryNfcRegisterTag => ({
  id: 'tag-1',
  item_id: kind === InventoryNfcTagKind.ITEM ? 'item-1' : null,
  storage_area_id: kind === InventoryNfcTagKind.STORAGE_AREA ? 'area-1' : null,
  check_compartment_id: kind === InventoryNfcTagKind.COMPARTMENT ? 'comp-1' : null,
  uid_preview: 'C903',
  credential_type: NfcCredentialType.SERIAL,
  label: null,
  status: InventoryNfcTagStatus.ACTIVE,
  linked_by: null,
  linked_by_name: null,
  linked_at: '2026-10-20T14:00:00Z',
  kind,
  target_name: 'Somewhere',
  template_name: null,
  last_scanned_at: null,
});

describe('MoveNfcTagDialog wording', () => {
  beforeEach(() => {
    mockGetNfcMoveTargets.mockReset();
    mockGetNfcMoveTargets.mockResolvedValue([]);
  });

  it('says "an item" for an item tag', async () => {
    render(<MoveNfcTagDialog tag={tag(InventoryNfcTagKind.ITEM)} onClose={vi.fn()} onMoved={vi.fn()} />);

    expect(await screen.findByText('Find an item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search for an item' })).toBeInTheDocument();
  });

  it.each([
    [InventoryNfcTagKind.STORAGE_AREA, 'a storage area'],
    [InventoryNfcTagKind.COMPARTMENT, 'a compartment'],
  ])('says "%s" with "a"', async (kind, phrase) => {
    render(<MoveNfcTagDialog tag={tag(kind)} onClose={vi.fn()} onMoved={vi.fn()} />);

    expect(await screen.findByText(`Find ${phrase}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Search for ${phrase}` })).toBeInTheDocument();
  });
});

describe('MoveNfcTagDialog moving', () => {
  beforeEach(() => {
    mockGetNfcMoveTargets.mockReset();
    mockGetNfcMoveTargets.mockResolvedValue([
      { id: 'item-1', name: 'Helmet 1', detail: null },
      { id: 'item-2', name: 'Helmet 2', detail: null },
    ]);
    mockMoveNfcTag.mockReset();
    mockMoveNfcTag.mockResolvedValue({});
  });

  it('names the missing choice instead of greying the button out', async () => {
    const user = userEvent.setup();
    render(<MoveNfcTagDialog tag={tag(InventoryNfcTagKind.ITEM)} onClose={vi.fn()} onMoved={vi.fn()} />);
    await screen.findByText('Helmet 2');
    await user.click(screen.getByRole('button', { name: 'Move tag' }));

    expect(screen.getByRole('group', { name: 'Move to' })).toHaveAccessibleDescription(
      'Choose the item to move the tag to.'
    );
    expect(mockMoveNfcTag).not.toHaveBeenCalled();
  });

  it('puts a refusal of the target on the list, announced', async () => {
    mockMoveNfcTag.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'item_id', message: 'Invalid ID format' }] } },
    });
    const user = userEvent.setup();
    render(<MoveNfcTagDialog tag={tag(InventoryNfcTagKind.ITEM)} onClose={vi.fn()} onMoved={vi.fn()} />);
    await user.click(await screen.findByLabelText('Helmet 2'));
    await user.click(screen.getByRole('button', { name: 'Move tag' }));

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Move to' })).toHaveAccessibleDescription(
        "Move to isn't a value this form accepts."
      )
    );
  });

  it('asks before Cancel drops a chosen place', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MoveNfcTagDialog tag={tag(InventoryNfcTagKind.ITEM)} onClose={onClose} onMoved={vi.fn()} />);
    await user.click(await screen.findByLabelText('Helmet 2'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
