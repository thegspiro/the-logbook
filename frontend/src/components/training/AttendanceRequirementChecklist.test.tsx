/**
 * Each session-attendance requirement on offer says whom it applies to, in the
 * precedence the backend grades by (requirement_applies_to_member):
 * applies_to_all, then member categories, then rank or position, and a
 * requirement naming none of them applies to nobody (pitfall #29).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttendanceRequirementChecklist from './AttendanceRequirementChecklist';
import type { TrainingRequirement } from '../../types/training';

const requirement = (overrides: Partial<TrainingRequirement>): TrainingRequirement => ({
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Drill attendance',
  requirement_type: 'session_attendance',
  source: 'department',
  frequency: 'annual',
  due_date_type: 'calendar_period',
  applies_to_all: false,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const renderWith = (r: TrainingRequirement) =>
  render(<AttendanceRequirementChecklist requirements={[r]} value={[]} onChange={vi.fn()} />);

describe('AttendanceRequirementChecklist › whom a requirement applies to', () => {
  it('says all members when the requirement applies to all', () => {
    renderWith(requirement({ applies_to_all: true, required_membership_types: ['active'] }));
    expect(screen.getByRole('checkbox', { name: 'Drill attendance' })).toHaveAccessibleDescription(
      'Applies to all members'
    );
  });

  // The backend grades this as applying to nobody, and the Mandatory for
  // pre-fill fills nothing from it; it used to read "Applies to all members".
  it('says no members when the requirement names nobody', () => {
    renderWith(requirement({ applies_to_all: false, required_membership_types: [], required_roles: [] }));
    expect(screen.getByRole('checkbox', { name: 'Drill attendance' })).toHaveAccessibleDescription(
      'Applies to no members: no member categories, ranks or positions are set'
    );
  });

  // A list of blank words matches no member's category, and the grader does
  // not go on to ranks or positions once the list is non-empty: the
  // Mandatory-for note says it applies to nobody, and so does this.
  it('says no members when the member categories are all blank, whatever rank it names', () => {
    renderWith(requirement({ required_membership_types: ['', '  '], required_roles: ['captain'] }));
    expect(screen.getByRole('checkbox', { name: 'Drill attendance' })).toHaveAccessibleDescription(
      'Applies to no members: no member categories, ranks or positions are set'
    );
  });

  it('leaves a blank word out of the categories it names', () => {
    renderWith(requirement({ required_membership_types: [' active ', ''] }));
    expect(screen.getByRole('checkbox', { name: 'Drill attendance' })).toHaveAccessibleDescription(
      'Member categories: Active'
    );
  });

  it('names the member categories, ahead of any rank or position', () => {
    renderWith(requirement({ required_membership_types: ['active', 'probationary'], required_roles: ['captain'] }));
    expect(screen.getByRole('checkbox', { name: 'Drill attendance' })).toHaveAccessibleDescription(
      'Member categories: Active, Probationary'
    );
  });

  it('says rank or position when that is all it names', () => {
    renderWith(requirement({ required_positions: ['engineer'] }));
    expect(screen.getByRole('checkbox', { name: 'Drill attendance' })).toHaveAccessibleDescription(
      'Applies to members by rank or position'
    );
  });
});
