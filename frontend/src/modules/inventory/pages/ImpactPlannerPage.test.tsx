import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetOptions = vi.fn();
const mockAnalyzeImpact = vi.fn();
const mockCreateReorderFromPlan = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getImpactPlannerOptions: (...a: unknown[]) => mockGetOptions(...a) as unknown,
    analyzeImpact: (...a: unknown[]) => mockAnalyzeImpact(...a) as unknown,
    createReorderFromPlan: (...a: unknown[]) => mockCreateReorderFromPlan(...a) as unknown,
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
  replacement_aware: false,
  members: [
    {
      user_id: 'u1', full_name: 'Amy Adams', membership_number: '001',
      rank: 'firefighter', station: 'Station 1', status: 'active',
      needed_size: 'M', has_size_on_file: true, has_related_item: false,
      needs_replacement: false, related_item_names: [], email: 'amy@x.org', phone: '555-1',
    },
    {
      user_id: 'u2', full_name: 'Bob Baker', membership_number: '002',
      rank: 'firefighter', station: 'Station 1', status: 'active',
      needed_size: 'L', has_size_on_file: true, has_related_item: true,
      needs_replacement: false, related_item_names: ['Old Jacket'], email: 'bob@x.org', phone: '555-2',
    },
  ],
};

describe('ImpactPlannerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOptions.mockResolvedValue(OPTIONS);
    mockAnalyzeImpact.mockResolvedValue(RESULT);
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

    // Select a related category so the "Existing" column renders.
    // Two selects exist: [0] related category, [1] size field.
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0] as HTMLSelectElement, 'cat-jacket');

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
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1] as HTMLSelectElement, 'jacket');
    const withStock = screen.getAllByRole('combobox');
    await user.selectOptions(withStock[2] as HTMLSelectElement, 'cat-jacket');

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

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1] as HTMLSelectElement, 'jacket');
    const withStock = screen.getAllByRole('combobox');
    await user.selectOptions(withStock[2] as HTMLSelectElement, 'cat-jacket');
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

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1] as HTMLSelectElement, 'jacket');
    const withStock = screen.getAllByRole('combobox');
    await user.selectOptions(withStock[2] as HTMLSelectElement, 'cat-jacket');
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
          needs_replacement: true, related_item_names: ['Worn Jacket'],
        },
      ],
    });
    renderWithRouter(<ImpactPlannerPage />);
    expect(await screen.findByText('Quartermaster')).toBeInTheDocument();

    // Selecting a related category reveals the replacement-aware checkbox.
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0] as HTMLSelectElement, 'cat-jacket');
    await user.click(screen.getByRole('checkbox', { name: /needing replacement/i }));
    await user.click(screen.getByRole('button', { name: /Analyze Impact/i }));

    expect(await screen.findByText('1 to replace')).toBeInTheDocument();
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(mockAnalyzeImpact).toHaveBeenCalledWith(
      expect.objectContaining({ related_category_id: 'cat-jacket', replacement_aware: true }),
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
