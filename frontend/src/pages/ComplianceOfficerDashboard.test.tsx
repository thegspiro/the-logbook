import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockToastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => {
      mockToastError(...args);
    },
  },
}));

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
    training_points_estimate: 6.3,
    training_points_possible: 9.0,
    scope_note: 'Measures training only — not a PPC.',
    total_certifications_active: 45,
    total_certifications_expired: 2,
    iso_readiness_pct: 82,
  },
  admin_hours_summary: {
    total_approved_hours: 350,
    total_pending_hours: 25,
    total_entries: 120,
    by_category: [
      {
        category_id: 'cat-1',
        category_name: 'Board Meetings',
        approved_hours: 200,
        pending_hours: 10,
        total_entries: 60,
      },
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

  it('renders the Configure action', () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

    expect(screen.getByText('Configure')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockGetAnnualReport.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

    // The AnnualReportSection is rendered by default and shows a loading spinner
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders Annual Report section by default when no tab is provided', async () => {
    renderWithRouter(<ComplianceOfficerDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Annual Compliance Report/)).toBeInTheDocument();
    });

    expect(mockGetAnnualReport).toHaveBeenCalledWith(new Date().getFullYear());
  });

  it('renders Annual Report section for an unrecognized tab', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="bogus" />);

    await waitFor(() => {
      expect(screen.getByText(/Annual Compliance Report/)).toBeInTheDocument();
    });
  });

  it('renders the ISO Readiness section when activeTab is iso-readiness', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="iso-readiness" />);

    await waitFor(() => {
      expect(screen.getByText(/ISO\/FSRS Readiness Assessment/)).toBeInTheDocument();
    });

    expect(mockGetISOReadiness).toHaveBeenCalledWith();
  });

  it('renders the Record Quality section when activeTab is record-completeness', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="record-completeness" />);

    await waitFor(() => {
      expect(screen.getByText(/Training Record Quality/)).toBeInTheDocument();
    });

    expect(mockGetRecordCompleteness).toHaveBeenCalledWith();
  });

  it('renders the Attestations section when activeTab is attestations', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="attestations" />);

    await waitFor(() => {
      expect(screen.getByText(/Compliance Attestations/)).toBeInTheDocument();
    });

    expect(mockGetAttestations).toHaveBeenCalledWith();
  });

  describe('attestation form (CS-8)', () => {
    const attestation = {
      attestation_id: 'att-1',
      period_type: 'quarterly',
      period_year: 2026,
      period_quarter: 3,
      compliance_percentage: 81.3,
      compliance_as_of: '2026-09-30',
      notes: '',
      areas_reviewed: [],
      exceptions: [],
      attested_at: '2026-10-05T12:00:00Z',
      attested_by: 'user-1',
      created_at: '2026-10-05T12:00:00Z',
    };

    beforeEach(() => {
      mockCreateAttestation.mockReset();
      mockCreateAttestation.mockResolvedValue(attestation);
    });

    it('asks for no percentage and sends the quarter of a quarterly attestation', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceOfficerDashboard activeTab="attestations" />);

      await user.click(await screen.findByRole('button', { name: 'New Attestation' }));
      expect(screen.queryByLabelText('Compliance %')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Quarter')).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Period Type'), 'quarterly');
      await user.selectOptions(screen.getByLabelText('Quarter'), '3');
      await user.click(screen.getByRole('button', { name: 'Submit Attestation' }));

      expect(mockCreateAttestation).toHaveBeenCalledTimes(1);
      const sent = mockCreateAttestation.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent).toMatchObject({ period_type: 'quarterly', period_quarter: 3 });
      expect(sent).not.toHaveProperty('compliance_percentage');
      expect(await screen.findByText('81.3%')).toBeInTheDocument();
      expect(screen.getByText('as of Sep 30, 2026')).toBeInTheDocument();
    });

    it('sends no quarter for an annual attestation', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceOfficerDashboard activeTab="attestations" />);

      await user.click(await screen.findByRole('button', { name: 'New Attestation' }));
      await user.click(screen.getByRole('button', { name: 'Submit Attestation' }));

      expect(mockCreateAttestation.mock.calls[0]?.[0]).not.toHaveProperty('period_quarter');
    });

    it('shows N/A for an attestation with no graded member', async () => {
      mockGetAttestations.mockResolvedValue([{ ...attestation, compliance_percentage: null }]);
      renderWithRouter(<ComplianceOfficerDashboard activeTab="attestations" />);

      expect(await screen.findByText('N/A')).toBeInTheDocument();
    });
  });

  it('displays admin hours and total contributed hours in annual report', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

    await waitFor(() => {
      expect(screen.getByText(/Annual Compliance Report/)).toBeInTheDocument();
    });

    expect(screen.getByText('Admin Hours')).toBeInTheDocument();
    expect(screen.getByText('Total Contributed')).toBeInTheDocument();
  });

  it('reads a requirement nobody is held to as not applicable, not 0%', async () => {
    mockGetAnnualReport.mockResolvedValue({
      ...mockAnnualReport,
      requirement_analysis: [
        {
          requirement_id: 'r1',
          name: 'Pump Operations',
          type: 'courses',
          members_compliant: 0,
          members_total: 0,
          compliance_pct: 0,
        },
        {
          requirement_id: 'r2',
          name: 'Annual Hazmat Hours',
          type: 'hours',
          members_compliant: 0,
          members_total: 27,
          compliance_pct: 0,
        },
      ],
    });
    renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

    const pump = await screen.findByRole('row', { name: /Pump Operations/ });
    expect(within(pump).getByText('Not applicable')).toBeInTheDocument();
    const hazmat = screen.getByRole('row', { name: /Annual Hazmat Hours/ });
    expect(within(hazmat).getByText('0%')).toBeInTheDocument();
  });

  it('shows admin hours by category breakdown', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

    await waitFor(() => {
      expect(screen.getByText('Admin Hours by Category')).toBeInTheDocument();
    });

    expect(screen.getByText('Board Meetings')).toBeInTheDocument();
    expect(screen.getByText('Fundraising')).toBeInTheDocument();
  });

  it('reports an annual report export failure instead of failing silently', async () => {
    mockExportAnnualReport.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to export annual compliance report');
    });
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('renders the Forecast section when activeTab is forecast', async () => {
    renderWithRouter(<ComplianceOfficerDashboard activeTab="forecast" />);

    await waitFor(() => {
      // With empty forecast data, the section shows an empty state message
      expect(screen.getByText('No forecast data available.')).toBeInTheDocument();
    });

    expect(mockGetComplianceForecast).toHaveBeenCalledWith();
  });
  // Every section reports a figure an officer acts on, so a 200 whose body is
  // not its declared shape (a captive portal's HTML page) must reach the
  // section's own error message — not crash the hub through the ErrorBoundary,
  // and not render as zeros or an empty list.
  describe('a response that is not its declared shape', () => {
    const PORTAL_PAGE = '<html>Sign in to Wi-Fi</html>';

    it.each([
      ['annual-report', 'Failed to load annual compliance report', () => mockGetAnnualReport.mockResolvedValue({})],
      ['iso-readiness', 'Failed to load ISO readiness data', () => mockGetISOReadiness.mockResolvedValue({})],
      [
        'record-completeness',
        'Failed to load record completeness data',
        () => mockGetRecordCompleteness.mockResolvedValue(PORTAL_PAGE),
      ],
      ['attestations', 'Failed to load attestation history', () => mockGetAttestations.mockResolvedValue({})],
      ['forecast', 'Failed to load compliance forecast', () => mockGetComplianceForecast.mockResolvedValue({})],
    ])('shows the %s error message', async (tab, message, malform) => {
      malform();
      renderWithRouter(<ComplianceOfficerDashboard activeTab={tab} />);

      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it('rejects an annual report missing one of the sections it renders', async () => {
      const { recertification_summary: _omitted, ...partial } = mockAnnualReport;
      mockGetAnnualReport.mockResolvedValue(partial);
      renderWithRouter(<ComplianceOfficerDashboard activeTab="annual-report" />);

      expect(await screen.findByText('Failed to load annual compliance report')).toBeInTheDocument();
    });
  });
});
