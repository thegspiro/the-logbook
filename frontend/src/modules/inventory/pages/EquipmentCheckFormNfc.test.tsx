/**
 * What a tapped NFC tag does to a check in progress.
 *
 * The tap control itself (reading, resolving, ordering) is tested in
 * CheckNfcTap.test.tsx and stubbed here; these drive the form's handler with
 * the server's answers and check where the form goes and what it records.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryNfcResolveCheckResponse } from '../types/nfc';

const { captured, nfc } = vi.hoisted(() => ({
  captured: {
    onResolved: null as ((tap: InventoryNfcResolveCheckResponse) => string) | null,
    templateId: null as string | null,
  },
  nfc: { enabled: true, supported: true },
}));

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults: vi.fn().mockResolvedValue({}),
    getLastCheckSeals: vi.fn().mockResolvedValue({}),
    submitEquipmentCheck: vi.fn(),
    submitStandaloneCheck: vi.fn(),
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
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: () => true,
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
vi.mock('../hooks/useInventoryNfcEnabled', () => ({
  useInventoryNfcEnabled: (shouldCheck = true) => ({
    enabled: shouldCheck && nfc.enabled,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('../../../constants/nfc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../constants/nfc')>()),
  isNfcSupported: () => nfc.supported,
}));
vi.mock('../components/CheckNfcTap', () => ({
  default: (props: { templateId: string; onResolved: (tap: InventoryNfcResolveCheckResponse) => string }) => {
    captured.onResolved = props.onResolved;
    captured.templateId = props.templateId;
    return <div data-testid="nfc-tap" />;
  },
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const item = (over: Record<string, unknown>) => ({
  compartmentId: 'cab',
  sortOrder: 0,
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...over,
});

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
      items: [item({ id: 'radio', name: 'Portable radio', checkType: 'function' })],
    },
    {
      id: 'bag',
      templateId: 'tmpl-1',
      name: 'Airway bag',
      sortOrder: 1,
      items: [
        item({ id: 'gauze', compartmentId: 'bag', name: 'Roller gauze', checkType: 'count', requiredQuantity: 10 }),
      ],
    },
    {
      id: 'pocket',
      templateId: 'tmpl-1',
      name: 'Front pocket',
      sortOrder: 0,
      parentCompartmentId: 'bag',
      items: [item({ id: 'igel', compartmentId: 'pocket', name: 'i-gel size 4', checkType: 'function' })],
    },
  ],
});

const compartmentTap = (id: string, name: string): InventoryNfcResolveCheckResponse => ({
  kind: 'compartment',
  tag_id: 'tag-1',
  compartment_id: id,
  compartment_name: name,
  item_name: null,
  template_item_ids: [],
});

const itemTap = (name: string, ids: string[]): InventoryNfcResolveCheckResponse => ({
  kind: 'item',
  tag_id: 'tag-2',
  compartment_id: null,
  compartment_name: null,
  item_name: name,
  template_item_ids: ids,
});

const fire = (tap: InventoryNfcResolveCheckResponse): string => {
  let message = '';
  act(() => {
    message = captured.onResolved?.(tap) ?? '';
  });
  return message;
};

describe('EquipmentCheckForm NFC taps', () => {
  const scrollIntoView = vi.fn();
  const originalScroll = Element.prototype.scrollIntoView;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    captured.onResolved = null;
    captured.templateId = null;
    nfc.enabled = true;
    nfc.supported = true;
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScroll;
  });

  describe('in the sweep', () => {
    const renderSweep = () =>
      renderWithRouter(
        <EquipmentCheckForm shiftId="shift-1" template={template() as never} experience="sweep" onBack={vi.fn()} />
      );

    it('offers the tap control for this template', async () => {
      renderSweep();
      expect(await screen.findByTestId('nfc-tap')).toBeInTheDocument();
      expect(captured.templateId).toBe('tmpl-1');
    });

    it('jumps to a tapped compartment, pocket included', async () => {
      renderSweep();
      await screen.findByRole('heading', { name: 'Cab' });

      expect(fire(compartmentTap('pocket', 'Front pocket'))).toBe('Front pocket.');
      expect(await screen.findByText(/Stop 2 of 2/)).toBeVisible();
      expect(screen.getByText(/Front pocket/)).toBeVisible();
    });

    it('marks an unanswered pass/fail row present, once', async () => {
      renderSweep();
      await screen.findByRole('heading', { name: 'Cab' });

      expect(fire(itemTap('Portable radio 3', ['radio']))).toBe('Portable radio 3: marked present.');
      // The answer was recorded: a second tap finds nothing left to answer.
      expect(fire(itemTap('Portable radio 3', ['radio']))).toBe('Portable radio 3 is already answered.');
    });

    it('brings a count on screen without inventing a number', async () => {
      renderSweep();
      await screen.findByRole('heading', { name: 'Cab' });

      expect(fire(itemTap('Gauze case', ['gauze']))).toBe('Gauze case found. Finish its check on screen.');
      expect(await screen.findByText(/Stop 2 of 2/)).toBeVisible();
    });

    it('says so when the compartment has no stop on this walk', async () => {
      renderSweep();
      await screen.findByRole('heading', { name: 'Cab' });
      expect(fire(compartmentTap('gone', 'Old tray'))).toBe('Old tray has nothing to check on this list.');
    });
  });

  describe('in the accordion', () => {
    const renderList = () =>
      renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template() as never} onBack={vi.fn()} />);

    it('scrolls to a tapped compartment’s card', async () => {
      renderList();
      await screen.findByTestId('nfc-tap');

      expect(fire(compartmentTap('bag', 'Airway bag'))).toBe('Airway bag.');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    });

    it('scrolls to the first item of a pocket merged into its bag’s card', async () => {
      renderList();
      await screen.findByTestId('nfc-tap');

      expect(fire(compartmentTap('pocket', 'Front pocket'))).toBe('Front pocket.');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement;
      expect(scrolled.textContent).toContain('i-gel size 4');
    });
  });

  it('is not offered in the builder’s preview', async () => {
    renderWithRouter(
      <EquipmentCheckForm shiftId="preview" template={template() as never} previewMode experience="sweep" />
    );
    await screen.findByRole('heading', { name: 'Cab' });
    expect(screen.queryByTestId('nfc-tap')).not.toBeInTheDocument();
  });

  it('is not offered where Web NFC is unavailable', async () => {
    nfc.supported = false;
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template() as never} experience="sweep" onBack={vi.fn()} />
    );
    await screen.findByRole('heading', { name: 'Cab' });
    expect(screen.queryByTestId('nfc-tap')).not.toBeInTheDocument();
  });
});
