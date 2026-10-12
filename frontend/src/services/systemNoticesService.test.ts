import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  },
}));

import { systemNoticesService } from './systemNoticesService';

const notice = {
  key: 'malware_scanning_disabled',
  severity: 'critical',
  title: 'Uploaded files are not being scanned',
  detail: 'CLAMAV_ENABLED is false.',
};

describe('systemNoticesService.list', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('returns the notices the server reports', async () => {
    mockGet.mockResolvedValue({ data: [notice] });

    await expect(systemNoticesService.list()).resolves.toEqual([notice]);
    expect(mockGet).toHaveBeenCalledWith('/system-notices');
  });

  it('treats a body that is not a list as no notices', async () => {
    mockGet.mockResolvedValue({ data: {} });

    await expect(systemNoticesService.list()).resolves.toEqual([]);
  });
});

describe('systemNoticesService key custody', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('reads the key status', async () => {
    mockGet.mockResolvedValue({ data: { key_fingerprint: '0123456789abcdef', confirmed: false } });

    await expect(systemNoticesService.getKeyCustody()).resolves.toEqual({
      key_fingerprint: '0123456789abcdef',
      confirmed: false,
    });
    expect(mockGet).toHaveBeenCalledWith('/system-notices/encryption-key-custody');
  });

  it('sends back the fingerprint that was shown', async () => {
    mockPost.mockResolvedValue({ data: { key_fingerprint: '0123456789abcdef', confirmed: true } });

    await systemNoticesService.confirmKeyCustody('0123456789abcdef');
    expect(mockPost).toHaveBeenCalledWith('/system-notices/encryption-key-custody', {
      key_fingerprint: '0123456789abcdef',
    });
  });
});
