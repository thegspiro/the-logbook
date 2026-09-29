import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithRouter } from '../../test/utils';

const mockGetPatterns = vi.fn();
const mockGetTemplates = vi.fn();
const mockGenerate = vi.fn();
vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getPatterns: (...a: unknown[]) => mockGetPatterns(...a) as unknown,
    getTemplates: (...a: unknown[]) => mockGetTemplates(...a) as unknown,
    generateShiftsFromPattern: (...a: unknown[]) => mockGenerate(...a) as unknown,
  },
}));

vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: () => ({
    members: [],
    loadMembers: vi.fn(),
    platoonsEnabled: false,
    loadSettings: vi.fn(),
  }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

import PatternsTab from './PatternsTab';

const PATTERN = {
  id: 'pat-1',
  name: 'A-Shift 24/48',
  pattern_type: 'platoon' as const,
  template_id: 'tpl-1',
  days_on: 1,
  days_off: 2,
  rotation_days: 3,
  start_date: '2026-10-01',
  is_active: true,
};

const TEMPLATE = {
  id: 'tpl-1',
  name: 'Day Shift A',
  start_time_of_day: '07:00',
  end_time_of_day: '19:00',
  is_active: true,
};

beforeEach(() => {
  mockGetPatterns.mockReset();
  mockGetPatterns.mockResolvedValue([PATTERN]);
  mockGetTemplates.mockReset();
  mockGetTemplates.mockResolvedValue([TEMPLATE]);
  mockGenerate.mockReset();
  mockGenerate.mockResolvedValue({ shifts_created: 11 });
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
});

describe('PatternsTab', () => {
  it('names every field of a new pattern and says which mode is chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PatternsTab />);

    await user.click(await screen.findByRole('button', { name: 'New Pattern' }));
    const manual = screen.getByRole('button', { name: /Manual Setup/ });
    await user.click(manual);
    expect(manual).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Fire Dept Presets/ })).toHaveAttribute('aria-pressed', 'false');

    await user.selectOptions(screen.getByLabelText('Pattern Type'), 'platoon');
    for (const name of ['Days On', 'Days Off', 'Rotation Cycle', 'Pattern Name *', 'Description']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Shift Template *')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date *')).toBeInTheDocument();
    expect(screen.getByLabelText('End Date (optional)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Pattern Type'), 'weekly');
    expect(screen.getByRole('group', { name: 'Active Days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tells the officer about driver seats generation left unfilled', async () => {
    mockGenerate.mockResolvedValue({
      shifts_created: 11,
      driver_warnings: ['2026-10-04: driver seat left unfilled (no EVOC level for Engine 1)'],
    });
    const user = userEvent.setup();
    renderWithRouter(<PatternsTab />);

    await user.click(await screen.findByRole('button', { name: 'Generate shifts from A-Shift 24/48' }));
    await user.type(screen.getByLabelText('Start Date *'), '2026-10-01');
    await user.type(screen.getByLabelText('End Date *'), '2026-10-31');
    // Exactly one control is named "Generate", whatever the viewport.
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(mockGenerate).toHaveBeenCalledWith('pat-1', { start_date: '2026-10-01', end_date: '2026-10-31' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Generated 11 shifts');
    expect(mockToastError).toHaveBeenCalledWith(
      'One driver seat was left unfilled: 2026-10-04: driver seat left unfilled (no EVOC level for Engine 1)',
      { duration: 8000 }
    );
  });

  it('explains a re-run that created nothing instead of reporting zero', async () => {
    mockGenerate.mockResolvedValue({ shifts_created: 0 });
    const user = userEvent.setup();
    renderWithRouter(<PatternsTab />);

    await user.click(await screen.findByRole('button', { name: 'Generate Shifts' }));
    await user.type(screen.getByLabelText('Start Date *'), '2026-10-01');
    await user.type(screen.getByLabelText('End Date *'), '2026-10-31');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(mockToastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/^No new shifts\. Dates already on the schedule/)
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
