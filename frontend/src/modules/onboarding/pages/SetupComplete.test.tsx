/**
 * The send-off screen reports the backend's checklist; it does not restate it.
 *
 * "What's left" was a hardcoded list naming stations and apparatus as
 * outstanding — two steps the wizard collects itself — so a department that
 * had just entered both was told to go and enter them, and the page its own
 * button leads to said otherwise. Nothing failed and nothing looked wrong;
 * the two screens simply disagreed, which is the quiet failure mode Pitfall
 * #29 is about.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const { getSetupChecklist } = vi.hoisted(() => ({ getSetupChecklist: vi.fn() }));
vi.mock('../../../services/api', () => ({
  organizationService: { getSetupChecklist: () => getSetupChecklist() as unknown },
}));

import SetupComplete from './SetupComplete';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  key: 'members',
  title: 'Add Department Members',
  description: 'Import or manually add your roster.',
  path: '/members/admin',
  category: 'essential',
  is_complete: false,
  count: 0,
  required: true,
  kind: 'auto',
  ...over,
});

const respond = (items: ReturnType<typeof item>[]) =>
  getSetupChecklist.mockResolvedValue({
    items,
    completed_count: items.filter((i) => i.is_complete).length,
    total_count: items.length,
    enabled_modules: [],
  });

const renderPage = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <SetupComplete />
      </MemoryRouter>
    </ThemeProvider>
  );

describe('SetupComplete — what is left', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSetupChecklist.mockReset();
    respond([item()]);
    useOnboardingStore.setState({ departmentName: 'Engine Co.' });
  });

  it('lists the essential steps the backend reports as incomplete', async () => {
    respond([item(), item({ key: 'documents', title: 'Upload SOPs & Policies', path: '/documents' })]);

    renderPage();

    expect(await screen.findByText('Add Department Members')).toBeInTheDocument();
    expect(screen.getByText('Upload SOPs & Policies')).toBeInTheDocument();
  });

  it('omits a step the wizard already completed', async () => {
    // The regression: stations and apparatus are collected in the wizard, so
    // the backend reports them complete and this screen must not ask again.
    respond([
      item(),
      item({ key: 'apparatus', title: 'Set Up Apparatus & Vehicles', is_complete: true }),
      item({ key: 'locations', title: 'Set Up Stations & Locations', is_complete: true }),
    ]);

    renderPage();

    expect(await screen.findByText('Add Department Members')).toBeInTheDocument();
    expect(screen.queryByText('Set Up Apparatus & Vehicles')).not.toBeInTheDocument();
    expect(screen.queryByText('Set Up Stations & Locations')).not.toBeInTheDocument();
  });

  it('leaves the per-module steps to Department Setup', async () => {
    respond([item(), item({ key: 'scheduling', title: 'Configure Scheduling', category: 'scheduling' })]);

    renderPage();

    expect(await screen.findByText('Add Department Members')).toBeInTheDocument();
    expect(screen.queryByText('Configure Scheduling')).not.toBeInTheDocument();
  });

  it('says so when nothing essential is outstanding', async () => {
    respond([item({ is_complete: true })]);

    renderPage();

    expect(await screen.findByText(/every essential step is done/i)).toBeInTheDocument();
  });

  it('still sends the operator on when the checklist cannot be loaded', async () => {
    getSetupChecklist.mockRejectedValue(new Error('offline'));

    renderPage();

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to department setup/i })).toBeInTheDocument();
  });

  it('links each outstanding step to where the work is done', async () => {
    renderPage();

    (await screen.findByRole('button', { name: 'Add Department Members' })).click();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/members/admin'));
  });
});
