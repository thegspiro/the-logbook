import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
