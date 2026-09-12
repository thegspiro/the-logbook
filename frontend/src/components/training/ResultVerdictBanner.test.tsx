/**
 * The banner's job is to make the verdict and its reason the same fact.
 *
 * Each case here is one way the old headline could be read as a contradiction:
 * a failure above the passing mark, a percentage rounded away from the figure
 * the threshold was judged against, and a sheet with no score at all reporting
 * a bare number as though it had decided something.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ResultVerdictBanner } from './ResultVerdictBanner';
import type { ScoreBreakdown } from '../../types/skillsTesting';

function breakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    method: 'points',
    score_pass_fail_criteria: false,
    earned: 18,
    available: 20,
    percentage: 90,
    passing_percentage: 80,
    meets_threshold: true,
    require_all_critical: true,
    critical_failures: [],
    sections: [],
    ...overrides,
  };
}

describe('ResultVerdictBanner', () => {
  it('states a pass against the mark it cleared', () => {
    render(<ResultVerdictBanner result="pass" breakdown={breakdown()} />);

    expect(screen.getByText(/Passed/)).toBeInTheDocument();
    expect(screen.getByText(/at or above the 80% passing mark/)).toBeInTheDocument();
  });

  it('states a failure against the mark it missed', () => {
    render(<ResultVerdictBanner result="fail" breakdown={breakdown({ percentage: 72, meets_threshold: false })} />);

    expect(screen.getByText(/Failed/)).toBeInTheDocument();
    expect(screen.getByText(/Scored 72%, below the 80% passing mark/)).toBeInTheDocument();
  });

  // The case the whole component exists for: the percentage cleared the mark
  // and the test still failed, which read as an arithmetic error.
  it('names the critical step when the percentage did not decide the outcome', () => {
    render(
      <ResultVerdictBanner
        result="fail"
        breakdown={breakdown({
          critical_failures: [{ section_name: 'Airway', criterion_label: 'Opens the airway', reason: 'failed' }],
        })}
      />
    );

    expect(
      screen.getByText(/A critical step was not met, which fails the test whatever the score/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Opens the airway/)).toBeInTheDocument();
    expect(screen.getByText(/Airway/)).toBeInTheDocument();
  });

  it('pluralises and marks an unmarked critical step as such', () => {
    render(
      <ResultVerdictBanner
        result="fail"
        breakdown={breakdown({
          critical_failures: [
            { section_name: 'Airway', criterion_label: 'Opens the airway', reason: 'failed' },
            { section_name: 'Scene', criterion_label: 'Takes precautions', reason: 'not_scored' },
          ],
        })}
      />
    );

    expect(screen.getByText(/2 critical steps were not met/)).toBeInTheDocument();
    expect(screen.getByText(/left unmarked/)).toBeInTheDocument();
  });

  // A template with require_all_critical off enforces nothing, so a listed
  // critical failure there would claim a consequence that never applied.
  it('ignores critical failures the template does not enforce', () => {
    render(
      <ResultVerdictBanner
        result="fail"
        breakdown={breakdown({
          require_all_critical: false,
          meets_threshold: false,
          percentage: 60,
          critical_failures: [{ section_name: 'Airway', criterion_label: 'Opens the airway', reason: 'failed' }],
        })}
      />
    );

    expect(screen.queryByText(/Opens the airway/)).not.toBeInTheDocument();
    expect(screen.getByText(/below the 80% passing mark/)).toBeInTheDocument();
  });

  it('says so when the sheet carries no score at all', () => {
    render(
      <ResultVerdictBanner
        result="pass"
        breakdown={breakdown({ method: 'none', percentage: null, available: 0, earned: 0 })}
      />
    );

    expect(screen.getByText(/Judged on its critical steps/)).toBeInTheDocument();
    expect(screen.queryByText(/passing mark/)).not.toBeInTheDocument();
  });

  it('says so when the template sets no passing mark', () => {
    render(<ResultVerdictBanner result="pass" breakdown={breakdown({ passing_percentage: null })} />);

    expect(screen.getByText(/sets no passing mark, so the score alone did not decide/)).toBeInTheDocument();
  });

  // The rounding split that produced "90%" above "Passing mark is 90% — not
  // met". Both figures now come from the same formatter.
  it('prints the figure the threshold was judged against, undisturbed', () => {
    render(
      <ResultVerdictBanner
        result="fail"
        breakdown={breakdown({ percentage: 89.5, passing_percentage: 90, meets_threshold: false })}
      />
    );

    expect(screen.getByText('89.5%')).toBeInTheDocument();
    expect(screen.getByText(/Scored 89\.5%, below the 90% passing mark/)).toBeInTheDocument();
  });

  // A redacted view can carry the score without the working behind it.
  it('falls back to the stored score when no breakdown arrived', () => {
    render(<ResultVerdictBanner result="pass" overallScore={88} />);

    expect(screen.getByText(/Passed/)).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
  });

  // A voided result keeps its marks on display — the scorecard is the evidence
  // of what was withdrawn — but must not read as a standing pass.
  it('drops the pass colouring on a voided result', () => {
    render(<ResultVerdictBanner result="pass" breakdown={breakdown()} isVoided />);

    const headline = screen.getByText(/Passed/);
    expect(headline.className).toContain('line-through');
    expect(headline.className).not.toContain('text-green-700');
  });
});
