import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DEFAULT_INACTIVITY_CONFIG, type Pipeline } from '../types';

const mockUpdatePipeline = vi.fn();
const mockSetCurrentPipeline = vi.fn();
let mockCurrentPipeline: Pipeline;

vi.mock('../services/api', () => ({
  pipelineService: {
    updatePipeline: (...args: unknown[]) => mockUpdatePipeline(...args) as unknown,
  },
}));

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: () => ({
    pipelines: [],
    currentPipeline: mockCurrentPipeline,
    pipelineStats: null,
    isLoadingPipelines: false,
    isLoadingPipeline: false,
    isLoadingStats: false,
    fetchPipelines: vi.fn(),
    fetchPipeline: vi.fn(),
    fetchPipelineStats: vi.fn(),
    setCurrentPipeline: mockSetCurrentPipeline,
    duplicatePipeline: vi.fn(),
    setDefaultPipeline: vi.fn(),
    saveAsTemplate: vi.fn(),
    fetchTemplates: vi.fn(),
  }),
}));

vi.mock('../components/PipelineBuilder', () => ({ PipelineBuilder: () => null }));
vi.mock('../components/ReportStageGroupsEditor', () => ({ ReportStageGroupsEditor: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PipelineSettingsPage } from './PipelineSettingsPage';

const pipeline = (overrides: Partial<Pipeline> = {}): Pipeline => ({
  id: 'pipe-1',
  organization_id: 'org-1',
  name: 'Recruit',
  is_active: true,
  is_template: false,
  is_default: true,
  inactivity_config: DEFAULT_INACTIVITY_CONFIG,
  public_status_enabled: true,
  public_show_future_stages: true,
  stages: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <PipelineSettingsPage />
    </MemoryRouter>
  );

describe('PipelineSettingsPage show upcoming stages', () => {
  beforeEach(() => {
    mockUpdatePipeline.mockReset();
    mockSetCurrentPipeline.mockReset();
    mockCurrentPipeline = pipeline();
  });

  it('turns off upcoming stages for the pipeline', async () => {
    mockUpdatePipeline.mockResolvedValue(pipeline({ public_show_future_stages: false }));
    renderPage();

    const toggle = screen.getByRole('checkbox', { name: /Show upcoming stages/i });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);

    expect(mockUpdatePipeline).toHaveBeenCalledWith('pipe-1', { public_show_future_stages: false });
    expect(mockSetCurrentPipeline).toHaveBeenCalledWith(expect.objectContaining({ public_show_future_stages: false }));
  });

  it('is disabled while the public status page is off', () => {
    mockCurrentPipeline = pipeline({ public_status_enabled: false });
    renderPage();

    expect(screen.getByRole('checkbox', { name: /Show upcoming stages/i })).toBeDisabled();
  });

  // An Enable Status Page stage opens the page for applicants who reach it
  // even with the switch off, and this setting still shapes what they see.
  const statusStage = (enable: boolean) => ({
    id: 'stage-1',
    pipeline_id: 'pipe-1',
    name: 'Reveal status page',
    stage_type: 'status_page_toggle' as const,
    config: { enable_public_status: enable },
    sort_order: 0,
    is_required: true,
    notify_prospect_on_completion: false,
    public_visible: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });

  it('stays available when a stage enables the page with the switch off', () => {
    mockCurrentPipeline = pipeline({ public_status_enabled: false, stages: [statusStage(true)] });
    renderPage();

    expect(screen.getByRole('checkbox', { name: /Show upcoming stages/i })).toBeEnabled();
  });

  it('stays disabled when the only such stage disables the page', () => {
    mockCurrentPipeline = pipeline({ public_status_enabled: false, stages: [statusStage(false)] });
    renderPage();

    expect(screen.getByRole('checkbox', { name: /Show upcoming stages/i })).toBeDisabled();
  });
});
