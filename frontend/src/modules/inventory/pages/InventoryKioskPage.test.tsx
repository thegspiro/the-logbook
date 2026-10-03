import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryKioskPage, MEMBER_TIMEOUT_MS } from './InventoryKioskPage';

type Tag = { serialNumber: string; payload: string | null };

const { service, scanner, state } = vi.hoisted(() => ({
  service: {
    kioskIdentify: vi.fn(),
    kioskPreview: vi.fn(),
    kioskCheckout: vi.fn(),
    kioskReturn: vi.fn(),
  },
  scanner: { onTag: null as ((tag: Tag) => void) | null, start: vi.fn(), stop: vi.fn() },
  state: { nfc: true, cards: true },
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../hooks/useInventoryNfcEnabled', () => ({
  useInventoryNfcEnabled: () => ({ enabled: state.nfc, loading: false, refresh: vi.fn() }),
}));
vi.mock('../../../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (t: string) => t === 'nfc-id-cards' && state.cards,
  }),
}));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: true,
      unavailableReason: null,
      scanning: true,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));

const CARD = { serialNumber: '04:aa:11:bb', payload: null };
const ITEM = { serialNumber: '04:77:00:01', payload: null };

async function tap(tag: Tag) {
  await act(async () => {
    scanner.onTag?.(tag);
    await Promise.resolve();
  });
}

const me = (loans: unknown[] = []) => ({ member_name: 'Morgan Tester', loans });

/** A refusal as the API sends it: a 409 carrying the reason and a support code. */
function refusal(detail: string) {
  return Object.assign(new Error(detail), {
    response: { status: 409, statusText: 'Conflict', data: { detail, code: 'LB-API-409' } },
  });
}

async function identified() {
  renderWithRouter(<InventoryKioskPage />);
  await tap(CARD);
  expect(await screen.findByText('Hi, Morgan Tester')).toBeInTheDocument();
}

describe('InventoryKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { nfc: true, cards: true });
    service.kioskIdentify.mockReset();
    service.kioskIdentify.mockResolvedValue(me());
    service.kioskPreview.mockReset();
    service.kioskPreview.mockResolvedValue({
      action: 'checkout',
      item_id: 'item-1',
      item_name: 'Radio',
      due_at: '2026-10-09T12:00:00Z',
    });
    service.kioskCheckout.mockReset();
    service.kioskCheckout.mockResolvedValue({
      action: 'checkout',
      checkout_id: 'co-1',
      item_id: 'item-1',
      item_name: 'Radio',
      member_name: 'Morgan Tester',
      due_at: '2026-10-09T12:00:00Z',
      damaged: false,
    });
    service.kioskReturn.mockReset();
    service.kioskReturn.mockResolvedValue({
      action: 'return',
      checkout_id: 'co-1',
      item_id: 'item-1',
      item_name: 'Radio',
      member_name: 'Morgan Tester',
      due_at: null,
      damaged: true,
    });
    scanner.onTag = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['NFC tag tracking', { nfc: false }],
    ['NFC ID cards', { cards: false }],
  ])('says what is missing when %s is off', async (label, overrides) => {
    Object.assign(state, overrides);
    renderWithRouter(<InventoryKioskPage />);
    expect(await screen.findByText(new RegExp(`needs ${label} turned on`))).toBeInTheDocument();
  });

  // Opening the kiosk takes inventory.kiosk; the switch takes the settings
  // grant, so "Turn on NFC tags" sent a kiosk officer to Access Denied.
  it('says who can turn NFC tags on when they are off', async () => {
    state.nfc = false;
    renderWithRouter(<InventoryKioskPage />);
    const notice = await screen.findByText(/needs NFC tag tracking turned on/);
    expect(notice).toHaveTextContent('An administrator can turn it on under NFC Tags.');
    expect(screen.getByRole('link', { name: 'NFC Tags' })).toHaveAttribute('href', '/inventory/admin/nfc');
  });

  it('greets the member by card and lists what they have out', async () => {
    service.kioskIdentify.mockResolvedValue(
      me([{ checkout_id: 'co-9', item_id: 'i', item_name: 'Light', checked_out_at: 'x', due_at: null }])
    );
    await identified();
    expect(service.kioskIdentify).toHaveBeenCalledWith({ code: undefined, serial_number: '04AA11BB' });
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('no due date')).toBeInTheDocument();
  });

  it('lends an item after confirming, sending the card with it', async () => {
    const user = userEvent.setup();
    await identified();
    await tap(ITEM);
    expect(await screen.findByText('Borrow Radio?')).toBeInTheDocument();
    expect(screen.getByText(/Due back/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Borrow it' }));
    await waitFor(() =>
      expect(service.kioskCheckout).toHaveBeenCalledWith({
        card: { code: undefined, serial_number: '04AA11BB' },
        item: { code: undefined, serial_number: '04770001' },
      })
    );
    expect(await screen.findByText(/Radio is yours until/)).toBeInTheDocument();
    // The list is re-read so the new loan shows.
    expect(service.kioskIdentify).toHaveBeenCalledTimes(2);
  });

  it('takes an item back and records damage with a note', async () => {
    const user = userEvent.setup();
    service.kioskPreview.mockResolvedValue({ action: 'return', item_id: 'item-1', item_name: 'Radio', due_at: null });
    await identified();
    await tap(ITEM);
    await user.click(await screen.findByRole('button', { name: /Yes, it's damaged/ }));
    const returnButton = screen.getByRole('button', { name: 'Return as damaged' });
    expect(returnButton).toBeDisabled();
    await user.type(screen.getByLabelText('Describe the damage'), 'Cracked antenna');
    await user.click(returnButton);
    await waitFor(() =>
      expect(service.kioskReturn).toHaveBeenCalledWith(
        expect.objectContaining({ damaged: true, damage_notes: 'Cracked antenna' })
      )
    );
    expect(await screen.findByText(/Thanks for reporting the damage/)).toBeInTheDocument();
  });

  it('returns an undamaged item without asking for a note', async () => {
    const user = userEvent.setup();
    service.kioskPreview.mockResolvedValue({ action: 'return', item_id: 'item-1', item_name: 'Radio', due_at: null });
    await identified();
    await tap(ITEM);
    await user.click(await screen.findByRole('button', { name: 'No, return it' }));
    await waitFor(() =>
      expect(service.kioskReturn).toHaveBeenCalledWith(
        expect.objectContaining({ damaged: false, damage_notes: undefined })
      )
    );
  });

  it('shows the reason a tap was refused', async () => {
    service.kioskPreview.mockRejectedValue(new Error('Radio cannot be checked out at the kiosk. Ask a quartermaster.'));
    await identified();
    // As on the server: an item's tag is not anybody's card.
    service.kioskIdentify.mockRejectedValue(refusal('This card is not registered to a member.'));
    await tap(ITEM);
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be checked out at the kiosk');
    expect(screen.getByText('Hi, Morgan Tester')).toBeInTheDocument();
  });

  it('Done forgets the member, so the next tap is a card again', async () => {
    const user = userEvent.setup();
    await identified();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Tap your ID card to start')).toBeInTheDocument();
    await tap(ITEM);
    await waitFor(() => expect(service.kioskIdentify).toHaveBeenCalledTimes(2));
    expect(service.kioskPreview).not.toHaveBeenCalled();
  });

  it('forgets the member after a minute without a tap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await identified();
    await act(async () => {
      vi.advanceTimersByTime(MEMBER_TIMEOUT_MS + 100);
    });
    expect(await screen.findByText('Tap your ID card to start')).toBeInTheDocument();
    expect(screen.queryByText('Hi, Morgan Tester')).not.toBeInTheDocument();
  });

  // A refusal is the kiosk's answer to the member, not a fault for IT: the
  // support code appended to other errors means nothing at a shared tablet.
  it('shows a refusal in the words the server gave, without a support code', async () => {
    await identified();
    service.kioskPreview.mockRejectedValue(refusal('Radio is not available (checked out).'));
    service.kioskIdentify.mockRejectedValue(refusal('This card is not registered to a member.'));
    await tap(ITEM);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Radio is not available \(checked out\)\.$/);
  });

  // Cards are issued by serial by default and carry no code, so the next
  // member's tap reached the item lookup and read "This tag is not linked to
  // anything" until the previous member pressed Done or a minute passed.
  it('a new card without a code starts a new member without Done', async () => {
    await identified();
    service.kioskPreview.mockRejectedValue(refusal('This tag is not linked to anything.'));
    service.kioskIdentify.mockResolvedValue({ member_name: 'Riley Tester', loans: [] });
    await tap({ serialNumber: '04:dd:44:55', payload: null });
    expect(await screen.findByText('Hi, Riley Tester')).toBeInTheDocument();
    expect(service.kioskIdentify).toHaveBeenLastCalledWith({ code: undefined, serial_number: '04DD4455' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a new card with an issued code starts a new member without Done', async () => {
    await identified();
    service.kioskIdentify.mockResolvedValue({ member_name: 'Riley Tester', loans: [] });
    await tap({ serialNumber: '04:dd:44', payload: 'LBC1ABCD1234' });
    expect(await screen.findByText('Hi, Riley Tester')).toBeInTheDocument();
    expect(service.kioskPreview).not.toHaveBeenCalled();
  });
});
