import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetOptions = vi.fn();
const mockAnalyzeImpact = vi.fn();
const mockCreateReorderFromPlan = vi.fn();
const mockExportPlanPdf = vi.fn();
const mockBulkIssueFromPlan = vi.fn();
const mockGetImpactPlans = vi.fn();
const mockCreateImpactPlan = vi.fn();
const mockDeleteImpactPlan = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getImpactPlannerOptions: (...a: unknown[]) => mockGetOptions(...a) as unknown,
    analyzeImpact: (...a: unknown[]) => mockAnalyzeImpact(...a) as unknown,
    createReorderFromPlan: (...a: unknown[]) => mockCreateReorderFromPlan(...a) as unknown,
    exportPlanPdf: (...a: unknown[]) => mockExportPlanPdf(...a) as unknown,
    bulkIssueFromPlan: (...a: unknown[]) => mockBulkIssueFromPlan(...a) as unknown,
    getImpactPlans: (...a: unknown[]) => mockGetImpactPlans(...a) as unknown,
    createImpactPlan: (...a: unknown[]) => mockCreateImpactPlan(...a) as unknown,
    deleteImpactPlan: (...a: unknown[]) => mockDeleteImpactPlan(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import ImpactPlannerPage from './ImpactPlannerPage';

const OPTIONS = {
  statuses: [
    { value: 'active', label: 'Active' },
    { value: 'retired', label: 'Retired' },
  ],
  membership_types: [{ value: 'active', label: 'Active' }],
  ranks: [{ value: 'firefighter', label: 'Firefighter' }],
  stations: ['Station 1', 'Station 2'],
  positions: [{ id: 'p1', name: 'Quartermaster' }],
  categories: [{ id: 'cat-jacket', name: 'Jackets', item_type: 'uniform' }],
  size_fields: [
    { value: 'shirt', label: 'Shirt' },
    { value: 'jacket', label: 'Jacket' },
  ],
};

const RESULT = {
  total_members: 3,
  members_with_related_item: 1,
  members_needing_item: 2,
  members_missing_sizes: 1,
  size_field: 'jacket',
  size_breakdown: [
    { size: 'L', total: 1, needing: 0 },
    { size: 'M', total: 1, needing: 1 },
    { size: 'Unknown', total: 1, needing: 1 },
  ],
  stock_checked: false,
  cost_estimated: false,
  members_needing_replacement: 0,
  members_over_allowance: 0,
  replacement_aware: false,
  allowance_aware: false,
  members: [
    {
      user_id: 'u1', full_name: 'Amy Adams', membership_number: '001',
      rank: 'firefighter', station: 'Station 1', status: 'active',
      needed_size: 'M', has_size_on_file: true, has_related_item: false,
      needs_replacement: false, over_allowance: false, related_item_names: [], email: 'amy@x.org', phone: '555-1',
    },
    {
      user_id: 'u2', full_name: 'Bob Baker', membership_number: '002',
      rank: 'firefighter', station: 'Station 1', status: 'active',
      needed_size: 'L', has_size_on_file: true, has_related_item: true,
      needs_replacement: false, over_allowance: false, related_item_names: ['Old Jacket'], email: 'bob@x.org', phone: '555-2',
    },
  ],
};

describe('ImpactPlannerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOptions.mockResolvedValue(OPTIONS);
    mockAnalyzeImpact.mockResolvedValue(RESULT);
    mockGetImpactPlans.mockResolvedValue([]);
  });

  it('loads filter options and shows the empty prompt', async () => {
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Quartermaster')).toBeInTheDocument();
    expect(screen.getByText(/run an analysis to see who is impacted/i)).toBeInTheDocument();
  });

  it('runs an analysis and renders summary, size breakdown, and members', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ImpactPlannerPage />);

    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Related category' }), 'cat-jacket',
    );

    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    expect(await screen.findByText('Members matched')).toBeInTheDocument();

    // Default request sends the active status preselected, plus the chosen category.
    expect(mockAnalyzeImpact).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['active'], related_category_id: 'cat-jacket' }),
    );

    expect(screen.getByText('Need the item')).toBeInTheDocument();
    expect(screen.getByText('Amy Adams')).toBeInTheDocument();
    expect(screen.getByText('Bob Baker')).toBeInTheDocument();
    // Member who already holds an item is flagged
    expect(screen.getByText('Has item')).toBeInTheDocument();
    expect(screen.getByText('Needs item')).toBeInTheDocument();
  });

  it('filters the member list by the search box', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));
    expect(await screen.findByText('Amy Adams')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Filter list…'), 'Bob');
    await waitFor(() => {
      expect(screen.queryByText('Amy Adams')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bob Baker')).toBeInTheDocument();
  });

  it('shows on-hand and to-buy when netting against stock', async () => {
    const user = userEvent.setup();
    mockAnalyzeImpact.mockResolvedValue({
      ...RESULT,
      stock_checked: true,
      total_to_purchase: 5,
      size_breakdown: [
        { size: 'M', total: 1, needing: 8, on_hand: 3, shortfall: 5 },
      ],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    // Choose a size field so the stock-source select appears, then a category.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Size needed' }), 'jacket',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Stock source' }), 'cat-jacket',
    );

    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    expect(await screen.findByText('5 to buy')).toBeInTheDocument();
    expect(screen.getByText(/3 on hand/)).toBeInTheDocument();
    expect(mockAnalyzeImpact).toHaveBeenCalledWith(
      expect.objectContaining({ size_field: 'jacket', stock_category_id: 'cat-jacket' }),
    );
  });

  it('shows estimated cost when stock is priced', async () => {
    const user = userEvent.setup();
    mockAnalyzeImpact.mockResolvedValue({
      ...RESULT,
      stock_checked: true,
      total_to_purchase: 2,
      cost_estimated: true,
      estimated_total_cost: 360,
      size_breakdown: [
        { size: 'M', total: 2, needing: 2, on_hand: 0, shortfall: 2, unit_cost: 180, estimated_cost: 360 },
      ],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Size needed' }), 'jacket',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Stock source' }), 'cat-jacket',
    );
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    expect(await screen.findByText('~$360.00 est.')).toBeInTheDocument();
  });

  it('creates reorder requests from the shortfall', async () => {
    const user = userEvent.setup();
    mockAnalyzeImpact.mockResolvedValue({
      ...RESULT,
      stock_checked: true,
      total_to_purchase: 5,
      size_breakdown: [
        { size: 'M', total: 1, needing: 8, on_hand: 3, shortfall: 5 },
      ],
    });
    mockCreateReorderFromPlan.mockResolvedValue({
      created_count: 1,
      total_quantity: 5,
      skipped_unknown_size: 0,
      reorder_requests: [{ id: 'r1', item_name: 'Jackets — M', size: 'M', quantity_requested: 5 }],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Size needed' }), 'jacket',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Stock source' }), 'cat-jacket',
    );
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    await user.click(await screen.findByRole('button', { name: /Create reorder request/i }));

    await waitFor(() => {
      expect(mockCreateReorderFromPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          size_field: 'jacket',
          stock_category_id: 'cat-jacket',
          urgency: 'normal',
        }),
      );
    });
    expect(await screen.findByText(/Created 1 reorder request/)).toBeInTheDocument();
  });

  it('flags members needing replacement when replacement-aware', async () => {
    const user = userEvent.setup();
    mockAnalyzeImpact.mockResolvedValue({
      ...RESULT,
      replacement_aware: true,
      members_needing_replacement: 1,
      members: [
        {
          user_id: 'u1', full_name: 'Amy Adams', membership_number: '001',
          rank: 'firefighter', station: 'Station 1', status: 'active',
          needed_size: 'M', has_size_on_file: true, has_related_item: false,
          needs_replacement: true, over_allowance: false, related_item_names: ['Worn Jacket'],
        },
      ],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Quartermaster')).toBeInTheDocument();

    // Selecting a related category reveals the replacement-aware checkbox.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Related category' }), 'cat-jacket',
    );
    await user.click(screen.getByRole('checkbox', { name: /needing replacement/i }));
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    expect(await screen.findByText('1 to replace')).toBeInTheDocument();
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(mockAnalyzeImpact).toHaveBeenCalledWith(
      expect.objectContaining({ related_category_id: 'cat-jacket', replacement_aware: true }),
    );
  });

  it('bulk-issues on-hand stock after confirmation', async () => {
    const user = userEvent.setup();
    mockAnalyzeImpact.mockResolvedValue({
      ...RESULT,
      stock_checked: true,
      total_to_purchase: 1,
      size_breakdown: [
        { size: 'M', total: 3, needing: 3, on_hand: 2, shortfall: 1 },
      ],
    });
    mockBulkIssueFromPlan.mockResolvedValue({
      issued_count: 2,
      skipped_count: 1,
      issued: [],
      skipped: [{ user_id: 'u9', name: 'No Size', reason: 'No size on file' }],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Size needed' }), 'jacket',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Stock source' }), 'cat-jacket',
    );
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    await user.click(await screen.findByRole('button', { name: /Issue on-hand stock/i }));
    // Confirm in the dialog
    await user.click(await screen.findByRole('button', { name: /^Issue items$/i }));

    await waitFor(() => {
      expect(mockBulkIssueFromPlan).toHaveBeenCalledWith(
        expect.objectContaining({ size_field: 'jacket', stock_category_id: 'cat-jacket' }),
      );
    });
    expect(await screen.findByText(/Issued to 2 members/)).toBeInTheDocument();
    expect(screen.getByText(/No size on file/)).toBeInTheDocument();
  });

  it('downloads a PDF summary of the plan', async () => {
    const user = userEvent.setup();
    mockExportPlanPdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const createUrl = vi.fn(() => 'blob:plan');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    // jsdom doesn't implement anchor click navigation; stub it.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));
    await screen.findByText('Amy Adams');

    await user.click(screen.getByRole('button', { name: /^PDF$/i }));

    await waitFor(() => {
      expect(mockExportPlanPdf).toHaveBeenCalledWith(
        expect.objectContaining({ statuses: ['active'] }),
      );
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('saves the current filters as a named plan', async () => {
    const user = userEvent.setup();
    mockCreateImpactPlan.mockResolvedValue({
      id: 'plan-1', organization_id: 'o1', name: 'Annual refresh',
      filters: { statuses: ['active'] }, created_at: '', updated_at: '',
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Quartermaster')).toBeInTheDocument();

    await user.click(screen.getByText('Save current filters as a plan'));
    await user.type(screen.getByPlaceholderText('Plan name'), 'Annual refresh');
    await user.click(screen.getByRole('button', { name: /Save plan/i }));

    await waitFor(() => {
      expect(mockCreateImpactPlan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Annual refresh' }),
      );
    });
    const [arg] = mockCreateImpactPlan.mock.calls[0] as [{ filters: { statuses?: string[] } }];
    expect(arg.filters.statuses).toEqual(['active']);
    // The saved plan appears in the dropdown
    expect(await screen.findByRole('option', { name: 'Annual refresh' })).toBeInTheDocument();
  });

  it('loads a saved plan and applies its filters', async () => {
    const user = userEvent.setup();
    mockGetImpactPlans.mockResolvedValue([
      {
        id: 'plan-1', organization_id: 'o1', name: 'Boots plan',
        filters: { size_field: 'boot', ranks: ['firefighter'] },
        created_at: '', updated_at: '',
      },
    ]);
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Quartermaster')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Saved plans' }), 'plan-1',
    );

    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));
    await waitFor(() => {
      expect(mockAnalyzeImpact).toHaveBeenCalledWith(
        expect.objectContaining({ size_field: 'boot', ranks: ['firefighter'] }),
      );
    });
  });

  it('flags members over their issuance allowance', async () => {
    const user = userEvent.setup();
    mockAnalyzeImpact.mockResolvedValue({
      ...RESULT,
      stock_checked: true,
      allowance_aware: true,
      members_over_allowance: 1,
      size_breakdown: [{ size: 'M', total: 1, needing: 1, on_hand: 0, shortfall: 1 }],
      members: [
        {
          user_id: 'u1', full_name: 'Amy Adams', membership_number: '001',
          rank: 'firefighter', station: 'Station 1', status: 'active',
          needed_size: 'M', has_size_on_file: true, has_related_item: false,
          needs_replacement: false, over_allowance: true, related_item_names: [],
        },
      ],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Firefighter')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Size needed' }), 'jacket',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Stock source' }), 'cat-jacket',
    );
    await user.click(screen.getByRole('checkbox', { name: /over their issuance allowance/i }));
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    expect(await screen.findByText('1 over allowance')).toBeInTheDocument();
    expect(screen.getByText('over allowance')).toBeInTheDocument();
    expect(mockAnalyzeImpact).toHaveBeenCalledWith(
      expect.objectContaining({ allowance_aware: true }),
    );
  });

  it('shows an error toast when options fail to load', async () => {
    mockGetOptions.mockRejectedValueOnce(new Error('boom'));
    renderWithRouter(<ImpactPlannerPage />);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.any(String));
    });
  });
});
