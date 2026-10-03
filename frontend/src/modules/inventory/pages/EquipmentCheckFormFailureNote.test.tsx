/**
 * A failure the crew member reports has to say what is wrong.
 *
 * The officer's failure report showed "Flashlights work — Ryan Hill — -": the
 * note was optional, so a member could tap Fail and submit, and nobody knew
 * whether the light was dead, cracked or just missing a battery. Failures the
 * record already explains — a count or reading below its minimum — still need
 * no note.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockSubmitCheck = vi.fn();
const mockListPendingChecks = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    updateDeployedLot: vi.fn(),
    uploadCheckItemPhotos: vi.fn(),
    swapItemLot: vi.fn(),
  },
}));

vi.mock('../../../services/inventoryService', () => ({
  inventoryService: { getItemLots: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../utils/offlineQueue', () => ({
  enqueueCheck: vi.fn(),
  listPendingChecks: (...a: unknown[]) => mockListPendingChecks(...a) as unknown,
  dequeueCheck: vi.fn(),
  markCheckSubmitted: vi.fn().mockResolvedValue({}),
  markPhotosUploaded: vi.fn().mockResolvedValue({}),
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => true }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const item = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  compartmentId: 'c-1',
  name,
  sortOrder: 0,
  checkType: 'function',
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...overrides,
});

const template = (items: ReturnType<typeof item>[]) => ({
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Engine Morning Check',
  checkTiming: 'start_of_shift',
  apparatusId: 'app-1',
  isActive: true,
  sortOrder: 0,
  compartments: [{ id: 'c-1', templateId: 'tmpl-1', name: 'Cab', sortOrder: 0, items }],
});

const submitButton = () => screen.getByRole('button', { name: /submit report/i });

describe('EquipmentCheckForm — a failed item needs a note', () => {
  beforeEach(() => {
    mockGetLastCheckResults.mockReset().mockResolvedValue({});
    mockListPendingChecks.mockReset().mockResolvedValue([]);
    mockSubmitCheck.mockReset().mockResolvedValue({ id: 'check-1', items: [] });
  });

  it('opens a required note field and holds Submit until it is filled', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template([item('ti-1', 'Flashlights work')]) as never} />
    );

    await user.click(await screen.findByRole('button', { name: 'Fail' }));

    const note = await screen.findByRole('textbox', { name: "What's wrong with Flashlights work (required)" });
    expect(note).toHaveAttribute('aria-required', 'true');
    expect(note).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(note).toHaveFocus());
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText("1 failed item needs a note saying what's wrong.")).toBeInTheDocument();

    await user.type(note, 'Bulb dead, battery fine');

    expect(note).toHaveAttribute('aria-invalid', 'false');
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(/needs a note/)).not.toBeInTheDocument();
  });

  it('does not accept a note of only spaces', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template([item('ti-1', 'Flashlights work')]) as never} />
    );

    await user.click(await screen.findByRole('button', { name: 'Fail' }));
    await user.type(await screen.findByRole('textbox', { name: /required/ }), '   ');

    expect(submitButton()).toBeDisabled();
  });

  it('asks for a note on Out of service as well', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template([item('ti-1', 'Thermal camera')]) as never} />
    );

    await user.click(await screen.findByRole('button', { name: 'Fail' }));
    await user.click(await screen.findByRole('button', { name: 'Out of service' }));

    expect(
      await screen.findByRole('textbox', { name: "What's wrong with Thermal camera (required)" })
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('files the note with the failed item', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template([item('ti-1', 'Flashlights work')]) as never} />
    );

    await user.click(await screen.findByRole('button', { name: 'Fail' }));
    await user.type(await screen.findByRole('textbox', { name: /required/ }), 'Lens cracked');
    await user.click(submitButton());

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalledTimes(1));
    const payload = mockSubmitCheck.mock.calls[0]?.[1] as {
      items: { template_item_id: string; status: string; notes?: string }[];
    };
    expect(payload.items).toEqual([
      expect.objectContaining({ template_item_id: 'ti-1', status: 'fail', notes: 'Lens cracked' }),
    ]);
  });

  it('needs no note for a count below its minimum, which the number explains', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={
          template([
            item('ti-1', 'Portable radios', { checkType: 'count', requiredQuantity: 3, expectedQuantity: 4 }),
          ]) as never
        }
      />
    );

    await user.type(await screen.findByRole('spinbutton', { name: 'Portable radios quantity found' }), '1');

    expect(screen.queryByRole('textbox', { name: /required/ })).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('needs no note for a pass', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template([item('ti-1', 'Flashlights work')]) as never} />
    );

    await user.click(await screen.findByRole('button', { name: 'Pass' }));

    expect(screen.queryByRole('textbox', { name: /required/ })).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });
});
