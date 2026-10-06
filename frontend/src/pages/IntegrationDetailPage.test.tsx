/**
 * Integration health monitoring: the detail page shows last sync / last
 * success / last error / failure streak and the run history, and Retry Sync
 * re-runs the integration and reloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderWithRouter } from '../test/utils';
import type { IntegrationDetail } from '../services/integrationHealthService';

const mockGetIntegration = vi.fn();
const mockGetSyncHistory = vi.fn();
const mockRetrySync = vi.fn();

vi.mock('../services/integrationHealthService', () => ({
  integrationHealthService: {
    getIntegration: (...args: unknown[]) => mockGetIntegration(...args) as unknown,
    getSyncHistory: (...args: unknown[]) => mockGetSyncHistory(...args) as unknown,
    retrySync: (...args: unknown[]) => mockRetrySync(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: mockToast }));

import IntegrationDetailPage from './IntegrationDetailPage';

const integration = (overrides: Partial<IntegrationDetail> = {}): IntegrationDetail => ({
  id: 'int-1',
  organization_id: 'org-1',
  integration_type: 'salesforce',
  name: 'Salesforce',
  category: 'Data',
  status: 'connected',
  config: {},
  enabled: true,
  contains_phi: false,
  last_sync_at: '2026-10-05T10:00:00Z',
  last_success_at: '2026-10-05T10:00:00Z',
  last_error: 'Salesforce rejected these credentials',
  last_error_at: '2026-10-05T11:00:00Z',
  consecutive_error_count: 3,
  health: 'failing',
  supports_sync: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-10-05T11:00:00Z',
  ...overrides,
});

const renderPage = () => {
  window.history.pushState({}, '', '/integrations/int-1');
  return renderWithRouter(
    <Routes>
      <Route path="/integrations/:integrationId" element={<IntegrationDetailPage />} />
    </Routes>
  );
};

describe('IntegrationDetailPage', () => {
  beforeEach(() => {
    mockGetIntegration.mockReset();
    mockGetSyncHistory.mockReset();
    mockRetrySync.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockGetIntegration.mockResolvedValue(integration());
    mockGetSyncHistory.mockResolvedValue({
      runs: [
        {
          id: 'run-1',
          operation: 'salesforce_sync',
          trigger: 'scheduled',
          status: 'failure',
          started_at: '2026-10-05T11:00:00Z',
          finished_at: '2026-10-05T11:00:02Z',
          duration_ms: 2000,
          summary: {},
          error_message: 'Salesforce rejected these credentials',
          triggered_by: null,
        },
        {
          id: 'run-0',
          operation: 'salesforce_sync',
          trigger: 'manual',
          status: 'success',
          started_at: '2026-10-05T10:00:00Z',
          finished_at: '2026-10-05T10:00:05Z',
          duration_ms: 5000,
          summary: { push_members_created: 4 },
          error_message: null,
          triggered_by: 'u1',
        },
      ],
    });
    mockRetrySync.mockResolvedValue({
      success: true,
      message: 'Salesforce sync completed',
      integration: integration(),
    });
  });

  it('shows health, the last error and the run history', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /Salesforce/ })).toBeInTheDocument();
    expect(screen.getByText('Failing')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('Salesforce rejected these credentials')).toHaveLength(2);
    expect(screen.getByText('push members created: 4')).toBeInTheDocument();
    expect(mockGetIntegration).toHaveBeenCalledWith('int-1');
    expect(mockGetSyncHistory).toHaveBeenCalledWith('int-1');
  });

  it('retries the sync and reloads', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retry sync' }));
    expect(mockRetrySync).toHaveBeenCalledWith('int-1');
    await waitFor(() => expect(mockGetIntegration).toHaveBeenCalledTimes(2));
    expect(mockToast.success).toHaveBeenCalledWith('Salesforce sync completed');
  });

  it('offers a connection check for an integration with nothing to sync', async () => {
    mockGetIntegration.mockResolvedValue(
      integration({ integration_type: 'slack', name: 'Slack', supports_sync: false })
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Retry connection check' })).toBeInTheDocument();
  });

  it('offers no retry for a disconnected integration', async () => {
    mockGetIntegration.mockResolvedValue(integration({ status: 'available', enabled: false }));
    renderPage();
    await screen.findByRole('heading', { name: /Salesforce/ });
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it('reports a failed retry', async () => {
    const user = userEvent.setup();
    mockRetrySync.mockRejectedValue(new Error('Wait a minute before retrying'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retry sync' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Wait a minute before retrying'));
  });

  it('reports a malformed response instead of a blank page', async () => {
    mockGetSyncHistory.mockResolvedValue('<html>portal</html>');
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/unexpected response/);
  });
});
