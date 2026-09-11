/**
 * "Step 4 of 11" overstates what is left when seven of the eleven are
 * skippable, and nothing in the bar said which were which.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import ProgressIndicator from './ProgressIndicatorEnhanced';
import { ONBOARDING_STEPS } from '../config/steps';

describe('ProgressIndicator', () => {
  it('says a required step is required', () => {
    render(<ProgressIndicator step="organization" />);

    expect(screen.getByText(/this step is required to finish setup/i)).toBeInTheDocument();
  });

  it('says an optional step can be skipped outright', () => {
    render(<ProgressIndicator step="file_storage" />);

    expect(screen.getByText(/skip is a complete answer/i)).toBeInTheDocument();
  });

  it('tells the operator when nothing required is left', () => {
    // Every required step is behind them by the third step, so from there on
    // they can stop whenever they like — worth saying, since the remaining
    // steps are the ones that send people looking for credentials.
    render(<ProgressIndicator step="file_storage" />);

    expect(screen.getByText(/setup can be finished from here/i)).toBeInTheDocument();
  });

  it('marks every optional step in the strip and no required one', () => {
    render(<ProgressIndicator step="organization" />);

    const optionalCount = ONBOARDING_STEPS.filter((s) => s.optional).length;
    expect(screen.getAllByText('(optional)')).toHaveLength(optionalCount);
  });

  it('reports position against the full flow', () => {
    render(<ProgressIndicator step="system_owner" />);

    expect(screen.getByText(`Step 2 of ${ONBOARDING_STEPS.length}: Administrator Account`)).toBeInTheDocument();
  });
});
