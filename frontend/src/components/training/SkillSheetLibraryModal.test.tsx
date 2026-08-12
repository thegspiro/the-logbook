import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetLibrarySheets = vi.fn();
const mockImportLibrarySheet = vi.fn();

vi.mock('../../services/api', () => ({
  skillsTestingService: {
    getLibrarySheets: () => mockGetLibrarySheets() as Promise<unknown>,
    importLibrarySheet: (...a: unknown[]) => mockImportLibrarySheet(...a) as Promise<unknown>,
  },
}));

const mockToastSuccess = vi.fn<(message: string) => void>();
const mockToastError = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (message: string) => mockToastSuccess(message),
    error: (message: string) => mockToastError(message),
  },
}));

import { SkillSheetLibraryModal } from './SkillSheetLibraryModal';

const SHEETS = [
  {
    slug: 'scba-donning-timed',
    name: 'SCBA Donning — Timed Evolution',
    description: 'Seated donning against a 60-second clock.',
    category: 'Fire Suppression',
    tags: ['NFPA 1001'],
    section_count: 2,
    criteria_count: 8,
    critical_count: 5,
    passing_percentage: null,
    time_limit_seconds: 300,
    already_imported: false,
  },
  {
    slug: 'patient-assessment-medical',
    name: 'Patient Assessment / Management — Medical',
    description: 'NREMT-style psychomotor sheet.',
    category: 'Emergency Medical',
    tags: ['NREMT'],
    section_count: 4,
    criteria_count: 18,
    critical_count: 8,
    passing_percentage: 70,
    time_limit_seconds: null,
    already_imported: true,
  },
];

const onImported = vi.fn();
const renderModal = () => render(<SkillSheetLibraryModal isOpen onClose={vi.fn()} onImported={onImported} />);

/** The list item for one sheet. Several values (the category, the counts)
 *  repeat across rows, so assertions are scoped to the row they belong to. */
const rowFor = (name: string): HTMLElement =>
  screen.getAllByRole('listitem').find((row) => within(row).queryByText(name) !== null) as HTMLElement;

describe('SkillSheetLibraryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLibrarySheets.mockResolvedValue(SHEETS);
  });

  it('lists each sheet with the shape an officer chooses on', async () => {
    renderModal();

    expect(await screen.findByText('SCBA Donning — Timed Evolution')).toBeInTheDocument();
    const row = rowFor('SCBA Donning — Timed Evolution');
    expect(within(row).getByText('Fire Suppression')).toBeInTheDocument();
    expect(within(row).getByText('2 sections')).toBeInTheDocument();
    expect(within(row).getByText('8 steps')).toBeInTheDocument();
    expect(within(row).getByText('5 critical')).toBeInTheDocument();
  });

  it('says the copy arrives as a draft to review', async () => {
    renderModal();

    expect(await screen.findByText(/arrives as a draft for you to review/i)).toBeInTheDocument();
  });

  // Otherwise the picker quietly makes a second copy of a sheet the officer
  // imported last month and has since edited.
  it('marks what the department already holds instead of offering it again', async () => {
    renderModal();

    await screen.findByText('Patient Assessment / Management — Medical');
    const held = rowFor('Patient Assessment / Management — Medical');
    expect(within(held).getByText('Already added')).toBeInTheDocument();
    expect(within(held).queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
  });

  it('imports the chosen sheet by its stable slug', async () => {
    const user = userEvent.setup();
    mockImportLibrarySheet.mockResolvedValue({ id: 'tpl-new' });
    renderModal();

    await user.click(await screen.findByRole('button', { name: /^add$/i }));

    expect(mockImportLibrarySheet).toHaveBeenCalledWith('scba-donning-timed');
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('SCBA Donning — Timed Evolution added as a draft')
    );
  });

  it('tells the list to refresh so the new draft appears', async () => {
    const user = userEvent.setup();
    mockImportLibrarySheet.mockResolvedValue({ id: 'tpl-new' });
    renderModal();

    await user.click(await screen.findByRole('button', { name: /^add$/i }));

    // onImported takes no arguments, so the zero-arg assertion is the intent.
    await waitFor(() => expect(onImported).toHaveBeenCalledWith());
    // Reloaded rather than patched, so "already added" reflects what the
    // department now holds even if someone else imported in parallel.
    await waitFor(() => expect(mockGetLibrarySheets).toHaveBeenCalledTimes(2));
  });

  it('reports a failed import and leaves the sheet available to retry', async () => {
    const user = userEvent.setup();
    mockImportLibrarySheet.mockRejectedValue(new Error('Network Error'));
    renderModal();

    await user.click(await screen.findByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Network Error'));
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^add$/i })).toBeEnabled();
  });

  it('surfaces a load failure rather than an empty library', async () => {
    mockGetLibrarySheets.mockRejectedValue(new Error('Network Error'));
    renderModal();

    expect(await screen.findByText('Network Error')).toBeInTheDocument();
  });

  it('says so when there is nothing to offer', async () => {
    mockGetLibrarySheets.mockResolvedValue([]);
    renderModal();

    expect(await screen.findByText(/no starter sheets are available/i)).toBeInTheDocument();
  });
});
