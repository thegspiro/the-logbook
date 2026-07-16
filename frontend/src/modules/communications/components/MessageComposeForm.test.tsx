import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetRoles = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    createMessage: (...args: unknown[]) => mockCreate(...args) as unknown,
    updateMessage: (...args: unknown[]) => mockUpdate(...args) as unknown,
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
    mockUpdate.mockResolvedValue({ id: 'm1' });
  });

  it('targets roles by name, not slug, matching the backend contract', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<MessageComposeForm onSaved={onSaved} onCancel={vi.fn()} />);

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
    expect(onSaved.mock.calls.length).toBe(1);
  });

  it('omits target lists when audience is everyone', async () => {
    const user = userEvent.setup();
    render(<MessageComposeForm onSaved={vi.fn()} onCancel={vi.fn()} />);

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
    render(<MessageComposeForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Title'), 'Untargeted');
    await user.type(screen.getByLabelText('Message'), 'Body');
    await user.selectOptions(screen.getByLabelText('Audience'), 'roles');
    await user.click(screen.getByRole('button', { name: /post message/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one role/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('edits an existing message via updateMessage, clearing stale targeting', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <MessageComposeForm
        message={{
          id: 'm1',
          organization_id: 'org1',
          title: 'Original',
          body: 'Original body',
          priority: 'normal',
          target_type: 'roles',
          target_roles: ['Officer'],
          is_pinned: false,
          is_active: true,
          is_persistent: false,
          requires_acknowledgment: false,
        }}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );

    // Pre-filled from the message being edited.
    expect(screen.getByLabelText('Title')).toHaveValue('Original');
    // Switch audience back to everyone.
    await user.selectOptions(screen.getByLabelText('Audience'), 'all');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdate.mock.calls.length).toBe(1));
    expect(mockCreate).not.toHaveBeenCalled();
    const [id, payload] = mockUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('m1');
    expect(payload.target_type).toBe('all');
    // Stale role targeting is explicitly cleared, not left behind.
    expect(payload.target_roles).toBeNull();
    expect(onSaved.mock.calls.length).toBe(1);
  });
});
