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
