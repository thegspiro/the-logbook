/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const getTemplate = vi.fn();
const addCheckItemsBulk = vi.fn();

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    addCheckItemsBulk: (...args: unknown[]) => addCheckItemsBulk(...args),
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: () => boolean }) => unknown) =>
    selector({ checkPermission: () => false }),
}));

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
    {
      id: 'bag',
      templateId: 'template-1',
      name: 'Medical bag',
      sortOrder: 1,
      containerType: 'bag',
      parentCompartmentId: 'cab',
      items: [],
    },
    {
      id: 'section',
      templateId: 'template-1',
      name: 'Supplies',
      sortOrder: 2,
      containerType: 'compartment',
      isHeader: true,
      items: [],
    },
  ],
};

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/templates/template-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/templates/:templateId" element={<EquipmentCheckTemplateBuilder />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

describe('EquipmentCheckTemplateBuilder responsive actions', () => {
  beforeEach(() => {
    getTemplate.mockResolvedValue(template);
    addCheckItemsBulk.mockReset();
  });

  it('exposes every item action from the phone overflow without drag and drop', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    expect(trigger.closest('details')).toHaveClass('sm:hidden');
    await user.click(trigger);
    const menu = trigger.closest('details') as HTMLElement;
    expect(within(menu).getByRole('button', { name: 'Rename' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Move up' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Move down' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Duplicate' })).toBeVisible();
    expect(within(menu).getByLabelText(/current destination Cab/i)).toHaveTextContent('Cab / Medical bag');
    expect(within(menu).getByRole('button', { name: 'Delete' })).toHaveClass('text-red-600');
    await user.click(within(menu).getByRole('button', { name: 'Duplicate' }));
    expect(menu).not.toHaveAttribute('open');
  });

  it('offers hierarchy-aware compartment movement and omits section headers', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Medical bag');
    await user.click(trigger);
    const menu = trigger.closest('details') as HTMLElement;
    expect(within(menu).getByRole('button', { name: 'Rename' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Duplicate' })).toBeVisible();
    const destination = within(menu).getByLabelText(/current destination Cab/i);
    expect(destination).toHaveTextContent('Cab (current)');
    expect(destination).not.toHaveTextContent('Supplies');
    expect(within(menu).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(menu).getByRole('button', { name: 'Move down' })).toBeDisabled();
    expect(within(menu).getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  it('shows rapid additions immediately, keeps focus, and serializes them per compartment', async () => {
    const user = userEvent.setup();
    let finishFirst: ((value: unknown) => void) | undefined;
    addCheckItemsBulk
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockResolvedValueOnce({
        items: [{ ...template.compartments[0]?.items[0], id: 'batteries', name: 'Spare batteries' }],
      });
    renderBuilder();
    const input = (
      await screen.findAllByPlaceholderText(/Search inventory or type a new item name/)
    )[0] as HTMLInputElement;

    await user.type(input, 'Flashlight{Enter}Spare batteries{Enter}');

    expect(screen.getByText('Flashlight')).toBeVisible();
    expect(screen.getByText('Spare batteries')).toBeVisible();
    expect(screen.getAllByText('Saving…')).toHaveLength(2);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(1);

    finishFirst?.({ items: [{ ...template.compartments[0]?.items[0], id: 'flashlight', name: 'Flashlight' }] });
    expect(await screen.findByLabelText('Expand Flashlight')).toBeVisible();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(2);
  });

  it('retains a failed sibling and retries it with the same idempotency key', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ items: [{ ...template.compartments[0]?.items[0], id: 'vest', name: 'Safety vest' }] });
    renderBuilder();
    const input = (
      await screen.findAllByPlaceholderText(/Search inventory or type a new item name/)
    )[0] as HTMLInputElement;
    await user.type(input, 'Safety vest{Enter}');

    expect(await screen.findByText('Not saved')).toBeVisible();
    const firstKey = addCheckItemsBulk.mock.calls[0]?.[2];
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Expand Safety vest')).toBeVisible();
    expect(addCheckItemsBulk.mock.calls[1]?.[2]).toBe(firstKey);
    expect(screen.getByText('Radio')).toBeVisible();
  });

  it('ignores repeated Enter events after clearing the submitted value', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk.mockResolvedValue({
      items: [{ ...template.compartments[0]?.items[0], id: 'light', name: 'Light' }],
    });
    renderBuilder();
    const input = (
      await screen.findAllByPlaceholderText(/Search inventory or type a new item name/)
    )[0] as HTMLInputElement;
    await user.type(input, 'Light{Enter}{Enter}');
    expect(await screen.findByLabelText('Expand Light')).toBeVisible();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(1);
  });
});
