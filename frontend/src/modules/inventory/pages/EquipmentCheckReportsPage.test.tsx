/**
 * The apparatus page's Deficiency badge links here with ?tab=failures and
 * ?from=<the day the deficiency began>, so a chief lands on the failure that
 * set it rather than on the compliance tab's last 30 days.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockGetFailureLog = vi.fn();
const mockGetCompliance = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getFailureLog: (...args: unknown[]) => mockGetFailureLog(...args) as unknown,
    getEquipmentComplianceReport: (...args: unknown[]) => mockGetCompliance(...args) as unknown,
    getEquipmentCheckTemplates: vi.fn().mockResolvedValue([]),
    getItemTrends: vi.fn().mockResolvedValue({ items: [] }),
    getReportExportUrl: vi.fn(() => ''),
    getReportPdfExportUrl: vi.fn(() => ''),
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import EquipmentCheckReportsPage from './EquipmentCheckReportsPage';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <EquipmentCheckReportsPage />
    </MemoryRouter>
  );

describe('EquipmentCheckReportsPage deep links', () => {
  beforeEach(() => {
    mockGetFailureLog.mockReset();
    mockGetFailureLog.mockResolvedValue({ items: [], total: 0 });
    mockGetCompliance.mockReset();
    mockGetCompliance.mockResolvedValue({ apparatus: [], members: [], summary: {} });
  });

  it('opens on the tab named in ?tab=', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=failures');
    await waitFor(() => expect(mockGetFailureLog).toHaveBeenCalled());
    expect(mockGetCompliance).not.toHaveBeenCalled();
  });

  it('reaches back to ?from= when it is older than the default window', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=failures&from=2020-01-15');
    await waitFor(() =>
      expect(mockGetFailureLog).toHaveBeenCalledWith(expect.objectContaining({ date_from: '2020-01-15' }))
    );
  });

  it('ignores an unknown tab and a malformed date', async () => {
    renderAt('/inventory/admin/checklists/reports?tab=nope&from=yesterday');
    await waitFor(() => expect(mockGetCompliance).toHaveBeenCalled());
    expect(mockGetFailureLog).not.toHaveBeenCalled();
    expect(screen.queryByText(/yesterday/)).not.toBeInTheDocument();
  });
});
