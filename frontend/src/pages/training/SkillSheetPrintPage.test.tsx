import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

const mockGetTemplate = vi.fn();

vi.mock('../../services/trainingServices', () => ({
  skillsTestingService: {
    getTemplate: (...args: unknown[]) => mockGetTemplate(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Import after the mocks are in place.
import SkillSheetPrintPage from './SkillSheetPrintPage';

const template = {
  id: 'tpl-1',
  organization_id: 'org-1',
  name: 'SCBA Donning — Timed Evolution',
  description: 'Seated donning against a 60-second clock.',
  category: 'Fire Suppression',
  version: 3,
  status: 'published',
  visibility: 'all_members',
  require_all_critical: true,
  passing_percentage: 70,
  time_limit_seconds: 300,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  sections: [
    {
      name: 'Preparation',
      description: 'Before the clock starts.',
      criteria: [
        {
          label: 'Pre-evolution brief',
          type: 'statement',
          statement_text: 'You have 60 seconds.',
          required: false,
        },
        { label: 'Inspects cylinder pressure', type: 'pass_fail', required: true },
      ],
    },
    {
      name: 'Donning',
      criteria: [
        { label: 'Start of evolution', type: 'statement', statement_text: 'Say go.', starts_timer: true },
        { label: 'Seal quality', type: 'score', required: false, max_score: 5, passing_score: 3 },
        { label: 'Completes in time', type: 'time_limit', required: true, time_limit_seconds: 60 },
        {
          label: 'PPE check',
          type: 'checklist',
          required: true,
          checklist_items: ['Helmet secured', 'Hood deployed'],
        },
      ],
    },
  ],
};

function renderAt(query: string) {
  window.history.pushState({}, '', `/training/skills-testing/print/template${query}`);
  return renderWithRouter(<SkillSheetPrintPage />);
}

describe('SkillSheetPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockResolvedValue(template);
  });

  it('renders the sheet header and template identity', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText('Skill Evaluation Sheet')).toBeInTheDocument();
    expect(screen.getByText('SCBA Donning — Timed Evolution')).toBeInTheDocument();
    expect(screen.getByText('Fire Suppression')).toBeInTheDocument();
    // The version is on the sheet so a mark made on paper can be matched to
    // the template revision it was made against.
    expect(screen.getByText('Template version: 3')).toBeInTheDocument();
    expect(mockGetTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('states the scoring rules before the first section', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText('Scoring rules')).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
    expect(screen.getByText(/6 steps across 2 sections/)).toBeInTheDocument();
    // Statements are excluded from the critical count: they mark themselves and
    // cannot fail anyone.
    expect(screen.getByText(/3 marked critical/)).toBeInTheDocument();
    expect(screen.getByText(/Overall time limit/)).toBeInTheDocument();
  });

  it('warns that an unmarked critical step counts as a fail', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText(/Leaving one unmarked counts the same as a fail/)).toBeInTheDocument();
  });

  it('numbers sections and criteria the way the examiner screen does', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText('Section 1 of 2 — Preparation')).toBeInTheDocument();
    expect(screen.getByText('Section 2 of 2 — Donning')).toBeInTheDocument();
  });

  it('marks critical steps unmissably, and only those', async () => {
    renderAt('?id=tpl-1');
    await screen.findByText('Inspects cylinder pressure');

    // Scoped per row: the scoring-rules banner also spells out "★ CRITICAL"
    // when explaining the rule, so a page-wide count would include it.
    const rowFor = (label: string) =>
      screen.getAllByRole('row').find((row) => within(row).queryByText(label) !== null) as HTMLElement;

    for (const label of ['Inspects cylinder pressure', 'Completes in time', 'PPE check']) {
      expect(within(rowFor(label)).getByText('★ CRITICAL')).toBeInTheDocument();
    }
    expect(within(rowFor('Seal quality')).queryByText('★ CRITICAL')).not.toBeInTheDocument();
  });

  it('prints the statement text, and flags the one that starts the clock', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText(/You have 60 seconds\./)).toBeInTheDocument();
    expect(screen.getByText('— START THE CLOCK')).toBeInTheDocument();
  });

  it('gives each criterion type its own marking affordance', async () => {
    renderAt('?id=tpl-1');

    await screen.findByText('Seal quality');
    // score: out of max, with the passing floor spelled out
    expect(screen.getByText('/ 5')).toBeInTheDocument();
    expect(screen.getByText('(min 3)')).toBeInTheDocument();
    // time_limit: a blank for the stopwatch reading and the ceiling
    expect(screen.getByText('sec')).toBeInTheDocument();
    expect(screen.getByText('(max 60s)')).toBeInTheDocument();
    // checklist: one box per item, listed on the sheet
    expect(screen.getByText('Helmet secured')).toBeInTheDocument();
    expect(screen.getByText('Hood deployed')).toBeInTheDocument();
    // statement: read aloud, deliberately no P/F box to mark
    expect(screen.getAllByText('read aloud')).toHaveLength(2);
  });

  it('provides somewhere to write who the sheet is for', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText('Candidate:')).toBeInTheDocument();
    expect(screen.getByText('Examiner:')).toBeInTheDocument();
    expect(screen.getByText('Date:')).toBeInTheDocument();
    expect(screen.getByText('Official evaluation')).toBeInTheDocument();
    expect(screen.getByText('Practice run')).toBeInTheDocument();
    expect(screen.getByText('Examiner signature:')).toBeInTheDocument();
    expect(screen.getByText('Candidate signature:')).toBeInTheDocument();
  });

  it('says the paper sheet is not the record', async () => {
    renderAt('?id=tpl-1');

    expect(await screen.findByText('This sheet is not the record.')).toBeInTheDocument();
    expect(screen.getByText(/credits no requirement, consumes no attempt/)).toBeInTheDocument();
  });

  // Real timers rather than fake ones: the print is scheduled from an effect
  // that only runs once the fetch promise has settled and `loading` has
  // flipped, and driving that with advanceTimers races the microtask queue.
  it('opens the print dialog once the sheet has rendered', async () => {
    renderAt('?id=tpl-1');
    await screen.findByText('Skill Evaluation Sheet');

    // window.print() genuinely takes no arguments, so the zero-arg assertion
    // is the intent here rather than an oversight — same as MemberIdCardPage.
    await waitFor(() => expect(window.print).toHaveBeenCalledWith(), { timeout: 2000 });
  });

  it('reports a missing id instead of fetching nothing', async () => {
    renderAt('');

    expect(await screen.findByText('No template ID provided')).toBeInTheDocument();
    expect(mockGetTemplate).not.toHaveBeenCalled();
  });

  it('reports a failed load rather than printing a blank page', async () => {
    mockGetTemplate.mockRejectedValue(new Error('boom'));
    renderAt('?id=tpl-1');

    expect(await screen.findByText('Failed to load skill sheet')).toBeInTheDocument();
    await waitFor(() => expect(window.print).not.toHaveBeenCalled());
  });

  it('falls back to a markable control for a stored type it cannot render', async () => {
    // Templates seeded before the API closed the criterion-type whitelist
    // stored "checkbox". On paper an unrenderable type must still get a P/F
    // box, or the step prints with no way to mark it.
    mockGetTemplate.mockResolvedValue({
      ...template,
      sections: [{ name: 'Legacy', criteria: [{ label: 'Dons the pack', type: 'checkbox', required: true }] }],
    });
    renderAt('?id=tpl-1');

    await screen.findByText('Dons the pack');
    expect(screen.queryByText('read aloud')).not.toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
  });
});
