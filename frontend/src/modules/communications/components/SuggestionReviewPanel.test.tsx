import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ReviewSuggestionDetail, ReviewSuggestionSummary } from '../types/suggestions';

const mockList = vi.fn();
const mockGet = vi.fn();
const mockOptions = vi.fn();
const mockForward = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    listForReview: (...args: unknown[]) => mockList(...args) as unknown,
    getForReview: (...args: unknown[]) => mockGet(...args) as unknown,
    getForwardOptions: (...args: unknown[]) => mockOptions(...args) as unknown,
    forward: (...args: unknown[]) => mockForward(...args) as unknown,
    updateDisposition: (...args: unknown[]) => mockUpdate(...args) as unknown,
    getReviewAttachment: vi.fn(),
  },
}));

import SuggestionReviewPanel from './SuggestionReviewPanel';

const summary = (overrides: Partial<ReviewSuggestionSummary> = {}): ReviewSuggestionSummary => ({
  id: 's1',
  boxId: 'b1',
  boxName: 'Complaints',
  title: 'Engine 2 bay door',
  isAnonymous: true,
  submitterName: null,
  disposition: 'new',
  messageCount: 0,
  attachmentCount: 0,
  createdAt: '2026-09-23T12:00:00Z',
  timestampPrecision: 'day',
  viaForward: false,
  ...overrides,
});

const detail = (overrides: Partial<ReviewSuggestionDetail> = {}): ReviewSuggestionDetail => ({
  id: 's1',
  boxId: 'b1',
  boxName: 'Complaints',
  title: 'Engine 2 bay door',
  details: 'It sticks.',
  isAnonymous: true,
  submitterName: null,
  followUpEnabled: false,
  canFollowUp: false,
  disposition: 'new',
  internalNote: null,
  attachments: [],
  messages: [],
  createdAt: '2026-09-23T12:00:00Z',
  timestampPrecision: 'day',
  canForward: true,
  viaForward: false,
  forwards: [],
  ...overrides,
});

describe('SuggestionReviewPanel forwarding', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockGet.mockReset();
    mockOptions.mockReset();
    mockForward.mockReset();
    mockList.mockResolvedValue({ items: [summary()], total: 1 });
    mockGet.mockResolvedValue(detail());
    mockOptions.mockResolvedValue({
      positions: [{ id: 'p1', name: 'Apparatus Officer' }],
      members: [{ id: 'u1', name: 'Drew Member' }],
    });
  });

  it('forwards to the chosen positions and members', async () => {
    mockForward.mockResolvedValue(
      detail({ forwards: [{ id: 'f1', kind: 'position', targetId: 'p1', name: 'Apparatus Officer' }] })
    );
    renderWithRouter(<SuggestionReviewPanel boxes={[]} selectedId="s1" onSelect={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Forward' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Apparatus Officer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Forward' }));

    expect(mockForward).toHaveBeenCalledWith('s1', { positionIds: ['p1'], memberIds: [] });
    expect(await screen.findByRole('button', { name: 'Withdraw forward to Apparatus Officer' })).toBeInTheDocument();
  });

  it('lets a forward recipient review but not forward or withdraw', async () => {
    mockList.mockResolvedValue({ items: [summary({ viaForward: true })], total: 1 });
    mockGet.mockResolvedValue(
      detail({
        canForward: false,
        viaForward: true,
        forwards: [{ id: 'f1', kind: 'member', targetId: 'me', name: 'Me Member' }],
      })
    );
    renderWithRouter(<SuggestionReviewPanel boxes={[]} selectedId="s1" onSelect={vi.fn()} />);

    expect(await screen.findByText('Forwarded to you')).toBeInTheDocument();
    expect(await screen.findByText(/was forwarded to you/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw forward/ })).not.toBeInTheDocument();
  });
});

describe('SuggestionReviewPanel disposition changes', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockList.mockResolvedValue({ items: [summary(), summary({ id: 's2', title: 'Hose tester' })], total: 2 });
    mockGet.mockResolvedValue(detail());
  });

  it('drops a closed submission from the Open list and tells the page', async () => {
    mockUpdate.mockResolvedValue(detail({ disposition: 'accepted' }));
    const onReviewed = vi.fn();
    renderWithRouter(<SuggestionReviewPanel boxes={[]} selectedId="s1" onSelect={vi.fn()} onReviewed={onReviewed} />);

    const user = userEvent.setup();
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Disposition' }), 'accepted');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Engine 2 bay door' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
    expect(within(screen.getByRole('list')).queryByText('Engine 2 bay door')).not.toBeInTheDocument();
    expect(onReviewed).toHaveBeenCalledTimes(1);
  });

  it('keeps a submission listed when only its note changes', async () => {
    mockUpdate.mockResolvedValue(detail({ internalNote: 'Asked the captain' }));
    const onReviewed = vi.fn();
    renderWithRouter(<SuggestionReviewPanel boxes={[]} selectedId="s1" onSelect={vi.fn()} onReviewed={onReviewed} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Internal note/), 'Asked the captain');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('s1', {
        disposition: 'new',
        internalNote: 'Asked the captain',
      })
    );
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    expect(onReviewed).not.toHaveBeenCalled();
  });
});
