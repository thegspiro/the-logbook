import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';

const mockGetStatus = vi.fn();
vi.mock('../../services/userServices', () => ({
  organizationService: {
    getFileStorageStatus: (...args: unknown[]) => mockGetStatus(...args) as unknown,
    activateRemoteStorage: vi.fn(),
    deactivateRemoteStorage: vi.fn(),
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import StorageSettingsSection from './StorageSettingsSection';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { FileStorageSettings } from '../../types/user';

const Harness: React.FC<{ initial: FileStorageSettings; onChange?: (s: FileStorageSettings) => void }> = ({
  initial,
  onChange,
}) => {
  const [settings, setSettings] = useState<FileStorageSettings>(initial);
  const [visible, setVisible] = useState(false);
  return (
    <ConfirmProvider>
      <StorageSettingsSection
        storageSettings={settings}
        onStorageSettingsChange={(update) => {
          setSettings((current) => {
            const next = typeof update === 'function' ? update(current) : update;
            onChange?.(next);
            return next;
          });
        }}
        savingStorage={false}
        storageSecretVisible={visible}
        onToggleSecretVisible={() => setVisible((v) => !v)}
        onSave={vi.fn()}
      />
    </ConfirmProvider>
  );
};

describe('StorageSettingsSection — Google Drive', () => {
  beforeEach(() => {
    mockGetStatus.mockReset();
    mockGetStatus.mockResolvedValue({
      platform: 'googledrive',
      platform_label: 'Google Drive',
      platform_short_label: 'Google Drive',
      container_noun: 'shared drive',
      container: null,
      platform_connectable: true,
      available_platforms: ['Amazon S3', 'Google Drive'],
      new_files_go_to: 'local',
      location: {},
      bucket: null,
      endpoint_url: null,
      activated_at: null,
      changed_since_test: false,
      problem: null,
      s3_problem: null,
      private_endpoints_allowed: false,
      allowed_s3_endpoints: [],
    });
  });

  it('asks for a service account key and a Shared Drive, not an OAuth client', async () => {
    render(<Harness initial={{ platform: 'googledrive' }} />);
    expect(screen.getByLabelText('Service account key (JSON)')).toBeInTheDocument();
    expect(screen.getByLabelText('Shared Drive ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder ID (optional)')).toBeInTheDocument();
    expect(screen.queryByText(/OAuth/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Test and switch to Google Drive' })).toBeInTheDocument();
  });

  it('keeps the key hidden until shown, then edits it as text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ platform: 'googledrive' }} onChange={onChange} />);
    expect(screen.getByLabelText('Service account key (JSON)')).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show the key' }));
    const area = screen.getByLabelText('Service account key (JSON)');
    expect(area.tagName).toBe('TEXTAREA');
    await user.type(area, 'x');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ google_drive_service_account_key: 'x' }));

    await user.type(screen.getByLabelText('Shared Drive ID'), 'D');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ google_drive_shared_drive_id: 'D' }));
  });
});

describe('StorageSettingsSection — S3 endpoint', () => {
  const s3Status = (allowed: string[]) => ({
    platform: 's3',
    platform_label: 'Amazon S3',
    platform_short_label: 'S3',
    container_noun: 'bucket',
    container: null,
    platform_connectable: true,
    available_platforms: ['Amazon S3'],
    new_files_go_to: 'local',
    location: {},
    bucket: null,
    endpoint_url: null,
    activated_at: null,
    changed_since_test: false,
    problem: null,
    s3_problem: null,
    private_endpoints_allowed: true,
    allowed_s3_endpoints: allowed,
  });

  beforeEach(() => {
    mockGetStatus.mockReset();
    mockGetStatus.mockResolvedValue(s3Status([]));
  });

  it('offers no free-text endpoint and says the operator sets one when none is allowed', async () => {
    render(<Harness initial={{ platform: 's3' }} />);
    expect(await screen.findByRole('button', { name: 'Test and switch to S3' })).toBeInTheDocument();
    expect(await screen.findByText(/set by whoever runs this installation/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Endpoint')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('https://minio.example.com')).not.toBeInTheDocument();
    expect(screen.getByText('S3_ALLOWED_ENDPOINTS')).toBeInTheDocument();
    // Amazon S3 itself still configures on screen.
    expect(screen.getByPlaceholderText('my-department-files')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('us-east-1')).toBeInTheDocument();
  });

  it('offers Amazon S3 and the operator’s endpoints, and clears with null', async () => {
    mockGetStatus.mockResolvedValue(s3Status(['http://minio:9000', 'https://s3.example.org']));
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ platform: 's3' }} onChange={onChange} />);

    const select = await screen.findByLabelText('Endpoint');
    expect(select).toHaveValue('');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Amazon S3 (the region’s own endpoint)',
      'http://minio:9000',
      'https://s3.example.org',
    ]);

    await user.selectOptions(select, 'http://minio:9000');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ s3_endpoint_url: 'http://minio:9000' }));

    await user.selectOptions(select, '');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ s3_endpoint_url: null }));
  });

  it('selects the listed endpoint a saved value names, trailing slash or not', async () => {
    mockGetStatus.mockResolvedValue(s3Status(['http://minio:9000']));
    render(<Harness initial={{ platform: 's3', s3_endpoint_url: 'http://MinIO:9000/' }} />);
    await waitFor(() => expect(screen.getByLabelText('Endpoint')).toHaveValue('http://minio:9000'));
    expect(screen.queryByText(/saved, not offered/)).not.toBeInTheDocument();
  });

  it('shows a saved endpoint the installation does not offer without letting it be picked again', async () => {
    render(<Harness initial={{ platform: 's3', s3_endpoint_url: 'https://old.example.org' }} />);
    const select = await screen.findByLabelText('Endpoint');
    expect(select).toHaveValue('https://old.example.org');
    const saved = await screen.findByRole('option', {
      name: 'https://old.example.org (saved, not offered by this installation)',
    });
    expect(saved).toBeDisabled();
  });
});
