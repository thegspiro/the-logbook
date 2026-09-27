import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { AuditScheduleField } from './AuditScheduleField';

const { service } = vi.hoisted(() => ({
  service: { getAuditSchedule: vi.fn(), setAuditSchedule: vi.fn() },
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const row = (overrides: Record<string, unknown> = {}) => ({
  storage_area_id: 'area-1',
  storage_area_name: 'Shelf A',
  location_name: null,
  audit_frequency: 'monthly',
  last_audited_at: '2026-09-01T12:00:00Z',
  next_due_at: '2026-10-01T12:00:00Z',
  overdue: false,
  days_overdue: null,
  ...overrides,
});

describe('AuditScheduleField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getAuditSchedule.mockReset();
    service.getAuditSchedule.mockResolvedValue({ items: [row({ storage_area_id: 'other' })], total: 1 });
    service.setAuditSchedule.mockReset();
    service.setAuditSchedule.mockResolvedValue(row({ audit_frequency: 'weekly' }));
  });

  it('reads an area missing from the schedule as not scheduled', async () => {
    renderWithRouter(<AuditScheduleField storageAreaId="area-1" />);
    expect(await screen.findByLabelText('Shelf audit schedule')).toHaveValue('');
  });

  it('shows the current schedule and when it is next due', async () => {
    service.getAuditSchedule.mockResolvedValue({ items: [row()], total: 1 });
    renderWithRouter(<AuditScheduleField storageAreaId="area-1" />);
    expect(await screen.findByLabelText('Shelf audit schedule')).toHaveValue('monthly');
    expect(screen.getByText(/next due/)).toBeInTheDocument();
  });

  it('says a never-audited area is due now', async () => {
    service.getAuditSchedule.mockResolvedValue({
      items: [row({ last_audited_at: null, next_due_at: null, overdue: true })],
      total: 1,
    });
    renderWithRouter(<AuditScheduleField storageAreaId="area-1" />);
    expect(await screen.findByText('Never audited: due now.')).toBeInTheDocument();
  });

  it('saves a change immediately', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditScheduleField storageAreaId="area-1" />);
    await user.selectOptions(await screen.findByLabelText('Shelf audit schedule'), 'weekly');
    await waitFor(() => expect(service.setAuditSchedule).toHaveBeenCalledWith('area-1', 'weekly'));
  });

  it('sends null to take the area off the schedule', async () => {
    const user = userEvent.setup();
    service.getAuditSchedule.mockResolvedValue({ items: [row()], total: 1 });
    service.setAuditSchedule.mockResolvedValue(row({ audit_frequency: null }));
    renderWithRouter(<AuditScheduleField storageAreaId="area-1" />);
    await user.selectOptions(await screen.findByLabelText('Shelf audit schedule'), '');
    await waitFor(() => expect(service.setAuditSchedule).toHaveBeenCalledWith('area-1', null));
    expect(screen.getByLabelText('Shelf audit schedule')).toHaveValue('');
  });
});
