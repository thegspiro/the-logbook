import { describe, it, expect } from 'vitest';
import type { HistoryImportAnalysis } from '../../../../modules/scheduling/types/historyImport';
import { hoursLabel, isSettled, memberLabel, unitLabel } from './historyImportLabels';

const analysis: HistoryImportAnalysis = {
  can_commit: false,
  blocking_issue_count: 0,
  counts: {
    rows: 0,
    excluded: 0,
    skipped: 0,
    with_errors: 0,
    new_shifts: 0,
    existing_shifts: 0,
    attendances: 0,
    external_entries: 0,
    duplicates: 0,
  },
  rows: [],
  positions: [],
  shifts: [],
  external: [],
  issues: [],
  members: [
    {
      key: 'number:77',
      display_name: 'Dana Former',
      first_name: 'Dana',
      last_name: 'Former',
      membership_number: '77',
      email: '',
      username: '',
      status: 'create',
      candidate_ids: [],
      reason: '',
      row_count: 1,
      remembered: false,
    },
  ],
  units: [
    {
      key: '|m7',
      unit: 'M7',
      agency: '',
      status: 'mapped',
      target_kind: 'new_external',
      candidates: [],
      new_agency_name: 'Metro Fire',
      new_unit_name: 'M7',
      row_count: 1,
      remembered: false,
    },
  ],
  options: {
    members: [{ id: 'u-1', name: 'Alice Ng', membership_number: '101', status: 'active' }],
    units: [
      { kind: 'own', id: 'app-1', name: 'A106E - Ambulance' },
      { kind: 'external', id: 'ext-1', name: 'A106', agency_name: 'County EMS' },
    ],
    seats: [],
  },
};

describe('history import labels', () => {
  it('shows split shifts joined to the half hour', () => {
    expect(hoursLabel(25 * 60 + 30)).toBe('25.5 h');
    expect(hoursLabel(24 * 60)).toBe('24 h');
    expect(hoursLabel(22 * 60 + 15)).toBe('22.25 h');
  });

  it('names existing and new members', () => {
    expect(memberLabel(analysis, 'u-1')).toBe('Alice Ng');
    expect(memberLabel(analysis, 'new:number:77')).toBe('Dana Former (new, inactive)');
    expect(memberLabel(analysis, 'u-missing')).toBe('Unknown member');
  });

  it("names the department's units, outside units and units the commit will add", () => {
    expect(unitLabel(analysis, 'own', 'app-1')).toBe('A106E - Ambulance');
    expect(unitLabel(analysis, 'external', 'ext-1')).toBe('A106 (County EMS)');
    expect(unitLabel(analysis, 'new_external', '|m7')).toBe('M7 (Metro Fire, new)');
  });

  it('counts matched, mapped and create as settled, and nothing else', () => {
    expect(['matched', 'mapped', 'create'].every(isSettled)).toBe(true);
    expect(['conflict', 'ambiguous', 'unmatched'].some(isSettled)).toBe(false);
  });
});
