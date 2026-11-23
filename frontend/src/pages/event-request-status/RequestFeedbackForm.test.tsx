import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicFeedbackForm } from '../../types/event';

const getPublicFeedbackForm = vi.fn();
const sendPublicFeedback = vi.fn();
vi.mock('../../services/outreachFeedbackServices', () => ({
  outreachFeedbackService: {
    getPublicFeedbackForm: (...args: unknown[]) => getPublicFeedbackForm(...args) as unknown,
    sendPublicFeedback: (...args: unknown[]) => sendPublicFeedback(...args) as unknown,
  },
}));

import RequestFeedbackForm from './RequestFeedbackForm';

const field = (overrides: Partial<PublicFeedbackForm['fields'][number]>) => ({
  id: 'x',
  label: 'x',
  field_type: 'text',
  required: false,
  sort_order: 0,
  width: 'full',
  is_sensitive: false,
  ...overrides,
});

// The starter form's shape: a 1-5 rating, and "what could we do better"
// shown only at a rating of 3 or less.
const FORM: PublicFeedbackForm = {
  form_name: 'Outreach feedback',
  form_description: 'Thank you for inviting us.',
  organization_name: 'Oakville Fire Department',
  contact_name: 'Pat Requester',
  fields: [
    field({ id: 'rating', label: 'How did the visit go?', field_type: 'number', required: true, sort_order: 0 }),
    field({ id: 'well', label: 'What went well?', field_type: 'textarea', sort_order: 1 }),
    field({
      id: 'better',
      label: 'What could we do better?',
      field_type: 'textarea',
      sort_order: 2,
      condition_field_id: 'rating',
      condition_operator: 'at_most',
      condition_value: '3',
    }),
  ],
};

const conflict = () => Object.assign(new Error('Already sent'), { response: { status: 409 } });

describe('RequestFeedbackForm', () => {
  beforeEach(() => {
    getPublicFeedbackForm.mockReset();
    getPublicFeedbackForm.mockResolvedValue(FORM);
    sendPublicFeedback.mockReset();
    sendPublicFeedback.mockResolvedValue({ submitted_at: '2026-11-23T12:00:00Z', message: 'Thank you.' });
  });

  it('shows the follow-up question only while the rating is 3 or less', async () => {
    render(<RequestFeedbackForm token="tok" onSent={vi.fn()} />);
    const rating = await screen.findByLabelText(/How did the visit go/);

    expect(screen.queryByLabelText('What could we do better?')).not.toBeInTheDocument();
    await userEvent.type(rating, '2');
    expect(screen.getByLabelText('What could we do better?')).toBeInTheDocument();
    await userEvent.clear(rating);
    await userEvent.type(rating, '5');
    expect(screen.queryByLabelText('What could we do better?')).not.toBeInTheDocument();
  });

  it('asks for the required rating before sending', async () => {
    render(<RequestFeedbackForm token="tok" onSent={vi.fn()} />);
    await screen.findByLabelText(/How did the visit go/);

    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByText(/Some answers need attention/)).toBeInTheDocument();
    expect(screen.getByText(/How did the visit go\? is required/)).toBeInTheDocument();
    expect(sendPublicFeedback).not.toHaveBeenCalled();
  });

  it('sends only the answers still showing, then reports the response sent', async () => {
    const onSent = vi.fn();
    render(<RequestFeedbackForm token="tok" onSent={onSent} />);
    const rating = await screen.findByLabelText(/How did the visit go/);
    await userEvent.type(rating, '2');
    await userEvent.type(screen.getByLabelText('What could we do better?'), 'Arrive earlier');
    await userEvent.clear(rating);
    await userEvent.type(rating, '5');

    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(sendPublicFeedback).toHaveBeenCalledWith('tok', { rating: '5' });
  });

  it('treats a response already on file as sent', async () => {
    getPublicFeedbackForm.mockReset();
    getPublicFeedbackForm.mockRejectedValue(conflict());
    const onSent = vi.fn();
    render(<RequestFeedbackForm token="tok" onSent={onSent} />);

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  });
});
