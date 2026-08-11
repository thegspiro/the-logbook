import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// INT-3: the hook must read the status-only projection (readable without the
// integrations-admin permission), NOT the admin-gated full list.
const mockGetConnectedStatus = vi.fn();
const mockGetIntegrations = vi.fn();
vi.mock('../services/api', () => ({
  integrationsService: {
    getConnectedIntegrationStatus: (...args: unknown[]) => mockGetConnectedStatus(...args) as unknown,
    getIntegrations: (...args: unknown[]) => mockGetIntegrations(...args) as unknown,
  },
}));

import { useConnectedIntegrations } from './useConnectedIntegrations';

describe('useConnectedIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the status projection, not the admin-gated full list', async () => {
    mockGetConnectedStatus.mockResolvedValue([
      { integration_type: 'zoom', status: 'connected', enabled: true },
      { integration_type: 'twilio', status: 'disconnected', enabled: false },
    ]);

    const { result } = renderHook(() => useConnectedIntegrations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetConnectedStatus).toHaveBeenCalledWith();
    expect(mockGetIntegrations).not.toHaveBeenCalled();
    expect(result.current.isConnected('zoom')).toBe(true);
    expect(result.current.isConnected('twilio')).toBe(false);
  });

  it('treats a failed fetch as nothing connected', async () => {
    mockGetConnectedStatus.mockRejectedValue(new Error('403'));

    const { result } = renderHook(() => useConnectedIntegrations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connected.size).toBe(0);
    expect(result.current.isConnected('zoom')).toBe(false);
  });
});
