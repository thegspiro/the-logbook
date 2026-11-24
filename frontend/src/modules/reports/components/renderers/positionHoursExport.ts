/**
 * The Hours by Position report's export rows and columns. The columns must
 * equal `position_hours` in backend/app/data/report_export_columns.json,
 * which the server's CSV and PDF are built from (exportColumnsParity.test.ts).
 */

import type { PositionHoursEntry, PositionHoursReport } from '../../types';

const COLUMNS = [
  { key: 'member_name', header: 'Member' },
  { key: 'position', header: 'Position' },
  { key: 'hours', header: 'Hours' },
  { key: 'shifts', header: 'Shifts' },
  { key: 'calls', header: 'Calls' },
];

export const positionHoursRow = (entry: PositionHoursEntry): Record<string, unknown> => ({
  member_name: entry.member_name,
  position: entry.position,
  hours: entry.hours,
  shifts: entry.shifts,
  calls: entry.calls,
});

export function getPositionHoursExportData(data: PositionHoursReport) {
  return { rows: data.entries.map(positionHoursRow), columns: COLUMNS };
}
