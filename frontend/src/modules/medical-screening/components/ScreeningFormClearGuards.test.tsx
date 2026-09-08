/**
 * Guard: clearing a field on the EDIT path must send an explicit `null`,
 * never omit the key.
 *
 * The backend dumps update payloads with `exclude_unset` (`apply_updates`,
 * see medical_screening_service.py), so an omitted key means "leave this
 * alone" — a blanked field that serializes to `undefined` never reaches the
 * server as a change, and the old value (PHI, for the record form's provider
 * name / result summary / notes) survives behind a success toast. This is
 * CLAUDE.md pitfall #1's update-path half; these forms build one payload
 * shape for both create and edit, which is exactly the shape that bug hides
 * in.
 *
 * The CREATE path keeps the opposite rule: a blank field is omitted
 * (`undefined`), never sent as `""`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreeningRecordForm } from './ScreeningRecordForm';
import { ScreeningRequirementForm } from './ScreeningRequirementForm';
import type { ScreeningRecord, ScreeningRequirement } from '../types';

const baseRecord: ScreeningRecord = {
  id: 'rec-1',
  organization_id: 'org-1',
  screening_type: 'physical_exam',
  status: 'passed',
  provider_name: 'Valley Medical Center',
  result_summary: 'Cleared for duty',
  notes: 'Follow-up in 6 months',
  scheduled_date: '2026-01-01',
  completed_date: '2026-01-05',
  expiration_date: '2027-01-05',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
};

const baseRequirement: ScreeningRequirement = {
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Annual Physical',
  screening_type: 'physical_exam',
  description: 'Yearly physical exam',
  frequency_months: 12,
  applies_to_roles: ['firefighter'],
  is_active: true,
  grace_period_days: 30,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ScreeningRecordForm — edit clears as null, not omitted', () => {
  it('sends explicit null for blanked PHI fields and dates', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRecordForm record={baseRecord} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Provider / Facility'));
    await user.clear(screen.getByLabelText('Result Summary'));
    await user.clear(screen.getByLabelText('Notes'));
    await user.clear(screen.getByLabelText('Expiration Date'));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.provider_name).toBeNull();
    expect(payload.result_summary).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.expiration_date).toBeNull();
    // Never the value the old `|| undefined` bug produced — that key would
    // simply be missing from the object entirely.
    expect(payload).not.toHaveProperty('provider_name', undefined);
    expect('provider_name' in payload).toBe(true);
  });

  it('keeps an untouched value unchanged and does not null it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRecordForm record={baseRecord} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Update' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.provider_name).toBe('Valley Medical Center');
  });

  it('create path still omits (undefined) a blank optional field, never null', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.provider_name).toBeUndefined();
    expect(payload.result_summary).toBeUndefined();
  });
});

describe('ScreeningRequirementForm — edit clears as null, not omitted', () => {
  it('sends explicit null for a cleared description and role list', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={baseRequirement} onSave={onSave} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Description'));
    await user.clear(screen.getByLabelText('Applies to Roles (comma-separated)'));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.description).toBeNull();
    expect(payload.applies_to_roles).toBeNull();
  });

  it('clears frequency_months when switching an existing requirement to one-time', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={baseRequirement} onSave={onSave} onClose={vi.fn()} />);

    await user.click(screen.getByLabelText('One-time requirement (not recurring)'));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.frequency_months).toBeNull();
  });

  it('create path still omits an unset description, never null', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Name *'), 'Vision Exam');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.description).toBeUndefined();
  });
});
