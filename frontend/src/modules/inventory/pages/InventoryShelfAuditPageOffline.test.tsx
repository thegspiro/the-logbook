/**
 * Shelf Audit by NFC without signal: reads are kept on the page, identified
 * when signal returns, or queued with the audit if it is finished first. The
 * online behaviour is in InventoryShelfAuditPage.test.tsx.
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { GenericQueuedItem } from '../../../utils/genericOfflineQueue';
import type { InventoryNfcAuditReplayRequest } from '../types/nfc';

type Tag = { serialNumber: string; payload: string | null };

const { service, scanner, net, queue } = vi.hoisted(() => ({
  service: {
    getNfcSettings: vi.fn(),
    getStorageAreas: vi.fn(),
    resolveAnyNfcTag: vi.fn(),
    createNfcAudit: vi.fn(),
    getNfcAudits: vi.fn(),
    getNfcAudit: vi.fn(),
    applyNfcAudit: vi.fn(),
    getAuditSchedule: vi.fn(),
  },
  scanner: { onTag: null as ((tag: Tag) => void) | null },
  net: { online: true, listeners: new Set<(online: boolean) => void>() },
  queue: new Map<string, GenericQueuedItem>(),
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return { supported: true, unavailableReason: null, scanning: false, error: null, start: vi.fn(), stop: vi.fn() };
  },
}));
vi.mock('../../../utils/genericOfflineQueue', () => ({
  putGenericItem: (item: GenericQueuedItem) => {
    queue.set(item.id, structuredClone(item));
    return Promise.resolve();
  },
}));
vi.mock('../../../stores/pendingSyncStore', () => ({
  usePendingSyncStore: { getState: () => ({ refresh: vi.fn() }) },
}));
vi.mock('../../../hooks/useOnlineStatus', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useOnlineStatus: () => {
      const [online, setOnline] = useState(net.online);
      useEffect(() => {
        net.listeners.add(setOnline);
        return () => {
          net.listeners.delete(setOnline);
        };
      }, []);
      return online;
    },
  };
});

import { InventoryShelfAuditPage } from './InventoryShelfAuditPage';

const SHELF_A = { id: 'area-1', name: 'Shelf A', label: null, location_id: null };
const RESOLVES: Record<string, unknown> = {
  SHELFA: { kind: 'storage_area', tag_id: 't-a', tag_uid_preview: 'LFA', item: null, storage_area: SHELF_A },
  ITEM1: { kind: 'item', tag_id: 't-1', tag_uid_preview: 'TEM1', item: { id: 'item-1', name: 'Helmet' } },
  ITEM2: { kind: 'item', tag_id: 't-2', tag_uid_preview: 'TEM2', item: { id: 'item-2', name: 'Light' } },
};

async function tap(serial: string) {
  await act(async () => {
    scanner.onTag?.({ serialNumber: serial, payload: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setOnline(online: boolean) {
  net.online = online;
  await act(async () => {
    net.listeners.forEach((listener) => listener(online));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const queuedAudit = () => {
  const items = [...queue.values()].filter((item) => item.kind === 'nfc-shelf-audit');
  expect(items).toHaveLength(1);
  return items[0]?.body as InventoryNfcAuditReplayRequest;
};

const auditCard = () => screen.getByRole('region', { name: 'Audit in progress' });

describe('InventoryShelfAuditPage without signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue.clear();
    net.online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => net.online);
    window.history.pushState({}, '', '/inventory/shelf-audit');
    service.getNfcSettings.mockReset();
    service.getNfcSettings.mockResolvedValue({ enabled: true });
    service.getStorageAreas.mockReset();
    service.getStorageAreas.mockResolvedValue([{ ...SHELF_A, is_active: true, location_name: null }]);
    service.resolveAnyNfcTag.mockReset();
    service.resolveAnyNfcTag.mockImplementation((body: { serial_number?: string }) =>
      Promise.resolve(RESOLVES[body.serial_number ?? ''])
    );
    service.createNfcAudit.mockReset();
    service.getNfcAudits.mockReset();
    service.getNfcAudits.mockResolvedValue({ items: [], total: 0 });
    service.getAuditSchedule.mockReset();
    service.getAuditSchedule.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps reads made offline and queues the audit when finished without signal', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryShelfAuditPage />);
    await tap('SHELFA');
    await tap('ITEM1');
    expect(await within(auditCard()).findByText(/1 item\(s\) tapped/)).toBeInTheDocument();

    await setOnline(false);
    await tap('ITEM2');
    await tap('ITEM2');
    expect(within(auditCard()).getByText(/1 tag\(s\) read without signal/)).toBeInTheDocument();
    expect(service.resolveAnyNfcTag).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Finish audit' }));

    await waitFor(() => expect(queue.size).toBe(1));
    const body = queuedAudit();
    expect(body.storage_area_id).toBe('area-1');
    expect(body.tapped).toEqual([{ item_id: 'item-1', tag_id: 't-1' }]);
    expect(body.taps).toEqual([{ code: undefined, serial_number: 'ITEM2' }]);
    expect(body.client_submission_id).toMatch(/^audit-/);
    expect(service.createNfcAudit).not.toHaveBeenCalled();
    // The page is cleared for the next shelf, as after an online audit.
    expect(within(auditCard()).getByText(/No shelf chosen/)).toBeInTheDocument();
  });

  it('can queue an audit whose shelf was only ever tapped offline', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByLabelText('Or pick a shelf');
    await setOnline(false);
    await tap('ITEM1');
    await tap('SHELFA');

    await user.click(screen.getByRole('button', { name: 'Finish audit' }));

    await waitFor(() => expect(queue.size).toBe(1));
    const body = queuedAudit();
    expect(body.storage_area_id).toBeUndefined();
    expect(body.taps).toEqual([
      { code: undefined, serial_number: 'ITEM1' },
      { code: undefined, serial_number: 'SHELFA' },
    ]);
  });

  it('identifies offline reads when signal returns, finding the shelf among them', async () => {
    renderWithRouter(<InventoryShelfAuditPage />);
    await screen.findByLabelText('Or pick a shelf');
    await setOnline(false);
    await tap('ITEM1');
    await tap('SHELFA');
    await tap('ITEM2');

    await setOnline(true);

    expect(await within(auditCard()).findByText(/Auditing/)).toHaveTextContent('Shelf A: 2 item(s) tapped');
    expect(within(auditCard()).getByText('Helmet')).toBeInTheDocument();
    expect(within(auditCard()).getByText('Light')).toBeInTheDocument();
    expect(queue.size).toBe(0);
  });

  it('queues the audit when saving it loses signal', async () => {
    const user = userEvent.setup();
    service.createNfcAudit.mockRejectedValueOnce({ request: {}, message: 'Network Error' });
    renderWithRouter(<InventoryShelfAuditPage />);
    await tap('SHELFA');
    await tap('ITEM1');
    await within(auditCard()).findByText(/1 item\(s\) tapped/);

    await user.click(screen.getByRole('button', { name: 'Finish audit' }));

    await waitFor(() => expect(queue.size).toBe(1));
    expect(queuedAudit()).toMatchObject({
      storage_area_id: 'area-1',
      tapped: [{ item_id: 'item-1', tag_id: 't-1' }],
      taps: [],
    });
  });

  it('keeps a read that loses signal mid-request instead of dropping it', async () => {
    renderWithRouter(<InventoryShelfAuditPage />);
    await tap('SHELFA');
    await within(auditCard()).findByText(/0 item\(s\) tapped/);
    service.resolveAnyNfcTag.mockRejectedValueOnce({ request: {}, message: 'Network Error' });

    await tap('ITEM1');

    expect(within(auditCard()).getByText(/1 tag\(s\) read without signal/)).toBeInTheDocument();
  });
});
