/**
 * Public form submission: a multi-select question is answered with
 * checkboxes, as in the signed-in renderer, and a second tap while the
 * challenge token is being fetched does not send a second submission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { PublicFormDef } from '../services/api';

const mockGetForm = vi.fn();
const mockSubmitForm = vi.fn();
vi.mock('../services/api', () => ({
  publicFormsService: {
    getForm: (...a: unknown[]) => mockGetForm(...a) as unknown,
    submitForm: (...a: unknown[]) => mockSubmitForm(...a) as unknown,
  },
}));

const captchaState = { required: false };
const mockGetToken = vi.fn();
vi.mock('../hooks/useCaptcha', () => ({
  useCaptcha: () => ({
    required: captchaState.required,
    ready: true,
    error: null,
    containerRef: { current: null },
    getToken: (...a: unknown[]) => mockGetToken(...a) as unknown,
    reset: vi.fn(),
  }),
}));

import PublicFormPage from './PublicFormPage';
import { useAuthStore } from '../stores/authStore';

const baseField = { required: false, sort_order: 0, width: 'full' };

const form: PublicFormDef = {
  id: 'form-1',
  name: 'Join the Department',
  category: 'membership',
  allow_multiple_submissions: true,
  require_authentication: false,
  fields: [
    { ...baseField, id: 'name', label: 'Full name', field_type: 'text' },
    {
      ...baseField,
      id: 'days',
      label: 'Days available',
      field_type: 'multiselect',
      options: [
        { value: 'sat', label: 'Saturday' },
        { value: 'sun', label: 'Sunday' },
      ],
    },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/f/abc123def456']}>
      <Routes>
        <Route path="/f/:slug" element={<PublicFormPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('PublicFormPage submit', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
    captchaState.required = false;
    mockGetToken.mockReset();
    mockGetForm.mockReset();
    mockGetForm.mockResolvedValue(form);
    mockSubmitForm.mockReset();
    mockSubmitForm.mockResolvedValue({ message: 'Thanks' });
  });

  it('answers a multi-select question with checkboxes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(/Full name/), 'Pat Doe');
    await user.click(screen.getByRole('checkbox', { name: 'Saturday' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sunday' }));
    await user.click(screen.getByRole('button', { name: /Submit/ }));

    expect(mockSubmitForm).toHaveBeenCalledWith(
      'abc123def456',
      { name: 'Pat Doe', days: 'sat,sun' },
      undefined,
      undefined
    );
  });

  it('sends one submission when Submit is pressed twice while the challenge runs', async () => {
    captchaState.required = true;
    let releaseToken: (token: string) => void = () => undefined;
    mockGetToken.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseToken = resolve;
        })
    );
    renderPage();
    await screen.findByLabelText(/Full name/);

    const submit = screen.getByRole('button', { name: /Submit/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    releaseToken('token-1');
    releaseToken('token-2');

    await screen.findByText('Thanks');
    await waitFor(() => expect(mockSubmitForm).toHaveBeenCalledTimes(1));
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });
});
