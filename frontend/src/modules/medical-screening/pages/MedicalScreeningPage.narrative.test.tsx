/**
 * MS-14: the clinical narrative is shown only to a member who may read it.
 *
 * Owner decision 2026-11-01: `medical_screening.view` covers compliance
 * status; `medical_screening.view_details` (or `.manage`, whose edit form
 * writes it) covers the provider, result summary and notes. The API returns
 * those null otherwise; the screens hide them, and the edit form neither shows
 * nor sends them, so a save cannot overwrite what is stored with the blanks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ScreeningRecord } from '../types';
import { useAuthStore } from '../../../stores/authStore';

const listRequirements = vi.fn();
const listRecords = vi.fn();
const getExpiringScreenings = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listRequirements: (...a: unknown[]) => listRequirements(...a) as unknown,
    listRecords: (...a: unknown[]) => listRecords(...a) as unknown,
    getExpiringScreenings: (...a: unknown[]) => getExpiringScreenings(...a) as unknown,
  },
}));

import { MedicalScreeningPage } from './MedicalScreeningPage';
import { ScreeningRecordForm } from '../components/ScreeningRecordForm';

const record: ScreeningRecord = {
  id: 'rec-1',
  organization_id: 'org-1',
  user_id: 'u-1',
  user_name: 'Devon Ellis',
  requirement_id: 'req-1',
  requirement_name: 'Annual physical',
  screening_type: 'physical_exam',
  status: 'passed',
  completed_date: '2026-10-01',
  provider_name: 'Valley Medical Center',
  result_summary: 'Cleared',
  notes: 'Follow up in spring',
  self_recorded: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const signInWith = (permissions: string[]) => useAuthStore.setState({ user: { id: 'me', permissions } as never });

const renderRecordsTab = () =>
  render(
    <MemoryRouter initialEntries={['/medical-screening?tab=records']}>
      <MedicalScreeningPage />
    </MemoryRouter>
  );

describe('MedicalScreeningPage — clinical narrative', () => {
  beforeEach(() => {
    listRequirements.mockReset();
    listRecords.mockReset();
    getExpiringScreenings.mockReset();
    listRequirements.mockResolvedValue([]);
    listRecords.mockResolvedValue([record]);
    getExpiringScreenings.mockResolvedValue([]);
  });

  it('hides the provider from a status-only reader', async () => {
    signInWith(['medical_screening.view']);
    renderRecordsTab();

    expect(await screen.findByText(/Devon Ellis/)).toBeInTheDocument();
    expect(screen.queryByText(/Valley Medical Center/)).not.toBeInTheDocument();
  });

  it.each(['medical_screening.view_details', 'medical_screening.manage'])(
    'shows it to a holder of %s',
    async (grant) => {
      signInWith(['medical_screening.view', grant]);
      renderRecordsTab();

      expect(await screen.findByText(/Valley Medical Center/)).toBeInTheDocument();
    }
  );

  it('marks a record linked to no requirement', async () => {
    signInWith(['medical_screening.view']);
    listRecords.mockResolvedValue([{ ...record, requirement_id: undefined, requirement_name: undefined }]);
    renderRecordsTab();

    expect(await screen.findByText('Not linked to a requirement')).toBeInTheDocument();
  });
});

describe('ScreeningRecordForm — without the narrative', () => {
  it('neither shows nor sends the narrative fields on edit', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(
      <ScreeningRecordForm record={record} requirements={[]} onSave={onSave} onClose={vi.fn()} showNarrative={false} />
    );

    expect(screen.queryByLabelText('Provider / Facility')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Result Summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('provider_name' in payload).toBe(false);
    expect('result_summary' in payload).toBe(false);
    expect('notes' in payload).toBe(false);
  });

  it('lets an officer link an existing record to a requirement', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(
      <ScreeningRecordForm
        record={{ ...record, requirement_id: undefined }}
        requirements={[
          {
            id: 'req-2',
            organization_id: 'org-1',
            name: 'Fitness-for-duty physical',
            screening_type: 'physical_exam',
            is_active: true,
            grace_period_days: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Linked Requirement (optional)'), 'req-2');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ requirement_id: 'req-2' }));
  });
});
