import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ApprovalChain } from '../types';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockAddStep = vi.fn();
const mockUpdateStep = vi.fn();
const mockDeleteStep = vi.fn();
const mockCategoryList = vi.fn();
const mockGetRoles = vi.fn();
const mockGetPermissions = vi.fn();
const mockGetUsers = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  approvalChainService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    create: (...args: unknown[]) => mockCreate(...args) as unknown,
    update: (...args: unknown[]) => mockUpdate(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
    addStep: (...args: unknown[]) => mockAddStep(...args) as unknown,
    updateStep: (...args: unknown[]) => mockUpdateStep(...args) as unknown,
    deleteStep: (...args: unknown[]) => mockDeleteStep(...args) as unknown,
  },
  budgetCategoryService: {
    list: (...args: unknown[]) => mockCategoryList(...args) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  roleService: {
    getRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown,
    getPermissions: (...args: unknown[]) => mockGetPermissions(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

// Imported after the mocks so the store binds to the mocked services.
import ApprovalChainsSettingsPage from './ApprovalChainsSettingsPage';
import { useFinanceStore } from '../store/financeStore';

const chain: ApprovalChain = {
  id: 'c1',
  organizationId: 'org1',
  name: 'Large purchases',
  appliesTo: 'purchase_request',
  isDefault: false,
  isActive: true,
  createdBy: 'u1',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  description: 'Over $1,000',
  steps: [
    {
      id: 's1',
      chainId: 'c1',
      stepOrder: 1,
      name: 'Treasurer review',
      stepType: 'approval',
      approverType: 'position',
      approverValue: 'treasurer',
      allowSelfApproval: false,
      required: true,
      createdAt: '2026-09-01T00:00:00Z',
    },
    {
      id: 's2',
      chainId: 'c1',
      stepOrder: 2,
      name: 'Trustee sign-off',
      stepType: 'approval',
      approverType: 'email',
      approverValue: 'trustee@example.org',
      allowSelfApproval: false,
      autoApproveUnder: '500.00',
      required: true,
      createdAt: '2026-09-01T00:00:00Z',
    },
  ],
};

async function openChainSteps() {
  const user = userEvent.setup();
  renderWithRouter(<ApprovalChainsSettingsPage />);
  await user.click(await screen.findByRole('button', { name: /^Large purchases/ }));
  return user;
}

describe('ApprovalChainsSettingsPage', () => {
  beforeEach(() => {
    for (const mock of [
      mockList,
      mockCreate,
      mockUpdate,
      mockDelete,
      mockAddStep,
      mockUpdateStep,
      mockDeleteStep,
      mockCategoryList,
      mockGetRoles,
      mockGetPermissions,
      mockGetUsers,
      mockToastSuccess,
      mockToastError,
    ]) {
      mock.mockReset();
    }
    mockList.mockResolvedValue([structuredClone(chain)]);
    mockCategoryList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ ...structuredClone(chain), id: 'c2', steps: [] });
    mockUpdate.mockResolvedValue(structuredClone(chain));
    mockAddStep.mockResolvedValue({});
    mockUpdateStep.mockResolvedValue({});
    mockDeleteStep.mockResolvedValue(undefined);
    mockGetRoles.mockResolvedValue([{ id: 'r1', slug: 'treasurer', name: 'Treasurer' }]);
    mockGetPermissions.mockResolvedValue([{ name: 'finance.approve', description: '', category: 'finance' }]);
    mockGetUsers.mockResolvedValue([{ id: 'u9', username: 'jdoe', first_name: 'Jane', last_name: 'Doe' }]);
    useFinanceStore.setState({ approvalChains: [], budgetCategories: [], isLoading: false, error: null });
  });

  it('adds a step at the end of the chain with a snake_case payload, then re-fetches', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText('Step name'), 'Board review');
    await user.selectOptions(within(dialog).getByLabelText('Approver type'), 'email');
    await user.type(within(dialog).getByLabelText('Approver email'), 'board@example.org');
    await user.type(within(dialog).getByLabelText('Auto-approve under ($)'), '250');
    const listCallsBefore = mockList.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Add step' }));

    await waitFor(() =>
      expect(mockAddStep).toHaveBeenCalledWith('c1', {
        step_order: 3,
        name: 'Board review',
        step_type: 'approval',
        approver_type: 'email',
        approver_value: 'board@example.org',
        allow_self_approval: false,
        auto_approve_under: '250',
      })
    );
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(listCallsBefore));
    expect(mockToastSuccess).toHaveBeenCalledWith('Step added');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refuses an invalid approver email without calling the API', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText('Step name'), 'Board review');
    await user.selectOptions(within(dialog).getByLabelText('Approver type'), 'email');
    await user.type(within(dialog).getByLabelText('Approver email'), 'not-an-email');
    await user.click(within(dialog).getByRole('button', { name: 'Add step' }));

    expect(await within(dialog).findByText(/Enter one valid email address/)).toBeInTheDocument();
    expect(mockAddStep).not.toHaveBeenCalled();
  });

  it('offers positions from the positions list rather than a free-text box', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Edit Treasurer review' }));
    const dialog = screen.getByRole('dialog');
    const picker = within(dialog).getByLabelText('Position');
    expect(picker.tagName).toBe('SELECT');
    expect(picker).toHaveValue('treasurer');
  });

  it('sends null for an optional field the user cleared on edit', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Edit Trustee sign-off' }));
    const dialog = screen.getByRole('dialog');

    const autoApprove = within(dialog).getByLabelText('Auto-approve under ($)');
    expect(autoApprove).toHaveValue('500.00');
    await user.clear(autoApprove);
    await user.click(within(dialog).getByRole('button', { name: 'Save step' }));

    await waitFor(() =>
      expect(mockUpdateStep).toHaveBeenCalledWith('c1', 's2', {
        name: 'Trustee sign-off',
        step_type: 'approval',
        approver_type: 'email',
        approver_value: 'trustee@example.org',
        allow_self_approval: false,
        auto_approve_under: null,
      })
    );
  });

  it('clears approver fields when a step becomes a notification step', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Edit Treasurer review' }));
    const dialog = screen.getByRole('dialog');

    await user.selectOptions(within(dialog).getByLabelText('Step type'), 'notification');
    await user.click(within(dialog).getByRole('button', { name: 'Save step' }));

    await waitFor(() =>
      expect(mockUpdateStep).toHaveBeenCalledWith('c1', 's1', {
        name: 'Treasurer review',
        step_type: 'notification',
        approver_type: null,
        approver_value: null,
        allow_self_approval: false,
        auto_approve_under: null,
      })
    );
  });

  it('deletes a step only after confirmation, then renumbers the rest', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Delete Treasurer review' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/including the record of who approved or denied it/)).toBeInTheDocument();
    expect(mockDeleteStep).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete step' }));

    await waitFor(() => expect(mockDeleteStep).toHaveBeenCalledWith('c1', 's1'));
    await waitFor(() => expect(mockUpdateStep).toHaveBeenCalledWith('c1', 's2', { step_order: 1 }));
    expect(mockUpdateStep).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('Step deleted');
  });

  it('does not delete a step when the confirmation is declined', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Delete Treasurer review' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteStep).not.toHaveBeenCalled();
  });

  it('moves a step up by swapping the two step_order values', async () => {
    const user = await openChainSteps();
    expect(screen.getByRole('button', { name: 'Move Treasurer review up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Trustee sign-off down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Trustee sign-off up' }));

    await waitFor(() => expect(mockUpdateStep).toHaveBeenCalledTimes(2));
    expect(mockUpdateStep).toHaveBeenCalledWith('c1', 's2', { step_order: 1 });
    expect(mockUpdateStep).toHaveBeenCalledWith('c1', 's1', { step_order: 2 });
  });

  it('shows the server error and keeps the dialog open when saving a step fails', async () => {
    mockAddStep.mockRejectedValue(new Error('Approval chain not found'));
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Step name'), 'Board review');
    await user.click(within(dialog).getByRole('button', { name: 'Add step' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Approval chain not found'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('shows the server error when a reorder fails', async () => {
    mockUpdateStep.mockRejectedValue(new Error('Approval chain step not found'));
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Move Trustee sign-off up' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Approval chain step not found'));
  });

  it('edits the chain name, description and active flag', async () => {
    const user = await openChainSteps();
    await user.click(screen.getByRole('button', { name: 'Edit chain Large purchases' }));
    const dialog = screen.getByRole('dialog');

    await user.clear(within(dialog).getByLabelText('Description'));
    await user.click(within(dialog).getByRole('checkbox', { name: /Active/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save chain' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('c1', {
        name: 'Large purchases',
        description: null,
        is_active: false,
      })
    );
  });

  it('creates a chain with the snake_case fields the backend reads', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApprovalChainsSettingsPage />);
    await screen.findByRole('button', { name: /^Large purchases/ });

    await user.click(screen.getByRole('button', { name: 'New Chain' }));
    await user.type(screen.getByPlaceholderText('e.g., Large Purchase Approval'), 'Small purchases');
    await user.type(screen.getByPlaceholderText('No limit'), '1000');
    await user.click(screen.getByRole('button', { name: 'Create Chain' }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Small purchases',
        description: undefined,
        applies_to: 'purchase_request',
        min_amount: undefined,
        max_amount: '1000',
        budget_category_id: undefined,
        is_default: false,
      })
    );
  });
});
