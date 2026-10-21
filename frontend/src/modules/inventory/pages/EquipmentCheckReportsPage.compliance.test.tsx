/**
 * The compliance tab shows expected and missed checks (EC-11).
 *
 * Both numbers are the server's: one expected check per shift per applicable
 * checklist, the fleet board's rule. They used to be hardcoded to zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { ComplianceReport } from '../types/equipmentCheck';

const mockGetReport = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getEquipmentComplianceReport: (...a: unknown[]) => mockGetReport(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import EquipmentCheckReportsPage from './EquipmentCheckReportsPage';

const report = (overrides: Partial<ComplianceReport> = {}): ComplianceReport => ({
  totalChecks: 1,
  passRate: 100,
  overdueCount: 2,
  avgItemsPerCheck: 1,
  apparatus: [
    {
      apparatusId: 'e1',
      apparatusName: 'E-1',
      checksCompleted: 1,
      checksExpected: 3,
      checksMissed: 2,
      passCount: 1,
      failCount: 0,
      hasDeficiency: false,
      hasChecklist: true,
    },
  ],
  members: [],
  ...overrides,
});

describe('EquipmentCheckReportsPage compliance tab', () => {
  beforeEach(() => {
    mockGetReport.mockReset();
    mockGetReport.mockResolvedValue(report());
  });

  it('shows each unit against what was expected, and the missed total', async () => {
    renderWithRouter(<EquipmentCheckReportsPage />);

    expect(await screen.findByText('1 of 3 expected')).toBeInTheDocument();
    // The unit's own missed count, and the department total in the summary.
    expect(within(screen.getByRole('region', { name: 'Apparatus' })).getByText(/2 missed/)).toBeInTheDocument();
    expect(within(screen.getByTestId('compliance-summary')).getByText('2 missed')).toBeInTheDocument();
  });

  it('shows a plain count when nothing was expected', async () => {
    mockGetReport.mockResolvedValue(
      report({
        overdueCount: 0,
        apparatus: [
          {
            apparatusId: 'e1',
            apparatusName: 'E-1',
            checksCompleted: 0,
            checksExpected: 0,
            checksMissed: 0,
            passCount: 0,
            failCount: 0,
            hasDeficiency: false,
            hasChecklist: false,
          },
        ],
      })
    );
    renderWithRouter(<EquipmentCheckReportsPage />);

    expect(await screen.findByText('No checklist applies')).toBeInTheDocument();
    expect(screen.queryByText(/expected/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Apparatus' })).queryByText(/missed/)).not.toBeInTheDocument();
  });
});
