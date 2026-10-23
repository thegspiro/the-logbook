import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetStatus = vi.fn();
const mockActivate = vi.fn();
const mockDeactivate = vi.fn();
vi.mock('../../services/userServices', () => ({
  organizationService: {
    getFileStorageStatus: (...args: unknown[]) => mockGetStatus(...args) as unknown,
    activateRemoteStorage: (...args: unknown[]) => mockActivate(...args) as unknown,
    deactivateRemoteStorage: (...args: unknown[]) => mockDeactivate(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import StorageLocationPanel from './StorageLocationPanel';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { FileStorageStatus } from '../../types/user';

const status = (overrides: Partial<FileStorageStatus> = {}): FileStorageStatus => ({
  platform: 's3',
  platform_label: 'Amazon S3',
  platform_short_label: 'S3',
  container_noun: 'bucket',
  container: null,
  platform_connectable: true,
  new_files_go_to: 'local',
  location: {},
  bucket: null,
  endpoint_url: null,
  activated_at: null,
  changed_since_test: false,
  problem: null,
  s3_problem: null,
  private_endpoints_allowed: false,
  ...overrides,
});

const onS3 = status({
  new_files_go_to: 's3',
  container: 'dept-files',
  bucket: 'dept-files',
  activated_at: '2026-10-22T12:00:00+00:00',
});

const notConnectable = {
  platform_label: null,
  platform_short_label: null,
  container_noun: null,
  platform_connectable: false,
};

const renderPanel = (savingStorage = false) =>
  render(
    <ConfirmProvider>
      <StorageLocationPanel savingStorage={savingStorage} />
    </ConfirmProvider>
  );

describe('StorageLocationPanel', () => {
  beforeEach(() => {
    mockGetStatus.mockReset();
    mockGetStatus.mockResolvedValue(status());
    mockActivate.mockReset();
    mockActivate.mockResolvedValue(onS3);
    mockDeactivate.mockReset();
    mockDeactivate.mockResolvedValue(status());
  });

  it('says files stay on the server until the S3 test passes', async () => {
    renderPanel();
    expect(await screen.findByText('New files are stored on this server’s disk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test and switch to S3' })).toBeEnabled();
  });

  it('switches to S3 when the connection test passes', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Test and switch to S3' }));
    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('dept-files')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test and switch to S3' })).not.toBeInTheDocument();
  });

  it('shows why a failed test changed nothing', async () => {
    const user = userEvent.setup();
    mockActivate.mockRejectedValue(new Error('The connection test failed: check the bucket name.'));
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Test and switch to S3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The connection test failed: check the bucket name.');
    expect(screen.getByText('New files are stored on this server’s disk')).toBeInTheDocument();
  });

  it('warns when the settings changed since the last test', async () => {
    mockGetStatus.mockResolvedValue(status({ changed_since_test: true, bucket: 'dept-files' }));
    renderPanel();
    expect(await screen.findByRole('status')).toHaveTextContent('changed after the last successful test');
  });

  it('shows the server’s reason a saved endpoint cannot be used', async () => {
    mockGetStatus.mockResolvedValue(status({ problem: 'The S3 endpoint must use HTTPS.' }));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('The S3 endpoint must use HTTPS.');
  });

  it('goes back to the server only after confirming', async () => {
    const user = userEvent.setup();
    mockGetStatus.mockResolvedValue(onS3);
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Store new files on this server instead' }));
    await user.click(await screen.findByRole('button', { name: 'Keep using S3' }));
    expect(mockDeactivate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Store new files on this server instead' }));
    await user.click(await screen.findByRole('button', { name: 'Store on this server' }));
    await waitFor(() => expect(mockDeactivate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('New files are stored on this server’s disk')).toBeInTheDocument();
  });

  it('says a platform that is not connected keeps files on the server', async () => {
    mockGetStatus.mockResolvedValue(status({ platform: 'googledrive', ...notConnectable }));
    renderPanel();
    expect(await screen.findByText(/This platform is not connected yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test and switch to S3' })).not.toBeInTheDocument();
  });

  it('names the platform the server reports, not a hard-coded one', async () => {
    mockGetStatus.mockResolvedValue(
      status({
        platform: 'example',
        platform_label: 'Example Store',
        platform_short_label: 'Example',
        container_noun: 'vault',
        new_files_go_to: 'example',
        container: 'dept-vault',
      })
    );
    renderPanel();
    expect(await screen.findByText(/New files go to your Example vault/)).toBeInTheDocument();
    expect(screen.getByText('dept-vault')).toBeInTheDocument();
  });

  it('re-reads the status once a save lands', async () => {
    const { rerender } = renderPanel(false);
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(1));
    rerender(
      <ConfirmProvider>
        <StorageLocationPanel savingStorage />
      </ConfirmProvider>
    );
    rerender(
      <ConfirmProvider>
        <StorageLocationPanel savingStorage={false} />
      </ConfirmProvider>
    );
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(2));
  });
});
