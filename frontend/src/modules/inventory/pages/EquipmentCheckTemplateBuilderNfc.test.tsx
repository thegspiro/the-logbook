/* eslint-disable testing-library/no-node-access */
/**
 * The checklist builder's way into a compartment's NFC tags.
 *
 * The tags card itself is tested in NfcTagsCard.test.tsx and stubbed here;
 * these check that the builder offers it only where it can work — NFC switched
 * on, the compartment saved — and opens it for the right compartment.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const { getTemplate, nfc } = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  nfc: { enabled: true, checkedWith: [] as boolean[] },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/modules/scheduling', () => ({
  schedulingService: { getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }) },
}));
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args) as unknown,
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
    updateCompartment: vi.fn().mockResolvedValue({}),
    updateCheckItem: vi.fn().mockResolvedValue({}),
    reorderItems: vi.fn().mockResolvedValue(undefined),
    updateEquipmentCheckTemplate: vi.fn(),
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (state: { checkPermission: () => boolean }) => unknown) => {
    const state = { checkPermission: () => false };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/modules/inventory/hooks/useInventoryNfcEnabled', () => ({
  useInventoryNfcEnabled: (shouldCheck = true) => {
    nfc.checkedWith.push(shouldCheck);
    return { enabled: shouldCheck && nfc.enabled, loading: false, refresh: vi.fn() };
  },
}));
vi.mock('@/modules/inventory/components/NfcTagsCard', () => ({
  NfcTagsCard: (props: { targetKind: string; targetId: string; targetName: string }) => (
    <div data-testid="nfc-tags-card">
      {props.targetKind}:{props.targetId}:{props.targetName}
    </div>
  ),
}));

import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const template = {
  id: 'template-1',
  organizationId: 'org-1',
  name: 'Engine check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'cab',
      templateId: 'template-1',
      name: 'Cab',
      sortOrder: 0,
      containerType: 'compartment',
      items: [
        {
          id: 'radio',
          compartmentId: 'cab',
          name: 'Radio',
          sortOrder: 0,
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
  ],
};

const renderBuilder = (path = '/templates/template-1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route path="/templates/new" element={<EquipmentCheckTemplateBuilder />} />
          <Route path="/templates/:templateId" element={<EquipmentCheckTemplateBuilder />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('EquipmentCheckTemplateBuilder compartment NFC tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    getTemplate.mockResolvedValue(structuredClone(template));
    nfc.enabled = true;
    nfc.checkedWith = [];
  });

  it('opens the tags card for the chosen compartment', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const trigger = await screen.findByLabelText('Actions for Cab');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'NFC tags' }));

    const dialog = await screen.findByRole('dialog', { name: 'NFC tags: Cab' });
    expect(within(dialog).getByTestId('nfc-tags-card')).toHaveTextContent('check_compartment:cab:Cab');
  });

  it('is not offered while NFC tracking is off', async () => {
    nfc.enabled = false;
    const user = userEvent.setup();
    renderBuilder();

    const trigger = await screen.findByLabelText('Actions for Cab');
    await user.click(trigger);
    expect(
      within(trigger.closest('details') as HTMLElement).queryByRole('button', { name: 'NFC tags' })
    ).not.toBeInTheDocument();
  });

  it('does not ask about NFC for a template that has not been saved', () => {
    renderBuilder('/templates/new');
    expect(nfc.checkedWith.length).toBeGreaterThan(0);
    expect(nfc.checkedWith.every((asked) => !asked)).toBe(true);
  });
});
