import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '../types/shiftSettings';
import { DepartmentDefaultsCard } from './DepartmentDefaultsCard';

describe('DepartmentDefaultsCard', () => {
  it('offers the three department defaults', () => {
    render(<DepartmentDefaultsCard settings={{ ...DEFAULT_SETTINGS }} onSettingsChange={vi.fn()} />);

    expect(screen.getByLabelText('Default Shift Duration (hours)')).toBeInTheDocument();
    expect(screen.getByLabelText('Default Min Staffing')).toBeInTheDocument();
    expect(screen.getByLabelText('Overtime Threshold (hours/week)')).toBeInTheDocument();
  });

  // require_assignment_confirmation is stored but nothing acts on it, so a
  // switch for it would only claim an effect it does not have (pitfall #19).
  it('does not offer the assignment-confirmation switch nothing reads', () => {
    render(<DepartmentDefaultsCard settings={{ ...DEFAULT_SETTINGS }} onSettingsChange={vi.fn()} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/assignment confirmation/i)).not.toBeInTheDocument();
  });

  // Pitfall #19: the three values are stored but no shift, template or overtime
  // warning reads them yet, so the card says so instead of implying an effect.
  it('labels the defaults as not in effect yet', () => {
    render(<DepartmentDefaultsCard settings={{ ...DEFAULT_SETTINGS }} onSettingsChange={vi.fn()} />);

    expect(screen.getByText(/Not in effect yet — these are saved, but new shifts and templates/)).toBeInTheDocument();
  });
});
