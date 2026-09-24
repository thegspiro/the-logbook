import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInventoryNfcEnabled } from './useInventoryNfcEnabled';

const { getNfcSettings } = vi.hoisted(() => ({ getNfcSettings: vi.fn() }));
vi.mock('../../../services/api', () => ({ inventoryService: { getNfcSettings } }));

describe('useInventoryNfcEnabled', () => {
  beforeEach(() => {
    getNfcSettings.mockReset();
    getNfcSettings.mockResolvedValue({ enabled: true });
  });

  it('reports the server’s answer', async () => {
    const { result } = renderHook(() => useInventoryNfcEnabled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
  });

  it('fails closed when the read fails', async () => {
    getNfcSettings.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useInventoryNfcEnabled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it('makes no request when told not to check', () => {
    const { result } = renderHook(() => useInventoryNfcEnabled(false));
    expect(getNfcSettings).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ enabled: false, loading: false });
  });
});
