import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getApparatusOptions, cloneEquipmentCheckTemplate, toastSuccess, toastError } = vi.hoisted(() => ({
  getApparatusOptions: vi.fn(),
  cloneEquipmentCheckTemplate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: toastError } }));
vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: (...args: unknown[]) => getApparatusOptions(...args) as unknown,
  },
}));
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    cloneEquipmentCheckTemplate: (...args: unknown[]) => cloneEquipmentCheckTemplate(...args) as unknown,
  },
}));

// Repository convention: service dependencies above are mocked before this import.
import { CloneChecklistDialog } from './CloneChecklistDialog';

const TEMPLATE = { id: 'tpl-1', name: 'Engine 1 start of shift' };

function renderDialog(overrides: Partial<React.ComponentProps<typeof CloneChecklistDialog>> = {}) {
  const onClose = vi.fn();
  const onCloned = vi.fn();
  render(<CloneChecklistDialog template={TEMPLATE} onClose={onClose} onCloned={onCloned} {...overrides} />);
  return { onClose, onCloned };
}

describe('CloneChecklistDialog', () => {
  beforeEach(() => {
    getApparatusOptions.mockReset();
    cloneEquipmentCheckTemplate.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    getApparatusOptions.mockResolvedValue({
      source: 'apparatus',
      options: [
        { id: 'app-e2', name: 'Engine 2', unit_number: 'E2', apparatus_type: 'engine', source: 'apparatus' },
        { id: 'app-t1', name: 'Truck 1', apparatus_type: 'ladder', source: 'apparatus' },
        // An option without an id cannot be a clone target and must not be offered.
        { name: 'Engine (type)', apparatus_type: 'engine', source: 'apparatus' },
      ],
    });
  });

  it('sends the chosen apparatus id, never a typed name, to the clone call', async () => {
    const user = userEvent.setup();
    const cloned = { id: 'tpl-2', name: 'Engine 2 - Engine 1 start of shift' };
    cloneEquipmentCheckTemplate.mockResolvedValue(cloned);
    const { onCloned } = renderDialog();

    const select = await screen.findByLabelText('Copy onto');
    await user.selectOptions(select, 'app-e2');
    await user.click(screen.getByRole('button', { name: 'Copy checklist' }));

    await waitFor(() => expect(cloneEquipmentCheckTemplate).toHaveBeenCalledWith('tpl-1', 'app-e2'));
    expect(onCloned).toHaveBeenCalledWith(cloned);
    expect(toastSuccess).toHaveBeenCalledWith('Copied as "Engine 2 - Engine 1 start of shift"');
  });

  it('labels each apparatus by unit number and name, and skips options without an id', async () => {
    renderDialog();

    await screen.findByLabelText('Copy onto');
    expect(screen.getByRole('option', { name: 'E2 — Engine 2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Truck 1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Engine (type)' })).not.toBeInTheDocument();
  });

  it('refuses to submit until an apparatus is chosen', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByLabelText('Copy onto');
    await user.click(screen.getByRole('button', { name: 'Copy checklist' }));

    expect(screen.getByText('Choose the apparatus to copy onto.')).toBeInTheDocument();
    expect(cloneEquipmentCheckTemplate).not.toHaveBeenCalled();
  });

  it('explains, and disables copying, when the department has no full apparatus records', async () => {
    getApparatusOptions.mockReset();
    getApparatusOptions.mockResolvedValue({
      source: 'basic',
      options: [{ id: 'basic-1', name: 'Engine 1', apparatus_type: 'engine', source: 'basic' }],
    });
    renderDialog();

    expect(await screen.findByText(/There is no apparatus to copy onto/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Copy onto')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy checklist' })).toBeDisabled();
  });

  it('keeps the dialog open and reports the error when the copy is refused', async () => {
    const user = userEvent.setup();
    cloneEquipmentCheckTemplate.mockRejectedValue(new Error('Target apparatus not found'));
    const { onCloned } = renderDialog();

    await user.selectOptions(await screen.findByLabelText('Copy onto'), 'app-t1');
    await user.click(screen.getByRole('button', { name: 'Copy checklist' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onCloned).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Copy onto')).toBeInTheDocument();
  });

  it('renders nothing while no template is set', () => {
    renderDialog({ template: null });
    expect(screen.queryByText('Copy checklist to an apparatus')).not.toBeInTheDocument();
    expect(getApparatusOptions).not.toHaveBeenCalled();
  });
});
