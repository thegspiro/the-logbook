import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryNfcTagPage } from './InventoryNfcTagPage';

const { resolveAnyNfcTag, navigate, params, auth } = vi.hoisted(() => ({
  resolveAnyNfcTag: vi.fn(),
  auth: { canManage: false },
  navigate: vi.fn(),
  params: { code: 'INVTABC123' },
}));

vi.mock('../../../services/api', () => ({ inventoryService: { resolveAnyNfcTag } }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => p === 'inventory.manage' && auth.canManage }),
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => params, useNavigate: () => navigate };
});

describe('InventoryNfcTagPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params.code = 'INVTABC123';
    resolveAnyNfcTag.mockReset();
    auth.canManage = false;
    resolveAnyNfcTag.mockResolvedValue({
      kind: 'item',
      tag_id: 'tag-1',
      tag_uid_preview: 'C123',
      item: { id: 'item-7', name: 'Helmet' },
      storage_area: null,
    });
  });

  it('replaces itself with the tagged item', async () => {
    renderWithRouter(<InventoryNfcTagPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/inventory/items/item-7', { replace: true }));
    expect(resolveAnyNfcTag).toHaveBeenCalledWith({ code: 'INVTABC123' });
  });

  it('explains a tag that is not linked, rather than navigating', async () => {
    resolveAnyNfcTag.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 404, data: { detail: 'This tag is not linked to any item.' } },
      })
    );
    renderWithRouter(<InventoryNfcTagPage />);
    expect(await screen.findByText('This tag is not linked to any item.')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not send a code outside the tag id shape to the server', async () => {
    params.code = 'x';
    renderWithRouter(<InventoryNfcTagPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like');
    expect(resolveAnyNfcTag).not.toHaveBeenCalled();
  });

  it('sends an inventory manager tapping a shelf to put-away with it open', async () => {
    auth.canManage = true;
    resolveAnyNfcTag.mockResolvedValue({
      kind: 'storage_area',
      tag_id: 'tag-2',
      tag_uid_preview: 'AB12',
      item: null,
      storage_area: { id: 'area-3', name: 'Shelf B', label: null, location_id: null },
    });
    renderWithRouter(<InventoryNfcTagPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/inventory/put-away?area=area-3', { replace: true }));
  });

  it('tells anyone else which shelf the tag marks', async () => {
    resolveAnyNfcTag.mockResolvedValue({
      kind: 'storage_area',
      tag_id: 'tag-2',
      tag_uid_preview: 'AB12',
      item: null,
      storage_area: { id: 'area-3', name: 'Shelf B', label: null, location_id: null },
    });
    renderWithRouter(<InventoryNfcTagPage />);
    expect(await screen.findByText('Shelf B')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
