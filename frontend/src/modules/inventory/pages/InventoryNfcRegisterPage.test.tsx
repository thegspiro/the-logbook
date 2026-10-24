/**
 * The NFC tag register.
 *
 * What each test protects:
 *  - the page lists every kind of tag and sends the filters it shows;
 *  - nothing loads while NFC tracking is off, and the page says why;
 *  - lost / found reaches the bulk endpoint for one tag and for a selection;
 *  - unlinking asks first;
 *  - a move offers only targets of the tag's own kind and never its current
 *    one, then calls the move endpoint with the matching field;
 *  - a checklist manager is shown compartment tags only, with no kind filter
 *    and no link to the item-enrolment page it cannot open.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryNfcRegisterPage } from './InventoryNfcRegisterPage';
import type { InventoryNfcRegisterTag } from '../types/nfc';

const { service, granted } = vi.hoisted(() => ({
  granted: { permissions: new Set<string>() },
  service: {
    getNfcSettings: vi.fn(),
    getNfcRegister: vi.fn(),
    exportNfcRegister: vi.fn(),
    bulkUpdateNfcTagStatus: vi.fn(),
    unlinkNfcTag: vi.fn(),
    getNfcMoveTargets: vi.fn(),
    moveNfcTag: vi.fn(),
  },
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (state: { checkPermission: (p: string) => boolean }) => unknown) =>
    select({ checkPermission: (p: string) => granted.permissions.has(p) }),
}));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const tag = (overrides: Partial<InventoryNfcRegisterTag>): InventoryNfcRegisterTag => ({
  id: 'tag-1',
  item_id: 'item-1',
  storage_area_id: null,
  check_compartment_id: null,
  uid_preview: '1180',
  credential_type: 'serial',
  label: 'Inside brim',
  status: 'active',
  linked_by: null,
  linked_by_name: 'Dana Ruiz',
  linked_at: '2026-10-01T14:00:00Z',
  kind: 'item',
  target_name: 'Helmet 12',
  template_name: null,
  last_scanned_at: '2026-10-20T14:00:00Z',
  ...overrides,
});

const TAGS = [
  tag({}),
  tag({
    id: 'tag-2',
    item_id: null,
    check_compartment_id: 'comp-1',
    uid_preview: '33A2',
    label: null,
    status: 'lost',
    kind: 'compartment',
    target_name: 'Cab',
    template_name: 'Engine 1 morning',
    last_scanned_at: null,
  }),
];

const rowFor = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('InventoryNfcRegisterPage', () => {
  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset();
    granted.permissions = new Set(['inventory.manage']);
    service.getNfcSettings.mockResolvedValue({ enabled: true });
    service.getNfcRegister.mockResolvedValue({ items: TAGS, total: 2 });
    service.bulkUpdateNfcTagStatus.mockResolvedValue({ updated: [TAGS[0]], failed: [] });
    service.unlinkNfcTag.mockResolvedValue(undefined);
    service.getNfcMoveTargets.mockResolvedValue([
      { id: 'item-1', name: 'Helmet 12', detail: null },
      { id: 'item-2', name: 'Helmet 13', detail: 'S/N H-13' },
    ]);
    service.moveNfcTag.mockResolvedValue(tag({ item_id: 'item-2' }));
  });

  it('lists every kind of tag and filters by what it is on', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcRegisterPage />);

    expect(await screen.findByText('Helmet 12')).toBeInTheDocument();
    expect(within(rowFor('Cab')).getByText('Compartment · Engine 1 morning')).toBeInTheDocument();
    expect(within(rowFor('Cab')).getByText('Lost')).toBeInTheDocument();
    expect(within(rowFor('Cab')).getByText('Not recorded')).toBeInTheDocument();
    expect(service.getNfcRegister).toHaveBeenCalledWith(
      { kind: undefined, status: undefined, search: undefined },
      50,
      0
    );

    await user.selectOptions(screen.getByLabelText('Tagged'), 'compartment');
    await user.selectOptions(screen.getByLabelText('Status'), 'lost');
    await user.type(screen.getByLabelText('Search'), 'cab');
    await user.click(screen.getByRole('button', { name: 'Search tags' }));
    await waitFor(() =>
      expect(service.getNfcRegister).toHaveBeenLastCalledWith(
        { kind: 'compartment', status: 'lost', search: 'cab' },
        50,
        0
      )
    );
  });

  it('loads nothing while NFC tracking is off, and says why', async () => {
    service.getNfcSettings.mockResolvedValue({ enabled: false });
    renderWithRouter(<InventoryNfcRegisterPage />);
    expect(await screen.findByText(/NFC tag tracking is turned off/)).toBeInTheDocument();
    expect(service.getNfcRegister).not.toHaveBeenCalled();
  });

  it('marks one tag lost and a selection found', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcRegisterPage />);
    await screen.findByText('Helmet 12');

    await user.click(screen.getByRole('button', { name: 'Mark lost: tag …1180' }));
    await waitFor(() => expect(service.bulkUpdateNfcTagStatus).toHaveBeenCalledWith(['tag-1'], 'lost'));

    await user.click(screen.getByLabelText('Select every tag shown'));
    const bar = screen.getByRole('region', { name: 'Actions for selected tags' });
    await user.click(within(bar).getByRole('button', { name: 'Mark found' }));
    await waitFor(() => expect(service.bulkUpdateNfcTagStatus).toHaveBeenLastCalledWith(['tag-1', 'tag-2'], 'active'));
  });

  it('asks before unlinking, and keeps the tag when told to', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcRegisterPage />);
    await screen.findByText('Helmet 12');

    await user.click(screen.getByRole('button', { name: 'Unlink tag …1180' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(service.unlinkNfcTag).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Unlink tag …1180' }));
    await user.click(await screen.findByRole('button', { name: 'Unlink tag' }));
    await waitFor(() => expect(service.unlinkNfcTag).toHaveBeenCalledWith('tag-1'));
  });

  it('moves an item tag onto another item, never onto the one it is on', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcRegisterPage />);
    await screen.findByText('Helmet 12');

    await user.click(screen.getByRole('button', { name: 'Move tag …1180' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(service.getNfcMoveTargets).toHaveBeenCalledWith('item', ''));
    expect(within(dialog).getByRole('radio', { name: /Helmet 12 \(current\)/ })).toBeDisabled();

    await user.click(within(dialog).getByRole('radio', { name: /Helmet 13/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move tag' }));
    await waitFor(() => expect(service.moveNfcTag).toHaveBeenCalledWith('tag-1', { item_id: 'item-2' }));
  });

  it('moves a compartment tag by its compartment field', async () => {
    const user = userEvent.setup();
    service.getNfcMoveTargets.mockResolvedValue([{ id: 'comp-2', name: 'Rear', detail: 'Engine 2' }]);
    renderWithRouter(<InventoryNfcRegisterPage />);
    await screen.findByText('Cab');

    await user.click(screen.getByRole('button', { name: 'Move tag …33A2' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(service.getNfcMoveTargets).toHaveBeenCalledWith('compartment', ''));
    await user.click(await within(dialog).findByRole('radio', { name: /Rear/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move tag' }));
    await waitFor(() => expect(service.moveNfcTag).toHaveBeenCalledWith('tag-2', { check_compartment_id: 'comp-2' }));
  });

  it('shows its own error, not a crash, when the register cannot load', async () => {
    service.getNfcRegister.mockRejectedValue(new Error('Could not load the tag register.'));
    renderWithRouter(<InventoryNfcRegisterPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the tag register.');
  });

  it('shows a checklist manager compartment tags only', async () => {
    granted.permissions = new Set(['inventory.check_manage']);
    renderWithRouter(<InventoryNfcRegisterPage />);

    await screen.findByText('Cab');
    expect(service.getNfcRegister).toHaveBeenCalledWith(
      { kind: 'compartment', status: undefined, search: undefined },
      50,
      0
    );
    expect(screen.queryByLabelText('Tagged')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tag items in bulk/ })).not.toBeInTheDocument();
  });
});
