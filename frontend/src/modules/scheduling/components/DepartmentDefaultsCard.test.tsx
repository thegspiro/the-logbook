import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '../types/shiftSettings';
import { DepartmentDefaultsCard } from './DepartmentDefaultsCard';

describe('DepartmentDefaultsCard', () => {
  it('offers the three defaults the scheduler reads', () => {
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
});
