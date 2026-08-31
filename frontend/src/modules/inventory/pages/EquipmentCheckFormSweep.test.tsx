/**
 * The sweep, driving the same check the accordion does.
 *
 * The point of these is not the layout — CheckSweep and CheckSweepStop have
 * their own tests for that. It is that a tap in the sweep lands in the same
 * `results` and `seals` the accordion writes, so a draft crosses between them
 * and submission is identical either way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { renderWithRouter } from '../../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockGetLastCheckSeals = vi.fn();
const mockSubmitCheck = vi.fn();
const mockSwapItemLot = vi.fn();

// The form takes its API from Inventory's own client, not the scheduling
// service it used before the checklist move, and this file now sits two levels
// deeper — so both the module specifier and the relative depths differ from
// where this suite was written. A vi.mock path that resolves to nothing fails
// silently: the real module loads and the assertions go red somewhere else.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    getLastCheckSeals: (...a: unknown[]) => mockGetLastCheckSeals(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    updateDeployedLot: vi.fn(),
    uploadCheckItemPhotos: vi.fn().mockResolvedValue({ photoUrls: [], count: 0 }),
    swapItemLot: (...a: unknown[]) => mockSwapItemLot(...a) as unknown,
  },
}));
const mockGetItemLots = vi.fn();
vi.mock('../../../services/inventoryService', () => ({
  inventoryService: { getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
const mockCheckPermission = vi.fn((_p: string) => true);
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: (p: string) => mockCheckPermission(p),
    user: { id: 'user-1', organization_id: 'org-1', first_name: 'Dana', last_name: 'Delgado' },
  }),
}));
vi.mock('../../../utils/offlineQueue', () => ({
  enqueueCheck: vi.fn().mockResolvedValue('queued'),
  listPendingChecks: vi.fn().mockResolvedValue([]),
  dequeueCheck: vi.fn(),
  markCheckSubmitted: vi.fn(),
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
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
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockGetItemLots.mockReset();
    mockGetItemLots.mockResolvedValue([]);
    mockGetLastCheckResults.mockReset();
    mockGetLastCheckResults.mockResolvedValue({});
    mockGetLastCheckSeals.mockReset();
    mockGetLastCheckSeals.mockResolvedValue({});
    mockSubmitCheck.mockReset();
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

describe('replacing expiring stock from inside the sweep', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockGetItemLots.mockReset();
    mockGetItemLots.mockResolvedValue([
      { id: 'lot-fresh', lot_number: 'L-99', expiration_date: '2099-12-31', quantity: 5 },
    ]);
    mockSwapItemLot.mockReset();
    mockSwapItemLot.mockResolvedValue({ lotNumber: 'L-99', expirationDate: '2099-12-31' });
    mockGetLastCheckResults.mockReset();
    mockGetLastCheckResults.mockResolvedValue({});
    mockGetLastCheckSeals.mockReset();
    mockGetLastCheckSeals.mockResolvedValue({});
    mockSubmitCheck.mockReset();
    mockSubmitCheck.mockResolvedValue({ id: 'check-1' });
  });

  /** One stop, one expired drug with ready stock behind it. */
  const expiringTemplate = () => ({
    ...template(),
    compartments: [
      {
        id: 'drugs',
        templateId: 'tmpl-1',
        name: 'Drug box',
        sortOrder: 0,
        items: [
          item({
            id: 'epi',
            name: 'Epinephrine',
            checkType: 'expiry',
            hasExpiration: true,
            expirationDate: '2020-01-01',
            inventoryItemId: 'inv-epi',
          }),
        ],
      },
    ],
  });

  it('does not offer a second submit once the check is filed', async () => {
    // `submitting` goes false in handleSubmit's `finally` whether or not the
    // POST succeeded, and nothing here unmounts the sweep — so an accepted
    // check leaves a live Submit button, and a second tap files a duplicate
    // under a fresh client_submission_id.
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={expiringTemplate() as never}
        experience="sweep"
        onBack={vi.fn()}
      />
    );
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await user.click(await screen.findByRole('button', { name: /Finish the check/ }));
    await user.click(await screen.findByRole('button', { name: 'Submit the check' }));

    // The success toast and the `finally` that re-enables the button land in
    // the same flush, so waiting on the toast settles both — a `waitFor` on the
    // button instead would pass on the still-submitting frame and prove nothing.
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Submit the check' })).toBeDisabled();
  });

  it('opens the lot dialog the Replace button asks for', async () => {
    // The sweep's seal card tells a crew to open a container and replace what
    // is expiring. The dialog that carries out that instruction is rendered
    // once for the whole form, and the sweep returns before reaching it — so
    // without it in this branch the button is a dead tap.
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={expiringTemplate() as never}
        experience="sweep"
        onBack={vi.fn()}
      />
    );
    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(await screen.findByRole('heading', { name: 'Replace from ready stock' })).toBeVisible();
  });

  it('un-reads a row whose unit has just been swapped', async () => {
    // The swap clears `status` so the crew verifies the new stock, but the
    // green "Read" chip is painted from `expiryConfirmed`. Left set, the row
    // says already-read while the tally counts it unanswered — inviting the
    // crew past the physical box they have just put on the truck.
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={expiringTemplate() as never}
        experience="sweep"
        onBack={vi.fn()}
      />
    );
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('button', { name: 'Read' })).toBeVisible();

    await user.click(within(screen.getByTestId('expiry-epi')).getByRole('button', { name: 'Replace' }));
    const modal = within(await screen.findByTestId('swap-modal'));
    await user.click(modal.getByRole('button', { name: 'Disposed of' }));
    await user.click(modal.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(mockSwapItemLot).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible());
  });

  it('disables Replace for a member the swap endpoint would refuse', async () => {
    // Disabled, not hidden — the same call the accordion's Swap button makes.
    // The server rejects a read-only member, and a button that simply vanishes
    // tells them nothing about who to hand the expired unit to.
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={expiringTemplate() as never}
        experience="sweep"
        onBack={vi.fn()}
      />
    );
    const replace = await screen.findByRole('button', { name: 'Replace' });
    expect(replace).toBeDisabled();
    expect(replace).toHaveAttribute('title', expect.stringContaining('recorded by a crew member'));
  });

  it('shows the fresh lot before the crew confirms it', async () => {
    // `doSwap` writes the new lot to `swapOverrides` and does not re-fetch the
    // template. Built from the raw compartments, the sweep would keep showing
    // the date of the box that just came off the truck — and Confirm computes
    // its verdict from what is on screen, filing a failure against stock that
    // is in date.
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={expiringTemplate() as never}
        experience="sweep"
        onBack={vi.fn()}
      />
    );
    expect(await screen.findByTestId('expiry-epi')).toHaveTextContent('2020-01-01');

    await user.click(within(screen.getByTestId('expiry-epi')).getByRole('button', { name: 'Replace' }));
    // Scoped: the row's Replace and the lot's Replace are both on screen now.
    const modal = within(await screen.findByTestId('swap-modal'));
    await user.click(modal.getByRole('button', { name: 'Disposed of' }));
    await user.click(modal.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(mockSwapItemLot).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('expiry-epi')).toHaveTextContent('2099-12-31'));
    expect(screen.getByTestId('expiry-epi')).not.toHaveTextContent('2020-01-01');
  });
});
