import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentFolder } from '../../services/api';

const mockGetAdminOnly = vi.fn();
const mockConfirmAdminOnly = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../services/api', () => ({
  documentsService: {
    getAdminOnlyFolders: (...a: unknown[]) => mockGetAdminOnly(...a) as unknown,
    confirmAdminOnlyFolder: (...a: unknown[]) => mockConfirmAdminOnly(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import { AdminOnlyFoldersNotice } from './AdminOnlyFoldersNotice';

const folder = (overrides: Partial<DocumentFolder> = {}): DocumentFolder => ({
  id: 'f-1',
  organization_id: 'org-1',
  name: 'Quartermaster files',
  color: '#3B82F6',
  icon: 'folder',
  document_count: 2,
  visibility: 'organization',
  allowed_roles: ['pos-qm'],
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('AdminOnlyFoldersNotice', () => {
  const onManage = vi.fn();

  beforeEach(() => {
    mockGetAdminOnly.mockReset();
    mockConfirmAdminOnly.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    onManage.mockReset();
    mockGetAdminOnly.mockResolvedValue([folder()]);
    mockConfirmAdminOnly.mockResolvedValue(folder());
  });

  it('shows nothing when no folder is shut', async () => {
    mockGetAdminOnly.mockResolvedValue([]);
    const { container } = render(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={0} />);
    await waitFor(() => expect(mockGetAdminOnly).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when the list cannot be loaded', async () => {
    mockGetAdminOnly.mockRejectedValue(new Error('offline'));
    const { container } = render(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={0} />);
    await waitFor(() => expect(mockGetAdminOnly).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each folder and opens its access settings', async () => {
    const user = userEvent.setup();
    render(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={0} />);

    expect(await screen.findByText('A folder only full administrators can open')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change who can open Quartermaster files' }));
    expect(onManage).toHaveBeenCalledWith(folder());
  });

  it('keeps a folder for administrators and reads the list again', async () => {
    const user = userEvent.setup();
    render(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={0} />);
    await screen.findByText('Quartermaster files');

    mockGetAdminOnly.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Keep Quartermaster files for administrators only' }));

    expect(mockConfirmAdminOnly).toHaveBeenCalledWith('f-1');
    await waitFor(() => expect(screen.queryByText('Quartermaster files')).not.toBeInTheDocument());
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it('says why a confirmation failed and keeps the folder listed', async () => {
    const user = userEvent.setup();
    mockConfirmAdminOnly.mockRejectedValue(new Error('Members besides full administrators can open this folder'));
    render(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={0} />);
    await screen.findByText('Quartermaster files');

    await user.click(screen.getByRole('button', { name: 'Keep Quartermaster files for administrators only' }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Members besides full administrators can open this folder')
    );
    expect(screen.getByText('Quartermaster files')).toBeInTheDocument();
  });

  it('counts several folders and reads again when the page asks', async () => {
    mockGetAdminOnly.mockResolvedValue([folder(), folder({ id: 'f-2', name: 'Command staff' })]);
    const { rerender } = render(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={0} />);
    expect(await screen.findByText('2 folders only full administrators can open')).toBeInTheDocument();

    rerender(<AdminOnlyFoldersNotice onManage={onManage} refreshKey={1} />);
    await waitFor(() => expect(mockGetAdminOnly).toHaveBeenCalledTimes(2));
  });
});
