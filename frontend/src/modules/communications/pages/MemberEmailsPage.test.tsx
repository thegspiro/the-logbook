import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import MemberEmailsPage from './MemberEmailsPage';
import type { MemberEmailPolicy } from '../../../services/api';

const mockGetPolicy = vi.fn();

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getMemberEmailPolicy: (...args: unknown[]) => mockGetPolicy(...args) as unknown,
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
};

describe('MemberEmailsPage', () => {
  beforeEach(() => {
    mockGetPolicy.mockReset();
    mockGetPolicy.mockResolvedValue(policy);
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
});
