import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

const { loadEquipmentCheckDraft } = vi.hoisted(() => ({ loadEquipmentCheckDraft: vi.fn() }));

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getLastCheckResults: vi.fn().mockResolvedValue({}),
    getLastCheckSeals: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../services/inventoryService', () => ({ inventoryService: { getItemLots: vi.fn() } }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../utils/offlineQueue', () => ({
  listPendingChecks: vi.fn().mockResolvedValue([]),
  pendingCount: vi.fn().mockResolvedValue(0),
  CHECK_QUEUE_MAX_RETRIES: 5,
}));
vi.mock('../../utils/equipmentCheckDrafts', () => ({
  loadEquipmentCheckDraft,
  saveEquipmentCheckDraft: vi.fn().mockResolvedValue(undefined),
  deleteEquipmentCheckDraft: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', organization_id: 'org-1' },
    checkPermission: () => true,
  }),
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  compartmentId: 'comp-1',
  name: 'Oxygen cylinder',
  sortOrder: 0,
  checkType: 'function',
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...overrides,
});

const template = (itemOverrides: Record<string, unknown> = {}, compartmentOverrides: Record<string, unknown> = {}) => ({
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Daily check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  isActive: true,
  sortOrder: 0,
  contentRevision: 2,
  compartments: [
    {
      id: 'comp-1',
      templateId: 'tmpl-1',
      name: 'Airway bag',
      sortOrder: 0,
      items: [item(itemOverrides)],
      ...compartmentOverrides,
    },
  ],
});

function definition(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Oxygen cylinder',
    compartmentId: 'comp-1',
    checkType: 'function',
    hasExpiration: false,
    ...overrides,
  };
}

function saveDraft(
  options: {
    definition?: Record<string, unknown>;
    seals?: Record<string, unknown>;
    sealDefinition?: Record<string, unknown>;
  } = {}
) {
  loadEquipmentCheckDraft.mockResolvedValue({
    updatedAt: Date.now(),
    contents: {
      contentRevision: 1,
      results: { 'item-1': { status: 'pass' } },
      overallNotes: '',
      itemDefinitions: { 'item-1': options.definition ?? definition() },
      seals: options.seals ?? {},
      sealDefinitions: options.sealDefinition ? { 'comp-1': options.sealDefinition } : {},
    },
  });
}

describe('equipment-check draft revision reconciliation', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    loadEquipmentCheckDraft.mockReset();
  });

  it('requires confirmation after the check type changes', async () => {
    saveDraft();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template({ checkType: 'count' }) as never} />);
    expect(await screen.findByText('Oxygen cylinder: Function → Count')).toBeInTheDocument();
    expect(screen.getByText('1 changed items must be checked again.')).toBeInTheDocument();
  });

  it('reports an answered item deleted from the active template', async () => {
    saveDraft();
    const active = template();
    active.compartments = active.compartments.map((compartment) => ({ ...compartment, items: [] }));
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={active as never} />);
    expect(await screen.findByText('Oxygen cylinder: removed from checklist')).toBeInTheDocument();
  });

  it('requires confirmation after the quantity requirement changes', async () => {
    saveDraft({ definition: definition({ checkType: 'count', requiredQuantity: 2 }) });
    renderWithRouter(
      <EquipmentCheckForm shiftId="shift-1" template={template({ checkType: 'count', requiredQuantity: 3 }) as never} />
    );
    expect(await screen.findByText('Oxygen cylinder: requirements changed')).toBeInTheDocument();
  });

  it('does not restore a seal-cleared answer after seal configuration is removed', async () => {
    saveDraft({
      seals: { 'comp-1': { sealNumber: '123', intact: true, confirmed: true, cleared: true } },
      sealDefinition: { name: 'Airway bag', isSealed: true, clearableItemIds: ['item-1'] },
    });
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template({}, { isSealed: false }) as never} />);
    expect(await screen.findByText('Oxygen cylinder: seal requirement changed')).toBeInTheDocument();
  });
});
