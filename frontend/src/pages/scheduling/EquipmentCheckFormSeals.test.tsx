/**
 * What an intact tamper seal does — and does not — put on the record.
 *
 * A seal proves a bag is unchanged since its last count. It is not a claim
 * that the bag is full, and it is not a substitute for a count when the tag
 * does not match what the last crew wrote down.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { renderWithRouter } from '../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockGetLastCheckSeals = vi.fn();
const mockSubmitCheck = vi.fn();
const authenticatedUser = { id: 'user-1', organization_id: 'org-1' };

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
    user: authenticatedUser,
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

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EquipmentCheckForm from './EquipmentCheckForm';
import { loadEquipmentCheckDraft } from '../../utils/equipmentCheckDrafts';

/**
 * A sealed drug bag carrying three of a required six — the case that matters.
 * The bag was short at its last count, and the seal says only that nobody has
 * opened it since.
 */
const sealedTemplate = () => ({
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Medic 2 Daily',
  checkTiming: 'start_of_shift',
  apparatusId: 'app-1',
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'bag-1',
      templateId: 'tmpl-1',
      name: 'Drug Bag',
      sortOrder: 0,
      isSealed: true,
      items: [
        {
          id: 'ti-1',
          compartmentId: 'bag-1',
          name: 'Morphine 10mg',
          sortOrder: 0,
          checkType: 'count',
          isRequired: true,
          requiredQuantity: 6,
          expectedQuantity: 6,
          quantityOnTruck: 3,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
  ],
});

const submittedItem = () => {
  const payload = mockSubmitCheck.mock.calls[0]?.[1] as {
    items: Array<{ template_item_id: string; quantity_found?: number; status: string }>;
    seals: Array<{ seal_number?: string; intact: boolean; cleared_item_count: number }>;
  };
  return payload;
};

describe('EquipmentCheckForm tamper seals', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.clearAllMocks();
    localStorage.clear();
    // The draft writer refuses to persist without a live session, so that a
    // check draft cannot outlive a logout.
    localStorage.setItem('has_session', '1');
    mockGetLastCheckResults.mockResolvedValue({});
    mockGetLastCheckSeals.mockResolvedValue({
      'bag-1': { sealNumber: 'M2-40817', intact: true, checkedAt: '2026-08-09T12:00:00Z' },
    });
    mockSubmitCheck.mockResolvedValue({ id: 'check-1', items: [] });
  });

  const render = () => renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={sealedTemplate() as never} />);

  // The regression this file exists for. Writing each quantity up to par put
  // stock on the record nobody had seen: the backend treats quantity_found as
  // a recount and writes it into the truck's running total, so a bag three
  // short came back full without anyone opening it.
  it('keeps the carried count when a matching seal clears the contents', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Seal intact — clear 1 check/ }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    const payload = submittedItem();
    expect(payload.items[0]?.quantity_found).toBe(3);
    expect(payload.items[0]?.quantity_found).not.toBe(6);
  });

  // Status still comes from the number, so a carried shortfall files as a
  // failure rather than being quietly passed by the seal.
  it('files a carried shortfall as a failure, not a pass', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Seal intact — clear 1 check/ }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    expect(submittedItem().items[0]?.status).toBe('fail');
  });

  it('records the seal it cleared against', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Seal intact — clear 1 check/ }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    expect(submittedItem().seals).toEqual([
      expect.objectContaining({ seal_number: 'M2-40817', intact: true, cleared_item_count: 1 }),
    ]);
  });

  // A tag nobody recognises is evidence the bag was opened. The seal is still
  // worth recording — it is what says the contents were counted by hand — but
  // it clears nothing.
  it('records but clears nothing when the tag does not match the last count', async () => {
    const user = userEvent.setup();
    render();

    const input = await screen.findByLabelText('Seal number on the bag');
    // Wait for the prefill to land before overtyping it; the previous seals
    // are fetched, so an immediate clear would race the response.
    await waitFor(() => expect(input).toHaveValue('M2-40817'));
    await user.clear(input);
    await user.type(input, 'M2-99999');
    await user.click(screen.getByRole('button', { name: 'Record seal' }));

    // The contents are still unanswered — the seal cleared nothing — so the
    // crew counts them by hand before the check can be submitted.
    expect(screen.getByText('Seal recorded')).toBeInTheDocument();
    expect(screen.getByText(/does not stand in for them/)).toBeInTheDocument();

    await user.click(await screen.findByDisplayValue('3'));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());

    const payload = submittedItem();
    expect(payload.seals).toEqual([
      expect.objectContaining({ seal_number: 'M2-99999', intact: true, cleared_item_count: 0 }),
    ]);
    // Counted by hand, and the count that was there is what got recorded.
    expect(payload.items[0]?.quantity_found).toBe(3);
  });

  // Confirming a seal writes passing statuses into the results, which are
  // persisted. If the seal were not persisted with them, a reload would restore
  // passes with nothing on the record vouching for them.
  it('saves the seal into the draft alongside the statuses it cleared', async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /Seal intact — clear 1 check/ }));

    await waitFor(async () => {
      const draft = await loadEquipmentCheckDraft<{
        seals: Record<string, { sealNumber: string; cleared: boolean }>;
      }>({
        organizationId: 'org-1',
        userId: 'user-1',
        shiftId: 'shift-1',
        templateId: 'tmpl-1',
        templateRevision: 'content-revision',
      });
      expect(draft?.contents.seals['bag-1']).toMatchObject({ sealNumber: 'M2-40817', cleared: true });
    });
  });

  it('asks for the previous seals of the template it is checking', async () => {
    render();
    await waitFor(() => expect(mockGetLastCheckSeals).toHaveBeenCalledWith('tmpl-1', 'app-1'));
  });
});
