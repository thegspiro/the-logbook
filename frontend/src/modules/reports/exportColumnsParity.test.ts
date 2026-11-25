/**
 * The Reports page's CSV and PDF are built on the server from
 * backend/app/data/report_export_columns.json. This holds that file equal to
 * what the page shows: every renderer's export columns, and every report
 * card's title (which names the downloaded file and heads the PDF). Changing
 * one side without the other fails here, rather than shipping an export whose
 * columns no longer match the screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getAdminHoursExportData } from './components/renderers/AdminHoursRenderer';
import { getAnnualTrainingExportData } from './components/renderers/AnnualTrainingRenderer';
import { getApparatusStatusExportData } from './components/renderers/ApparatusStatusRenderer';
import { getCallVolumeExportData } from './components/renderers/CallVolumeRenderer';
import { getCertExpirationExportData } from './components/renderers/CertExpirationRenderer';
import { getComplianceStatusExportData } from './components/renderers/ComplianceStatusRenderer';
import { getDepartmentOverviewExportData } from './components/renderers/DepartmentOverviewRenderer';
import { getEventAttendanceExportData } from './components/renderers/EventAttendanceRenderer';
import { getInventoryStatusExportData } from './components/renderers/InventoryStatusRenderer';
import { getMemberRosterExportData } from './components/renderers/MemberRosterRenderer';
import { getPipelineOverviewExportData } from './components/renderers/PipelineOverviewRenderer';
import { getPositionHoursExportData } from './components/renderers/positionHoursExport';
import { getTrainingProgressExportData } from './components/renderers/TrainingProgressRenderer';
import { getTrainingSummaryExportData } from './components/renderers/TrainingSummaryRenderer';
import type {
  AdminHoursReport,
  AnnualTrainingReport,
  ApparatusStatusReport,
  CallVolumeReport,
  CertExpirationReport,
  ComplianceStatusReport,
  DepartmentOverviewReport,
  EventAttendanceReport,
  InventoryStatusReport,
  MemberRosterReport,
  PipelineOverviewReport,
  PositionHoursReport,
  TrainingProgressReport,
  TrainingSummaryReport,
} from './types';

interface ContractColumn {
  key: string;
  header: string;
}
interface ContractEntry {
  title: string;
  columns: ContractColumn[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const contract = JSON.parse(
  fs.readFileSync(path.join(REPO, 'backend/app/data/report_export_columns.json'), 'utf8')
) as Record<string, ContractEntry | string>;

const entry = (reportType: string): ContractEntry => {
  const value = contract[reportType];
  if (!value || typeof value === 'string') throw new Error(`No contract entry for ${reportType}`);
  return value;
};

const columnsOf = (result: { columns: ContractColumn[] }): ContractColumn[] =>
  result.columns.map(({ key, header }) => ({ key, header }));

// Empty reports: the columns a renderer exports do not depend on its rows,
// except call volume's per-type columns, which the contract marks dynamic.
const empty = { entries: [], events: [], members: [], prospects: [] };

const RENDERED: Record<string, () => ContractColumn[]> = {
  member_roster: () => columnsOf(getMemberRosterExportData(empty as unknown as MemberRosterReport)),
  training_summary: () => columnsOf(getTrainingSummaryExportData(empty as unknown as TrainingSummaryReport)),
  event_attendance: () => columnsOf(getEventAttendanceExportData(empty as unknown as EventAttendanceReport)),
  training_progress: () => columnsOf(getTrainingProgressExportData(empty as unknown as TrainingProgressReport)),
  annual_training: () => columnsOf(getAnnualTrainingExportData(empty as unknown as AnnualTrainingReport)),
  admin_hours: () => columnsOf(getAdminHoursExportData(empty as unknown as AdminHoursReport)),
  position_hours: () => columnsOf(getPositionHoursExportData(empty as unknown as PositionHoursReport)),
  department_overview: () =>
    columnsOf(
      getDepartmentOverviewExportData({
        members: {},
        training: {},
        events: {},
        action_items: {},
      } as unknown as DepartmentOverviewReport)
    ),
  certification_expiration: () => columnsOf(getCertExpirationExportData(empty as unknown as CertExpirationReport)),
  compliance_status: () => columnsOf(getComplianceStatusExportData(empty as unknown as ComplianceStatusReport)),
  apparatus_status: () => columnsOf(getApparatusStatusExportData(empty as unknown as ApparatusStatusReport)),
  inventory_status: () => columnsOf(getInventoryStatusExportData(empty as unknown as InventoryStatusReport)),
  call_volume: () => columnsOf(getCallVolumeExportData(empty as unknown as CallVolumeReport)),
  pipeline_overview: () => columnsOf(getPipelineOverviewExportData(empty as unknown as PipelineOverviewReport)),
};

/** id -> title for each report card, read from the page's own definitions. */
const cardTitles = (): Map<string, string> => {
  const source = fs.readFileSync(path.join(HERE, 'pages/ReportsPage.tsx'), 'utf8');
  const typeMap = new Map([...source.matchAll(/'([a-z-]+)':\s*'([a-z_]+)'/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
  const titles = new Map<string, string>();
  for (const m of source.matchAll(/id:\s*'([a-z-]+)',\s*\n\s*title:\s*'((?:[^'\\]|\\.)*)'/g)) {
    const reportType = typeMap.get(m[1] ?? '');
    if (reportType) titles.set(reportType, (m[2] ?? '').replace(/\\'/g, "'"));
  }
  return titles;
};

const reportTypes = Object.keys(contract).filter((key) => !key.startsWith('_'));

describe('server export column contract', () => {
  it('covers exactly the report types the page renders', () => {
    expect(reportTypes.sort()).toEqual(Object.keys(RENDERED).sort());
  });

  it.each(reportTypes)('%s exports the columns its renderer exports', (reportType) => {
    expect(RENDERED[reportType]?.()).toEqual(entry(reportType).columns);
  });

  it.each(reportTypes)('%s is titled as its report card is', (reportType) => {
    expect(cardTitles().get(reportType)).toBe(entry(reportType).title);
  });
});
