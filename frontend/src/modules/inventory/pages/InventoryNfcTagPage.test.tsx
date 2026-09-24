import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryNfcTagPage } from './InventoryNfcTagPage';

const { resolveNfcTag, navigate, params } = vi.hoisted(() => ({
  resolveNfcTag: vi.fn(),
  navigate: vi.fn(),
  params: { code: 'INVTABC123' },
}));

vi.mock('../../../services/api', () => ({ inventoryService: { resolveNfcTag } }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => params, useNavigate: () => navigate };
});

describe('InventoryNfcTagPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params.code = 'INVTABC123';
    resolveNfcTag.mockReset();
    resolveNfcTag.mockResolvedValue({
      matched_field: 'nfc_tag',
      matched_value: 'NFC tag …C123',
      item: { id: 'item-7', name: 'Helmet' },
    });
  });

  it('replaces itself with the tagged item', async () => {
    renderWithRouter(<InventoryNfcTagPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/inventory/items/item-7', { replace: true }));
    expect(resolveNfcTag).toHaveBeenCalledWith({ code: 'INVTABC123' });
  });

  it('explains a tag that is not linked, rather than navigating', async () => {
    resolveNfcTag.mockRejectedValue(
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
    expect(resolveNfcTag).not.toHaveBeenCalled();
  });
});
