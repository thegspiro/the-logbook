import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockCreateElection = vi.fn();

vi.mock('../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    createElection: (...args: unknown[]) => mockCreateElection(...args) as unknown,
    getSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: { getRanks: vi.fn().mockResolvedValue([]) },
  roleService: { getRoles: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

async function openCreateDialog() {
  renderWithRouter(<ElectionsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /^Create Election$/ }));
  return screen.getByRole('dialog', { name: 'Create New Election' });
}

describe('ElectionsPage › Create Election, refusals on their fields', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetElections.mockResolvedValue([]);
    mockCreateElection.mockReset();
    mockCreateElection.mockResolvedValue({ id: 'e1' });
  });

  it("puts the server's 422 on the Title field and announces it", async () => {
    mockCreateElection.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'title', message: 'String should have at most 200 characters' }] },
      },
    });
    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Annual officers');
    fireEvent.change(within(dialog).getByLabelText(/Start Date & Time/), { target: { value: '2099-12-10' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Election' }));

    const title = within(dialog).getByLabelText(/^Title/);
    await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'));
    expect(title).toHaveAccessibleDescription('String should have at most 200 characters.');
    expect(title).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Create New Election' })).toBeInTheDocument();
  });

  it('creates nothing without a title and says so on the field', async () => {
    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText(/Start Date & Time/), { target: { value: '2099-12-10' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Election' }));

    expect(within(dialog).getByLabelText(/^Title/)).toHaveAccessibleDescription('Enter a title for the election.');
    expect(mockCreateElection).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws away a typed title', async () => {
    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Annual officers');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('Annual officers');
  });
});
