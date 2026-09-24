import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryShelfAuditPage } from './InventoryShelfAuditPage';

type Tag = { serialNumber: string; payload: string | null };

const { service, scanner } = vi.hoisted(() => ({
  service: {
    getNfcSettings: vi.fn(),
    getStorageAreas: vi.fn(),
    resolveAnyNfcTag: vi.fn(),
    createNfcAudit: vi.fn(),
    getNfcAudits: vi.fn(),
    getNfcAudit: vi.fn(),
    applyNfcAudit: vi.fn(),
  },
  scanner: { onTag: null as ((tag: Tag) => void) | null, start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: true,
      unavailableReason: null,
      scanning: false,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));

const SHELF_A = { id: 'area-1', name: 'Shelf A', label: null, location_id: null };
const SHELF_B = { id: 'area-2', name: 'Shelf B', label: null, location_id: null };

const RESOLVES: Record<string, unknown> = {
  SHELFA: { kind: 'storage_area', tag_id: 't-a', tag_uid_preview: 'LFA', item: null, storage_area: SHELF_A },
  SHELFB: { kind: 'storage_area', tag_id: 't-b', tag_uid_preview: 'LFB', item: null, storage_area: SHELF_B },
  ITEM1: { kind: 'item', tag_id: 't-1', tag_uid_preview: 'TEM1', item: { id: 'item-1', name: 'Helmet' } },
  ITEM2: { kind: 'item', tag_id: 't-2', tag_uid_preview: 'TEM2', item: { id: 'item-2', name: 'Light' } },
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: 'audit-1',
  storage_area_id: 'area-1',
  storage_area_name: 'Shelf A',
  expected_count: 2,
  found_count: 1,
  missing_count: 1,
  unexpected_count: 1,
  audited_by: 'u-1',
  audited_by_name: 'Pat Quartermaster',
  audited_at: '2026-09-24T12:00:00Z',
  applied_by: null,
  applied_by_name: null,
  applied_at: null,
  items: [
    {
      id: 'l-1',
      item_id: 'item-3',
      item_name: 'Radio',
      result: 'missing',
      recorded_storage_area_id: 'area-1',
      recorded_storage_area_name: 'Shelf A',
      moved: false,
    },
    {
      id: 'l-2',
      item_id: 'item-2',
      item_name: 'Light',
      result: 'unexpected',
      recorded_storage_area_id: 'area-2',
      recorded_storage_area_name: 'Shelf B',
      moved: false,
    },
    {
      id: 'l-3',
      item_id: 'item-1',
      item_name: 'Helmet',
      result: 'found',
      recorded_storage_area_id: 'area-1',
      recorded_storage_area_name: 'Shelf A',
      moved: false,
    },
  ],
  ...overrides,
});

async function tap(serial: string) {
  await act(async () => {
    scanner.onTag?.({ serialNumber: serial, payload: null });
    await Promise.resolve();
  });
}

describe('InventoryShelfAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/inventory/shelf-audit');
    service.getNfcSettings.mockReset();
    service.getNfcSettings.mockResolvedValue({ enabled: true });
    service.getStorageAreas.mockReset();
    service.getStorageAreas.mockResolvedValue([
      { ...SHELF_A, is_active: true, location_name: null },
      { ...SHELF_B, is_active: true, location_name: null },
    ]);
    service.resolveAnyNfcTag.mockReset();
    service.resolveAnyNfcTag.mockImplementation((body: { serial_number?: string }) =>
      Promise.resolve(RESOLVES[body.serial_number ?? ''])
    );
    service.createNfcAudit.mockReset();
    service.createNfcAudit.mockResolvedValue(detail());
    service.getNfcAudits.mockReset();
    service.getNfcAudits.mockResolvedValue({ items: [], total: 0 });
    service.getNfcAudit.mockReset();
    service.getNfcAudit.mockResolvedValue(detail());
    service.applyNfcAudit.mockReset();
    service.applyNfcAudit.mockResolvedValue(
      detail({
        applied_at: '2026-09-24T12:05:00Z',
        moved_item_ids: ['item-2'],
        skipped: [],
        items: detail().items.map((l) => (l.id === 'l-2' ? { ...l, moved: true } : l)),
      })
    );
    scanner.onTag = null;
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('says so when NFC tracking is off', async () => {
    service.getNfcSettings.mockResolvedValue({ enabled: false });
    renderWithRouter(<InventoryShelfAuditPage />);
    expect(await screen.findByText(/NFC tag tracking is turned off/)).toBeInTheDocument();
  });

  it('asks for the shelf before items', async () => {
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByText(/No shelf chosen/);
    await tap('ITEM1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Tap the shelf first/);
  });

  it('submits every item tapped on the shelf, once each, without logging lookups', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByText(/No shelf chosen/);
    await tap('SHELFA');
    await tap('ITEM1');
    await tap('ITEM1');
    await tap('ITEM2');
    expect(await screen.findByText(/2 item\(s\) tapped/)).toBeInTheDocument();
    expect(service.resolveAnyNfcTag).toHaveBeenCalledWith(expect.objectContaining({ record: false }));

    await user.click(screen.getByRole('button', { name: /Finish audit/ }));
    await waitFor(() => expect(service.createNfcAudit).toHaveBeenCalledTimes(1));
    expect(service.createNfcAudit).toHaveBeenCalledWith({
      storage_area_id: 'area-1',
      tapped: [
        { item_id: 'item-2', tag_id: 't-2' },
        { item_id: 'item-1', tag_id: 't-1' },
      ],
    });
    expect(await screen.findByText(/Nothing has been marked lost/)).toBeInTheDocument();
    expect(screen.getByText('Radio')).toBeInTheDocument();
  });

  it('refuses to switch shelves mid-audit', async () => {
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByText(/No shelf chosen/);
    await tap('SHELFA');
    await tap('ITEM1');
    await tap('SHELFB');
    expect(await screen.findByRole('alert')).toHaveTextContent(/You are auditing Shelf A/);
  });

  it('moves only the unexpected items that were ticked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByText(/No shelf chosen/);
    await tap('SHELFA');
    await tap('ITEM2');
    await user.click(screen.getByRole('button', { name: /Finish audit/ }));

    const move = await screen.findByRole('button', { name: /Move 0 selected onto Shelf A/ });
    expect(move).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Light/ }));
    await user.click(screen.getByRole('button', { name: /Move 1 selected onto Shelf A/ }));
    await waitFor(() => expect(service.applyNfcAudit).toHaveBeenCalledWith('audit-1', ['item-2']));
    expect(await screen.findByText(/moved here/)).toBeInTheDocument();
    // Missing items never get a control: they are listed, not acted on.
    expect(screen.queryByRole('checkbox', { name: /Radio/ })).not.toBeInTheDocument();
  });

  it('shows why an item was not moved', async () => {
    const user = userEvent.setup();
    service.applyNfcAudit.mockResolvedValue(
      detail({
        moved_item_ids: [],
        skipped: [{ item_id: 'item-2', name: 'Light', reason: 'assigned to a member — return it first' }],
      })
    );
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByText(/No shelf chosen/);
    await tap('SHELFA');
    await tap('ITEM2');
    await user.click(screen.getByRole('button', { name: /Finish audit/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Light/ }));
    await user.click(screen.getByRole('button', { name: /Move 1 selected/ }));
    expect(await screen.findByText(/assigned to a member — return it first/)).toBeInTheDocument();
  });

  it('confirms before recording an empty shelf', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByText(/No shelf chosen/);
    await tap('SHELFA');
    await user.click(await screen.findByRole('button', { name: /Finish audit/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep tapping' }));
    expect(service.createNfcAudit).not.toHaveBeenCalled();
  });

  it('opens a recent audit', async () => {
    const user = userEvent.setup();
    service.getNfcAudits.mockResolvedValue({ items: [detail()], total: 1 });
    renderWithRouter(<InventoryShelfAuditPage />);
    await user.click(await screen.findByRole('button', { name: 'View' }));
    await waitFor(() => expect(service.getNfcAudit).toHaveBeenCalledWith('audit-1'));
    expect(await screen.findByRole('heading', { name: 'Shelf A' })).toBeInTheDocument();
  });
});
