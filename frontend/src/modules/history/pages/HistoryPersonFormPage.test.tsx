import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const mockCreatePerson = vi.fn();
const mockUpdatePerson = vi.fn();
const mockGetPerson = vi.fn();
const mockCheckPerson = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    createPerson: (...args: unknown[]) => mockCreatePerson(...args) as unknown,
    updatePerson: (...args: unknown[]) => mockUpdatePerson(...args) as unknown,
    getPerson: (...args: unknown[]) => mockGetPerson(...args) as unknown,
    checkPerson: (...args: unknown[]) => mockCheckPerson(...args) as unknown,
  },
}));
vi.mock('../../../services/userServices', () => ({
  userService: { getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import HistoryPersonFormPage from './HistoryPersonFormPage';

const renderAt = (path: string) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/history/people/new" element={<HistoryPersonFormPage />} />
          <Route path="/history/people/:personId/edit" element={<HistoryPersonFormPage />} />
          <Route path="/history/people/:personId" element={<p>Saved page</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryPersonFormPage', () => {
  beforeEach(() => {
    for (const mock of [mockCreatePerson, mockUpdatePerson, mockGetPerson, mockCheckPerson, mockGetUsers]) {
      mock.mockReset();
    }
    mockCheckPerson.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([]);
    mockCreatePerson.mockResolvedValue({ id: 'new-1' });
    mockUpdatePerson.mockResolvedValue({ id: 'p1' });
  });

  it('creates a draft with only a last name, omitting the blank fields', async () => {
    const user = userEvent.setup();
    renderAt('/history/people/new');

    await user.type(screen.getByLabelText('Last name (required)'), 'Smith');
    await user.click(screen.getByRole('button', { name: 'Add to the archive' }));

    await waitFor(() => expect(mockCreatePerson).toHaveBeenCalledTimes(1));
    const payload = mockCreatePerson.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.last_name).toBe('Smith');
    expect(payload.first_name).toBeUndefined();
    expect(payload.addresses).toBeUndefined();
  });

  it('shows the duplicate warning without blocking the save', async () => {
    mockCheckPerson.mockResolvedValue([
      {
        kind: 'possible_duplicate',
        message: 'John Smith may be the same person',
        member_id: 'other',
        display_name: 'John Smith',
        service_years: '1951–1972',
      },
    ]);
    const user = userEvent.setup();
    renderAt('/history/people/new');

    await user.type(screen.getByLabelText('Last name (required)'), 'Smith');
    await user.tab();

    expect(await screen.findByText(/may be the same person/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to the archive' }));
    await waitFor(() => expect(mockCreatePerson).toHaveBeenCalledTimes(1));
  });

  it('sends null for a cleared field on update, with the edit kind', async () => {
    mockGetPerson.mockResolvedValue({
      view: 'full',
      id: 'p1',
      display_name: 'John Smith',
      first_name: 'John',
      middle_name: null,
      last_name: 'Smith',
      suffix: null,
      nickname: 'Jack',
      badge_number: null,
      birth_date: null,
      birth_date_precision: 'day',
      birth_date_circa: false,
      biography: null,
      addresses: null,
      verification_sources: null,
      research_notes: null,
      is_memorial: false,
      is_line_of_duty_death: false,
      death_date: null,
      death_date_precision: 'day',
      death_date_circa: false,
      death_date_visibility: 'historian',
      death_circumstances: null,
      death_circumstances_visibility: 'historian',
      burial_location: null,
      burial_location_visibility: 'historian',
      publication_level: 'draft',
      service_periods: [],
      relations: [],
    });
    const user = userEvent.setup();
    renderAt('/history/people/p1/edit');

    const nickname = await screen.findByLabelText('Nickname');
    await user.clear(nickname);
    await user.click(screen.getByLabelText('Substantial (new facts, rewrites)'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdatePerson).toHaveBeenCalledTimes(1));
    const [id, payload] = mockUpdatePerson.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('p1');
    expect(payload.nickname).toBeNull();
    expect(payload.edit_kind).toBe('substantial');
  });
});
