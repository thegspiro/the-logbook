import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import MemberEmailsPage from './MemberEmailsPage';
import type { MemberEmailPolicy } from '../../../services/api';

const mockGetPolicy = vi.fn();
const mockUpdatePolicy = vi.fn();

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getMemberEmailPolicy: (...args: unknown[]) => mockGetPolicy(...args) as unknown,
    updateMemberEmailPolicy: (...args: unknown[]) => mockUpdatePolicy(...args) as unknown,
  },
}));

const policy: MemberEmailPolicy = {
  emails: [
    {
      key: 'election_ballots',
      label: 'Election ballots',
      required: true,
      default_on: true,
      audience: 'members',
      includes: ['Ballots and voting links'],
      rationale: 'Every eligible voter must receive their ballot.',
      legacy_preference: null,
      department_required: false,
    },
    {
      key: 'shift_notices',
      label: 'Shift notices',
      required: false,
      default_on: true,
      audience: 'members',
      includes: ['Shift reminders'],
      rationale: 'The schedule and the bell carry the same information.',
      legacy_preference: null,
      department_required: false,
    },
    {
      key: 'inventory_duties',
      label: 'Quartermaster duties',
      required: false,
      default_on: true,
      audience: 'officers',
      includes: ['Low stock'],
      rationale: 'Inventory shows the same alerts.',
      legacy_preference: null,
      department_required: false,
    },
  ],
  texts: [
    {
      key: 'urgent_department_message',
      label: 'Urgent department messages',
      description: 'A department message an officer marks urgent is also texted.',
      email_kind: 'department_messages',
    },
  ],
  text_conditions: ['The member has agreed to receive texts.'],
  can_edit: false,
};

describe('MemberEmailsPage', () => {
  beforeEach(() => {
    mockGetPolicy.mockReset();
    mockGetPolicy.mockResolvedValue(policy);
    mockUpdatePolicy.mockReset();
  });

  it('separates the emails members cannot turn off from the ones they can', async () => {
    renderWithRouter(<MemberEmailsPage />);

    const required = await screen.findByRole('region', { name: 'Always sent' });
    const optional = screen.getByRole('region', { name: 'Members can turn off' });

    expect(within(required).getByText('Election ballots')).toBeInTheDocument();
    expect(within(required).queryByText('Shift notices')).not.toBeInTheDocument();
    expect(within(optional).getByText('Shift notices')).toBeInTheDocument();
    expect(within(optional).getByText('Quartermaster duties')).toBeInTheDocument();
  });

  it('marks officer duty emails and the default for optional ones', async () => {
    renderWithRouter(<MemberEmailsPage />);

    const optional = await screen.findByRole('region', { name: 'Members can turn off' });
    expect(within(optional).getByText('Officers')).toBeInTheDocument();
    expect(within(optional).getAllByText('On unless turned off')).toHaveLength(2);
  });

  it('lists the alerts that may be texted and when', async () => {
    renderWithRouter(<MemberEmailsPage />);

    const texts = await screen.findByRole('region', { name: 'Text messages' });
    expect(within(texts).getByText('Urgent department messages')).toBeInTheDocument();
    expect(within(texts).getByText('The member has agreed to receive texts.')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    mockGetPolicy.mockReset();
    mockGetPolicy.mockRejectedValue(new Error('boom'));
    renderWithRouter(<MemberEmailsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('offers no department switch to someone who cannot change settings', async () => {
    renderWithRouter(<MemberEmailsPage />);

    await screen.findByRole('region', { name: 'Members can turn off' });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('lets an administrator make an optional email required', async () => {
    const editable: MemberEmailPolicy = { ...policy, can_edit: true };
    mockGetPolicy.mockResolvedValue(editable);
    mockUpdatePolicy.mockResolvedValue({
      ...editable,
      emails: editable.emails.map((e) => (e.key === 'shift_notices' ? { ...e, department_required: true } : e)),
    });
    renderWithRouter(<MemberEmailsPage />);

    const toggle = await screen.findByRole('switch', { name: 'Require Shift notices for every member' });
    // A required-by-code email has nothing for the department to decide.
    expect(screen.queryByRole('switch', { name: /Election ballots/ })).not.toBeInTheDocument();
    await userEvent.click(toggle);

    expect(mockUpdatePolicy).toHaveBeenCalledWith(['shift_notices']);
    expect(await screen.findByText('Required by your department')).toBeInTheDocument();
  });

  it('removes only the email switched back to optional', async () => {
    const editable: MemberEmailPolicy = {
      ...policy,
      can_edit: true,
      emails: policy.emails.map((e) => (e.required ? e : { ...e, department_required: true })),
    };
    mockGetPolicy.mockResolvedValue(editable);
    mockUpdatePolicy.mockResolvedValue(editable);
    renderWithRouter(<MemberEmailsPage />);

    await userEvent.click(await screen.findByRole('switch', { name: 'Require Shift notices for every member' }));

    expect(mockUpdatePolicy).toHaveBeenCalledWith(['inventory_duties']);
  });
});
