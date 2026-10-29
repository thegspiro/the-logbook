/**
 * FollowUpFormPage — the applicant's follow-up form, from their emailed link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { PublicFollowUpForm } from '../types';

const mockGetForm = vi.fn();
const mockSaveDraft = vi.fn();
const mockSubmit = vi.fn();

vi.mock('../services/api', () => ({
  publicFollowUpFormService: {
    getForm: (...a: unknown[]) => mockGetForm(...a) as unknown,
    saveDraft: (...a: unknown[]) => mockSaveDraft(...a) as unknown,
    submit: (...a: unknown[]) => mockSubmit(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import FollowUpFormPage from './FollowUpFormPage';

const TOKEN = 'a'.repeat(43);

const field = (id: string, label: string, extra: Partial<PublicFollowUpForm['fields'][number]> = {}) => ({
  id,
  label,
  field_type: 'text',
  required: false,
  sort_order: 0,
  width: 'full',
  is_sensitive: false,
  ...extra,
});

const form: PublicFollowUpForm = {
  form_name: 'Background Questionnaire',
  organization_name: 'Falls Church VFD',
  applicant_first_name: 'Pat',
  fields: [
    field('street', 'Street Address', { sort_order: 0 }),
    field('licensed', 'Do you hold a driver licence?', {
      field_type: 'radio',
      sort_order: 1,
      required: true,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    }),
    field('licence_no', 'Licence number', {
      sort_order: 2,
      required: true,
      condition_field_id: 'licensed',
      condition_operator: 'equals',
      condition_value: 'yes',
    }),
    field('history', 'Criminal history', { field_type: 'textarea', sort_order: 3, is_sensitive: true }),
  ],
  values: { street: '12 Old Road' },
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/application-form/${TOKEN}`]}>
      <Routes>
        <Route path="/application-form/:token" element={<FollowUpFormPage />} />
      </Routes>
    </MemoryRouter>
  );

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

describe('FollowUpFormPage', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockSaveDraft.mockReset();
    mockSubmit.mockReset();
    mockGetForm.mockResolvedValue(structuredClone(form));
    mockSaveDraft.mockResolvedValue({ draft_saved_at: '2026-10-29T12:00:00Z' });
    mockSubmit.mockResolvedValue({ submitted_at: '2026-10-29T12:05:00Z', message: 'Thank you.' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens filled with what the department holds, and marks the sensitive question', async () => {
    renderPage();

    expect(await screen.findByLabelText('Street Address')).toHaveValue('12 Old Road');
    expect(screen.getByText(/Hi Pat\./)).toBeInTheDocument();
    expect(
      screen.getAllByText('This answer is stored encrypted and is visible only to authorized staff.')
    ).toHaveLength(1);
  });

  it('hides a follow-up question until its answer calls for it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Street Address');

    expect(screen.queryByLabelText(/Licence number/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Yes'));

    expect(screen.getByLabelText(/Licence number/)).toBeInTheDocument();
  });

  it('submits only the visible answers and thanks the applicant', async () => {
    // A draft saved while "Yes" was chosen still holds the licence number.
    mockGetForm.mockResolvedValue({
      ...structuredClone(form),
      values: { street: '12 Old Road', licensed: 'yes', licence_no: 'D1234567' },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Street Address');

    await user.click(screen.getByLabelText('No'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const [token, answers] = mockSubmit.mock.calls[0] as [string, Record<string, string>];
    expect(token).toBe(TOKEN);
    expect(answers).toEqual({ street: '12 Old Road', licensed: 'no' });
    expect(await screen.findByText('Thank you')).toBeInTheDocument();
  });

  it('will not submit while a required question is unanswered', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Street Address');

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Do you hold a driver licence? is required')).toBeInTheDocument();
  });

  it('shows the reason the department gave for refusing an answer', async () => {
    mockSubmit.mockRejectedValue(
      Object.assign(new Error('Bad request'), {
        response: { status: 400, data: { detail: "Enter a valid email address for 'Email'" } },
      })
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Street Address');

    await user.click(screen.getByLabelText('No'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Enter a valid email address for 'Email'");
  });

  it('saves a draft on its own a few seconds after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    renderPage();
    const street = await screen.findByLabelText('Street Address');

    await user.clear(street);
    await user.type(street, '9 New Lane');
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft).toHaveBeenCalledWith(TOKEN, { street: '9 New Lane' });
  });

  it('saves straight away when asked to finish later', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Street Address');

    await user.click(screen.getByRole('button', { name: 'Save and finish later' }));

    expect(mockSaveDraft).toHaveBeenCalledWith(TOKEN, { street: '12 Old Road' });
    expect(await screen.findByText(/You can come back to this link to finish/)).toBeInTheDocument();
  });

  it('says the form was already received when the link has been used', async () => {
    mockGetForm.mockRejectedValue(httpError(409));
    renderPage();

    expect(await screen.findByText('Thank you')).toBeInTheDocument();
  });

  it('says the form is not available for a dead link', async () => {
    mockGetForm.mockRejectedValue(httpError(404));
    renderPage();

    expect(await screen.findByText('This form is not available')).toBeInTheDocument();
  });

  it('does not call an outage a dead link', async () => {
    mockGetForm.mockRejectedValue(new Error('Network Error'));
    renderPage();

    expect(await screen.findByText('We could not load your form')).toBeInTheDocument();
  });
});
