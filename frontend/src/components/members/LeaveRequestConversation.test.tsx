/**
 * The conversation on a leave request: questions, answers and changed dates.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaveApproverActions, LeaveMemberActions, LeaveRequestDetails } from './LeaveRequestConversation';
import type { LeaveRequest } from '../../types/leaveRequest';

const request = (overrides: Partial<LeaveRequest>): LeaveRequest => ({
  id: 'r1',
  user_id: 'u1',
  member_name: 'Alex Johnson',
  leave_type: 'personal',
  start_date: '2027-03-01',
  end_date: '2027-03-31',
  reason: null,
  status: 'pending',
  decision_rule: 'majority',
  created_at: '2027-02-20T12:00:00Z',
  decided_at: null,
  decided_by_name: null,
  leave_id: null,
  votes: [],
  approvals: 0,
  denials: 0,
  approver_count: 3,
  approvals_needed: 2,
  can_vote: true,
  my_vote: null,
  ...overrides,
});

describe('LeaveRequestDetails', () => {
  it('says which leave a request extends', () => {
    render(
      <LeaveRequestDetails
        request={request({ extends_leave: { start_date: '2026-12-01', end_date: '2027-02-28' } })}
        audience="member"
      />
    );
    expect(screen.getByText(/Extends your leave of Dec 1, 2026 – Feb 28, 2027/)).toBeInTheDocument();
  });

  it('shows changed dates waiting on the member, and the thread in order', () => {
    render(
      <LeaveRequestDetails
        request={request({
          awaiting: 'proposal',
          proposal: {
            start_date: '2027-03-15',
            end_date: null,
            proposed_by_name: 'Captain Lopez',
            proposed_at: '2027-02-21T12:00:00Z',
          },
          messages: [
            { kind: 'question', author_name: 'Captain Lopez', body: 'Which dates?', created_at: 'x' },
            { kind: 'answer', author_name: 'Alex Johnson', body: 'March.', created_at: 'x' },
            { kind: 'proposal', author_name: 'Captain Lopez', body: null, created_at: 'x' },
          ],
        })}
        audience="approver"
      />
    );
    expect(screen.getByText(/Captain Lopez would approve Mar 15, 2027 – no end date instead/)).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'Captain Lopez asked: “Which dates?”',
      'Alex Johnson answered: “March.”',
      'Captain Lopez proposed changed dates',
    ]);
  });
});

describe('LeaveApproverActions', () => {
  it('asks a question', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn().mockResolvedValue(true);
    render(
      <LeaveApproverActions request={request({ can_ask: true })} busy={false} onAsk={onAsk} onPropose={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'Ask a question' }));
    await user.type(screen.getByLabelText('Your question to the member'), 'Which dates exactly?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(onAsk).toHaveBeenCalledWith('Which dates exactly?');
  });

  it('proposes changed dates, with no end date when ticked', async () => {
    const user = userEvent.setup();
    const onPropose = vi.fn().mockResolvedValue(true);
    render(
      <LeaveApproverActions request={request({ can_ask: true })} busy={false} onAsk={vi.fn()} onPropose={onPropose} />
    );

    await user.click(screen.getByRole('button', { name: 'Approve with changes' }));
    const first = screen.getByLabelText('First day');
    await user.clear(first);
    await user.type(first, '2027-03-15');
    await user.click(screen.getByRole('checkbox', { name: 'No end date' }));
    await user.type(screen.getByLabelText('Note to the member (optional)'), 'Later start');
    await user.click(screen.getByRole('button', { name: 'Send changed dates' }));

    expect(onPropose).toHaveBeenCalledWith('2027-03-15', null, 'Later start');
  });

  it('offers nothing while the request waits on its member', () => {
    const { container } = render(
      <LeaveApproverActions request={request({ can_ask: false })} busy={false} onAsk={vi.fn()} onPropose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LeaveMemberActions', () => {
  it('answers a question', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn().mockResolvedValue(true);
    render(
      <LeaveMemberActions
        request={request({ can_answer: true })}
        busy={false}
        onAnswer={onAnswer}
        onRespond={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('Your answer'), 'All of March.');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(onAnswer).toHaveBeenCalledWith('All of March.');
  });

  it('accepts or keeps their own dates', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn().mockResolvedValue(true);
    render(
      <LeaveMemberActions
        request={request({ can_respond_to_changes: true })}
        busy={false}
        onAnswer={vi.fn()}
        onRespond={onRespond}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Accept these dates' }));
    await user.click(screen.getByRole('button', { name: 'Keep my dates' }));

    expect(onRespond.mock.calls).toEqual([[true], [false]]);
  });
});
