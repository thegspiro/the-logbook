import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApparatusNfpaSummary } from '../types';

const mockGetSummary = vi.fn();
let granted = new Set<string>();

vi.mock('../services/api', () => ({
  apparatusNfpaService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => granted.has(permission) }),
}));

import { NfpaComplianceTab } from './NfpaComplianceTab';

const summary: ApparatusNfpaSummary = {
  apparatusId: 'app-1',
  asOf: '2026-06-15',
  requiredMaintenance: [
    {
      maintenanceTypeId: 'pump',
      name: 'Annual Pump Test',
      nfpaReference: 'NFPA 1911',
      lastCompletedDate: '2025-05-01',
      lastRecordId: 'rec-1',
      nextDueDate: '2026-05-01',
      status: 'overdue',
    },
    {
      maintenanceTypeId: 'hose',
      name: 'Hose Test',
      nfpaReference: null,
      lastCompletedDate: null,
      lastRecordId: null,
      nextDueDate: null,
      status: 'never_performed',
    },
  ],
  complianceItems: [
    {
      record: {
        id: 'item-1',
        organizationId: 'org-1',
        apparatusId: 'app-1',
        standardCode: 'NFPA 1911',
        sectionReference: '6.1',
        requirementDescription: 'Annual inspection',
        isCompliant: true,
        complianceStatus: 'compliant',
        lastCheckedDate: '2026-01-10',
        lastCheckedBy: null,
        nextDueDate: '2027-01-10',
        notes: null,
        exemptionReason: null,
        createdAt: '2026-01-10T00:00:00Z',
        updatedAt: '2026-01-10T00:00:00Z',
      },
      status: 'compliant',
    },
  ],
  overdueCount: 1,
  dueSoonCount: 0,
  neverPerformedCount: 1,
};

describe('NfpaComplianceTab', () => {
  beforeEach(() => {
    granted = new Set();
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue(summary);
  });

  it('shows each required test with the standing the server graded', async () => {
    render(<NfpaComplianceTab apparatusId="app-1" timezone="UTC" onOpenMaintenance={vi.fn()} />);

    expect(await screen.findByText('Annual Pump Test')).toBeInTheDocument();
    expect(mockGetSummary).toHaveBeenCalledWith('app-1');
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('No record yet')).toBeInTheDocument();
    expect(screen.getByText('1 overdue ·')).toBeInTheDocument();
    expect(screen.getByText('Annual inspection')).toBeInTheDocument();
  });

  it('keeps the edit controls from a member who can only view', async () => {
    render(<NfpaComplianceTab apparatusId="app-1" timezone="UTC" onOpenMaintenance={vi.fn()} />);

    await screen.findByText('Annual Pump Test');
    expect(screen.queryByRole('button', { name: /Add Item/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit NFPA 1911 6.1' })).not.toBeInTheDocument();
  });

  it('offers add, edit and remove to an apparatus editor', async () => {
    granted = new Set(['apparatus.edit']);
    render(<NfpaComplianceTab apparatusId="app-1" timezone="UTC" onOpenMaintenance={vi.fn()} />);

    await screen.findByText('Annual Pump Test');
    expect(screen.getByRole('button', { name: /Add Item/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit NFPA 1911 6.1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove NFPA 1911 6.1' })).toBeInTheDocument();
  });

  it('says so when the summary cannot be loaded', async () => {
    mockGetSummary.mockReset();
    mockGetSummary.mockRejectedValue(new Error('NFPA apparatus compliance is not turned on'));
    render(<NfpaComplianceTab apparatusId="app-1" timezone="UTC" onOpenMaintenance={vi.fn()} />);

    expect(await screen.findByText('NFPA apparatus compliance is not turned on')).toBeInTheDocument();
  });
});
