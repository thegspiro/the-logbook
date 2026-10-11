import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentFolder } from '../../services/api';

const mockUpdateFolder = vi.fn();
const mockDeleteFolder = vi.fn();
const mockGetFolders = vi.fn();
const mockGetRoleOptions = vi.fn();

vi.mock('../../services/api', () => ({
  documentsService: {
    updateFolder: (...a: unknown[]) => mockUpdateFolder(...a) as unknown,
    deleteFolder: (...a: unknown[]) => mockDeleteFolder(...a) as unknown,
    getFolders: (...a: unknown[]) => mockGetFolders(...a) as unknown,
    getFolderRoleOptions: (...a: unknown[]) => mockGetRoleOptions(...a) as unknown,
  },
}));

import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { FolderManageDialog } from './FolderManageDialog';

const folder = (overrides: Partial<DocumentFolder> = {}): DocumentFolder => ({
  id: 'f-1',
  organization_id: 'org-1',
  name: 'SOPs',
  description: 'Standard operating procedures',
  color: '#3B82F6',
  icon: 'folder',
  document_count: 4,
  visibility: 'organization',
  allowed_roles: null,
  is_system: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

const sibling = folder({ id: 'f-2', name: 'Policies', description: '' });

const onChanged = vi.fn();

const renderDialog = (target: DocumentFolder) =>
  render(
    <ConfirmProvider>
      <FolderManageDialog folder={target} onClose={vi.fn()} onChanged={onChanged} />
    </ConfirmProvider>
  );

describe('FolderManageDialog', () => {
  beforeEach(() => {
    mockUpdateFolder.mockReset();
    mockDeleteFolder.mockReset();
    mockGetFolders.mockReset();
    mockGetRoleOptions.mockReset();
    onChanged.mockReset();
    mockUpdateFolder.mockResolvedValue({});
    mockDeleteFolder.mockResolvedValue(undefined);
    mockGetRoleOptions.mockResolvedValue([
      { slug: 'captain', name: 'Captain' },
      { slug: 'lieutenant', name: 'Lieutenant' },
    ]);
    mockGetFolders.mockImplementation((params: { parent_id?: string }) =>
      Promise.resolve(
        params.parent_id === 'f-1'
          ? { folders: [], total: 2, skip: 0, limit: 1 }
          : { folders: [folder(), sibling], total: 2, skip: 0, limit: 100 }
      )
    );
  });

  it('renames and restricts to specific roles, sending every field it owns', async () => {
    const user = userEvent.setup();
    renderDialog(folder());

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Operating Procedures');
    await user.clear(screen.getByLabelText('Description'));
    await user.click(screen.getByRole('radio', { name: 'Specific roles' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(await screen.findByRole('checkbox', { name: 'Captain' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith('f-1', {
        name: 'Operating Procedures',
        description: null,
        visibility: 'organization',
        allowed_roles: ['captain'],
      })
    );
    expect(onChanged).toHaveBeenCalledWith('saved');
  });

  it('clears the role list when set back to Organization, and offers Leadership', async () => {
    const user = userEvent.setup();
    renderDialog(folder({ allowed_roles: ['captain'] }));

    expect(screen.getByRole('radio', { name: 'Specific roles' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Leadership' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith(
        'f-1',
        expect.objectContaining({ visibility: 'leadership', allowed_roles: null })
      )
    );
  });

  it('moves into another folder, never offering the folder itself', async () => {
    const user = userEvent.setup();
    renderDialog(folder());

    const move = screen.getByRole('region', { name: 'Move' });
    await within(move).findByRole('button', { name: 'Policies' });
    expect(within(move).queryByRole('button', { name: 'SOPs' })).not.toBeInTheDocument();
    expect(within(move).getByRole('button', { name: 'Move here' })).toBeDisabled();

    await user.click(within(move).getByRole('button', { name: 'Policies' }));
    await user.click(within(move).getByRole('button', { name: 'Move here' }));
    expect(screen.getByText(/Will move to “Policies” when you save/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith('f-1', expect.objectContaining({ parent_id: 'f-2' }))
    );
  });

  it('says what a delete removes, and Keep it removes nothing', async () => {
    const user = userEvent.setup();
    renderDialog(folder());

    await user.click(screen.getByRole('button', { name: 'Delete folder…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete “SOPs”?' });
    expect(within(confirm).getByText('4 documents directly in it')).toBeInTheDocument();
    expect(within(confirm).getByText('2 subfolders, with everything inside them')).toBeInTheDocument();

    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(mockDeleteFolder).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete folder…' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Delete “SOPs”?' })).getByRole('button', {
        name: 'Delete folder and contents',
      })
    );
    await waitFor(() => expect(mockDeleteFolder).toHaveBeenCalledWith('f-1'));
    expect(onChanged).toHaveBeenCalledWith('deleted');
  });

  it('offers a system folder no rename, move or delete', async () => {
    const user = userEvent.setup();
    renderDialog(folder({ name: 'Member Files', is_system: true }));

    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByText(/keeps its name and place, and cannot be deleted/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Move' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete folder…' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Leadership' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdateFolder).toHaveBeenCalledTimes(1));
    const payload = mockUpdateFolder.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('parent_id');
    expect(payload).toMatchObject({ visibility: 'leadership' });
  });
});
