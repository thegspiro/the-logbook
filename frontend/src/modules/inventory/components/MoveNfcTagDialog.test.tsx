/**
 * MoveNfcTagDialog names the kind of place a tag moves to, so its wording is
 * built from a noun — and "a item" is what a fixed "a" made of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetNfcMoveTargets = vi.fn();
vi.mock('../../../services/api', () => ({
  inventoryService: {
    getNfcMoveTargets: (...a: unknown[]) => mockGetNfcMoveTargets(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { InventoryNfcTagKind, InventoryNfcTagStatus, NfcCredentialType } from '../../../constants/enums';
import type { InventoryNfcRegisterTag } from '../types/nfc';
import { MoveNfcTagDialog } from './MoveNfcTagDialog';

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
