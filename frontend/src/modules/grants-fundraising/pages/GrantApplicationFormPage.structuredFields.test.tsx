/**
 * The budget summary and key contacts used to be free-text boxes while the
 * API required structured data, so any typed value was refused and the
 * application would not save. They are now an amount per budget category and
 * a list of named contacts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetApplication = vi.fn();
const mockUpdateApplication = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: () => Promise.resolve([]),
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    updateApplication: (...args: unknown[]) => mockUpdateApplication(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) as unknown, success: vi.fn() },
}));

import GrantApplicationFormPage from './GrantApplicationFormPage';

const stored = {
  id: 'app-1',
  grantProgramName: 'AFG',
  grantAgency: 'FEMA',
  opportunityId: null,
  applicationStatus: 'preparing',
  allowedNextStatuses: ['internal_review'],
  priority: 'medium',
  budgetSummary: { equipment: 85000, notes: 'SCBA' },
  keyContacts: [{ name: 'Dana Ruiz', role: 'Program officer', email: 'dana@afg.gov' }],
};

function renderEdit() {
  render(
    <MemoryRouter initialEntries={['/grants/applications/app-1/edit']}>
      <Routes>
        <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
        <Route path="/grants/applications/:id" element={<div>detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const lastPayload = () => mockUpdateApplication.mock.calls[0]?.[1] as Record<string, unknown>;

describe('GrantApplicationFormPage — budget summary and key contacts', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue(structuredClone(stored));
    mockUpdateApplication.mockReset();
    mockUpdateApplication.mockResolvedValue({ id: 'app-1' });
    mockToastError.mockReset();
  });

  it('loads the stored values and saves edits as structured data', async () => {
    const user = userEvent.setup();
    renderEdit();

    const equipment = await screen.findByLabelText('Equipment ($)');
    await waitFor(() => expect(equipment).toHaveValue(85000));
    expect(screen.getByLabelText('Contact 1 name')).toHaveValue('Dana Ruiz');

    await user.type(screen.getByLabelText('Training ($)'), '12500');
    await user.click(screen.getByRole('button', { name: 'Add contact' }));
    await user.type(screen.getByLabelText('Contact 2 name'), 'Chief Lee');
    await user.type(screen.getByLabelText('Contact 2 phone'), '555-0100');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalled());
    expect(lastPayload().budgetSummary).toEqual({ equipment: 85000, training: 12500, notes: 'SCBA' });
    expect(lastPayload().keyContacts).toEqual([
      { name: 'Dana Ruiz', role: 'Program officer', email: 'dana@afg.gov' },
      { name: 'Chief Lee', phone: '555-0100' },
    ]);
  });

  it('sends null for both once everything is cleared', async () => {
    const user = userEvent.setup();
    renderEdit();

    const equipment = await screen.findByLabelText('Equipment ($)');
    await waitFor(() => expect(equipment).toHaveValue(85000));
    await user.clear(equipment);
    await user.clear(screen.getByLabelText('Budget notes'));
    await user.click(screen.getByRole('button', { name: 'Remove contact 1' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalled());
    expect(lastPayload().budgetSummary).toBeNull();
    expect(lastPayload().keyContacts).toBeNull();
  });

  it('will not save a contact without a name', async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.click(await screen.findByRole('button', { name: 'Add contact' }));
    await user.type(screen.getByLabelText('Contact 2 role'), 'Signatory');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Each contact needs a name')).toBeInTheDocument();
    expect(mockUpdateApplication).not.toHaveBeenCalled();
  });
});
