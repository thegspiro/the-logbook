import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SkillTestOfficerActions } from './SkillTestOfficerActions';
import type { SkillTest } from '../../types/skillsTesting';

const mockValidateTest = vi.fn();
const mockReleaseTest = vi.fn();
const mockVoidTest = vi.fn();
const mockReturnTest = vi.fn();

vi.mock('../../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: () => ({
    validateTest: (...args: unknown[]) => mockValidateTest(...args) as unknown,
    releaseTest: (...args: unknown[]) => mockReleaseTest(...args) as unknown,
    voidTest: (...args: unknown[]) => mockVoidTest(...args) as unknown,
    returnTest: (...args: unknown[]) => mockReturnTest(...args) as unknown,
  }),
}));

const mockToastSuccess = vi.fn<(message: string) => void>();
const mockToastError = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (message: string) => mockToastSuccess(message),
    error: (message: string) => mockToastError(message),
  },
}));

function buildTest(overrides: Partial<SkillTest> = {}): SkillTest {
  return {
    id: 'test-1',
    organization_id: 'org-1',
    template_id: 'tpl-1',
    template_name: 'Power Lift and Cot',
    candidate_id: 'user-1',
    candidate_name: 'Maria Garcia',
    examiner_id: 'user-2',
    examiner_name: 'Gabriel Spiro',
    status: 'completed',
    result: 'fail',
    is_practice: false,
    version: 3,
    section_results: [],
    overall_score: 71,
    created_at: '2026-08-08T19:00:00Z',
    updated_at: '2026-08-08T19:14:00Z',
    completed_at: '2026-08-08T19:14:00Z',
    validated_at: '2026-08-08T19:14:00Z',
    validated_by_name: 'Gabriel Spiro',
    effective_result_disclosure: 'full',
    effective_result_release: 'on_completion',
    ...overrides,
  };
}

describe('SkillTestOfficerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateTest.mockResolvedValue(buildTest());
    mockReleaseTest.mockResolvedValue(buildTest());
    mockVoidTest.mockResolvedValue(buildTest({ status: 'voided' }));
  });

  describe('Accepting a member-run result', () => {
    it('offers Accept only while the result is awaiting validation', () => {
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);

      expect(screen.getByRole('button', { name: /accept result/i })).toBeInTheDocument();
    });

    it('reports who accepted an already-validated result instead of offering it again', () => {
      render(<SkillTestOfficerActions test={buildTest()} />);

      expect(screen.queryByRole('button', { name: /accept result/i })).not.toBeInTheDocument();
      expect(screen.getByText(/Accepted/)).toBeInTheDocument();
      expect(screen.getByText(/Gabriel Spiro/)).toBeInTheDocument();
    });

    it('spells out the consequences of accepting, in terms of the named candidate', () => {
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);

      const note = screen.getByText(/Accepting confirms/);
      expect(note).toHaveTextContent(/counts toward Maria Garcia's record/);
      expect(note).toHaveTextContent(/credits any program requirement/);
      expect(note).toHaveTextContent(/uses one of their attempts/);
      expect(note).toHaveTextContent(/notified/);
    });

    it('calls the store and reports success', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);

      await user.click(screen.getByRole('button', { name: /accept result/i }));

      expect(mockValidateTest).toHaveBeenCalledWith('test-1');
      expect(mockToastSuccess).toHaveBeenCalledWith('Result accepted');
    });

    it('surfaces a rejected acceptance rather than reporting success', async () => {
      const user = userEvent.setup();
      mockValidateTest.mockRejectedValue(new Error('Attempt limit reached'));
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);

      await user.click(screen.getByRole('button', { name: /accept result/i }));

      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith('Attempt limit reached');
    });
  });

  describe('What the note promises the candidate will see', () => {
    it('does not promise notes at the scores tier', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({ pending_validation: true, effective_result_disclosure: 'scores' })}
        />
      );

      const note = screen.getByText(/Accepting confirms/);
      expect(note).toHaveTextContent(/none of the written notes/);
    });

    it('promises the full scorecard at the full tier', () => {
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);

      expect(screen.getByText(/Accepting confirms/)).toHaveTextContent(/full scorecard, including the notes/);
    });

    it('says nothing is sent when the department withholds results entirely', () => {
      render(
        <SkillTestOfficerActions test={buildTest({ pending_validation: true, effective_result_disclosure: 'none' })} />
      );

      expect(screen.getByText(/Accepting confirms/)).toHaveTextContent(/nothing is sent to them/);
    });

    it('warns that acceptance alone shows the candidate nothing under on_release', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({ pending_validation: true, effective_result_release: 'on_release' })}
        />
      );

      expect(screen.getByText(/Accepting confirms/)).toHaveTextContent(/until you release it below/);
    });
  });

  describe('Releasing a held-back result', () => {
    it('is not offered when results are visible on completion', () => {
      render(<SkillTestOfficerActions test={buildTest()} />);

      expect(screen.queryByRole('button', { name: /release to candidate/i })).not.toBeInTheDocument();
    });

    it('is offered when the department holds results until an officer releases them', () => {
      render(<SkillTestOfficerActions test={buildTest({ effective_result_release: 'on_release' })} />);

      expect(screen.getByRole('button', { name: /release to candidate/i })).toBeInTheDocument();
    });

    it('is not offered once released', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({ effective_result_release: 'on_release', released_at: '2026-08-08T20:00:00Z' })}
        />
      );

      expect(screen.queryByRole('button', { name: /release to candidate/i })).not.toBeInTheDocument();
    });

    it('is not offered when the result is never shown to the candidate anyway', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({ effective_result_release: 'on_release', effective_result_disclosure: 'none' })}
        />
      );

      expect(screen.queryByRole('button', { name: /release to candidate/i })).not.toBeInTheDocument();
    });

    it('is blocked until the result has been accepted', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({ pending_validation: true, effective_result_release: 'on_release' })}
        />
      );

      expect(screen.getByRole('button', { name: /release to candidate/i })).toBeDisabled();
      expect(screen.getByText(/Accept the result first/)).toBeInTheDocument();
    });

    it('calls the store when released', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest({ effective_result_release: 'on_release' })} />);

      await user.click(screen.getByRole('button', { name: /release to candidate/i }));

      expect(mockReleaseTest).toHaveBeenCalledWith('test-1');
      expect(mockToastSuccess).toHaveBeenCalledWith('Result released to Maria Garcia');
    });
  });

  describe('Voiding a result', () => {
    it('requires a reason of the length the backend enforces', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest()} />);

      await user.click(screen.getByRole('button', { name: /void result/i }));

      // The trigger stays mounted behind the modal, so the confirm has to be
      // located inside the dialog rather than by its (identical) label.
      const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: /void result/i });
      expect(confirm).toBeDisabled();

      await user.type(screen.getByLabelText(/reason for voiding/i), 'too short');
      expect(confirm).toBeDisabled();

      await user.type(screen.getByLabelText(/reason for voiding/i), ' and then some');
      expect(confirm).toBeEnabled();
    });

    it('sends the trimmed reason to the store', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest()} />);

      await user.click(screen.getByRole('button', { name: /void result/i }));
      await user.type(screen.getByLabelText(/reason for voiding/i), '  Scored against the wrong candidate  ');
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /void result/i }));

      expect(mockVoidTest).toHaveBeenCalledWith('test-1', 'Scored against the wrong candidate');
      expect(mockToastSuccess).toHaveBeenCalledWith('Result voided');
    });

    it('warns that the member can read the reason', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest()} />);

      await user.click(screen.getByRole('button', { name: /void result/i }));

      expect(screen.getByText(/The member can see this reason/)).toBeInTheDocument();
    });
  });

  describe('An already-voided result', () => {
    it('offers no actions and shows the void trail', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({
            status: 'voided',
            voided_at: '2026-08-08T21:00:00Z',
            voided_by_name: 'Chief Adams',
            void_reason: 'Scored against the wrong candidate',
          })}
        />
      );

      expect(screen.queryByRole('button', { name: /void result/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /accept result/i })).not.toBeInTheDocument();
      expect(screen.getByText(/Chief Adams/)).toBeInTheDocument();
      expect(screen.getByText(/Scored against the wrong candidate/)).toBeInTheDocument();
    });
  });

  // Without its own branch this panel fell through to the normal state and
  // told the officer the result "counts toward the candidate's record" — of a
  // test that was abandoned and counts toward nothing.
  describe('A cancelled test', () => {
    it('offers no actions and does not claim the result counts', () => {
      render(<SkillTestOfficerActions test={buildTest({ status: 'cancelled', result: 'incomplete' })} />);

      expect(screen.queryByRole('button', { name: /void result/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /accept result/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /release to candidate/i })).not.toBeInTheDocument();
      expect(screen.getByText('Test cancelled')).toBeInTheDocument();
      expect(screen.getByText(/counts toward nothing/)).toBeInTheDocument();
    });
  });

  describe('Responses predating the effective-policy fields', () => {
    it('describes the permissive default rather than claiming results are withheld', () => {
      render(
        <SkillTestOfficerActions
          test={buildTest({
            pending_validation: true,
            effective_result_disclosure: undefined,
            effective_result_release: undefined,
          })}
        />
      );

      expect(screen.getByText(/Accepting confirms/)).toHaveTextContent(/full scorecard/);
      expect(screen.queryByRole('button', { name: /release to candidate/i })).not.toBeInTheDocument();
    });
  });

  // The third exit from a pending submission. Voiding is right for a result
  // that was *wrong*; this is for one that was not finished properly, and it
  // must not cost a permanent, candidate-visible withdrawal.
  describe('Sending a submission back to its examiner', () => {
    it('is offered only while the result is still pending', () => {
      const { rerender } = render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);
      expect(screen.getByRole('button', { name: /send back to examiner/i })).toBeInTheDocument();

      rerender(
        <SkillTestOfficerActions
          test={buildTest({ pending_validation: false, validated_at: '2026-08-08T20:00:00Z' })}
        />
      );
      expect(screen.queryByRole('button', { name: /send back to examiner/i })).not.toBeInTheDocument();
    });

    it('says the candidate is neither told nor marked', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);

      await user.click(screen.getByRole('button', { name: /send back to examiner/i }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/Nothing is voided/)).toBeInTheDocument();
      expect(within(dialog).getByText(/they are not notified/i)).toBeInTheDocument();
    });

    it('will not send without a reason the examiner can act on', async () => {
      const user = userEvent.setup();
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);
      await user.click(screen.getByRole('button', { name: /send back to examiner/i }));

      const send = screen.getByRole('button', { name: /^send back$/i });
      expect(send).toBeDisabled();

      await user.type(screen.getByLabelText(/what needs correcting/i), 'too short');
      expect(send).toBeDisabled();

      await user.type(screen.getByLabelText(/what needs correcting/i), ' — recheck step 4');
      expect(send).toBeEnabled();
    });

    it('sends the trimmed reason and closes on success', async () => {
      const user = userEvent.setup();
      mockReturnTest.mockResolvedValue({});
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);
      await user.click(screen.getByRole('button', { name: /send back to examiner/i }));

      await user.type(screen.getByLabelText(/what needs correcting/i), '  Step 4 contradicts your note  ');
      await user.click(screen.getByRole('button', { name: /^send back$/i }));

      expect(mockReturnTest).toHaveBeenCalledWith('test-1', 'Step 4 contradicts your note');
      expect(mockToastSuccess).toHaveBeenCalledWith('Sent back to Gabriel Spiro');
    });

    it('keeps the dialog open and reports the failure when the send fails', async () => {
      const user = userEvent.setup();
      mockReturnTest.mockRejectedValue(new Error('Network Error'));
      render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);
      await user.click(screen.getByRole('button', { name: /send back to examiner/i }));

      await user.type(screen.getByLabelText(/what needs correcting/i), 'Recheck step 4 please');
      await user.click(screen.getByRole('button', { name: /^send back$/i }));

      expect(mockToastError).toHaveBeenCalledWith('Network Error');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Voiding remains the only way out of a result that already stands, so it
    // stays offered in both states.
    it('leaves void available whether or not the result is pending', () => {
      const { rerender } = render(<SkillTestOfficerActions test={buildTest({ pending_validation: true })} />);
      expect(screen.getByRole('button', { name: /void result/i })).toBeInTheDocument();

      rerender(<SkillTestOfficerActions test={buildTest({ pending_validation: false })} />);
      expect(screen.getByRole('button', { name: /void result/i })).toBeInTheDocument();
    });
  });
});
