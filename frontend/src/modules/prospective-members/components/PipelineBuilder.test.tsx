/**
 * Editing an existing stage has to reach the API.
 *
 * Two separate defects made it impossible on 2026-08-25, and neither surfaced
 * as an error the user could act on:
 *
 *  - the dialog is declared inside the "Pipeline Stages" card, and `card`
 *    carries `backdrop-blur-xs` for the dark-mode glass surface. A
 *    `backdrop-filter` makes an element the containing block for
 *    `position: fixed` descendants, so the shell was laid out inside the card
 *    rather than over the page: centred in a 492px box while keeping its
 *    100dvh height cap, which left "Update Stage" ~265px below the fold with
 *    body scroll locked and no way to reach it;
 *  - a stage whose stored config predates its editor (or was seeded with no
 *    config at all) came back from the API without the arrays the form maps
 *    over, so opening it threw before a save was even possible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdateStage = vi.fn();
const mockAddStage = vi.fn();
const mockToastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) as unknown, success: vi.fn() },
}));

vi.mock('../services/api', () => ({
  pipelineService: {
    updateStage: (...args: unknown[]) => mockUpdateStage(...args) as unknown,
    addStage: (...args: unknown[]) => mockAddStage(...args) as unknown,
    reorderStages: vi.fn(),
    deleteStage: vi.fn(),
    validateFormForPipeline: vi.fn(),
  },
}));

vi.mock('@/services/formsServices', () => ({
  formsService: { getForms: vi.fn().mockResolvedValue({ forms: [], total: 0, skip: 0, limit: 200 }) },
}));

vi.mock('@/services/eventServices', () => ({
  eventService: {
    getEvents: vi.fn().mockResolvedValue([]),
    getVisibleEventTypesWithCategories: vi.fn().mockResolvedValue({ custom_event_categories: [] }),
  },
}));

import { PipelineBuilder } from './PipelineBuilder';
import type { Pipeline, PipelineStage } from '../types';

const meetingStage: PipelineStage = {
  id: 'stage-1',
  pipeline_id: 'pipeline-1',
  name: 'Interest Meeting',
  description: 'Come meet us',
  stage_type: 'meeting',
  config: { meeting_type: 'informational', meeting_description: '' },
  sort_order: 0,
  is_required: true,
  inactivity_timeout_days: null,
  notify_prospect_on_completion: false,
  public_visible: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** A checklist stage seeded with no config — `items` is absent, not empty. */
const bareChecklistStage = {
  ...meetingStage,
  id: 'stage-2',
  name: 'Orientation Checklist',
  stage_type: 'checklist',
  config: {},
  sort_order: 1,
} as unknown as PipelineStage;

const buildPipeline = (stages: PipelineStage[]): Pipeline =>
  ({
    id: 'pipeline-1',
    organization_id: 'org-1',
    name: 'Prospective Member Pipeline',
    is_active: true,
    is_template: false,
    is_default: true,
    inactivity_config: { timeout_preset: '6_months' },
    public_status_enabled: false,
    stages,
    applicant_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as unknown as Pipeline;

/** Mirrors the real page: the builder lives inside a `card`. */
const renderInCard = (pipeline: Pipeline) =>
  render(
    <div data-testid="stages-card" className="card bg-theme-input-bg p-4">
      <PipelineBuilder pipeline={pipeline} onPipelineUpdated={vi.fn()} />
    </div>
  );

describe('PipelineBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders the stage dialog outside the card that contains the builder', async () => {
    const user = userEvent.setup();
    renderInCard(buildPipeline([meetingStage]));

    await user.click(screen.getByTitle('Edit stage'));
    await screen.findByText('Edit Stage');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByTestId('stages-card')).queryByRole('dialog')).toBeNull();
  });

  it('saves an edit to an existing stage', async () => {
    const user = userEvent.setup();
    mockUpdateStage.mockResolvedValue({ ...meetingStage, name: 'Renamed' });
    renderInCard(buildPipeline([meetingStage]));

    await user.click(screen.getByTitle('Edit stage'));
    await screen.findByText('Edit Stage');

    const nameInput = screen.getByLabelText(/stage name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Update Stage' }));

    await waitFor(() => {
      expect(mockUpdateStage).toHaveBeenCalledWith(
        'pipeline-1',
        'stage-1',
        expect.objectContaining({ name: 'Renamed', stage_type: 'meeting' })
      );
    });
    expect(mockAddStage).not.toHaveBeenCalled();
  });

  it('opens and saves a stage whose stored config is missing its fields', async () => {
    const user = userEvent.setup();
    mockUpdateStage.mockResolvedValue(bareChecklistStage);
    renderInCard(buildPipeline([bareChecklistStage]));

    await user.click(screen.getByTitle('Edit stage'));
    await screen.findByText('Edit Stage');

    // The form fell back to the checklist default rather than throwing on a
    // missing `items` array, so the one blank row is editable.
    const firstItem = screen.getByLabelText('Checklist item 1');
    await user.type(firstItem, 'Issue turnout gear');
    await user.click(screen.getByRole('button', { name: 'Update Stage' }));

    await waitFor(() => {
      expect(mockUpdateStage).toHaveBeenCalledWith(
        'pipeline-1',
        'stage-2',
        expect.objectContaining({
          stage_type: 'checklist',
          config: expect.objectContaining({
            items: [expect.objectContaining({ label: 'Issue turnout gear' })],
          }) as unknown,
        })
      );
    });
  });

  it('says why a save was rejected instead of appearing to do nothing', async () => {
    const user = userEvent.setup();
    // A form stage stored with no form selected — legacy and seeded stages have
    // this, and the inline message sits far above the action row.
    const formStage = {
      ...meetingStage,
      stage_type: 'form_submission',
      config: { form_id: '', form_name: '' },
    } as unknown as PipelineStage;
    renderInCard(buildPipeline([formStage]));

    await user.click(screen.getByTitle('Edit stage'));
    await screen.findByText('Edit Stage');
    await user.click(screen.getByRole('button', { name: 'Update Stage' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Please select a form');
    });
    expect(mockUpdateStage).not.toHaveBeenCalled();
    // The dialog stays open on the field that needs attention.
    expect(screen.getByText('Edit Stage')).toBeInTheDocument();
  });

  it('sends an explicit null when a stage-level timeout override is cleared', async () => {
    const user = userEvent.setup();
    const withOverride = { ...meetingStage, inactivity_timeout_days: 45 };
    mockUpdateStage.mockResolvedValue(withOverride);
    renderInCard(buildPipeline([withOverride]));

    await user.click(screen.getByTitle('Edit stage'));
    await screen.findByText('Edit Stage');

    const toggle = screen.getByLabelText('Use a custom timeout for this stage');
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Update Stage' }));

    await waitFor(() => {
      expect(mockUpdateStage).toHaveBeenCalledWith(
        'pipeline-1',
        'stage-1',
        expect.objectContaining({ inactivity_timeout_days: null })
      );
    });
  });
});
