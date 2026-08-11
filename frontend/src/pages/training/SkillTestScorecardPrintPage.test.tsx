import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

/** The row whose first cell names `label`.
 *
 *  Several values legitimately appear twice on a scorecard — "PASS" as the
 *  overall verdict and again beside a step, "4 / 5" as a section's points and
 *  as one criterion's score — so assertions are scoped to the row they belong
 *  to rather than to the page. */
const rowFor = (label: string): HTMLElement =>
  screen.getAllByRole('row').find((row) => within(row).queryByText(label) !== null) as HTMLElement;

const mockGetTest = vi.fn();

vi.mock('../../services/trainingServices', () => ({
  skillsTestingService: {
    getTest: (...args: unknown[]) => mockGetTest(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import SkillTestScorecardPrintPage from './SkillTestScorecardPrintPage';

const baseTest = {
  id: 'test-1',
  organization_id: 'org-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Donning — Timed Evolution',
  candidate_id: 'u1',
  candidate_name: 'Nadia Belhaj',
  examiner_id: 'u2',
  examiner_name: 'Callum Frazier',
  status: 'completed',
  result: 'pass',
  is_practice: false,
  pending_validation: false,
  overall_score: 92,
  elapsed_seconds: 372,
  notes: 'Strong run overall.',
  completed_at: '2026-08-08T14:30:00Z',
  created_at: '2026-08-08T14:00:00Z',
  updated_at: '2026-08-08T14:30:00Z',
  validated_at: '2026-08-08T15:00:00Z',
  validated_by_name: 'Dana Ruiz',
  version: 2,
  template_sections: [
    {
      name: 'Preparation',
      criteria: [
        { label: 'Brief', type: 'statement', statement_text: 'Go.' },
        { label: 'Checks cylinder', type: 'pass_fail', required: true },
        { label: 'Seal quality', type: 'score', max_score: 5, passing_score: 3 },
        { label: 'In time', type: 'time_limit', required: true, time_limit_seconds: 60 },
        { label: 'PPE', type: 'checklist', required: true, checklist_items: ['Helmet', 'Hood'] },
        { label: 'Unmarked step', type: 'pass_fail' },
      ],
    },
  ],
  section_results: [
    {
      section_id: 'section-0',
      criteria_results: [
        { criterion_id: 'criterion-0-0', passed: true },
        { criterion_id: 'criterion-0-1', passed: true, notes: 'Clean check.' },
        { criterion_id: 'criterion-0-2', score: 4, passed: true },
        { criterion_id: 'criterion-0-3', passed: true, time_seconds: 48 },
        { criterion_id: 'criterion-0-4', passed: false, checklist_completed: [true, false] },
      ],
    },
  ],
  score_breakdown: {
    method: 'points' as const,
    score_pass_fail_criteria: false,
    earned: 4,
    available: 5,
    percentage: 92,
    passing_percentage: 70,
    meets_threshold: true,
    require_all_critical: true,
    critical_failures: [],
    sections: [
      {
        section_id: 'section-0',
        section_name: 'Preparation',
        counts_toward_score: true,
        earned: 4,
        available: 5,
        passed: 3,
        failed: 1,
        not_scored: 1,
        statements: 1,
      },
    ],
  },
};

function renderAt(query = '?id=test-1') {
  window.history.pushState({}, '', `/training/skills-testing/print/scorecard${query}`);
  return renderWithRouter(<SkillTestScorecardPrintPage />);
}

describe('SkillTestScorecardPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTest.mockResolvedValue(baseTest);
  });

  it('records who was tested, by whom, and the verdict', async () => {
    renderAt();

    expect(await screen.findByText('Skill Evaluation Record')).toBeInTheDocument();
    expect(screen.getByText('SCBA Donning — Timed Evolution')).toBeInTheDocument();
    expect(screen.getByText('Nadia Belhaj')).toBeInTheDocument();
    expect(screen.getByText('Callum Frazier')).toBeInTheDocument();
    expect(within(rowFor('Result:')).getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('(pass mark 70%)')).toBeInTheDocument();
    expect(screen.getByText('6m 12s')).toBeInTheDocument();
  });

  it('prints the server-side breakdown rather than recomputing it', async () => {
    renderAt();

    expect(await screen.findByText('Score Breakdown')).toBeInTheDocument();
    // The breakdown row reports the section's point total and its tallies.
    const section = rowFor('Preparation');
    expect(within(section).getByText('4 / 5')).toBeInTheDocument();
    expect(within(section).getByText('3')).toBeInTheDocument();
  });

  it('shows what was recorded against each step, per type', async () => {
    renderAt();
    await screen.findByText('Checks cylinder');

    expect(within(rowFor('Seal quality')).getByText('4 / 5')).toBeInTheDocument();
    expect(within(rowFor('In time')).getByText(/48s/)).toBeInTheDocument();
    expect(within(rowFor('PPE')).getByText(/1\/2/)).toBeInTheDocument();
    expect(within(rowFor('Brief')).getByText('read aloud')).toBeInTheDocument();
    expect(within(rowFor('Checks cylinder')).getByText('Clean check.')).toBeInTheDocument();
  });

  it('says plainly when a step was never marked', async () => {
    renderAt();
    await screen.findByText('Unmarked step');

    expect(screen.getByText('not scored')).toBeInTheDocument();
  });

  it('explains a critical failure, so a passing percentage that failed makes sense', async () => {
    mockGetTest.mockResolvedValue({
      ...baseTest,
      result: 'fail',
      score_breakdown: {
        ...baseTest.score_breakdown,
        critical_failures: [
          { section_name: 'Preparation', criterion_label: 'PPE', reason: 'failed' },
          { section_name: 'Preparation', criterion_label: 'In time', reason: 'not_scored' },
        ],
      },
    });
    renderAt();

    expect(await screen.findByText('Critical steps not passed')).toBeInTheDocument();
    expect(screen.getByText(/Preparation — PPE/)).toBeInTheDocument();
    expect(screen.getByText(/In time \(left unscored\)/)).toBeInTheDocument();
  });

  it('records the officer sign-off an official result rests on', async () => {
    renderAt();

    expect(await screen.findByText('Validation')).toBeInTheDocument();
    expect(screen.getByText(/Dana Ruiz/)).toBeInTheDocument();
  });

  it('marks an unvalidated official result as such', async () => {
    mockGetTest.mockResolvedValue({ ...baseTest, validated_at: null, validated_by_name: null });
    renderAt();

    expect(await screen.findByText('Not validated.')).toBeInTheDocument();
  });

  it('marks a practice attempt as no part of the training history', async () => {
    mockGetTest.mockResolvedValue({ ...baseTest, is_practice: true, validated_at: null });
    renderAt();

    expect(await screen.findByText(/Practice attempt — not an official record/)).toBeInTheDocument();
    expect(screen.getByText(/Practice attempts are not validated/)).toBeInTheDocument();
  });

  it('carries the void notice and its reason onto the paper record', async () => {
    mockGetTest.mockResolvedValue({
      ...baseTest,
      status: 'voided',
      void_reason: 'Wrong candidate selected.',
      voided_by_name: 'Dana Ruiz',
      voided_at: '2026-08-09T09:00:00Z',
    });
    renderAt();

    expect(await screen.findByText(/VOIDED/)).toBeInTheDocument();
    expect(screen.getByText(/Wrong candidate selected\./)).toBeInTheDocument();
  });

  // The API withholds the outcome until an officer signs off. Printing then
  // would hand the candidate a document reading as a failure nobody recorded.
  it('refuses to print a result still awaiting validation', async () => {
    mockGetTest.mockResolvedValue({ ...baseTest, pending_validation: true, overall_score: null });
    renderAt();

    expect(await screen.findByText('Not ready to print')).toBeInTheDocument();
    await waitFor(() => expect(window.print).not.toHaveBeenCalled());
  });

  // Under `scores` disclosure the API strips examiner notes before the payload
  // leaves the server; the page shows what arrived and derives nothing.
  it('renders no examiner notes when the API redacted them', async () => {
    mockGetTest.mockResolvedValue({
      ...baseTest,
      section_results: [
        {
          section_id: 'section-0',
          criteria_results: [{ criterion_id: 'criterion-0-1', passed: true }],
        },
      ],
    });
    renderAt();

    await screen.findByText('Checks cylinder');
    expect(screen.queryByText('Clean check.')).not.toBeInTheDocument();
  });

  it('opens the print dialog once the scorecard has rendered', async () => {
    renderAt();
    await screen.findByText('Skill Evaluation Record');

    // window.print() genuinely takes no arguments, so the zero-arg assertion
    // is the intent here rather than an oversight.
    await waitFor(() => expect(window.print).toHaveBeenCalledWith(), { timeout: 2000 });
  });

  it('reports a missing id instead of fetching nothing', async () => {
    renderAt('');

    expect(await screen.findByText('No test ID provided')).toBeInTheDocument();
    expect(mockGetTest).not.toHaveBeenCalled();
  });

  it('reports a failed load rather than printing a blank page', async () => {
    mockGetTest.mockRejectedValue(new Error('boom'));
    renderAt();

    expect(await screen.findByText('Failed to load scorecard')).toBeInTheDocument();
    await waitFor(() => expect(window.print).not.toHaveBeenCalled());
  });
});
