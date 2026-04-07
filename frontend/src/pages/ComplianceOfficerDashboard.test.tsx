import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetAnnualReport = vi.fn();
const mockGetISOReadiness = vi.fn();
const mockGetRecordCompleteness = vi.fn();
const mockGetAttestations = vi.fn();
const mockCreateAttestation = vi.fn();
const mockExportAnnualReport = vi.fn();
const mockGetIncompleteRecords = vi.fn();
const mockGetComplianceForecast = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceOfficerService: {
    getAnnualReport: (...args: unknown[]) => mockGetAnnualReport(...args) as unknown,
    getISOReadiness: (...args: unknown[]) => mockGetISOReadiness(...args) as unknown,
    getRecordCompleteness: (...args: unknown[]) => mockGetRecordCompleteness(...args) as unknown,
    getAttestations: (...args: unknown[]) => mockGetAttestations(...args) as unknown,
    createAttestation: (...args: unknown[]) => mockCreateAttestation(...args) as unknown,
    exportAnnualReport: (...args: unknown[]) => mockExportAnnualReport(...args) as unknown,
    getIncompleteRecords: (...args: unknown[]) => mockGetIncompleteRecords(...args) as unknown,
  },
  reportExportService: {
    getComplianceForecast: (...args: unknown[]) => mockGetComplianceForecast(...args) as unknown,
  },
}));

import ComplianceOfficerDashboard from './ComplianceOfficerDashboard';

const mockAnnualReport = {
  year: 2026,
  generated_at: '2026-03-01T00:00:00Z',
  executive_summary: {
    overall_compliance_pct: 85,
    fully_compliant_members: 18,
    total_members: 20,
    total_training_hours: 1200,
    total_admin_hours: 350,
    total_contributed_hours: 1550,
    iso_class_estimate: 3,
    total_certifications_active: 45,
    total_certifications_expired: 2,
    iso_readiness_pct: 82,
  },
  admin_hours_summary: {
    total_approved_hours: 350,
    total_pending_hours: 25,
    total_entries: 120,
    by_category: [
      { category_id: 'cat-1', category_name: 'Board Meetings', approved_hours: 200, pending_hours: 10, total_entries: 60 },
      { category_id: 'cat-2', category_name: 'Fundraising', approved_hours: 150, pending_hours: 15, total_entries: 60 },
    ],
  },
  recertification_summary: {
    active_pathways: 5,
    tasks_completed: 30,
    tasks_pending: 8,
    tasks_expired: 1,
  },
  instructor_summary: {
    active_instructors: 6,
    active_qualifications: 12,
    expiring_qualifications: 2,
  },
  multi_agency_summary: {
    total_exercises: 4,
    nims_compliant_exercises: 3,
    total_participants: 50,
  },
  effectiveness_summary: {
    total_evaluations: 15,
    avg_reaction_rating: 4.2,
    avg_knowledge_gain: 12,
  },
  record_completeness: {
    total_records: 200,
    completeness_pct: 92,
    nfpa_1401_compliant: true,
    field_details: [
      { field_name: 'date', fill_rate_pct: 100, records_with_value: 200 },
      { field_name: 'instructor', fill_rate_pct: 95, records_with_value: 190 },
    ],
  },
  requirement_analysis: [],
  member_compliance: [],
};

describe('ComplianceOfficerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAnnualReport.mockResolvedValue(mockAnnualReport);
    mockGetISOReadiness.mockResolvedValue({
      year: 2026,
      overall_readiness_pct: 78,
      iso_class_estimate: 4,
      categories: [],
    });
    mockGetRecordCompleteness.mockResolvedValue({
      total_records: 200,
      overall_completeness_pct: 91,
      nfpa_1401_compliant: true,
      period_start: '2025-01-01',
      period_end: '2025-12-31',
      fields: [],
    });
    mockGetAttestations.mockResolvedValue([]);
    mockGetComplianceForecast.mockResolvedValue([]);
  });

  it('renders section tab buttons', () => {
    renderWithRouter(<ComplianceOfficerDashboard />);

    expect(screen.getByText('Annual Report')).toBeInTheDocument();
    expect(screen.getByText('ISO Readiness')).toBeInTheDocument();
    expect(screen.getByText('Record Quality')).toBeInTheDocument();
    expect(screen.getByText('Attestations')).toBeInTheDocument();
    expect(screen.getByText('Forecast')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockGetAnnualReport.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ComplianceOfficerDashboard />);

    // The AnnualReportSection is rendered by default and shows a loading spinner
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders Annual Report section by default', async () => {
    renderWithRouter(<ComplianceOfficerDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Annual Compliance Report/)).toBeInTheDocument();
    });

    expect(mockGetAnnualReport).toHaveBeenCalledWith();
  });

  it('can switch to ISO Readiness section', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceOfficerDashboard />);

    await user.click(screen.getByText('ISO Readiness'));

    await waitFor(() => {
      expect(screen.getByText(/ISO\/FSRS Readiness Assessment/)).toBeInTheDocument();
    });

    expect(mockGetISOReadiness).toHaveBeenCalledWith();
  });

  it('can switch to Record Quality section', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceOfficerDashboard />);

    await user.click(screen.getByText('Record Quality'));

    await waitFor(() => {
      expect(screen.getByText(/Training Record Quality/)).toBeInTheDocument();
    });

    expect(mockGetRecordCompleteness).toHaveBeenCalledWith();
  });

  it('can switch to Attestations section', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceOfficerDashboard />);

    await user.click(screen.getByText('Attestations'));

    await waitFor(() => {
      expect(screen.getByText(/Compliance Attestations/)).toBeInTheDocument();
    });

    expect(mockGetAttestations).toHaveBeenCalledWith();
  });

  it('displays admin hours and total contributed hours in annual report', async () => {
    renderWithRouter(<ComplianceOfficerDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Annual Compliance Report/)).toBeInTheDocument();
    });

    expect(screen.getByText('Admin Hours')).toBeInTheDocument();
    expect(screen.getByText('Total Contributed')).toBeInTheDocument();
  });

  it('shows admin hours by category breakdown', async () => {
    renderWithRouter(<ComplianceOfficerDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Admin Hours by Category')).toBeInTheDocument();
    });

    expect(screen.getByText('Board Meetings')).toBeInTheDocument();
    expect(screen.getByText('Fundraising')).toBeInTheDocument();
  });

  it('can switch to Forecast section', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceOfficerDashboard />);

    await user.click(screen.getByText('Forecast'));

    await waitFor(() => {
      // With empty forecast data, the section shows an empty state message
      expect(screen.getByText('No forecast data available.')).toBeInTheDocument();
    });

    expect(mockGetComplianceForecast).toHaveBeenCalledWith();
  });
});
