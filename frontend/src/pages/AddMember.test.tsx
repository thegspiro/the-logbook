/**
 * The membership type chosen when a member is added, and the rank it forbids.
 *
 * Two things this screen got wrong, and the first is why the second mattered:
 * the required-marked Membership Type dropdown was never included in the create
 * payload at all, so every member added here landed as a plain operational
 * regular whatever the operator picked. Gating the rank field on a value the
 * server never heard would have been theatre.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreateMember = vi.fn();
const mockGetWelcomeEmailAvailability = vi.fn();
const mockPreviewNextMembershipId = vi.fn();
const mockGetRoles = vi.fn();
const mockGetLocations = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    createMember: (...args: unknown[]) => mockCreateMember(...args) as unknown,
    getWelcomeEmailAvailability: (...args: unknown[]) => mockGetWelcomeEmailAvailability(...args) as unknown,
  },
  organizationService: {
    previewNextMembershipId: (...args: unknown[]) => mockPreviewNextMembershipId(...args) as unknown,
  },
  roleService: { getRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown },
  locationsService: { getLocations: (...args: unknown[]) => mockGetLocations(...args) as unknown },
}));

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    rankOptions: [
      { value: 'captain', label: 'Captain' },
      { value: 'firefighter', label: 'Firefighter' },
    ],
    ranks: [],
    loading: false,
    refetch: vi.fn(),
    formatRank: (r: string) => r,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { renderWithRouter } from '../test/utils';
import AddMember from './AddMember';

const rankSelect = () => screen.getByRole('combobox', { name: /^rank$/i });
const membershipSelect = () => screen.getByRole('combobox', { name: /membership type/i });

/**
 * Fill every field `validateForm` insists on, so submit actually reaches the API.
 *
 * By placeholder: written when this form's labels were not associated with
 * their controls. They are now (workflow review W08, asserted below), and the
 * placeholders still identify each field.
 */
const fillRequired = async (
  user: ReturnType<typeof userEvent.setup>,
  { membershipNumber = 'FF-001' }: { membershipNumber?: string | null } = {}
) => {
  // Pasted rather than typed: every keystroke re-renders the whole form, and
  // eleven typed fields took 2-3s per test unloaded, so a loaded run (the
  // pre-commit hook runs every related suite at once) crossed the 5s
  // timeout. What these tests assert is the saved payload, not keystrokes.
  const fill = async (field: HTMLElement, value: string) => {
    await user.click(field);
    await user.paste(value);
  };
  const type = (placeholder: string, value: string) => fill(screen.getByPlaceholderText(placeholder), value);
  await type('John', 'Dana');
  await type('Doe', 'Reyes');
  // Null leaves it blank, for a department that auto-assigns numbers. Found by
  // label because its placeholder is the previewed number when there is one.
  if (membershipNumber !== null) {
    await fill(screen.getByLabelText(/^membership number/i), membershipNumber);
  }
  await type('123 Main Street', '1 Main St');
  await type('Springfield', 'Falls Church');
  await type('IL', 'VA');
  await type('62701', '22046');
  await type('john.doe@example.com', 'dreyes@dept.test');
  await type('Jane Doe', 'Sam Reyes');
  await type('Spouse', 'Spouse');
  // The member's primary phone and the emergency contact's share a
  // placeholder; they are the first and second in document order.
  const phones = screen.getAllByPlaceholderText('(555) 123-4567');
  await fill(phones[0] as HTMLElement, '5550100');
  await fill(phones[1] as HTMLElement, '5550101');
};

// These tests type a whole member record a keystroke at a time, which on a
// loaded machine — the pre-commit hook runs the suite beside other work —
// takes longer than the default 5s even though nothing is wrong.
describe('AddMember', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreviewNextMembershipId.mockResolvedValue({ enabled: false, next_id: null });
    mockGetRoles.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockCreateMember.mockResolvedValue({ id: 'u1' });
    mockGetWelcomeEmailAvailability.mockReset();
    mockGetWelcomeEmailAvailability.mockResolvedValue({ available: true });
  });

  it('offers a rank to an operational member', async () => {
    renderWithRouter(<AddMember />);
    await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

    expect(rankSelect()).toBeEnabled();
  });

  it('explains how rank and position differ, since both carry access', async () => {
    renderWithRouter(<AddMember />);
    await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

    expect(rankSelect()).toHaveAccessibleDescription(/title in the chain of command/);
    expect(screen.getByRole('combobox', { name: 'Position' })).toHaveAccessibleDescription(
      /Positions decide most of what they can see and do/
    );
  });

  it('disables and explains the rank field once Administrative is chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AddMember />);
    await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

    await user.selectOptions(rankSelect(), 'captain');
    await user.selectOptions(membershipSelect(), 'administrative');

    expect(rankSelect()).toBeDisabled();
    expect(rankSelect()).toHaveValue('');
    expect(screen.getByText(/do not hold an operational rank/i)).toBeInTheDocument();
  });

  it('sends the class and status the operator picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AddMember />);
    await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

    await fillRequired(user);
    await user.selectOptions(membershipSelect(), 'administrative');
    await user.click(screen.getByRole('button', { name: /save member/i }));

    await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
    const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.member_class).toBe('administrative');
    expect(payload.member_status).toBe('regular');
    expect(payload.rank).toBeUndefined();
  });

  it("maps the form's 'regular' onto the class and status it means", async () => {
    // 'regular' is a member *status*; the backend's legacy vocabulary spells
    // that case 'active', so sending the raw string would land in the column as
    // an unrecognised tier.
    const user = userEvent.setup();
    renderWithRouter(<AddMember />);
    await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

    await fillRequired(user);
    await user.selectOptions(membershipSelect(), 'regular');
    await user.selectOptions(rankSelect(), 'captain');
    await user.click(screen.getByRole('button', { name: /save member/i }));

    await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
    const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.member_class).toBe('operational');
    expect(payload.member_status).toBe('regular');
    expect(payload.rank).toBe('captain');
  });

  describe('when email cannot deliver a temporary password', () => {
    const passwordToggle = () => screen.getByRole('checkbox', { name: /set initial password/i });

    beforeEach(() => {
      mockGetWelcomeEmailAvailability.mockReset();
      mockGetWelcomeEmailAvailability.mockResolvedValue({ available: false });
    });

    it('requires an initial password and says why', async () => {
      renderWithRouter(<AddMember />);

      await waitFor(() => expect(passwordToggle()).toBeChecked());
      expect(passwordToggle()).toBeDisabled();
      expect(screen.getByText(/email isn't set up for this department/i)).toBeInTheDocument();
    });

    it('does not submit without the password', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(passwordToggle()).toBeChecked());

      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /save member/i }));

      expect(mockCreateMember).not.toHaveBeenCalled();
    });

    it('sends the password and asks for no welcome email', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(passwordToggle()).toBeChecked());

      await fillRequired(user);
      await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'Hydrant$Blue947');
      await user.type(screen.getByPlaceholderText(/re-enter|confirm/i), 'Hydrant$Blue947');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.password).toBe('Hydrant$Blue947');
      expect(payload.send_welcome_email).toBe(false);
    });
  });

  it('leaves the initial password optional when email can deliver one', async () => {
    renderWithRouter(<AddMember />);
    await waitFor(() => expect(mockGetWelcomeEmailAvailability).toHaveBeenCalled());

    const toggle = screen.getByRole('checkbox', { name: /set initial password/i });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });

  describe('the optional second emergency contact', () => {
    it('refuses a half-filled one, naming the fields, rather than 422ing the save', async () => {
      // `EmergencyContact` requires name, relationship and phone. Posting a
      // name with an empty relationship failed the whole member creation with
      // a 422 naming a field on a card the form labels "(Optional)".
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.type(screen.getByPlaceholderText('Bob Doe'), 'Alex Reyes');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      expect(mockCreateMember).not.toHaveBeenCalled();
      expect(screen.getByText('Relationship is required')).toBeInTheDocument();
      expect(screen.getByText('Phone is required')).toBeInTheDocument();
    });

    it('sends a complete one', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.type(screen.getByPlaceholderText('Bob Doe'), 'Alex Reyes');
      await user.type(screen.getByPlaceholderText('Parent'), 'Parent');
      // Shared with the member's secondary phone; the emergency one is second.
      const secondaryPhones = screen.getAllByPlaceholderText('(555) 987-6543');
      await user.type(secondaryPhones[1] as HTMLElement, '5550102');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      const contacts = payload.emergency_contacts as Array<Record<string, unknown>>;
      expect(contacts).toHaveLength(2);
      expect(contacts[1]).toMatchObject({ name: 'Alex Reyes', relationship: 'Parent', is_primary: false });
    });

    it('refuses an email-only one rather than discarding the address', async () => {
      // The email was not part of the "did they start filling this in?" check,
      // so a second contact entered as an address alone passed validation and
      // was then dropped: the payload builder keys the whole contact off the
      // name. Typed, accepted, never stored.
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.type(screen.getByPlaceholderText('bob.doe@example.com'), 'alex@dept.test');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      expect(mockCreateMember).not.toHaveBeenCalled();
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    it('still allows leaving it entirely blank', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.emergency_contacts).toHaveLength(1);
    });
  });

  describe('membership number', () => {
    beforeEach(() => {
      mockPreviewNextMembershipId.mockReset();
      mockPreviewNextMembershipId.mockResolvedValue({ enabled: true, next_id: 'FD-0012' });
    });

    it('may be left blank when the department auto-assigns, and is then omitted', async () => {
      // It used to be required regardless, so the typed value always won and
      // the server's counter never issued a number from this screen.
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      expect(await screen.findByText(/leave blank to assign FD-0012 automatically/i)).toBeInTheDocument();

      await fillRequired(user, { membershipNumber: null });
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('membership_number');
    });

    it('sends a typed number as a manual override', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await screen.findByText(/leave blank to assign FD-0012 automatically/i);

      await fillRequired(user, { membershipNumber: ' FD-0003 ' });
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.membership_number).toBe('FD-0003');
    });

    it('offers one membership number field, not a second override box', async () => {
      renderWithRouter(<AddMember />);
      await screen.findByText(/leave blank to assign FD-0012 automatically/i);

      expect(screen.getAllByLabelText(/^membership (number|id)/i)).toHaveLength(1);
    });

    it('is required when nothing will be assigned automatically', async () => {
      mockPreviewNextMembershipId.mockResolvedValue({ enabled: true, next_id: null });
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockPreviewNextMembershipId).toHaveBeenCalled());

      await fillRequired(user, { membershipNumber: null });
      await user.click(screen.getByRole('button', { name: /save member/i }));

      expect(await screen.findByText('Membership number is required')).toBeInTheDocument();
      expect(mockCreateMember).not.toHaveBeenCalled();
    });
  });

  describe('workflow review W08', () => {
    it('names every field by its label', async () => {
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      for (const label of [
        /^first name/i,
        /^last name/i,
        /^membership number/i,
        /^street address/i,
        /^zip code/i,
        /^primary phone/i,
        /^email/i,
      ]) {
        expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
      }
    });

    it('offers the starting statuses the server accepts, and no Preferred Contact control', async () => {
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      const status = screen.getByRole('combobox', { name: /^status$/i });
      expect(
        within(status)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['Active', 'Inactive', 'On Leave']);
      expect(screen.queryByText('Preferred Contact Method')).not.toBeInTheDocument();
    });

    // W08-1: the status used to be shown and not sent, so "On Leave" created
    // an active member.
    it('sends the status the operator picked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.selectOptions(screen.getByRole('combobox', { name: /^status$/i }), 'leave');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.status).toBe('leave');
    });

    it('sends Active when the status is left alone', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.status).toBe('active');
    });

    it('refuses a password the server would, at the field, and lists the rules', async () => {
      const user = userEvent.setup();
      mockGetWelcomeEmailAvailability.mockResolvedValue({ available: false });
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(screen.getByRole('checkbox', { name: /set initial password/i })).toBeChecked());

      await fillRequired(user);
      await user.type(screen.getByLabelText(/^password\s*\*?$/i), 'Abcdefgh1234!');
      await user.type(screen.getByLabelText(/^confirm password/i), 'Abcdefgh1234!');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      expect(await screen.findByText('Password does not meet every rule listed below')).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Password rules' })).toHaveTextContent('No runs like 123 or abc');
      expect(mockCreateMember).not.toHaveBeenCalled();
    });

    it('takes the next free username when the email-derived one is taken', async () => {
      const user = userEvent.setup();
      mockCreateMember.mockReset();
      mockCreateMember
        .mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Username already exists' } } })
        .mockResolvedValueOnce({ id: 'u2' });
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalledTimes(2));
      expect((mockCreateMember.mock.calls[0]?.[0] as { username: string }).username).toBe('dreyes');
      expect((mockCreateMember.mock.calls[1]?.[0] as { username: string }).username).toBe('dreyes_2');
    });
  });

  describe('preferred name', () => {
    it('sends the name the member goes by, trimmed', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.type(screen.getByLabelText('Preferred Name'), ' Dee ');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      const payload = mockCreateMember.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.preferred_name).toBe('Dee');
      expect(payload.first_name).toBe('Dana');
    });

    it('omits it when left blank', async () => {
      const user = userEvent.setup();
      renderWithRouter(<AddMember />);
      await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());

      await fillRequired(user);
      await user.type(screen.getByLabelText('Preferred Name'), '   ');
      await user.click(screen.getByRole('button', { name: /save member/i }));

      await waitFor(() => expect(mockCreateMember).toHaveBeenCalled());
      expect(mockCreateMember.mock.calls[0]?.[0]).not.toHaveProperty('preferred_name');
    });
  });
});
