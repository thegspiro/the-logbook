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

// The module switch, as useEnabledModules reports it. On by default so the
// other tests exercise the request; the module-off tests turn it off.
let mockIntegrationsOn = true;
let mockModulesLoading = false;
vi.mock('./useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isModuleOn: (key: string) => key !== 'integrations' || mockIntegrationsOn,
    isLoading: mockModulesLoading,
  }),
}));

import { useConnectedIntegrations } from './useConnectedIntegrations';

describe('useConnectedIntegrations', () => {
  beforeEach(() => {
    mockGetConnectedStatus.mockReset();
    mockGetIntegrations.mockReset();
    mockIntegrationsOn = true;
    mockModulesLoading = false;
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

  // W07: with the Integrations module off the endpoint answers 403, and both
  // navigation bars asked for it on every page load.
  it('makes no request while disabled, then fetches once enabled', async () => {
    mockGetConnectedStatus.mockResolvedValue([{ integration_type: 'zoom', status: 'connected', enabled: true }]);

    const { result, rerender } = renderHook(({ enabled }) => useConnectedIntegrations({ enabled }), {
      initialProps: { enabled: false },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetConnectedStatus).not.toHaveBeenCalled();
    expect(result.current.isConnected('zoom')).toBe(false);

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.isConnected('zoom')).toBe(true));
    expect(mockGetConnectedStatus).toHaveBeenCalledTimes(1);
  });

  // Workflow review W01, 2026-10-31: twelve callers pass no `enabled`, so a
  // department that left Integrations off at setup got a 403 from
  // /integrations/connected on Members Administration, a member's profile, Add
  // Member and the check-in screens. The hook now asks the module switch itself.
  it('makes no request when the Integrations module is off, whatever the caller passes', async () => {
    mockIntegrationsOn = false;
    mockGetConnectedStatus.mockResolvedValue([{ integration_type: 'zoom', status: 'connected', enabled: true }]);

    const { result } = renderHook(() => useConnectedIntegrations());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetConnectedStatus).not.toHaveBeenCalled();
    expect(result.current.isConnected('zoom')).toBe(false);
  });

  it('waits for the module switch before asking, and stays loading meanwhile', async () => {
    mockModulesLoading = true;
    mockGetConnectedStatus.mockResolvedValue([]);

    const { result, rerender } = renderHook(() => useConnectedIntegrations());

    expect(result.current.loading).toBe(true);
    expect(mockGetConnectedStatus).not.toHaveBeenCalled();

    mockModulesLoading = false;
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetConnectedStatus).toHaveBeenCalledTimes(1);
  });
});
