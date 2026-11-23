import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { RequestPipelineSettings } from '../../types/event';

const getFeedbackFormOptions = vi.fn();
const createStarterFeedbackForm = vi.fn();
vi.mock('../../services/api', () => ({
  eventService: {
    getFeedbackFormOptions: (...args: unknown[]) => getFeedbackFormOptions(...args) as unknown,
    createStarterFeedbackForm: (...args: unknown[]) => createStarterFeedbackForm(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import FeedbackFormSetting from './FeedbackFormSetting';

const pipeline = (overrides: Partial<RequestPipelineSettings> = {}) =>
  ({
    min_lead_time_days: 14,
    default_assignee_id: null,
    public_progress_visible: false,
    accept_public_requests: true,
    public_daily_limit: 10,
    tasks: [],
    email_triggers: {},
    feedback_form_id: null,
    feedback_rating_field_id: null,
    ...overrides,
  }) as RequestPipelineSettings;

const OPTIONS = [
  { id: 'f1', name: 'Outreach feedback', rating_fields: [{ id: 'r1', label: 'How did the visit go?' }] },
  { id: 'f2', name: 'School visit survey', rating_fields: [] },
];

const renderSetting = (p: RequestPipelineSettings, onSave: (patch: Partial<RequestPipelineSettings>) => void) =>
  render(
    <MemoryRouter>
      <FeedbackFormSetting pipeline={p} saving={false} onSave={onSave} />
    </MemoryRouter>
  );

describe('FeedbackFormSetting', () => {
  beforeEach(() => {
    getFeedbackFormOptions.mockReset();
    getFeedbackFormOptions.mockResolvedValue(OPTIONS);
    createStarterFeedbackForm.mockReset();
    createStarterFeedbackForm.mockResolvedValue({
      form_id: 'f1',
      form_name: 'Outreach feedback',
      rating_field_id: 'r1',
    });
  });

  it('choosing a form clears the last form’s rating question', async () => {
    const onSave = vi.fn();
    renderSetting(pipeline({ feedback_form_id: 'f1', feedback_rating_field_id: 'r1' }), onSave);
    await screen.findByRole('option', { name: 'School visit survey' });

    await userEvent.selectOptions(screen.getByLabelText('Feedback form'), 'f2');

    expect(onSave).toHaveBeenCalledWith({ feedback_form_id: 'f2', feedback_rating_field_id: null });
  });

  it('offers the chosen form’s rating questions, and says when it has none', async () => {
    renderSetting(pipeline({ feedback_form_id: 'f2' }), vi.fn());

    expect(await screen.findByText(/This form has no number question/)).toBeInTheDocument();
    expect(screen.getByLabelText('Rating question')).toHaveDisplayValue('No rating');
  });

  it('creates the starter form when none is chosen, and saves it as the choice', async () => {
    const onSave = vi.fn();
    renderSetting(pipeline(), onSave);
    await screen.findByRole('option', { name: 'Outreach feedback' });

    await userEvent.click(screen.getByRole('button', { name: 'Create the starter feedback form' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ feedback_form_id: 'f1', feedback_rating_field_id: 'r1' })
    );
    expect(createStarterFeedbackForm).toHaveBeenCalledTimes(1);
  });

  it('does not offer the starter form once a form is chosen', async () => {
    renderSetting(pipeline({ feedback_form_id: 'f1' }), vi.fn());
    await screen.findByRole('option', { name: 'Outreach feedback' });

    expect(screen.queryByRole('button', { name: 'Create the starter feedback form' })).not.toBeInTheDocument();
  });
});
