/**
 * The Member ID Cards page.
 *
 * What each test protects:
 *  - the page says cards are off rather than firing requests that will 403;
 *  - bulk changes only offer cards the server will move, and report refusals;
 *  - coverage issues a card to the member it lists, not another;
 *  - the tap log sends the filters it shows, as UTC instants, and exports them;
 *  - the retention field refuses what the server would refuse.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { NfcCard, NfcCoverage } from '../types/idCard';

const mockList = vi.fn();
const mockBulk = vi.fn();
const mockCoverage = vi.fn();
const mockListTaps = vi.fn();
const mockExportTaps = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockRegister = vi.fn();
const mockIsConnected = vi.fn();
const mockSaveBlob = vi.fn();
const mockToastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

vi.mock('../services/nfcCardService', () => ({
  nfcCardService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    bulkUpdateStatus: (...args: unknown[]) => mockBulk(...args) as unknown,
    coverage: (...args: unknown[]) => mockCoverage(...args) as unknown,
    listTaps: (...args: unknown[]) => mockListTaps(...args) as unknown,
    exportTaps: (...args: unknown[]) => mockExportTaps(...args) as unknown,
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown,
    register: (...args: unknown[]) => mockRegister(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (type: string) => mockIsConnected(type) as boolean,
  }),
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

vi.mock('../../../utils/saveBlob', () => ({
  saveBlob: (...args: unknown[]) => mockSaveBlob(...args) as unknown,
}));

vi.mock('../components/NfcCardCapture', () => ({
  NfcCardCapture: ({ onChange }: { onChange: (value: string, type: string) => void }) => (
    <button type="button" onClick={() => onChange('04A2245B', 'serial')}>
      Read card
    </button>
  ),
}));

import MemberIdCardsAdminPage from './MemberIdCardsAdminPage';

const card = (overrides: Partial<NfcCard>): NfcCard => ({
  id: 'tag-1',
  organizationId: 'org-1',
  userId: 'u-1',
  uidPreview: '245B',
  credentialType: 'serial',
  label: null,
  status: 'active',
  issuedAt: '2026-01-01T12:00:00Z',
  lastUsedAt: null,
  createdAt: '2026-01-01T12:00:00Z',
  updatedAt: '2026-01-01T12:00:00Z',
  autoSuspended: false,
  memberName: 'Dana Ruiz',
  ...overrides,
});

const coverage = (overrides: Partial<NfcCoverage> = {}): NfcCoverage => ({
  unusedDays: 180,
  currentMemberCount: 2,
  cardCounts: { active: 1, suspended: 0, lost: 0, revoked: 0 },
  membersWithoutCard: [{ userId: 'u-9', memberName: 'Sam Okafor', membershipNumber: '77' }],
  membersWithoutCardTotal: 1,
  unusedCards: [],
  unusedCardsTotal: 0,
  formerMemberCards: [],
  formerMemberCardsTotal: 0,
  ...overrides,
});

const renderAt = (search = '') => {
  window.history.pushState({}, '', `/members/admin/id-cards${search}`);
  return renderWithRouter(<MemberIdCardsAdminPage />);
};

describe('MemberIdCardsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReset();
    mockIsConnected.mockReturnValue(true);
    mockList.mockReset();
    mockList.mockResolvedValue({
      items: [
        card({ id: 'tag-1', memberName: 'Dana Ruiz', status: 'active' }),
        card({ id: 'tag-2', memberName: 'Lee Park', uidPreview: '9C1A', status: 'lost' }),
        card({ id: 'tag-3', memberName: 'Ari Cole', uidPreview: '77F0', status: 'suspended', autoSuspended: true }),
      ],
      total: 3,
    });
    mockBulk.mockReset();
    mockBulk.mockResolvedValue({ updated: [card({ status: 'suspended' })], failed: [] });
    mockCoverage.mockReset();
    mockCoverage.mockResolvedValue(coverage());
    mockListTaps.mockReset();
    mockListTaps.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    mockExportTaps.mockReset();
    mockExportTaps.mockResolvedValue(new Blob(['x']));
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({ tapRetentionMonths: 24 });
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({ tapRetentionMonths: 12 });
    mockRegister.mockReset();
    mockRegister.mockResolvedValue(card({}));
  });

  it('says cards are off and asks the server for nothing', () => {
    mockIsConnected.mockReturnValue(false);
    renderAt();
    expect(screen.getByText('NFC ID cards are turned off')).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('lists every card and marks one suspended because its holder left', async () => {
    renderAt();
    expect(await screen.findByText('Dana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Lee Park')).toBeInTheDocument();
    expect(screen.getByText(/Holder left/)).toBeInTheDocument();
  });

  it('never offers a lost card for a bulk change', async () => {
    renderAt();
    await screen.findByText('Lee Park');
    expect(screen.getByRole('checkbox', { name: 'Select card ending 9C1A' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select card ending 245B' })).toBeEnabled();
  });

  it('suspends the selected cards and reports a refusal', async () => {
    const user = userEvent.setup();
    mockBulk.mockResolvedValue({ updated: [], failed: [{ id: 'tag-1', detail: 'Card not found' }] });
    renderAt();
    await screen.findByText('Dana Ruiz');

    await user.click(screen.getByRole('checkbox', { name: 'Select card ending 245B' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select card ending 77F0' }));
    const bar = screen.getByRole('region', { name: 'Actions for selected cards' });
    await user.click(within(bar).getByRole('button', { name: /Suspend/ }));

    await waitFor(() =>
      expect(mockBulk).toHaveBeenCalledWith({
        tag_ids: ['tag-1', 'tag-3'],
        status: 'suspended',
        revoked_reason: 'Suspended by an officer',
      })
    );
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('1 card was not changed: Card not found'));
  });

  it('filters the roster by search text', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText('Dana Ruiz');
    await user.type(screen.getByLabelText('Search cards'), 'park');
    expect(screen.queryByText('Dana Ruiz')).not.toBeInTheDocument();
    expect(screen.getByText('Lee Park')).toBeInTheDocument();
  });

  it('issues a card to the member coverage lists', async () => {
    const user = userEvent.setup();
    renderAt('?tab=coverage');
    expect(await screen.findByText('Sam Okafor')).toBeInTheDocument();
    expect(mockCoverage).toHaveBeenCalledWith(180);

    await user.click(screen.getByRole('button', { name: /Issue card/ }));
    await user.click(screen.getByRole('button', { name: 'Read card' }));
    await user.click(screen.getByRole('button', { name: 'Register card' }));

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        user_id: 'u-9',
        tag_uid: '04A2245B',
        credential_type: 'serial',
        label: undefined,
      })
    );
  });

  it('opens the tap log for one card from the roster', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText('Dana Ruiz');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Dana Ruiz'));
    expect(row).toBeDefined();
    await user.click(within(row as HTMLElement).getByRole('button', { name: /Taps/ }));

    await waitFor(() =>
      expect(mockListTaps).toHaveBeenLastCalledWith(expect.objectContaining({ tagId: 'tag-1' }), 50, 0)
    );
    expect(screen.getByText(/Dana Ruiz · …245B/)).toBeInTheDocument();
  });

  it('sends the chosen days as UTC instants and exports the same filters', async () => {
    const user = userEvent.setup();
    mockListTaps.mockResolvedValue({
      items: [
        {
          id: 'tap-1',
          tappedAt: '2026-10-01T14:00:00Z',
          outcome: 'unknown_card',
          source: 'kiosk',
          unknownCardKey: '3f9a1c2b',
          locationName: 'Training Room',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    renderAt('?tab=taps');
    expect(await screen.findByText('Unknown card 3f9a1c2b')).toBeInTheDocument();

    await user.type(screen.getByLabelText('From'), '2026-10-01');
    await user.type(screen.getByLabelText('To'), '2026-10-01');
    await waitFor(() =>
      expect(mockListTaps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          // Midnight in New York (EDT) is 04:00 UTC; "to" is the start of the next day.
          since: '2026-10-01T04:00:00.000Z',
          until: '2026-10-02T04:00:00.000Z',
        }),
        50,
        0
      )
    );

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(mockExportTaps).toHaveBeenCalledWith(
        expect.objectContaining({ since: '2026-10-01T04:00:00.000Z', until: '2026-10-02T04:00:00.000Z' })
      )
    );
    expect(mockSaveBlob).toHaveBeenCalledWith(expect.any(Blob), 'id-card-taps.csv');
  });

  it('refuses a retention period the server would refuse', async () => {
    const user = userEvent.setup();
    renderAt('?tab=settings');
    const input = await screen.findByLabelText(/Keep the tap log for/);
    await waitFor(() => expect(input).toHaveValue(24));
    const save = screen.getByRole('button', { name: /Save/ });

    await user.clear(input);
    await user.type(input, '2');
    expect(save).toBeDisabled();

    await user.clear(input);
    await user.type(input, '12');
    await user.click(save);
    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith(12));
  });
});
