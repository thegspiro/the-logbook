import { act, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberCardTap } from './MemberCardTap';

type Tag = { serialNumber: string; payload: string | null };

const { state, scanner, resolveNfcMember } = vi.hoisted(() => ({
  state: { canManage: true, nfcEnabled: true, cardsConnected: true, supported: true },
  scanner: { onTag: null as ((tag: Tag) => void) | null, start: vi.fn(), stop: vi.fn() },
  resolveNfcMember: vi.fn(),
}));

vi.mock('../services/api', () => ({ inventoryService: { resolveNfcMember } }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => state.canManage }),
}));
vi.mock('../modules/inventory/hooks/useInventoryNfcEnabled', () => ({
  useInventoryNfcEnabled: (shouldCheck: boolean) => ({
    enabled: shouldCheck && state.nfcEnabled,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (type: string) => type === 'nfc-id-cards' && state.cardsConnected,
  }),
}));
vi.mock('../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: state.supported,
      unavailableReason: null,
      scanning: true,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));

async function tap(tag: Tag) {
  await act(async () => {
    scanner.onTag?.(tag);
    await Promise.resolve();
  });
}

describe('MemberCardTap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { canManage: true, nfcEnabled: true, cardsConnected: true, supported: true });
    resolveNfcMember.mockReset();
    resolveNfcMember.mockResolvedValue({ user_id: 'u-7', member_name: 'Dana Reyes', membership_number: '117' });
    scanner.onTag = null;
  });

  it.each([
    ['without inventory.manage', { canManage: false }],
    ['with inventory NFC off', { nfcEnabled: false }],
    ['without the ID card integration', { cardsConnected: false }],
    ['without Web NFC', { supported: false }],
  ])('renders nothing %s', (_label, overrides) => {
    Object.assign(state, overrides);
    const { container } = render(<MemberCardTap onMemberIdentified={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('identifies the member from a tapped card', async () => {
    const onMemberIdentified = vi.fn();
    render(<MemberCardTap onMemberIdentified={onMemberIdentified} />);
    expect(screen.getByRole('button', { name: /Hold their ID card/ })).toBeInTheDocument();
    await tap({ serialNumber: '04:a2:24:5b:7c:11:80', payload: null });
    await waitFor(() => expect(onMemberIdentified).toHaveBeenCalledWith({ userId: 'u-7', memberName: 'Dana Reyes' }));
    expect(resolveNfcMember).toHaveBeenCalledWith({ code: undefined, serial_number: '04A2245B7C1180' });
    expect(scanner.stop).toHaveBeenCalled();
  });

  it('forwards only a payload that looks like an issued card code', async () => {
    render(<MemberCardTap onMemberIdentified={vi.fn()} />);
    await tap({ serialNumber: '04A2245B', payload: 'https://transit.example/card' });
    await waitFor(() => expect(resolveNfcMember).toHaveBeenCalled());
    expect(resolveNfcMember).toHaveBeenCalledWith({ code: undefined, serial_number: '04A2245B' });
  });

  it('says why a card was refused, and listens for another', async () => {
    const onMemberIdentified = vi.fn();
    resolveNfcMember.mockRejectedValueOnce(new Error('This card is not registered to a member.'));
    render(<MemberCardTap onMemberIdentified={onMemberIdentified} />);
    await tap({ serialNumber: '04A2245B', payload: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('This card is not registered to a member.');
    await tap({ serialNumber: '04998877', payload: null });
    await waitFor(() => expect(onMemberIdentified).toHaveBeenCalledTimes(1));
  });
});
