import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockExpiring = vi.fn();
let manager = true;

vi.mock('../services/api', () => ({
  trainingService: {
    getExpiringCertificationsDetailed: (...a: unknown[]) => mockExpiring(...a) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (select: (state: { checkPermission: (p: string) => boolean }) => unknown) =>
    select({ checkPermission: (p: string) => manager && p === 'training.manage' }),
}));

vi.mock('../components/training/CertAlertSettingsPanel', () => ({
  default: () => <div>alert settings panel</div>,
}));

import ExpiringCertsTab from './ExpiringCertsTab';

describe('ExpiringCertsTab alert settings', () => {
  beforeEach(() => {
    mockExpiring.mockReset();
    mockExpiring.mockResolvedValue([]);
    manager = true;
  });

  it('offers the alert settings to someone who manages training', async () => {
    render(<ExpiringCertsTab />);

    expect(await screen.findByText('alert settings panel')).toBeInTheDocument();
  });

  it('does not show them to anyone else', async () => {
    manager = false;
    render(<ExpiringCertsTab />);

    await screen.findByText(/No certifications expiring within/);
    expect(screen.queryByText('alert settings panel')).not.toBeInTheDocument();
  });
});
