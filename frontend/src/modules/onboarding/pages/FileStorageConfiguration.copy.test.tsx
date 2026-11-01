/**
 * Workflow review W01, 2026-10-31: the storage step told a fresh install that
 * "The Logbook uses these to store documents, photos, and attachments in your
 * OneDrive / SharePoint account", and offered Local Storage a "Storage Path".
 * Nothing reads either (docs/KNOWN_LIMITATIONS.md, "File Storage — The
 * Onboarding Platform Choice Has No Reader"): every file stays in the server's
 * upload folder. An IT manager who believes otherwise leaves that folder out of
 * the backups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

import FileStorageConfiguration from './FileStorageConfiguration';
import FileStorageChoice from './FileStorageChoice';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderWith = (ui: React.ReactElement) =>
  render(
    <ThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>
  );

describe('file storage copy', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ departmentName: 'Test FD' });
  });

  it('says OneDrive is not connected and files stay on the server', () => {
    useOnboardingStore.setState({ fileStoragePlatform: 'onedrive' });
    renderWith(<FileStorageConfiguration />);

    expect(screen.getByRole('note')).toHaveTextContent(/not connected yet/i);
    expect(screen.getByRole('note')).toHaveTextContent(/upload folder/i);
    expect(screen.queryByText(/uses these to store documents/i)).not.toBeInTheDocument();
  });

  it('says the local path is not used, and drops the secrets note where there are none', () => {
    useOnboardingStore.setState({ fileStoragePlatform: 'local' });
    renderWith(<FileStorageConfiguration />);

    expect(screen.getByLabelText(/Storage Path \(not used yet\)/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/recorded but not used yet/i);
    expect(screen.queryByText(/Secrets are encrypted/)).not.toBeInTheDocument();
  });

  it('keeps the secrets note where there is a secret', () => {
    useOnboardingStore.setState({ fileStoragePlatform: 's3' });
    renderWith(<FileStorageConfiguration />);

    expect(screen.getByText(/Secrets are encrypted/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('marks the OneDrive card as not connected before it is chosen', () => {
    useOnboardingStore.setState({ fileStoragePlatform: null, emailPlatform: 'selfhosted' });
    renderWith(<FileStorageChoice />);

    expect(screen.getByText('Microsoft cloud storage — not connected yet')).toBeInTheDocument();
    expect(screen.queryByText(/5 GB free storage/)).not.toBeInTheDocument();
  });
});
