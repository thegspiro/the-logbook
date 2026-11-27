/**
 * Editing a grant whose record could not be loaded shows no form. The blank
 * form that used to stand in could be saved, and its PUT nulled every field
 * the officer had not retyped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetApplication = vi.fn();
const mockUpdateApplication = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: () => Promise.resolve([]),
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    updateApplication: (...args: unknown[]) => mockUpdateApplication(...args) as unknown,
    createApplication: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/services/api', () => ({ userService: { getUsers: () => Promise.resolve([]) } }));

import GrantApplicationFormPage from './GrantApplicationFormPage';

const renderEdit = () =>
  render(
    <MemoryRouter initialEntries={['/grants/applications/app-1/edit']}>
      <Routes>
        <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('GrantApplicationFormPage when the record cannot be loaded', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    mockUpdateApplication.mockReset();
    mockGetApplication.mockRejectedValue(new Error('network'));
  });

  it('says so and offers no form to save', async () => {
    renderEdit();

    expect(await screen.findByRole('alert')).toHaveTextContent('This application could not be loaded');
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/grant program name/i)).not.toBeInTheDocument();
  });
});
