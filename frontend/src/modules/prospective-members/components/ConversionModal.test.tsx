/**
 * How a converted member gets their password.
 *
 * The dialog used to offer a single "Send welcome email" checkbox and report
 * "Conversion Complete" either way — so a department without email, or an
 * email that failed to send, produced a member with a password nobody knew
 * and no sign of it. It now asks how the password will reach them, withdraws
 * the email option when email cannot send, and says what is left to do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Applicant } from '../types';

const mockConvertToMember = vi.fn();
const mockGetWelcomeEmailAvailability = vi.fn();
const mockRefreshPipelineView = vi.fn();
const mockGetPipeline = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    convertToMember: (...args: unknown[]) => mockConvertToMember(...args) as unknown,
  },
  pipelineService: {
    getPipeline: (...args: unknown[]) => mockGetPipeline(...args) as unknown,
  },
}));
vi.mock('../../../services/api', () => ({
  userService: {
    getWelcomeEmailAvailability: (...args: unknown[]) => mockGetWelcomeEmailAvailability(...args) as unknown,
  },
}));
// The pipeline on screen, whose conversion rule pre-fills class and status.
const currentPipeline = {
  id: 'pipe-1',
  conversion_config: {
    operational: { member_class: 'operational', member_status: 'probationary' },
    administrative: { member_class: 'administrative', member_status: 'probationary' },
  },
};
vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: () => ({ refreshPipelineView: mockRefreshPipelineView, currentPipeline }),
}));
vi.mock('./TargetRolePicker', () => ({ default: () => null }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ConversionModal } from './ConversionModal';

const applicant: Applicant = {
  id: 'p1',
  pipeline_id: 'pipe-1',
  first_name: 'Devon',
  last_name: 'Marsh',
  email: 'devon@example.org',
  current_stage_id: 'stage-3',
  stage_entered_at: '2026-09-01T12:00:00Z',
  status: 'active',
  stage_history: [],
  total_stages: 3,
  last_activity_at: '2026-09-01T12:00:00Z',
  target_membership_type: 'regular',
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
};

const openStepTwo = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<ConversionModal isOpen onClose={vi.fn()} applicant={applicant} />);
  await user.click(screen.getByRole('button', { name: /continue/i }));
};

const emailOption = () => screen.getByRole('radio', { name: /email them a temporary password/i });
const setNowOption = () => screen.getByRole('radio', { name: /set an initial password now/i });
const laterOption = () => screen.getByRole('radio', { name: /set it later/i });
const convert = () => screen.getByRole('button', { name: /convert to member/i });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetWelcomeEmailAvailability.mockReset();
  mockGetWelcomeEmailAvailability.mockResolvedValue({ available: true });
  mockConvertToMember.mockReset();
  mockConvertToMember.mockResolvedValue({
    applicant_id: 'p1',
    user_id: 'u-new',
    membership_type: 'regular',
    message: 'Prospect Devon Marsh transferred to membership as dmarsh',
    membership_number: 'FF-104',
    welcome_email_sent: true,
  });
  mockRefreshPipelineView.mockResolvedValue(undefined);
});

describe('when email can send', () => {
  it('defaults to emailing a temporary password', async () => {
    const user = userEvent.setup();
    await openStepTwo(user);
    await waitFor(() => expect(mockGetWelcomeEmailAvailability).toHaveBeenCalled());

    expect(emailOption()).toBeChecked();
    expect(emailOption()).toBeEnabled();

    await user.click(convert());

    await waitFor(() => expect(mockConvertToMember).toHaveBeenCalled());
    const payload = mockConvertToMember.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.send_welcome_email).toBe(true);
    expect(payload.password).toBeUndefined();
    expect(await screen.findByText(/welcome email with a temporary password was sent/i)).toBeInTheDocument();
  });

  it('says so when the welcome email did not go out', async () => {
    mockConvertToMember.mockResolvedValue({
      applicant_id: 'p1',
      user_id: 'u-new',
      membership_type: 'regular',
      message: 'done',
      welcome_email_sent: false,
    });
    const user = userEvent.setup();
    await openStepTwo(user);
    await waitFor(() => expect(mockGetWelcomeEmailAvailability).toHaveBeenCalled());

    await user.click(convert());

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/could not be sent/i);
    expect(warning).toHaveTextContent(/reset password/i);
  });

  it('shows the membership number the server assigned', async () => {
    const user = userEvent.setup();
    await openStepTwo(user);
    await user.click(convert());

    expect(await screen.findByText('Membership #: FF-104')).toBeInTheDocument();
  });
});

describe('when email cannot send', () => {
  beforeEach(() => {
    mockGetWelcomeEmailAvailability.mockReset();
    mockGetWelcomeEmailAvailability.mockResolvedValue({ available: false });
  });

  it('withdraws the email option and moves to setting a password', async () => {
    const user = userEvent.setup();
    await openStepTwo(user);

    await waitFor(() => expect(emailOption()).toBeDisabled());
    expect(setNowOption()).toBeChecked();
    expect(screen.getByText(/email isn't set up for this department/i)).toBeInTheDocument();
  });

  it('will not convert with a password that is too short or does not match', async () => {
    const user = userEvent.setup();
    await openStepTwo(user);
    await waitFor(() => expect(setNowOption()).toBeChecked());

    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(convert());
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 12 characters/i);

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'Hydrant$Blue947');
    await user.type(screen.getByLabelText('Confirm password'), 'Hydrant$Blue948');
    await user.click(convert());
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);

    expect(mockConvertToMember).not.toHaveBeenCalled();
  });

  it('sends the chosen password and no welcome email', async () => {
    const user = userEvent.setup();
    await openStepTwo(user);
    await waitFor(() => expect(setNowOption()).toBeChecked());

    await user.type(screen.getByLabelText('Password'), 'Hydrant$Blue947');
    await user.type(screen.getByLabelText('Confirm password'), 'Hydrant$Blue947');
    await user.click(convert());

    await waitFor(() => expect(mockConvertToMember).toHaveBeenCalled());
    const payload = mockConvertToMember.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.password).toBe('Hydrant$Blue947');
    expect(payload.send_welcome_email).toBe(false);
    expect(await screen.findByText(/give devon marsh the password you set/i)).toBeInTheDocument();
  });

  it('can still convert now and leave the password for later', async () => {
    const user = userEvent.setup();
    await openStepTwo(user);
    await waitFor(() => expect(setNowOption()).toBeChecked());

    await user.click(laterOption());
    await user.click(convert());

    await waitFor(() => expect(mockConvertToMember).toHaveBeenCalled());
    const payload = mockConvertToMember.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.send_welcome_email).toBe(false);
    expect(payload.password).toBeUndefined();
    expect(await screen.findByRole('alert')).toHaveTextContent(/no password they know yet/i);
  });
});

it('no longer reads "Step 3 of 2" once the conversion is done', async () => {
  const user = userEvent.setup();
  await openStepTwo(user);
  await user.click(convert());

  await screen.findByText('Conversion Complete');
  expect(screen.queryByText(/step 3 of 2/i)).not.toBeInTheDocument();
});

describe('what the applicant becomes', () => {
  // Pre-filled from the pipeline's conversion rule for the applicant's track,
  // the same rule automatic conversion applies.
  const openFor = async (user: ReturnType<typeof userEvent.setup>, overrides: Partial<Applicant>) => {
    render(<ConversionModal isOpen onClose={vi.fn()} applicant={{ ...applicant, ...overrides }} />);
    await user.click(screen.getByRole('button', { name: /continue/i }));
  };
  const classSelect = () => screen.getByRole('combobox', { name: 'Member class' });
  const statusSelect = () => screen.getByRole('combobox', { name: 'Starting status' });

  beforeEach(() => {
    mockGetPipeline.mockReset();
  });

  it("starts from the pipeline's rule for an administrative applicant", async () => {
    const user = userEvent.setup();
    await openFor(user, { target_membership_type: 'administrative' });

    expect(classSelect()).toHaveValue('administrative');
    expect(statusSelect()).toHaveValue('probationary');

    await user.click(convert());

    await waitFor(() => expect(mockConvertToMember).toHaveBeenCalled());
    const payload = mockConvertToMember.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({ member_class: 'administrative', member_status: 'probationary' });
  });

  it('can be changed for this one applicant', async () => {
    const user = userEvent.setup();
    await openFor(user, { target_membership_type: 'regular' });
    expect(classSelect()).toHaveValue('operational');

    await user.selectOptions(classSelect(), 'social');
    await user.selectOptions(statusSelect(), 'regular');
    await user.click(convert());

    await waitFor(() => expect(mockConvertToMember).toHaveBeenCalled());
    const payload = mockConvertToMember.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({ member_class: 'social', member_status: 'regular' });
  });

  it("reads another pipeline's rule from the server", async () => {
    mockGetPipeline.mockResolvedValue({
      id: 'pipe-2',
      conversion_config: {
        operational: { member_class: 'operational', member_status: 'regular' },
        administrative: { member_class: 'administrative', member_status: 'regular' },
      },
    });
    const user = userEvent.setup();
    await openFor(user, { pipeline_id: 'pipe-2', target_membership_type: 'regular' });

    await waitFor(() => expect(statusSelect()).toHaveValue('regular'));
    expect(mockGetPipeline).toHaveBeenCalledWith('pipe-2');
  });

  it('waits for a choice when the rule cannot be read', async () => {
    mockGetPipeline.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await openFor(user, { pipeline_id: 'pipe-2' });

    await waitFor(() => expect(mockGetPipeline).toHaveBeenCalled());
    expect(classSelect()).toHaveValue('');
    expect(convert()).toBeDisabled();
  });
});
