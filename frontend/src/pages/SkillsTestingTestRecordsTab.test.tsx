import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SkillsTestingTestRecordsTab from './SkillsTestingTestRecordsTab';

const mockLoadTests = vi.fn();
const mockLoadTemplates = vi.fn();
const mockDeleteTest = vi.fn();
const mockVoidTest = vi.fn();
const mockCancelTest = vi.fn();
const mockReleaseTest = vi.fn();
const mockValidateTest = vi.fn();

const completedTest = {
  id: 'test-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Evaluation',
  candidate_id: 'user-1',
  candidate_name: 'John Smith',
  examiner_id: 'user-2',
  examiner_name: 'Captain Jones',
  status: 'completed' as const,
  result: 'pass' as const,
  is_practice: false,
  overall_score: 95,
  started_at: '2026-01-15T10:00:00Z',
  completed_at: '2026-01-15T10:30:00Z',
  created_at: '2026-01-15T10:00:00Z',
};

const unfinishedTest = {
  ...completedTest,
  id: 'test-2',
  status: 'in_progress' as const,
  result: 'incomplete' as const,
  overall_score: undefined,
  completed_at: undefined,
};

const practiceTest = {
  ...completedTest,
  id: 'test-3',
  is_practice: true,
};

const pendingTest = {
  ...completedTest,
  id: 'test-4',
  pending_validation: true,
};

let mockTests: (typeof completedTest | typeof unfinishedTest)[] = [];

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: () => ({
    tests: mockTests,
    testsLoading: false,
    loadTests: mockLoadTests,
    deleteTest: mockDeleteTest,
    voidTest: mockVoidTest,
    cancelTest: mockCancelTest,
    releaseTest: mockReleaseTest,
    validateTest: mockValidateTest,
    templates: [{ id: 'tpl-1', name: 'SCBA Evaluation' }],
    loadTemplates: mockLoadTemplates,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('SkillsTestingTestRecordsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTests = [];
    mockCancelTest.mockResolvedValue(undefined);
    mockDeleteTest.mockResolvedValue(undefined);
    mockValidateTest.mockResolvedValue(undefined);
  });

  // An unfinished test is the one row with work waiting on it, and it read as
  // muted grey status text that said nothing about being the way back in.
  describe('Resuming an unfinished test', () => {
    it('invites the officer back into a test that was left part-done', () => {
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      expect(screen.getByText('Tap to resume')).toBeInTheDocument();
    });

    it('opens an unfinished test on the scoring screen', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByText('SCBA Evaluation'));

      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-2/active');
    });

    it('opens a finished test on its scorecard', async () => {
      const user = userEvent.setup();
      mockTests = [completedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByText('SCBA Evaluation'));

      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-1');
    });
  });

  // These were window.confirm / window.prompt. A browser may suppress a prompt,
  // and a suppressed one returns null — indistinguishable from "cancelled" — so
  // cancelling a test could silently do nothing.
  describe('Closing out a test', () => {
    it('asks in-app before cancelling, and keeps the reason optional', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /cancel unfinished test for John Smith/i }));
      expect(await screen.findByText('Cancel unfinished test')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^cancel test$/i }));

      expect(mockCancelTest).toHaveBeenCalledWith('test-2', undefined);
    });

    it('passes a typed reason through to the cancel call', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /cancel unfinished test for John Smith/i }));
      await user.type(await screen.findByLabelText(/reason/i), 'Drill called off for a run');
      await user.click(screen.getByRole('button', { name: /^cancel test$/i }));

      expect(mockCancelTest).toHaveBeenCalledWith('test-2', 'Drill called off for a run');
    });

    it('does not cancel when the officer backs out', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /cancel unfinished test for John Smith/i }));
      await user.click(await screen.findByRole('button', { name: /keep it open/i }));

      expect(mockCancelTest).not.toHaveBeenCalled();
    });

    it('confirms in-app before deleting a practice attempt', async () => {
      const user = userEvent.setup();
      mockTests = [practiceTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /delete practice attempt for John Smith/i }));
      expect(await screen.findByText('Delete practice attempt?')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      expect(mockDeleteTest).toHaveBeenCalledWith('test-3');
    });
  });

  describe('Validating a member-run result', () => {
    it('spells out what accepting the result does before doing it', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /validate result for John Smith/i }));

      expect(await screen.findByText('Validate this result?')).toBeInTheDocument();
      expect(screen.getByText(/uses one of their attempts/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^validate$/i }));

      expect(mockValidateTest).toHaveBeenCalledWith('test-4');
    });
  });
});
