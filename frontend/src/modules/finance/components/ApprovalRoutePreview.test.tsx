/**
 * The route a request would take, as the server reports it. The panel asks
 * once the amount settles, says who each step waits on, and never lets a slow
 * answer for an earlier amount replace a later one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ApprovalRoutePreview as RoutePreview } from '../types';

const mockRoutePreview = vi.fn();
vi.mock('../services/api', () => ({
  approvalChainService: {
    routePreview: (...args: unknown[]) => mockRoutePreview(...args) as unknown,
  },
}));

import { ApprovalRoutePreview } from './ApprovalRoutePreview';

const route = (overrides: Partial<RoutePreview> = {}): RoutePreview => ({
  chainName: 'Purchases over $500',
  manual: false,
  secondApproverRequired: false,
  steps: [
    {
      name: 'Officer review',
      stepOrder: 1,
      stepType: 'approval',
      assigneeLabel: 'Lieutenant position',
      autoApproved: false,
    },
    { name: 'Petty cash', stepOrder: 2, stepType: 'approval', assigneeLabel: 'Treasurer position', autoApproved: true },
    { name: 'Tell the accountant', stepOrder: 3, stepType: 'notification', assigneeLabel: null, autoApproved: false },
  ],
  ...overrides,
});

/** Lets the debounce run out and the answer arrive. */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
};

describe('ApprovalRoutePreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRoutePreview.mockReset();
    mockRoutePreview.mockResolvedValue(route());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once the amount settles, with the budget line', async () => {
    render(<ApprovalRoutePreview entityType="purchase_request" amount={750} budgetId="b-1" />);
    expect(mockRoutePreview).not.toHaveBeenCalled();

    await settle();

    expect(mockRoutePreview).toHaveBeenCalledTimes(1);
    expect(mockRoutePreview).toHaveBeenCalledWith({
      entityType: 'purchase_request',
      amount: '750.00',
      budgetId: 'b-1',
    });
  });

  it('says who each step waits on', async () => {
    render(<ApprovalRoutePreview entityType="purchase_request" amount={750} />);
    await settle();

    expect(screen.getByText('Purchases over $500')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'Officer review — waits on Lieutenant position',
      'Petty cash — approved automatically at this amount',
      'Tell the accountant — notified, nothing to approve',
    ]);
  });

  it('says when a finance approver decides by hand', async () => {
    mockRoutePreview.mockResolvedValue(route({ manual: true, chainName: null, steps: [] }));
    render(<ApprovalRoutePreview entityType="check_request" amount={40} />);
    await settle();

    expect(screen.getByText(/a finance approver decides it by hand/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says when a second approver is needed', async () => {
    mockRoutePreview.mockResolvedValue(route({ secondApproverRequired: true }));
    render(<ApprovalRoutePreview entityType="purchase_request" amount={5000} />);
    await settle();

    expect(screen.getByText(/needs a second, different approver/)).toBeInTheDocument();
  });

  it('asks nothing and shows nothing until there is an amount', async () => {
    const { container } = render(<ApprovalRoutePreview entityType="expense_report" amount={0} />);
    await settle();

    expect(mockRoutePreview).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when the route cannot be loaded', async () => {
    mockRoutePreview.mockRejectedValue(new Error('offline'));
    render(<ApprovalRoutePreview entityType="purchase_request" amount={750} />);
    await settle();

    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
  });

  it('reads an answer that is not a route as a failure instead of throwing', async () => {
    mockRoutePreview.mockResolvedValue({});
    render(<ApprovalRoutePreview entityType="purchase_request" amount={750} />);
    await settle();

    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
  });

  it("does not keep an earlier amount's route once a later one fails", async () => {
    mockRoutePreview.mockResolvedValueOnce(route()).mockRejectedValueOnce(new Error('offline'));
    const { rerender } = render(<ApprovalRoutePreview entityType="purchase_request" amount={750} />);
    await settle();
    expect(screen.getByText('Purchases over $500')).toBeInTheDocument();

    rerender(<ApprovalRoutePreview entityType="purchase_request" amount={9000} />);
    await settle();

    expect(screen.queryByText('Purchases over $500')).not.toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
  });

  it('keeps the answer for the latest amount when an earlier one arrives late', async () => {
    let answerEarlier: (value: RoutePreview) => void = () => undefined;
    mockRoutePreview
      .mockImplementationOnce(
        () =>
          new Promise<RoutePreview>((resolve) => {
            answerEarlier = resolve;
          })
      )
      .mockResolvedValueOnce(route({ chainName: 'Large purchases' }));
    const { rerender } = render(<ApprovalRoutePreview entityType="purchase_request" amount={100} />);
    await settle();

    rerender(<ApprovalRoutePreview entityType="purchase_request" amount={9000} />);
    await settle();
    await act(async () => {
      answerEarlier(route({ chainName: 'Small purchases' }));
      await Promise.resolve();
    });

    expect(screen.getByText('Large purchases')).toBeInTheDocument();
    expect(screen.queryByText('Small purchases')).not.toBeInTheDocument();
  });
});
