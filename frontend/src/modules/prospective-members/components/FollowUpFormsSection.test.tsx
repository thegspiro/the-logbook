/**
 * FollowUpFormsSection — follow-up forms on the applicant's page: progress,
 * Send now / Resend, and the contact-change flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Applicant, FollowUpFormRequest } from '../types';

const mockList = vi.fn();
const mockSend = vi.fn();
const mockReview = vi.fn();
let canManage = true;

vi.mock('../services/api', () => ({
  followUpFormService: {
    list: (...a: unknown[]) => mockList(...a) as unknown,
    send: (...a: unknown[]) => mockSend(...a) as unknown,
    reviewContactChange: (...a: unknown[]) => mockReview(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    select({ checkPermission: (p: string) => p === 'prospective_members.manage' && canManage }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import FollowUpFormsSection from './FollowUpFormsSection';

const applicant = (overrides: Partial<Applicant> = {}): Applicant =>
  ({
    id: 'prospect-1',
    status: 'active',
    current_stage_id: 'step-2',
    current_stage_name: 'Background Questionnaire',
    current_stage_type: 'follow_up_form',
    ...overrides,
  }) as Applicant;

const request = (overrides: Partial<FollowUpFormRequest> = {}): FollowUpFormRequest => ({
  id: 'request-1',
  prospect_id: 'prospect-1',
  step_id: 'step-2',
  step_name: 'Background Questionnaire',
  form_id: 'form-1',
  form_name: 'Background Questionnaire',
  status: 'sent',
  last_sent_at: '2026-10-29T12:00:00Z',
  changes: [],
  contact_changed: false,
  ...overrides,
});

describe('FollowUpFormsSection', () => {
  beforeEach(() => {
    canManage = true;
    mockList.mockReset();
    mockSend.mockReset();
    mockReview.mockReset();
    mockList.mockResolvedValue([request()]);
  });

  it('shows the form and offers a resend while it is unsubmitted', async () => {
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });

  it('resends to the request’s own stage', async () => {
    mockSend.mockResolvedValue(request({ last_sent_at: '2026-10-29T13:00:00Z' }));
    const user = userEvent.setup();
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    await user.click(await screen.findByRole('button', { name: 'Resend' }));

    expect(mockSend).toHaveBeenCalledWith('prospect-1', 'step-2');
  });

  it('offers no resend for a submitted form, and lists what it changed', async () => {
    mockList.mockResolvedValue([
      request({
        status: 'submitted',
        submitted_at: '2026-10-29T14:00:00Z',
        changes: [
          { field: 'address_street', label: 'Street address', old: '12 Old Road', new: '9 New Lane', applied: true },
        ],
      }),
    ]);
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    expect(await screen.findByText('Submitted', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
    expect(screen.getByText(/12 Old Road/)).toHaveTextContent('Street address: 12 Old Road → 9 New Lane');
  });

  it('flags a contact change until it is marked reviewed', async () => {
    const changed = request({
      status: 'submitted',
      contact_changed: true,
      changes: [{ field: 'email', label: 'Email', old: 'old@example.org', new: 'taken@example.org', applied: false }],
    });
    mockList.mockResolvedValue([changed]);
    mockReview.mockResolvedValue({
      ...changed,
      contact_change_reviewed_at: '2026-10-29T15:00:00Z',
      contact_change_reviewed_by_name: 'Captain Lopez',
    });
    const user = userEvent.setup();
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    expect(await screen.findByText(/Contact details changed/)).toBeInTheDocument();
    expect(screen.getByText(/Not applied: another open application uses this address/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    expect(mockReview).toHaveBeenCalledWith('prospect-1', 'request-1');
    await waitFor(() => expect(screen.queryByText(/Contact details changed/)).not.toBeInTheDocument());
    expect(screen.getByText(/Contact change reviewed by Captain Lopez/)).toBeInTheDocument();
  });

  it('shows how many reminders have gone out', async () => {
    mockList.mockResolvedValue([request({ reminder_count: 2, last_reminder_at: '2026-10-29T09:05:00Z' })]);
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    expect(await screen.findByText(/2 of 3/)).toBeInTheDocument();
    expect(screen.getByText('Reminders')).toBeInTheDocument();
  });

  it('says nothing about reminders before the first one', async () => {
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    await screen.findByText('Sent');
    expect(screen.queryByText('Reminders')).not.toBeInTheDocument();
  });

  it('offers Send now when the applicant is on a follow-up stage with nothing sent', async () => {
    mockList.mockResolvedValue([]);
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    expect(await screen.findByText('Not sent yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument();
  });

  it('shows a viewer the progress but none of the buttons', async () => {
    canManage = false;
    mockList.mockResolvedValue([request({ contact_changed: true })]);
    render(<FollowUpFormsSection applicant={applicant()} tz="UTC" />);

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  });

  it('renders nothing for an applicant who never reached a follow-up stage', async () => {
    mockList.mockResolvedValue([]);
    const { container } = render(
      <FollowUpFormsSection applicant={applicant({ current_stage_type: 'checklist' })} tz="UTC" />
    );

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
