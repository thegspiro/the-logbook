/**
 * The sweep, driving the same check the accordion does.
 *
 * The point of these is not the layout — CheckSweep and CheckSweepStop have
 * their own tests for that. It is that a tap in the sweep lands in the same
 * `results` and `seals` the accordion writes, so a draft crosses between them
 * and submission is identical either way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { renderWithRouter } from '../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockGetLastCheckSeals = vi.fn();
const mockSubmitCheck = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
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
vi.mock('../../services/inventoryService', () => ({
  inventoryService: { getItemLots: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: () => true,
    user: { id: 'user-1', organization_id: 'org-1', first_name: 'Dana', last_name: 'Delgado' },
  }),
}));
vi.mock('../../utils/offlineQueue', () => ({
  enqueueCheck: vi.fn().mockResolvedValue('queued'),
  listPendingChecks: vi.fn().mockResolvedValue([]),
  dequeueCheck: vi.fn(),
  markCheckSubmitted: vi.fn(),
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import EquipmentCheckForm from './EquipmentCheckForm';

const item = (over: Record<string, unknown>) => ({
  compartmentId: 'cab',
  sortOrder: 0,
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...over,
});

/** A bag with a pocket inside it — the shape the accordion has to flatten. */
const template = () => ({
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Engine 402 Daily',
  checkTiming: 'start_of_shift',
  apparatusId: 'app-1',
  isActive: true,
  sortOrder: 0,
  contentRevision: 1,
  compartments: [
    {
      id: 'cab',
      templateId: 'tmpl-1',
      name: 'Cab',
      sortOrder: 0,
      items: [item({ id: 'siren', name: 'Siren', checkType: 'function' })],
    },
    {
      id: 'bag',
      templateId: 'tmpl-1',
      name: 'Airway bag',
      sortOrder: 1,
      items: [item({ id: 'gauze', name: 'Roller gauze', checkType: 'count', requiredQuantity: 10 })],
    },
    {
      id: 'pocket',
      templateId: 'tmpl-1',
      name: 'Front pocket',
      sortOrder: 0,
      parentCompartmentId: 'bag',
      items: [item({ id: 'igel', name: 'i-gel size 4', checkType: 'count', requiredQuantity: 2 })],
    },
  ],
});

const renderSweep = () =>
  renderWithRouter(
    <EquipmentCheckForm shiftId="shift-1" template={template() as never} experience="sweep" onBack={vi.fn()} />
  );

describe('EquipmentCheckForm in sweep mode', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    mockGetLastCheckResults.mockResolvedValue({});
    mockGetLastCheckSeals.mockResolvedValue({});
    mockSubmitCheck.mockResolvedValue({ id: 'check-1' });
  });

  it('walks stops rather than listing compartments', async () => {
    renderSweep();
    expect(await screen.findByRole('heading', { name: 'Cab' })).toBeVisible();
    // Two stops, not three: the pocket is inside the bag.
    expect(screen.getByText(/Stop 1 of 2/)).toBeVisible();
  });

  it('records an answer against the results the form keeps', async () => {
    const user = userEvent.setup();
    renderSweep();
    await user.click(await screen.findByRole('button', { name: 'Siren works' }));
    // The header tally is computed from `results`, so it moving is the proof
    // the tap reached the form's state rather than local component state.
    await waitFor(() => expect(screen.getByText(/1 \/ 3 answered/)).toBeVisible());
  });

  it('opens a bag on its first pocket, and answers it against its own id', async () => {
    const user = userEvent.setup();
    renderSweep();
    await user.click(await screen.findByRole('button', { name: /^Next ·/ }));
    expect(await screen.findByRole('heading', { name: 'Pocket 1 · Front pocket' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'One more i-gel size 4' }));
    await waitFor(() => expect(screen.getByText(/Pocket 1 of 1/)).toBeVisible());
  });

  it('carries the last count forward into the walk', async () => {
    mockGetLastCheckResults.mockResolvedValue({ gauze: { status: 'pass', quantity_found: 12 } });
    const user = userEvent.setup();
    renderSweep();
    await user.click(await screen.findByRole('button', { name: /^Next ·/ }));
    // 12 found against a par of 10 — the surplus survives into the next check.
    expect(await screen.findByTestId('tally-value-gauze')).toHaveTextContent('12');
  });

  it('submits through the same path the accordion uses', async () => {
    const user = userEvent.setup();
    renderSweep();
    await user.click(await screen.findByRole('button', { name: 'Siren works' }));
    await user.click(screen.getByRole('button', { name: /^Next ·/ }));
    await user.click(await screen.findByRole('button', { name: /Finish the check/ }));
    await user.click(await screen.findByRole('button', { name: /^Submit with/ }));
    // The shared submit path still guards an incomplete check. The sweep's
    // finish button already names the gap, so this is a second confirmation of
    // the same thing — kept because it belongs to the submit path both
    // experiences use, not to either screen.
    await user.click(await screen.findByRole('button', { name: 'Submit anyway' }));

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalled());
    const payload = mockSubmitCheck.mock.calls[0]?.[1] as {
      items: { template_item_id: string; compartment_name: string; status: string }[];
    };
    // Every item is submitted, and a pocket item still records where it lives.
    expect(payload.items.map((i) => i.template_item_id).sort()).toEqual(['gauze', 'igel', 'siren']);
    expect(payload.items.find((i) => i.template_item_id === 'igel')?.compartment_name).toBe(
      'Airway bag › Front pocket'
    );
  });

  it('leaves the accordion untouched when it is not asked for', async () => {
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template() as never} onBack={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Engine 402 Daily' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Truck map' })).not.toBeInTheDocument();
  });
});
