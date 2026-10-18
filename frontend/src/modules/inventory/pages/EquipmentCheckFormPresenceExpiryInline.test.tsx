/**
 * Present / Absent lines, crew-dated replacements, and items placed directly
 * on the checklist — the three changes the department asked for on
 * 2026-10-18. The server enforces each rule too; these pin what the crew sees.
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
  listOwnPendingChecks: (...a: unknown[]) => mockListPendingChecks(...a) as unknown,
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

/** A date `days` from today, as the form compares them: local `YYYY-MM-DD`. */
const isoFromToday = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type SubmittedPayload = { items: Record<string, unknown>[] };
const submittedItems = () => (mockSubmitCheck.mock.calls[0]?.[1] as SubmittedPayload).items;

describe('EquipmentCheckForm — Present / Absent lines', () => {
  beforeEach(() => {
    mockGetLastCheckResults.mockReset().mockResolvedValue({});
    mockListPendingChecks.mockReset().mockResolvedValue([]);
    mockSubmitCheck.mockReset().mockResolvedValue({ id: 'check-1', items: [] });
  });

  it('answers in Present / Absent, without Not on truck or Out of service', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={template([item('ti-1', 'Map book', { checkType: 'presence' })]) as never}
      />
    );

    expect(await screen.findByRole('button', { name: 'Present' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Absent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pass' })).not.toBeInTheDocument();
    // On a Works line these two appear once it fails; Absent offers neither.
    await user.click(screen.getByRole('button', { name: 'Absent' }));
    expect(screen.queryByRole('button', { name: /Not on truck/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Out of service/ })).not.toBeInTheDocument();
  });

  it('files Absent as a failure with no note required', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EquipmentCheckForm
        shiftId="shift-1"
        template={template([item('ti-1', 'Map book', { checkType: 'presence' })]) as never}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Absent' }));

    expect(screen.queryByText(/needs a note/)).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    await user.click(submitButton());
    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalled());
    expect(submittedItems()[0]).toEqual(expect.objectContaining({ status: 'fail', check_type: 'presence' }));
  });
});

describe('EquipmentCheckForm — dating a replacement', () => {
  beforeEach(() => {
    mockGetLastCheckResults.mockReset().mockResolvedValue({});
    mockListPendingChecks.mockReset().mockResolvedValue([]);
    mockSubmitCheck.mockReset().mockResolvedValue({ id: 'check-1', items: [] });
  });

  const expiredPads = (overrides: Record<string, unknown> = {}) =>
    item('ti-1', 'AED pads', {
      checkType: 'expiry',
      hasExpiration: true,
      expirationDate: isoFromToday(-3),
      ...overrides,
    });

  it('lets the crew record an in-date replacement, which clears the expiry', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template([expiredPads()]) as never} />);

    expect(await screen.findByRole('button', { name: 'Pass' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Replaced it? Enter the new date' }));
    await user.type(screen.getByLabelText("New unit's expiration"), isoFromToday(200));
    await user.type(screen.getByLabelText('Lot number (optional)'), 'NEW-7');
    await user.click(screen.getByRole('button', { name: 'Pass' }));
    await user.click(submitButton());

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalled());
    expect(submittedItems()[0]).toEqual(
      expect.objectContaining({
        status: 'pass',
        expiration_found: isoFromToday(200),
        lot_found: 'NEW-7',
        is_expired: false,
      })
    );
  });

  it('refuses a replacement date that has already passed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template([expiredPads()]) as never} />);

    await user.click(await screen.findByRole('button', { name: 'Replaced it? Enter the new date' }));
    await user.type(screen.getByLabelText("New unit's expiration"), isoFromToday(-1));

    expect(screen.getByText('That date has passed. Put an in-date unit aboard.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass' })).toBeDisabled();
  });

  it('does not offer the field on a line linked to inventory', async () => {
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template([expiredPads({ inventoryItemId: 'inv-1' })]) as never} />
    );

    await screen.findByRole('button', { name: 'Pass' });
    expect(screen.queryByRole('button', { name: 'Replaced it? Enter the new date' })).not.toBeInTheDocument();
  });
});

describe('EquipmentCheckForm — items placed on the checklist', () => {
  beforeEach(() => {
    mockGetLastCheckResults.mockReset().mockResolvedValue({});
    mockListPendingChecks.mockReset().mockResolvedValue([]);
    mockSubmitCheck.mockReset().mockResolvedValue({ id: 'check-1', items: [] });
  });

  it('shows them with no location heading, in their place among the locations', async () => {
    const base = template([item('ti-1', 'Flashlight')]);
    const withInline = {
      ...base,
      compartments: [
        {
          id: 'loose',
          templateId: 'tmpl-1',
          name: '',
          sortOrder: 0,
          isInline: true,
          items: [{ ...item('ti-2', 'Radios'), compartmentId: 'loose' }],
        },
        ...base.compartments.map((c) => ({ ...c, sortOrder: 1 })),
        { id: 'empty', templateId: 'tmpl-1', name: '', sortOrder: 2, isInline: true, items: [] },
      ],
    };
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={withInline as never} />);

    const inline = await screen.findByTestId('inline-items-loose');
    expect(inline).toHaveTextContent('Radios');
    expect(screen.queryByTestId('compartment-header-loose')).not.toBeInTheDocument();
    expect(screen.getByTestId('compartment-header-c-1')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-items-empty')).not.toBeInTheDocument();
  });
});
