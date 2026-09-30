import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import type { TrainingRecord } from '../types/training';

const getRecords = vi.fn();
const getUserWithRoles = vi.fn();

vi.mock('../services/api', () => ({
  trainingService: { getRecords: (...args: unknown[]) => getRecords(...args) as unknown },
  userService: { getUserWithRoles: (...args: unknown[]) => getUserWithRoles(...args) as unknown },
}));

vi.mock('../services/trainingServices', () => ({
  reportExportService: { exportReport: vi.fn() },
  documentService: {},
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useParams: () => ({ userId: 'u1' }) };
});

import { MemberTrainingHistoryPage } from './MemberTrainingHistoryPage';

const record = (expiration_date: string): TrainingRecord =>
  ({
    id: `r-${expiration_date}`,
    user_id: 'u1',
    course_name: `Cert ${expiration_date}`,
    training_type: 'certification',
    status: 'completed',
    completion_date: '2024-09-30',
    expiration_date,
    hours_completed: 8,
  }) as unknown as TrainingRecord;

describe('MemberTrainingHistoryPage certificate expiry', () => {
  beforeEach(() => {
    // Only Date is faked: the page's async loading still runs on real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    // 20:00 on 2026-09-30 in New York — already 2026-10-01 in UTC.
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    getRecords.mockReset();
    getUserWithRoles.mockReset();
    getUserWithRoles.mockResolvedValue({ id: 'u1', full_name: 'Dana Ruiz', username: 'druiz', roles: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not mark a certificate expired on its last valid day in the department timezone', async () => {
    getRecords.mockResolvedValue([record('2026-09-30')]);

    renderWithRouter(<MemberTrainingHistoryPage />);

    expect(await screen.findByText('Cert 2026-09-30')).toBeInTheDocument();
    expect(screen.queryByText('expired')).not.toBeInTheDocument();
    expect(screen.getByText('expiring soon')).toBeInTheDocument();
  });

  it('marks a certificate expired once the department date has passed it', async () => {
    getRecords.mockResolvedValue([record('2026-09-29')]);

    renderWithRouter(<MemberTrainingHistoryPage />);

    expect(await screen.findByText('Cert 2026-09-29')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
  });
});
