/**
 * The form offers four dates and a "Mark as completed" box with nothing saying
 * which to use for work already done versus work coming up. The Next Due
 * fields also read like a reminder, but only an open record's Due Date reaches
 * the fleet page's Maintenance Due count.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetMaintenanceTypes = vi.fn();

vi.mock('../services/api', () => ({
  apparatusMaintenanceService: { createMaintenanceRecord: vi.fn(), updateMaintenanceRecord: vi.fn() },
  apparatusMaintenanceTypeService: {
    getMaintenanceTypes: (...args: unknown[]) => mockGetMaintenanceTypes(...args) as unknown,
  },
}));

import { MaintenanceRecordModal } from './MaintenanceRecordModal';

describe('MaintenanceRecordModal guidance', () => {
  beforeEach(() => {
    mockGetMaintenanceTypes.mockReset();
    mockGetMaintenanceTypes.mockResolvedValue([]);
  });

  it('says which fields to use for done and for upcoming work', async () => {
    render(<MaintenanceRecordModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="a-1" />);
    expect(await screen.findByText(/For work already done, tick Mark as completed/)).toBeInTheDocument();
    expect(screen.getByText(/For upcoming work, leave it unticked and set a Due Date/)).toBeInTheDocument();
  });

  it('says the Next Due fields do not add anything to Maintenance Due', async () => {
    render(<MaintenanceRecordModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="a-1" />);
    expect(await screen.findByText(/They do not add the next service to Maintenance Due/)).toBeInTheDocument();
  });
});
