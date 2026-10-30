import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import userEvent from '@testing-library/user-event';

/**
 * TagListEditor is module-local to this panel, so the only way to test the list
 * it actually renders is to render the panel around it. That is the point: the
 * first version of this regression test rendered a local fixture that hard-coded
 * the fixed key, so it could not have failed whatever the panel did.
 *
 * Everything mocked here is mocked because the panel loads it on mount, not
 * because the test cares about it.
 */
const mockGetSettings = vi.fn();
const mockGetConfig = vi.fn();
const mockGetSkillNames = vi.fn();
const mockUpdateConfig = vi.fn();
const mockGetBasicApparatus = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown,
  },
}));

vi.mock('../../../services/trainingServices', () => ({
  trainingModuleConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getSkillNames: (...args: unknown[]) => mockGetSkillNames(...args) as unknown,
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  schedulingService: {
    getBasicApparatus: (...args: unknown[]) => mockGetBasicApparatus(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { ShiftReportsSettingsPanel } from './ShiftReportsSettingsPanel';
import type { ShiftReportSettings } from '../types/shiftSettings';

const matchMedia = (matches: boolean) =>
  vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
});

/**
 * `mockReset`, not `clearAllMocks` — an unconsumed `mockResolvedValueOnce` from
 * a previous test survives `clearAllMocks` and is handed out ahead of the
 * default set here (CLAUDE.md).
 */
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMedia(true) });

  mockGetSettings.mockReset();
  mockGetConfig.mockReset();
  mockGetSkillNames.mockReset();
  mockUpdateConfig.mockReset();
  mockGetBasicApparatus.mockReset();
  mockUpdateSettings.mockReset();
  mockUpdateSettings.mockResolvedValue({});

  mockGetSettings.mockResolvedValue({});
  mockGetSkillNames.mockResolvedValue([]);
  mockGetBasicApparatus.mockResolvedValue([]);
  mockGetConfig.mockResolvedValue({
    shift_reports_enabled: true,
    shift_review_default_skills: ['Alpha', 'Bravo', 'Charlie'],
    shift_review_default_tasks: ['Task'],
    apparatus_type_skills: {},
    apparatus_type_tasks: {},
    rating_scale_labels: {},
  });
});

/** Both navs are in the DOM at once — a `md:hidden` strip and a desktop aside. */
const openFeedbackDefaults = async (user: ReturnType<typeof userEvent.setup>) => {
  const tabs = await screen.findAllByRole('button', { name: /Feedback Defaults/ });
  await user.click(tabs[0] as HTMLElement);
};

describe('ShiftReportsSettingsPanel tag lists', () => {
  it('keeps the open row on the chip it was opened on when an earlier chip goes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);

    await openFeedbackDefaults(user);

    // Open Bravo, then remove Alpha from in front of it.
    await user.click(await screen.findByRole('button', { name: 'Actions for Bravo' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }));

    // Bravo is still the open one, and Charlie — which has taken Bravo's old
    // index — has not inherited its disclosure. With an index key it does.
    expect(screen.getByRole('button', { name: 'Actions for Bravo' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Actions for Charlie' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ShiftReportsSettingsPanel — who files reports', () => {
  const openFiling = async (user: ReturnType<typeof userEvent.setup>) => {
    const tabs = await screen.findAllByRole('button', { name: /Filing & Validation/ });
    await user.click(tabs[0] as HTMLElement);
  };

  it('saves the officer-on-the-rig rule alongside the validation settings', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openFiling(user);

    const toggle = await screen.findByRole('checkbox', { name: /Reports are filed by the officer on the rig/ });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    const [sent] = mockUpdateSettings.mock.calls[0] as [{ shift_reports: ShiftReportSettings }];
    expect(sent.shift_reports.authorship).toBe('shift_officer');
    // Sent alongside, not instead of, the validation block it shares a key with.
    expect(sent.shift_reports.post_shift_validation.enabled).toBe(true);
  });

  it('shows the rule as on when the department saved it', async () => {
    mockGetSettings.mockResolvedValue({ shift_reports: { authorship: 'shift_officer' } });
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openFiling(user);

    expect(await screen.findByRole('checkbox', { name: /Reports are filed by the officer on the rig/ })).toBeChecked();
  });
});

describe('ShiftReportsSettingsPanel — call types', () => {
  it('points to the department call-type list instead of keeping a second one', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openFeedbackDefaults(user);

    expect(await screen.findByRole('link', { name: /General → Call types/ })).toHaveAttribute(
      'href',
      '/scheduling/admin/settings/general'
    );
    expect(screen.queryByText('Call / Incident Types', { selector: 'label, h3, h4, p' })).not.toBeInTheDocument();
  });

  it('no longer saves a report-specific call-type list', async () => {
    mockUpdateConfig.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openFeedbackDefaults(user);

    await user.click(await screen.findByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    const [sent] = mockUpdateConfig.mock.calls[0] as [Record<string, unknown>];
    expect(sent).not.toHaveProperty('shift_review_call_types');
    expect(sent.shift_review_default_skills).toEqual(['Bravo', 'Charlie']);
  });
});

/**
 * CLAUDE.md pitfall #19: a setting with no reader must say so. These two are
 * saved but nothing acts on them — close-out never checks for a report, and
 * approving a report is gated on managing training, not on the chosen role —
 * so the screen labels them rather than promising an effect.
 */
describe('ShiftReportsSettingsPanel — settings that are not in effect yet', () => {
  // Close-out enforces it since 2026-10-29, so the box says what it blocks.
  it('says the required report blocks close-out, and who can override', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    const tabs = await screen.findAllByRole('button', { name: /Filing & Validation/ });
    await user.click(tabs[0] as HTMLElement);

    expect(await screen.findByText(/Require officer shift completion report/)).toBeInTheDocument();
    expect(screen.getByText(/needs a shift completion report for the shift before it can be/)).toBeInTheDocument();
    expect(screen.queryByText(/a shift can still be closed out without a report/)).not.toBeInTheDocument();
  });

  it('says the reviewer role does not limit who can review', async () => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue({
      shift_reports_enabled: true,
      report_review_required: true,
      report_review_role: 'captain',
      shift_review_default_skills: [],
      shift_review_default_tasks: [],
      apparatus_type_skills: {},
      apparatus_type_tasks: {},
      rating_scale_labels: {},
    });
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    const tabs = await screen.findAllByRole('button', { name: /Review Workflow/ });
    await user.click(tabs[0] as HTMLElement);

    expect(await screen.findByText('Reviewer role')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not in effect yet — anyone who can manage training can review reports, whatever is chosen here.'
      )
    ).toBeInTheDocument();
  });
});

describe('ShiftReportsSettingsPanel — skill lists under each practical-skills method', () => {
  const configFor = (method: 'skills_testing' | 'shift_signoffs') => ({
    shift_reports_enabled: true,
    practical_skills_method: method,
    form_show_skills_observed: true,
    shift_review_default_skills: ['Alpha'],
    shift_review_default_tasks: ['Task'],
    apparatus_type_skills: {},
    apparatus_type_tasks: {},
    rating_scale_labels: {},
  });

  const openSection = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
    const tabs = await screen.findAllByRole('button', { name });
    await user.click(tabs[0] as HTMLElement);
  };

  // Under Skills Testing the form shows no skills list, so a list edited here
  // changes nothing until the department switches back. It says so, and keeps
  // the list rather than hiding it.
  it('labels the default skills as not in effect under Skills Testing, and keeps them editable', async () => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(configFor('skills_testing'));
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openSection(user, /Feedback Defaults/);

    expect(await screen.findByRole('note')).toHaveTextContent(/Not in effect/);
    expect(screen.getByRole('link', { name: /Practical Skills/ })).toHaveAttribute(
      'href',
      '/training/admin?page=settings&tab=practical-skills'
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('labels the apparatus skills as not in effect under Skills Testing', async () => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(configFor('skills_testing'));
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openSection(user, /Apparatus Skills/);

    expect(await screen.findByRole('note')).toHaveTextContent(/Not in effect/);
  });

  it('shows no such label for a department on shift report sign-offs', async () => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(configFor('shift_signoffs'));
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportsSettingsPanel />);
    await openSection(user, /Feedback Defaults/);

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    await openSection(user, /Apparatus Skills/);
    expect(await screen.findByText(/Skills for/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
