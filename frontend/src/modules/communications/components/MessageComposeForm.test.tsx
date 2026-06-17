import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreate = vi.fn();
const mockGetRoles = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    createMessage: (...args: unknown[]) => mockCreate(...args) as unknown,
    getAvailableRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MessageComposeForm from './MessageComposeForm';

describe('MessageComposeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRoles.mockResolvedValue([{ name: 'Officer', slug: 'officer' }]);
    mockGetUsers.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'm1' });
  });

  it('targets roles by name, not slug, matching the backend contract', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<MessageComposeForm onCreated={onCreated} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Title'), 'Safety bulletin');
    await user.type(screen.getByLabelText('Message'), 'Please review.');
    await user.selectOptions(screen.getByLabelText('Audience'), 'roles');

    // Role checkbox appears once getAvailableRoles resolves.
    const officer = await screen.findByLabelText('Officer');
    await user.click(officer);
    await user.click(screen.getByRole('button', { name: /post message/i }));

    await waitFor(() => expect(mockCreate.mock.calls.length).toBe(1));
    const payload = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.target_type).toBe('roles');
    // The role *name* is sent, not the slug — _is_targeted matches on name.
    expect(payload.target_roles).toEqual(['Officer']);
    expect(onCreated.mock.calls.length).toBe(1);
  });

  it('omits target lists when audience is everyone', async () => {
    const user = userEvent.setup();
    render(<MessageComposeForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Title'), 'All hands');
    await user.type(screen.getByLabelText('Message'), 'Body');
    await user.click(screen.getByRole('button', { name: /post message/i }));

    await waitFor(() => expect(mockCreate.mock.calls.length).toBe(1));
    const payload = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.target_type).toBe('all');
    expect(payload.target_roles).toBeUndefined();
    expect(payload.target_statuses).toBeUndefined();
    expect(payload.target_member_ids).toBeUndefined();
  });

  it('blocks submit when a role audience has no selection', async () => {
    const user = userEvent.setup();
    render(<MessageComposeForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Title'), 'Untargeted');
    await user.type(screen.getByLabelText('Message'), 'Body');
    await user.selectOptions(screen.getByLabelText('Audience'), 'roles');
    await user.click(screen.getByRole('button', { name: /post message/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one role/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
