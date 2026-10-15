import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockAdd = vi.fn();
const mockResolve = vi.fn();
const toastError = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getSuggestions: (...a: unknown[]) => mockList(...a) as unknown,
    addSuggestion: (...a: unknown[]) => mockAdd(...a) as unknown,
    resolveSuggestion: (...a: unknown[]) => mockResolve(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...a: unknown[]) => toastError(...a) as unknown, success: vi.fn() },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { SuggestionsPanel } from './SuggestionsPanel';
import { useMinutesSuggestions } from '../hooks/useMinutesSuggestions';
import { renderWithRouter } from '../../../test/utils';
import type { MinutesStatus, MinutesSuggestion, SectionEntry } from '../types/minutes';

const sections: SectionEntry[] = [
  { order: 0, key: 'new_business', title: 'New Business', content: 'x' },
  { order: 1, key: 'treasurer_report', title: "Treasurer's Report", content: 'y' },
];

const open: MinutesSuggestion = {
  id: 'g1',
  minutes_id: 'm1',
  section_key: 'new_business',
  comment: 'The vote was 5-1',
  proposed_text: 'Motion carried 5-1.',
  status: 'open',
  created_by_name: 'Blake Brown',
  created_at: '2026-10-03T12:00:00Z',
};

describe('SuggestionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockAdd.mockReset();
    mockResolve.mockReset();
    mockList.mockResolvedValue([]);
    mockAdd.mockResolvedValue(open);
    mockResolve.mockResolvedValue({ ...open, status: 'accepted' });
  });

  // The panel is handed its suggestions by the page; this stands in for the page.
  const Harness: React.FC<{ status: MinutesStatus; canManage: boolean }> = ({ status, canManage }) => {
    const shared = useMinutesSuggestions('m1', status);
    return <SuggestionsPanel minutesId="m1" status={status} sections={sections} canManage={canManage} {...shared} />;
  };
  const render = (status: MinutesStatus, canManage: boolean) =>
    renderWithRouter(<Harness status={status} canManage={canManage} />);

  it('invites a member to suggest from a section, or about the minutes as a whole', async () => {
    render('submitted', false);

    expect(await screen.findByRole('heading', { name: 'Your suggestions' })).toBeInTheDocument();
    expect(screen.getByText(/on the section you want/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest a change to the minutes as a whole' })).toBeInTheDocument();
    expect(screen.queryByLabelText('What should change?')).not.toBeInTheDocument();
  });

  it('sends a whole-minutes suggestion with no section and no wording', async () => {
    const user = userEvent.setup();
    render('submitted', false);

    await user.click(await screen.findByRole('button', { name: 'Suggest a change to the minutes as a whole' }));
    await user.type(screen.getByLabelText('What should change?'), 'Please add the guest list');
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    expect(mockAdd).toHaveBeenCalledWith('m1', {
      section_key: undefined,
      comment: 'Please add the guest list',
      proposed_text: undefined,
    });
    await waitFor(() => expect(screen.queryByLabelText('What should change?')).not.toBeInTheDocument());
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('gives a secretary no form at all: they answer suggestions, they do not make them', async () => {
    render('submitted', true);

    expect(await screen.findByRole('heading', { name: 'Suggested changes (0)' })).toBeInTheDocument();
    expect(screen.getByText('No suggestions yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suggest a change/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('What should change?')).not.toBeInTheDocument();
  });

  it('offers no form once the minutes are adopted, but still shows the member their own', async () => {
    mockList.mockResolvedValue([{ ...open, status: 'accepted', resolved_by_name: 'Sam Secretary' }]);
    render('approved', false);

    expect(await screen.findByText('The vote was 5-1')).toBeInTheDocument();
    expect(screen.queryByLabelText('What should change?')).not.toBeInTheDocument();
    expect(screen.getByText(/Accepted by Sam Secretary/)).toBeInTheDocument();
  });

  it('shows nothing when nothing is circulating and nothing was suggested', async () => {
    const { container } = render('draft', false);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lets a secretary accept, and resolves with the status only', async () => {
    mockList.mockResolvedValue([open]);
    const user = userEvent.setup();
    render('submitted', true);

    expect(await screen.findByRole('heading', { name: 'Suggested changes (1)' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('New Business')).toBeInTheDocument();
    expect(screen.getByText('Motion carried 5-1.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(mockResolve).toHaveBeenCalledWith('m1', 'g1', 'accepted', undefined);
  });

  it('asks for a reason, optionally, when declining', async () => {
    mockList.mockResolvedValue([open]);
    mockResolve.mockResolvedValue({ ...open, status: 'declined' });
    const user = userEvent.setup();
    render('submitted', true);

    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await user.type(await screen.findByLabelText(/Reason/), 'The vote was 6-0');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('m1', 'g1', 'declined', 'The vote was 6-0'));
  });

  it('does not offer Accept or Decline once the minutes are adopted', async () => {
    mockList.mockResolvedValue([open]);
    render('approved', true);

    await screen.findByText('The vote was 5-1');
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('does not offer Accept to a plain member', async () => {
    mockList.mockResolvedValue([open]);
    render('submitted', false);

    await screen.findByText('The vote was 5-1');
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});
