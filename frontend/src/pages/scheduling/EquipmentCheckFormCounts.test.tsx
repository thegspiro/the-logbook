/**
 * How a quantity item arrives pre-filled, and what that does (and does not)
 * count as having been checked.
 */

import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockSubmitCheck = vi.fn();
const mockUpdateDeployedLot = vi.fn();
const mockUploadCheckItemPhotos = vi.fn();
const mockListPendingChecks = vi.fn();
const mockDequeueCheck = vi.fn();
const mockMarkCheckSubmitted = vi.fn();
const mockMarkPhotosUploaded = vi.fn();
const mockSwapItemLot = vi.fn();
const mockGetItemLots = vi.fn();
const mockEnqueueCheck = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    updateDeployedLot: (...a: unknown[]) => mockUpdateDeployedLot(...a) as unknown,
    uploadCheckItemPhotos: (...a: unknown[]) => mockUploadCheckItemPhotos(...a) as unknown,
    swapItemLot: (...a: unknown[]) => mockSwapItemLot(...a) as unknown,
  },
}));

vi.mock('../../services/inventoryService', () => ({
  inventoryService: { getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../utils/offlineQueue', () => ({
  enqueueCheck: (...a: unknown[]) => mockEnqueueCheck(...a) as unknown,
  listPendingChecks: (...a: unknown[]) => mockListPendingChecks(...a) as unknown,
  dequeueCheck: (...a: unknown[]) => mockDequeueCheck(...a) as unknown,
  markCheckSubmitted: (...a: unknown[]) => mockMarkCheckSubmitted(...a) as unknown,
  markPhotosUploaded: (...a: unknown[]) => mockMarkPhotosUploaded(...a) as unknown,
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));

const mockCheckPermission = vi.fn(() => true);
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: (...a: unknown[]) => mockCheckPermission(...a) as unknown,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const template = (itemOverrides = {}) => ({
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Engine 1 Daily',
  checkTiming: 'start_of_shift',
  apparatusId: 'app-1',
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'c-1',
      templateId: 'tmpl-1',
      name: 'Front Bumper',
      sortOrder: 0,
      items: [
        {
          id: 'ti-1',
          compartmentId: 'c-1',
          name: '4x4 Gauze',
          sortOrder: 0,
          checkType: 'count',
          isRequired: true,
          requiredQuantity: 4,
          expectedQuantity: 4,
          hasExpiration: false,
          expirationWarningDays: 30,
          ...itemOverrides,
        },
      ],
    },
  ],
});

/** A compartment where every item is one short of a par of ten. */
const multiItemTemplate = (count: number) => ({
  ...template(),
  compartments: [
    {
      id: 'c-1',
      templateId: 'tmpl-1',
      name: 'Front Bumper',
      sortOrder: 0,
      items: Array.from({ length: count }, (_, i) => ({
        id: `ti-${i + 1}`,
        compartmentId: 'c-1',
        name: `Item ${i + 1}`,
        sortOrder: i,
        checkType: 'count',
        isRequired: true,
        requiredQuantity: 10,
        expectedQuantity: 10,
        quantityOnTruck: 1,
        hasExpiration: false,
        expirationWarningDays: 30,
      })),
    },
  ],
});

describe('EquipmentCheckForm quantity seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetLastCheckResults.mockResolvedValue({});
    mockListPendingChecks.mockResolvedValue([]);
    mockUploadCheckItemPhotos.mockResolvedValue({ photoUrls: [], count: 1 });
    mockMarkCheckSubmitted.mockResolvedValue({});
    mockMarkPhotosUploaded.mockResolvedValue({});
    mockGetItemLots.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(true);
    mockSubmitCheck.mockResolvedValue({ id: 'check-1', items: [] });
    mockEnqueueCheck.mockResolvedValue('queued-check-1');
    mockUpdateDeployedLot.mockResolvedValue({
      templateItemId: 'ti-1',
      itemName: '4x4 Gauze',
      isShort: false,
      lots: [{ id: 'dl-1', lotNumber: 'NEW-9', expirationDate: '2028-01-31', quantity: 2, isExpired: false }],
    });
  });

  describe('sticky checklist identification', () => {
    it('keeps fixed safety metadata beside a truncated apparatus name at phone width', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
      const apparatusName = 'Engine 4 With An Exceptionally Long Reserve Apparatus Name';

      renderWithRouter(
        <EquipmentCheckForm
          shiftId="shift-1"
          template={{ ...template(), name: 'Daily Apparatus Check With A Very Long Template Name' } as never}
          shiftContext={{ apparatusName, shiftDate: '2026-08-28', checkTiming: 'start_of_shift' }}
        />
      );

      const context = screen.getByRole('group', {
        name: `Checklist context: ${apparatusName}, Fri, Aug 28, 2026, Start of shift`,
      });
      expect(within(context).getByTitle(apparatusName)).toHaveClass('min-w-0', 'truncate');
      expect(within(context).getByText('Fri, Aug 28, 2026')).toHaveClass('shrink-0');
      expect(within(context).getByText('Start of shift')).toHaveClass('sr-only');
      expect(within(context).getByText('START')).toHaveClass('shrink-0');
      expect(screen.getByText('0/1')).toHaveClass('shrink-0');
      expect(screen.getByRole('heading')).toHaveClass('min-w-0', 'truncate');
    });

    it('omits unavailable optional context without placeholder text or separators', () => {
      renderWithRouter(
        <EquipmentCheckForm
          shiftId="shift-1"
          template={template() as never}
          shiftContext={{ apparatusName: 'Engine 4' }}
        />
      );

      const context = screen.getByRole('group', { name: 'Checklist context: Engine 4' });
      expect(context).toHaveTextContent('Engine 4');
      expect(context).not.toHaveTextContent('·');
      expect(context).not.toHaveTextContent(/undefined|invalid|N\/A/i);
      expect(screen.queryByText(/START|END/)).not.toBeInTheDocument();
    });

    it.each([
      ['start_of_shift', 'Start of shift', 'START'],
      ['end_of_shift', 'End of shift', 'END'],
    ])('renders the %s timing in the single metadata row', (checkTiming, label, badgeLabel) => {
      renderWithRouter(
        <EquipmentCheckForm
          shiftId="shift-1"
          template={template() as never}
          shiftContext={{ apparatusName: 'Engine 4', shiftDate: '2026-08-28', checkTiming }}
        />
      );

      const context = screen.getByRole('group', {
        name: `Checklist context: Engine 4, Fri, Aug 28, 2026, ${label}`,
      });
      expect(within(context).getByText(badgeLabel)).toBeInTheDocument();
      expect(screen.getAllByText(label)).toHaveLength(1);
      expect(within(context).getByText('Fri, Aug 28, 2026')).toBeInTheDocument();
    });
  });

  const render = (itemOverrides = {}, onComplete?: () => void) =>
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template(itemOverrides) as never} onComplete={onComplete} />
    );

  const completeWithPhoto = async (fileName = 'gauze.jpg') => {
    const user = userEvent.setup();
    await user.click(await screen.findByDisplayValue('4'));
    await user.click(screen.getByRole('button', { name: 'Note' }));
    const input = screen.getByLabelText('Upload photo for 4x4 Gauze');
    await user.upload(input, new File(['photo'], fileName, { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
  };

  it('reveals exceptional Pass/Fail outcomes only after a failure is selected', async () => {
    const user = userEvent.setup();
    render({ name: 'Portable light', checkType: 'function' });

    expect(await screen.findByRole('button', { name: 'Pass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fail' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not on truck' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Out of service' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fail' }));

    expect(screen.getByRole('button', { name: 'Not on truck' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Out of service' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Out of service' }));
    expect(screen.getByRole('button', { name: 'Out of service' })).toHaveClass('bg-amber-600');
  });

  it('retains a failed online photo upload without claiming unconditional success', async () => {
    const onComplete = vi.fn();
    mockSubmitCheck.mockResolvedValue({
      id: 'check-1',
      items: [{ id: 'check-item-77', templateItemId: 'ti-1', itemName: '4x4 Gauze' }],
    });
    mockUploadCheckItemPhotos.mockRejectedValueOnce(new Error('upload interrupted'));
    render({ quantityOnTruck: 4 }, onComplete);

    await completeWithPhoto();

    expect(await screen.findByText('Equipment check submitted')).toBeInTheDocument();
    expect(screen.getByText('1 photo saved for retry')).toBeInTheDocument();
    expect(screen.getByText('Evidence will sync when connected.')).toBeInTheDocument();
    expect(screen.queryByText('1 photo attached')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Report' })).toBeDisabled();
    expect(mockEnqueueCheck).toHaveBeenCalledWith('shift-1', expect.objectContaining({ template_id: 'tmpl-1' }), [
      { itemId: 'ti-1', files: [expect.any(File)] },
    ]);
    expect(mockMarkCheckSubmitted).toHaveBeenCalledWith('queued-check-1', 'check-1', {
      'ti-1': 'check-item-77',
    });
    expect(mockDequeueCheck).not.toHaveBeenCalledWith('queued-check-1');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('removes successful photos from the pending set before completing', async () => {
    const onComplete = vi.fn();
    mockSubmitCheck.mockResolvedValue({
      id: 'check-1',
      items: [{ id: 'check-item-77', templateItemId: 'ti-1', itemName: '4x4 Gauze' }],
    });
    render({ quantityOnTruck: 4 }, onComplete);

    await completeWithPhoto();

    await waitFor(() => expect(mockMarkPhotosUploaded).toHaveBeenCalledWith('queued-check-1', 'ti-1'));
    expect(mockDequeueCheck).toHaveBeenCalledWith('queued-check-1');
    expect(await screen.findByText('1 photo attached')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('distinguishes a rejected check submission from retained evidence', async () => {
    mockSubmitCheck.mockRejectedValueOnce({ response: { status: 422, data: { detail: 'Check already submitted' } } });
    const onComplete = vi.fn();
    render({ quantityOnTruck: 4 }, onComplete);

    await completeWithPhoto();

    expect(await screen.findByText('Check submission failed')).toBeInTheDocument();
    expect(screen.getByText('Check already submitted')).toBeInTheDocument();
    expect(screen.queryByText(/saved for retry/)).not.toBeInTheDocument();
    expect(mockEnqueueCheck).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('retries retained evidence with the returned check-item ID and does not resubmit the check', async () => {
    const photo = new File(['photo'], 'gauze.jpg', { type: 'image/jpeg' });
    mockSubmitCheck.mockResolvedValue({
      id: 'check-1',
      items: [{ id: 'check-item-77', templateItemId: 'ti-1', itemName: '4x4 Gauze' }],
    });
    mockUploadCheckItemPhotos.mockRejectedValueOnce(new Error('upload interrupted')).mockResolvedValue({
      photoUrls: [],
      count: 1,
    });
    render({ quantityOnTruck: 4 });
    await completeWithPhoto();
    await screen.findByText('1 photo saved for retry');

    mockListPendingChecks.mockResolvedValue([
      {
        id: 'queued-check-1',
        shiftId: 'shift-1',
        payload: { template_id: 'tmpl-1', items: [] },
        photos: [{ itemId: 'ti-1', blob: photo, fileName: photo.name }],
        queuedAt: 1,
        retries: 0,
        submittedCheckId: 'check-1',
        submittedItemIds: { 'ti-1': 'check-item-77' },
      },
    ]);
    mockSubmitCheck.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));

    await waitFor(() =>
      expect(mockUploadCheckItemPhotos).toHaveBeenLastCalledWith('check-1', 'check-item-77', [expect.any(File)])
    );
    expect(mockSubmitCheck).not.toHaveBeenCalled();
    expect(mockMarkPhotosUploaded).toHaveBeenCalledWith('queued-check-1', 'ti-1');
  });

  it('uploads a queued photo against the returned check-item ID', async () => {
    const photo = new File(['photo'], 'gauze.jpg', { type: 'image/jpeg' });
    mockListPendingChecks.mockResolvedValue([
      {
        id: 'queue-1',
        shiftId: 'shift-1',
        payload: { template_id: 'tmpl-1', items: [] },
        photos: [{ itemId: 'ti-1', blob: photo, fileName: photo.name }],
        queuedAt: 1,
        retries: 0,
      },
    ]);
    mockSubmitCheck.mockResolvedValue({
      id: 'check-1',
      items: [{ id: 'check-item-77', templateItemId: 'ti-1' }],
    });

    render();

    await waitFor(() => {
      expect(mockUploadCheckItemPhotos).toHaveBeenCalledWith('check-1', 'check-item-77', [expect.any(File)]);
    });
    expect(mockMarkCheckSubmitted).toHaveBeenCalledWith('queue-1', 'check-1', { 'ti-1': 'check-item-77' });
    // Checkpointed before the entry is dropped: the upload endpoint appends to
    // photo_urls, so a group still queued after a successful POST is uploaded
    // twice on the next drain.
    await waitFor(() => expect(mockMarkPhotosUploaded).toHaveBeenCalledWith('queue-1', 'ti-1'));
    expect(mockDequeueCheck).toHaveBeenCalledWith('queue-1');
  });

  it('starts from the running on-truck count, not the last check', async () => {
    // The last check saw four; two were used mid-shift and recorded against
    // the truck. The crew should open this at two.
    mockGetLastCheckResults.mockResolvedValue({ 'ti-1': { quantity_found: 4 } });
    render({ quantityOnTruck: 2 });

    expect(await screen.findByDisplayValue('2')).toBeInTheDocument();
  });

  it('falls back to the last check when nothing has been counted', async () => {
    mockGetLastCheckResults.mockResolvedValue({ 'ti-1': { quantity_found: 3 } });
    render();

    expect(await screen.findByDisplayValue('3')).toBeInTheDocument();
  });

  it('shows the count against par with the catalog unit', async () => {
    render({ quantityOnTruck: 2, unitOfMeasure: 'Box' });

    expect(await screen.findByText('2/4 Box')).toBeInTheDocument();
  });

  it('does not count a carried-over number as checked', async () => {
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    // The whole safety point: a pre-filled number is a starting point, so the
    // progress counter must not report the check as done before anyone looked.
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('does not submit caption rows as unchecked items', async () => {
    const user = userEvent.setup();
    const templateWithCaption = template({ quantityOnTruck: 4 });
    templateWithCaption.compartments[0].items.push({
      ...templateWithCaption.compartments[0].items[0],
      id: 'ti-caption',
      name: 'Confirm the seal is intact before continuing.',
      sortOrder: 1,
      checkType: 'text',
    });
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={templateWithCaption as never} />);

    await user.click(await screen.findByDisplayValue('4'));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    const payload = mockSubmitCheck.mock.calls[0][1] as {
      items: Array<{ template_item_id: string }>;
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.template_item_id).toBe('ti-1');
  });

  it('does not queue text instruction rows after a transport failure', async () => {
    const user = userEvent.setup();
    const templateWithInstruction = template({ quantityOnTruck: 4 });
    templateWithInstruction.compartments[0].items.push({
      ...templateWithInstruction.compartments[0].items[0],
      id: 'ti-instruction',
      name: 'Inspect the package seal before recording the count.',
      sortOrder: 1,
      checkType: 'text',
    });
    mockSubmitCheck.mockRejectedValueOnce({ message: 'Network Error' });
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={templateWithInstruction as never} />);

    await user.click(await screen.findByDisplayValue('4'));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => expect(mockEnqueueCheck).toHaveBeenCalledOnce());
    const queuedPayload = mockEnqueueCheck.mock.calls[0][1] as {
      items: Array<{ template_item_id: string }>;
    };
    expect(queuedPayload.items).toHaveLength(1);
    expect(queuedPayload.items.map((item) => item.template_item_id)).toEqual(['ti-1']);
  });

  it('states the carry-over once rather than on every row', async () => {
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    // One standing rule about the whole check, not sixty pieces of chrome.
    expect(screen.getByText(/Counts are carried over from the last recorded count/)).toBeInTheDocument();
  });

  it('confirms an unchanged count when the field is touched', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    const field = await screen.findByDisplayValue('4');

    await user.click(field);

    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    // Nothing left carried, so the explanation retires itself.
    expect(screen.queryByText(/Counts are carried over/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });

  it('confirms the counts shown without raising any of them', async () => {
    const user = userEvent.setup();
    render({ requiredQuantity: 24, expectedQuantity: 24, quantityOnTruck: 18 });
    await screen.findByDisplayValue('18');

    await user.click(screen.getByRole('button', { name: /Confirm the counts shown/ }));

    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    // The shortfall a crew can see stays a shortfall — and files as a failure
    // rather than quietly passing.
    expect(screen.getByDisplayValue('18')).toBeInTheDocument();
    expect(screen.getByText(/Below required \(24\)/)).toBeInTheDocument();
  });

  it('asks before recording a short compartment as full', async () => {
    const user = userEvent.setup();
    render({ requiredQuantity: 24, expectedQuantity: 24, quantityOnTruck: 18 });
    await screen.findByDisplayValue('18');

    await user.click(screen.getByRole('button', { name: /Set all items in .* to par/ }));

    // Par writes over what is shown, so putting six gauze on the record that
    // are not in the bag has to be a decision, not a fast path — and the
    // decision needs the size of the claim, not just the fact of one.
    expect(await screen.findByText(/This item is.* below the required quantity/)).toBeInTheDocument();
    expect(screen.getByText('18 → 24')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Keep the counts/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('18')).toBeInTheDocument();
    });
  });

  it('sets par once the crew says they restocked', async () => {
    const user = userEvent.setup();
    render({ requiredQuantity: 24, expectedQuantity: 24, quantityOnTruck: 18 });
    await screen.findByDisplayValue('18');

    await user.click(screen.getByRole('button', { name: /Set all items in .* to par/ }));
    await user.click(await screen.findByRole('button', { name: /Yes, it is full/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('24')).toBeInTheDocument();
    });
  });

  it('does not interrupt a compartment already at par', async () => {
    const user = userEvent.setup();
    render({ requiredQuantity: 24, expectedQuantity: 24, quantityOnTruck: 24 });
    await screen.findByDisplayValue('24');

    await user.click(screen.getByRole('button', { name: /Set all items in .* to par/ }));

    // Nothing would be raised, so there is nothing to warn about.
    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    expect(screen.queryByText(/showing below the required quantity/)).not.toBeInTheDocument();
  });

  it('keeps the photo control with the note it evidences', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    // Collapsed, the row carries two controls rather than four.
    expect(screen.queryByRole('button', { name: /Add photo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Note$/ }));

    expect(await screen.findByRole('button', { name: /Add photo/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Notes for this item...')).toBeInTheDocument();
  });

  it('treats an adjustment as the check itself', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    await user.click(screen.getByRole('button', { name: /Decrease 4x4 Gauze quantity/ }));

    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('shows every lot aboard with its own date', async () => {
    render({
      hasExpiration: true,
      expirationDate: '2028-01-01',
      lotsAboard: [
        { id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: false },
        { id: 'dl-2', lotNumber: 'LOT-B', expirationDate: '2027-06-30', quantity: 1, isExpired: false },
      ],
    });

    // A drug bag holding two boxes holds two dates; one line cannot say that.
    expect(await screen.findByText('LOT-A')).toBeInTheDocument();
    expect(screen.getByText('LOT-B')).toBeInTheDocument();
    expect(screen.getByText(/Expires.*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Expires.*2027/)).toBeInTheDocument();
  });

  it('judges expiry on the soonest date aboard, not the position column', async () => {
    render({
      hasExpiration: true,
      // The column says next decade; a box in the bag expired yesterday.
      expirationDate: '2030-01-01',
      lotsAboard: [
        { id: 'dl-1', lotNumber: 'LOT-OLD', expirationDate: '2020-01-01', quantity: 1, isExpired: true },
        { id: 'dl-2', lotNumber: 'LOT-NEW', expirationDate: '2030-01-01', quantity: 1, isExpired: false },
      ],
    });

    expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
  });

  it('itemizes every shortfall rather than running them into a sentence', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={multiItemTemplate(3) as never} />);
    await screen.findAllByDisplayValue('1');

    await user.click(screen.getByRole('button', { name: /Set all items in .* to par/ }));

    // Three names joined by commas inside a paragraph is not something a crew
    // can read at 6am, and prose cannot say how short each one is.
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/These 3 items are below the required quantity/)).toBeInTheDocument();
    expect(dialog.getByText('Item 1')).toBeInTheDocument();
    expect(dialog.getByText('Item 3')).toBeInTheDocument();
    expect(dialog.getAllByText('1 → 10')).toHaveLength(3);
  });

  it('summarizes the tail so a long list cannot fill the screen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={multiItemTemplate(9) as never} />);
    await screen.findAllByDisplayValue('1');

    await user.click(screen.getByRole('button', { name: /Set all items in .* to par/ }));

    // Six named, the rest counted: the dialog stays glanceable whether the
    // compartment is two items short or twenty.
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Item 6')).toBeInTheDocument();
    expect(dialog.queryByText('Item 7')).not.toBeInTheDocument();
    expect(dialog.getByText(/and 3 more items below par/)).toBeInTheDocument();
  });

  it('counts the items in the title so the ask is clear before reading', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={multiItemTemplate(4) as never} />);
    await screen.findAllByDisplayValue('1');

    await user.click(screen.getByRole('button', { name: /Set all items in .* to par/ }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Record 4 items at full?')).toBeInTheDocument();
  });

  it('shows inventory lot data without offering a second editor', async () => {
    render({
      hasExpiration: true,
      lotsAboard: [{ id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 2, isExpired: false }],
    });
    await screen.findByText('LOT-A');

    expect(screen.getByText('Inventory lots aboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Correct/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expiration')).not.toBeInTheDocument();
    expect(mockUpdateDeployedLot).not.toHaveBeenCalled();
  });
  it('derives an expired unanswered item as failed everywhere, including submission', async () => {
    const user = userEvent.setup();
    render({ hasExpiration: true, expirationDate: '2020-01-01' });

    expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Front Bumper, 1 of 1 checked, Has Failures/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledOnce());
    const submitted = mockSubmitCheck.mock.calls[0][1] as {
      items: Array<{ status: string; is_expired: boolean }>;
    };
    expect(submitted.items[0]).toMatchObject({ status: 'fail', is_expired: true });
  });

  /**
   * The swap only ever appended the incoming lot, and a position's exposure is
   * read from the lots aboard rather than from the scalar date the swap
   * rewrote. So an item whose bracket held an expired box was still EXPIRED —
   * force-failed, Pass disabled — the instant after the crew was told fresh
   * stock had been swapped in.
   */
  describe('replacing expired stock', () => {
    const expiredItem = {
      hasExpiration: true,
      expirationDate: '2020-01-01',
      inventoryItemId: 'inv-1',
      lotsAboard: [{ id: 'dl-old', lotNumber: 'OLD-1', expirationDate: '2020-01-01', quantity: 1, isExpired: true }],
    };

    const freshResult = {
      templateItemId: 'ti-1',
      lotNumber: 'NEW-9',
      expirationDate: '2030-01-01',
      remainingQuantity: 5,
      lotsAboard: [{ id: 'dl-new', lotNumber: 'NEW-9', expirationDate: '2030-01-01', quantity: 1, isExpired: false }],
      replacedLotNumber: 'OLD-1',
      disposition: 'discarded',
    };

    const openSwapDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      mockGetItemLots.mockResolvedValue([
        { id: 'inv-lot-1', lot_number: 'NEW-9', expiration_date: '2030-01-01', quantity: 5 },
      ]);
      render(expiredItem);
      expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^Swap$/ }));
      return screen.findByText('NEW-9');
    };

    it('will not send the replacement until the crew says where the old unit went', async () => {
      const user = userEvent.setup();
      await openSwapDialog(user);

      await user.click(screen.getByRole('button', { name: /^Replace$/ }));

      expect(mockSwapItemLot).not.toHaveBeenCalled();
    });

    // Destroyed, handed back to the pharmacy, or pulled for a later exchange:
    // all three take it off the truck, and which one happened is the part only
    // the crew knows.
    it.each([
      ['Disposed of', 'discarded'],
      ['Exchanged now', 'returned_for_exchange'],
      ['Exchange later', 'awaiting_exchange'],
    ])('sends %s as the disposition of the lot it retires', async (label, expected) => {
      const user = userEvent.setup();
      mockSwapItemLot.mockResolvedValue(freshResult);
      await openSwapDialog(user);

      await user.click(screen.getByRole('button', { name: label }));
      await user.click(screen.getByRole('button', { name: /^Replace$/ }));

      await waitFor(() =>
        expect(mockSwapItemLot).toHaveBeenCalledWith('ti-1', 'inv-lot-1', 1, {
          disposition: expected,
          deployedLotId: 'dl-old',
        })
      );
    });

    it('clears the expiry verdict once the old lot is off the truck', async () => {
      const user = userEvent.setup();
      mockSwapItemLot.mockResolvedValue(freshResult);
      await openSwapDialog(user);

      await user.click(screen.getByRole('button', { name: 'Disposed of' }));
      await user.click(screen.getByRole('button', { name: /^Replace$/ }));

      // The scalar date alone never did this: soonest-expiration reads the
      // collection, so the item stayed EXPIRED and force-failed.
      await waitFor(() => expect(screen.queryByText('EXPIRED')).not.toBeInTheDocument());
      expect(screen.getByText('0/1')).toBeInTheDocument();
    });

    // The position a crew is most likely to be standing in front of: expired
    // by its own date, with no lot rows to point at. Asking only when there is
    // a row to name left this one topping up, so the expired units stayed
    // aboard and the item read EXPIRED straight after the swap.
    it('still asks, and still replaces, when the units were never lot-tracked', async () => {
      const user = userEvent.setup();
      mockSwapItemLot.mockResolvedValue({ ...freshResult, replacedLotNumber: 'OLD-1' });
      mockGetItemLots.mockResolvedValue([
        { id: 'inv-lot-1', lot_number: 'NEW-9', expiration_date: '2030-01-01', quantity: 5 },
      ]);
      render({ hasExpiration: true, expirationDate: '2020-01-01', inventoryItemId: 'inv-1' });
      expect(await screen.findByText('EXPIRED')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^Swap$/ }));
      await screen.findByText('NEW-9');
      await user.click(screen.getByRole('button', { name: 'Exchange later' }));
      await user.click(screen.getByRole('button', { name: /^Replace$/ }));

      // No deployedLotId: there is no row to name, and the disposition alone
      // is what tells the server this is a replacement.
      await waitFor(() =>
        expect(mockSwapItemLot).toHaveBeenCalledWith('ti-1', 'inv-lot-1', 1, {
          disposition: 'awaiting_exchange',
        })
      );
    });

    // The crew standing at the compartment is the one who replaces the unit.
    // Requiring a manage right left them looking at an expired item with ready
    // stock on the shelf and nothing to do but find an officer.
    it('is reachable by a crew member who can only submit checks', async () => {
      const user = userEvent.setup();
      mockCheckPermission.mockImplementation((p: unknown) => p === 'equipment_check.submit');
      mockSwapItemLot.mockResolvedValue(freshResult);
      await openSwapDialog(user);

      await user.click(screen.getByRole('button', { name: 'Disposed of' }));
      await user.click(screen.getByRole('button', { name: /^Replace$/ }));

      await waitFor(() => expect(mockSwapItemLot).toHaveBeenCalledOnce());
    });

    it('stays out of reach for a member who can only read checks', async () => {
      mockCheckPermission.mockImplementation((p: unknown) => p === 'equipment_check.view');
      render(expiredItem);

      expect(await screen.findByRole('button', { name: /^Swap$/ })).toBeDisabled();
    });

    it('tops a position up without retiring anything when nothing aboard is expired', async () => {
      const user = userEvent.setup();
      mockSwapItemLot.mockResolvedValue({ ...freshResult, replacedLotNumber: undefined, disposition: undefined });
      mockGetItemLots.mockResolvedValue([
        { id: 'inv-lot-1', lot_number: 'NEW-9', expiration_date: '2030-01-01', quantity: 5 },
      ]);
      render({
        hasExpiration: true,
        expirationDate: '2030-01-01',
        inventoryItemId: 'inv-1',
        lotsAboard: [{ id: 'dl-ok', lotNumber: 'OK-1', expirationDate: '2030-06-01', quantity: 1, isExpired: false }],
      });
      await user.click(await screen.findByRole('button', { name: /^Swap$/ }));
      await screen.findByText('NEW-9');

      await user.click(screen.getByRole('button', { name: /^Swap in$/ }));

      await waitFor(() => expect(mockSwapItemLot).toHaveBeenCalledWith('ti-1', 'inv-lot-1', 1, undefined));
    });
  });

  it('renders an expired item safely under React Strict Mode', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithRouter(
      <StrictMode>
        <EquipmentCheckForm
          shiftId="shift-1"
          template={template({ hasExpiration: true, expirationDate: '2020-01-01' }) as never}
        />
      </StrictMode>
    );

    expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/update.*while rendering|cannot update/i);
    consoleError.mockRestore();
  });
});
