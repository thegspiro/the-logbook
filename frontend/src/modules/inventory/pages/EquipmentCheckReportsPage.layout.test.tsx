import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetFailureLog = vi.fn();
const mockGetCompliance = vi.fn();
const mockGetTemplates = vi.fn();
const mockGetTrends = vi.fn();
const mockExportUrl = vi.fn();
const mockPdfUrl = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getFailureLog: (...a: unknown[]) => mockGetFailureLog(...a) as unknown,
    getEquipmentComplianceReport: (...a: unknown[]) => mockGetCompliance(...a) as unknown,
    getEquipmentCheckTemplates: (...a: unknown[]) => mockGetTemplates(...a) as unknown,
    getItemTrends: (...a: unknown[]) => mockGetTrends(...a) as unknown,
    getReportExportUrl: (...a: unknown[]) => mockExportUrl(...a) as unknown,
    getReportPdfExportUrl: (...a: unknown[]) => mockPdfUrl(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import EquipmentCheckReportsPage from './EquipmentCheckReportsPage';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <EquipmentCheckReportsPage />
    </MemoryRouter>
  );

describe('EquipmentCheckReportsPage — phone layout', () => {
  const open = vi.fn();

  beforeEach(() => {
    // Only Date is faked: day headings depend on the clock, and faking timers
    // would stall the promise-driven loads and userEvent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T16:00:00Z'));
    vi.stubGlobal('open', open);
    open.mockReset();
    mockExportUrl.mockReset();
    mockExportUrl.mockReturnValue('/export.csv');
    mockPdfUrl.mockReset();
    mockPdfUrl.mockReturnValue('/export.pdf');
    mockGetCompliance.mockReset();
    mockGetCompliance.mockResolvedValue({
      totalChecks: 104,
      passRate: 88,
      overdueCount: 6,
      avgItemsPerCheck: 23.4,
      apparatus: [],
      members: [{ userId: 'u1', userName: 'Kelly Moreno', checksCompleted: 24, passCount: 20, failCount: 4 }],
    });
    mockGetFailureLog.mockReset();
    mockGetFailureLog.mockResolvedValue({
      total: 3,
      items: [
        {
          id: 'f1',
          checkId: 'c1',
          checkedAt: '2026-10-20T11:10:00Z',
          apparatusName: 'E106',
          compartmentName: 'Cab',
          itemName: 'Portable radio',
          status: 'fail',
          notes: 'Battery would not hold charge',
          checkedByName: 'J. Smith',
        },
        {
          id: 'f2',
          checkId: 'c2',
          checkedAt: '2026-10-19T11:10:00Z',
          apparatusName: 'A106E',
          compartmentName: 'Jump bag',
          itemName: 'Oxygen cylinder',
          status: 'fail',
          checkedByName: 'K. Moreno',
        },
        {
          id: 'f3',
          checkId: 'c3',
          checkedAt: '2026-10-14T11:10:00Z',
          apparatusName: 'T106',
          compartmentName: '',
          itemName: 'SCBA bottle',
          status: 'fail',
        },
      ],
    });
    mockGetTemplates.mockReset();
    mockGetTemplates.mockResolvedValue([
      {
        id: 't1',
        name: 'Engine Daily',
        compartments: [{ id: 'k', name: 'Cab', items: [{ id: 'i1', name: 'Radio' }] }],
      },
    ]);
    mockGetTrends.mockReset();
    mockGetTrends.mockResolvedValue({
      itemName: 'Radio',
      trends: [{ period: 'Oct 13', passCount: 3, failCount: 1, notCheckedCount: 1, notApplicableCount: 2 }],
      history: [
        {
          checkId: 'h1',
          shiftId: 's',
          status: 'fail',
          checkType: 'pass_fail',
          isExpired: false,
          checkedByName: 'J. Smith',
          checkedAt: '2026-10-19T11:10:00Z',
          notes: 'Antenna cracked',
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('names the date range on a chip that opens the picker in a sheet', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=failures');
    await screen.findByText('Portable radio');

    await userEvent.click(screen.getByRole('button', { name: 'Date range: Sep 20 – Oct 20' }));

    const sheet = screen.getByRole('dialog', { name: 'Date range' });
    expect(within(sheet).getByLabelText('Start date')).toHaveValue('2026-09-20');
    expect(within(sheet).getByLabelText('End date')).toHaveValue('2026-10-20');
  });

  it('exports either format from one menu', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=failures');
    await screen.findByText('Portable radio');

    await userEvent.click(screen.getByText('Export'));
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mockPdfUrl).toHaveBeenCalledWith(expect.objectContaining({ report_type: 'failures' }));
    expect(open).toHaveBeenCalledWith('/export.pdf', '_blank');
  });

  it('lists failures under the day they were found, each on a row of its own', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=failures');
    await screen.findByText('Portable radio');

    const log = screen.getByRole('region', { name: 'Failure log' });
    expect(
      within(log)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(['Today', 'Yesterday', 'Wed, Oct 14']);

    const today = within(log).getByRole('region', { name: 'Today' });
    expect(within(today).getByText('E106')).toBeInTheDocument();
    expect(within(today).getByText('Cab · 7:10 AM · J. Smith')).toBeInTheDocument();
    expect(within(today).getByText(/Battery would not hold charge/)).toBeInTheDocument();
    // An item with no compartment still says where it sits.
    expect(within(log).getByText(/^On the checklist ·/)).toBeInTheDocument();
  });

  it('reads compliance as one summary line and a row per member', async () => {
    renderAt('/inventory/admin/checklists/reports');

    const summary = await screen.findByTestId('compliance-summary');
    expect(summary).toHaveTextContent('88% pass · 104 checks · 6 missed · 23.4 items avg');
    const members = screen.getByRole('region', { name: 'Members' });
    expect(within(members).getByText('Kelly Moreno')).toBeInTheDocument();
    expect(within(members).getByText('83%')).toBeInTheDocument();
    expect(within(members).getByText(/24 checks/)).toBeInTheDocument();
  });

  // Each "not on truck" answer was drawn twice — once as itself and once as
  // "Not applicable" — so the bar's segments summed past the answers given.
  it('draws a not-on-truck answer once, and lists the past results as rows', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=trends');
    await userEvent.selectOptions(await screen.findByLabelText('Template'), 't1');
    await userEvent.selectOptions(screen.getByLabelText('Item'), 'i1');

    expect(await screen.findByText('Trend: Radio')).toBeInTheDocument();
    expect(screen.getAllByTitle(/^Not on truck/)).toHaveLength(1);
    expect(screen.queryByTitle(/^Not applicable/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();

    const past = screen.getByRole('region', { name: 'Past results' });
    expect(within(past).getByText(/Antenna cracked/)).toBeInTheDocument();
    expect(within(past).getByText(/J\. Smith/)).toBeInTheDocument();
  });
});
