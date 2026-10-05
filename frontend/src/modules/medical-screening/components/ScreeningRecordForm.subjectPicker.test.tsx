/**
 * MS-13: the Add Record dialog files a record against exactly one member or
 * one prospect.
 *
 * Before this the dialog had no control for either id, so every record it
 * created belonged to nobody and counted toward no one's compliance. The
 * owner's decision was a picker with exactly one of the two — the API now
 * rejects neither and both — so these tests pin that the payload carries the
 * chosen subject and only that one, and that the dialog cannot submit until a
 * subject is chosen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScreeningRecord, ScreeningSubjects } from '../types';

const listSubjects = vi.fn<() => Promise<ScreeningSubjects>>();
vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listSubjects: () => listSubjects(),
  },
}));

import { ScreeningRecordForm } from './ScreeningRecordForm';

const subjects: ScreeningSubjects = {
  members: [
    { id: 'u-1', name: 'Jake Thompson' },
    { id: 'u-2', name: 'Maria Lopez' },
  ],
  prospects: [{ id: 'p-1', name: 'Alex Rivera' }],
};

const baseRecord: ScreeningRecord = {
  id: 'rec-1',
  organization_id: 'org-1',
  user_id: 'u-1',
  screening_type: 'physical_exam',
  status: 'passed',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
};

const subjectSelect = () => screen.getByRole('combobox', { name: /member|prospect/i });

describe('ScreeningRecordForm — subject picker (MS-13)', () => {
  beforeEach(() => {
    listSubjects.mockReset();
    listSubjects.mockResolvedValue(structuredClone(subjects));
  });

  it('files the record against the chosen member only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await screen.findByRole('option', { name: 'Maria Lopez' }, { timeout: 5000 });
    await user.selectOptions(subjectSelect(), 'u-2');
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.user_id).toBe('u-2');
    expect(payload.prospect_id).toBeUndefined();
  });

  it('files the record against the chosen prospect only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.click(screen.getByRole('radio', { name: 'Prospect' }));
    // Switching lists offers only prospects and drops the member choice.
    expect(within(subjectSelect()).queryByRole('option', { name: 'Jake Thompson' })).not.toBeInTheDocument();
    await user.selectOptions(subjectSelect(), 'p-1');
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.prospect_id).toBe('p-1');
    expect(payload.user_id).toBeUndefined();
  });

  it('switching kind clears a choice made in the other list', async () => {
    const user = userEvent.setup();
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);

    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.selectOptions(subjectSelect(), 'u-1');
    await user.click(screen.getByRole('radio', { name: 'Prospect' }));

    expect(subjectSelect()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add Record' })).toBeDisabled();
  });

  it('cannot be submitted before a subject is chosen', async () => {
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Add Record' })).toBeDisabled();
  });

  it('says so when the list cannot be loaded', async () => {
    listSubjects.mockReset();
    listSubjects.mockRejectedValue(new Error('Network down'));
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: 'Add Record' })).toBeDisabled();
  });

  it('no longer carries the "not linked" notice', async () => {
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    expect(screen.queryByText(/not linked to a member or prospect/i)).not.toBeInTheDocument();
  });

  it('the edit dialog shows no picker and loads no list', () => {
    render(<ScreeningRecordForm record={baseRecord} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: 'Member' })).not.toBeInTheDocument();
    expect(listSubjects).not.toHaveBeenCalled();
  });
});
