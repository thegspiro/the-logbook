/**
 * Items placed directly on the checklist, Present / Absent lines, and the
 * replacement date a crew records on a Date line nothing else tracks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { renderWithRouter } from '../../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockGetLastCheckSeals = vi.fn();
const mockSubmitCheck = vi.fn();
const authenticatedUser = { id: 'user-1', organization_id: 'org-1' };

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    getLastCheckSeals: (...a: unknown[]) => mockGetLastCheckSeals(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    updateDeployedLot: vi.fn(),
    uploadCheckItemPhotos: vi.fn().mockResolvedValue({ photoUrls: [], count: 0 }),
    swapItemLot: vi.fn(),
  },
}));

vi.mock('../../../services/inventoryService', () => ({
  inventoryService: { getItemLots: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: () => true,
    user: authenticatedUser,
  }),
}));
vi.mock('../../../utils/offlineQueue', () => ({
  enqueueCheck: vi.fn().mockResolvedValue('queued'),
  listOwnPendingChecks: vi.fn().mockResolvedValue([]),
  dequeueCheck: vi.fn(),
  markCheckSubmitted: vi.fn(),
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const EXPIRED = '2020-01-01';
const FAR_FUTURE = '2099-12-31';

const item = (overrides: Record<string, unknown>) => ({
  compartmentId: 'loose',
  sortOrder: 0,
  isRequired: false,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...overrides,
});

const template = (padsOverrides: Record<string, unknown> = {}) => ({
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Engine 1 Daily',
  checkTiming: 'start_of_shift',
  apparatusId: 'app-1',
  isActive: true,
  sortOrder: 0,
  contentRevision: 1,
  compartments: [
    {
      id: 'loose',
      templateId: 'tmpl-1',
      name: '',
      sortOrder: 0,
      isInline: true,
      items: [
        item({ id: 'chocks', name: 'Wheel chocks', checkType: 'presence' }),
        item({
          id: 'pads',
          name: 'AED pads',
          sortOrder: 1,
          checkType: 'expiry',
          hasExpiration: true,
          expirationDate: EXPIRED,
          ...padsOverrides,
        }),
      ],
    },
    {
      id: 'cab',
      templateId: 'tmpl-1',
      name: 'Cab',
      sortOrder: 1,
      items: [item({ id: 'radio', compartmentId: 'cab', name: 'Radio', checkType: 'function' })],
    },
  ],
});

type SubmittedItem = {
  template_item_id: string;
  status: string;
  is_expired?: boolean;
  expiration_date?: string;
  expiration_found?: string;
  lot_found?: string;
};

const submitted = (id: string): SubmittedItem | undefined => {
  const payload = mockSubmitCheck.mock.calls[0]?.[1] as { items: SubmittedItem[] };
  return payload.items.find((entry) => entry.template_item_id === id);
};

describe('EquipmentCheckForm: loose items, Present lines, replacement dates', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    mockGetLastCheckResults.mockReset();
    mockGetLastCheckResults.mockResolvedValue({});
    mockGetLastCheckSeals.mockReset();
    mockGetLastCheckSeals.mockResolvedValue({});
    mockSubmitCheck.mockReset();
    mockSubmitCheck.mockResolvedValue({ id: 'check-1', items: [] });
  });

  const render = () => renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template() as never} />);

  /** Answer the lines a test is not about, so the check files as complete. */
  const answerTheRest = async (user: ReturnType<typeof userEvent.setup>, { chocks = true } = {}) => {
    await user.click(within(screen.getByRole('group', { name: 'Radio' })).getByRole('button', { name: /Pass/ }));
    if (chocks)
      await user.click(
        within(screen.getByRole('group', { name: 'Wheel chocks' })).getByRole('button', { name: /Present/ })
      );
  };

  it('shows loose items as rows with no heading of their own', async () => {
    render();

    const loose = await screen.findByTestId('inline-items-loose');
    expect(within(loose).getByText('Wheel chocks')).toBeInTheDocument();
    expect(screen.queryByTestId('compartment-header-loose')).not.toBeInTheDocument();
    // The ordinary location still has its heading.
    expect(screen.getByTestId('compartment-header-cab')).toBeInTheDocument();
  });

  it('asks Present or Absent, and files Absent as a failure without a note', async () => {
    const user = userEvent.setup();
    render();

    const group = await screen.findByRole('group', { name: 'Wheel chocks' });
    expect(within(group).getByRole('button', { name: /Present/ })).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: /Absent/ }));

    // Absent is the answer: no "Not on truck" or "Out of service" beside it,
    // and no note demanded.
    expect(within(group).queryByRole('button', { name: /Not on truck/ })).not.toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /Out of service/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/What's wrong with Wheel chocks/)).not.toBeInTheDocument();

    await answerTheRest(user, { chocks: false });
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    expect(submitted('chocks')?.status).toBe('fail');
  });

  it('records the date off a replacement unit and passes the line', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId('replacement-open-pads'));
    fireEvent.change(screen.getByTestId('replacement-lot-pads'), { target: { value: ' L-9 ' } });
    fireEvent.change(screen.getByTestId('replacement-date-pads'), { target: { value: FAR_FUTURE } });

    // The line now reads the unit aboard, which is in date.
    expect(screen.queryByText('EXPIRED')).not.toBeInTheDocument();

    await answerTheRest(user);
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    expect(submitted('pads')).toMatchObject({
      status: 'pass',
      is_expired: false,
      expiration_date: FAR_FUTURE,
      expiration_found: FAR_FUTURE,
      lot_found: 'L-9',
    });
  });

  it('refuses a replacement date that has already passed', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId('replacement-open-pads'));
    fireEvent.change(screen.getByTestId('replacement-date-pads'), { target: { value: '2020-02-02' } });

    expect(screen.getByRole('alert')).toHaveTextContent('already passed');
    expect(screen.getByText('EXPIRED')).toBeInTheDocument();

    await answerTheRest(user);
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    const pads = submitted('pads');
    expect(pads?.status).toBe('fail');
    expect(pads?.expiration_found).toBeUndefined();
  });

  it('offers no replacement date on a line linked to inventory', async () => {
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template({ inventoryItemId: 'inv-1' }) as never} />
    );

    await screen.findByTestId('inline-items-loose');
    expect(screen.queryByTestId('replacement-open-pads')).not.toBeInTheDocument();
  });
});
