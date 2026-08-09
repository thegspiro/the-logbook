import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScoreBreakdownPanel } from './ScoreBreakdownPanel';
import type { ScoreBreakdown, ScoreBreakdownSection } from '../../types/skillsTesting';

function section(overrides: Partial<ScoreBreakdownSection> & { section_id: string }): ScoreBreakdownSection {
  return {
    section_name: overrides.section_id,
    counts_toward_score: true,
    earned: 0,
    available: 0,
    passed: 0,
    failed: 0,
    not_scored: 0,
    statements: 0,
    ...overrides,
  };
}

function breakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    method: 'points',
    score_pass_fail_criteria: false,
    earned: 12,
    available: 14,
    percentage: 85.7,
    passing_percentage: 80,
    meets_threshold: true,
    require_all_critical: true,
    critical_failures: [],
    sections: [],
    ...overrides,
  };
}

describe('ScoreBreakdownPanel', () => {
  it('shows the point total behind the percentage', () => {
    render(<ScoreBreakdownPanel breakdown={breakdown()} />);

    expect(screen.getByText('12 of 14 points')).toBeInTheDocument();
    expect(screen.getByText(/85\.7%/)).toBeInTheDocument();
  });

  it('states the passing mark and whether it was met', () => {
    render(<ScoreBreakdownPanel breakdown={breakdown({ meets_threshold: false })} />);

    expect(screen.getByText(/Passing mark is 80% — not met/)).toBeInTheDocument();
  });

  it('says so when the template sets no passing percentage', () => {
    render(<ScoreBreakdownPanel breakdown={breakdown({ passing_percentage: null })} />);

    expect(screen.getByText(/sets no passing percentage/)).toBeInTheDocument();
  });

  it('names a section that contributed nothing to the percentage', () => {
    // The whole point of the panel: "Cot Questions" is marked up in full on the
    // scorecard and moved the number not at all.
    render(
      <ScoreBreakdownPanel
        breakdown={breakdown({
          sections: [
            section({ section_id: 'section-0', section_name: 'Bring the cot', earned: 5, available: 5 }),
            section({
              section_id: 'section-1',
              section_name: 'Cot Questions',
              counts_toward_score: false,
              earned: null,
              available: null,
              passed: 2,
              failed: 2,
            }),
          ],
        })}
      />
    );

    expect(screen.getByText('5/5 pts')).toBeInTheDocument();
    // Twice over: as a row in the table, and named in the footnote below it.
    expect(screen.getAllByText('Cot Questions')).toHaveLength(2);
    expect(screen.getByText('2 passed · 2 failed')).toBeInTheDocument();
    expect(screen.getByText('not scored')).toBeInTheDocument();
    expect(screen.getByText(/holds no steps carrying points/)).toBeInTheDocument();
    expect(screen.getByText(/Pass\/Fail steps are not worth points/)).toBeInTheDocument();
  });

  it('omits the Pass/Fail hint once the template scores them', () => {
    render(
      <ScoreBreakdownPanel
        breakdown={breakdown({
          score_pass_fail_criteria: true,
          sections: [
            section({ section_id: 'section-0', section_name: 'Timing', counts_toward_score: false, earned: null }),
          ],
        })}
      />
    );

    expect(screen.queryByText(/Pass\/Fail steps are not worth points/)).not.toBeInTheDocument();
  });

  it('names the critical step that failed a test the percentage would have passed', () => {
    render(
      <ScoreBreakdownPanel
        breakdown={breakdown({
          critical_failures: [
            { section_name: 'Procedure', criterion_label: 'Assess scene safety', reason: 'failed' },
            { section_name: 'Place cot', criterion_label: 'Secure the stretcher', reason: 'not_scored' },
          ],
        })}
      />
    );

    expect(screen.getByText(/2 critical steps/)).toBeInTheDocument();
    expect(screen.getByText(/Assess scene safety/)).toBeInTheDocument();
    expect(screen.getByText(/left unscored/)).toBeInTheDocument();
  });

  it('hides critical failures when the template does not require them', () => {
    render(
      <ScoreBreakdownPanel
        breakdown={breakdown({
          require_all_critical: false,
          critical_failures: [{ section_name: 'Procedure', criterion_label: 'Scene safety', reason: 'failed' }],
        })}
      />
    );

    expect(screen.queryByText(/regardless of the percentage/)).not.toBeInTheDocument();
  });

  it('explains a template with nothing scorable on it', () => {
    render(<ScoreBreakdownPanel breakdown={breakdown({ method: 'none', percentage: null, available: 0 })} />);

    expect(screen.getByText(/No percentage could be calculated/)).toBeInTheDocument();
  });
});
