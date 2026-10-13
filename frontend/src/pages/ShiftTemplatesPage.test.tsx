import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ShiftTemplateRecord } from '../modules/scheduling/services/api';
import ShiftTemplatesPage from './ShiftTemplatesPage';

const mockGetTemplates = vi.fn();
const mockDeleteTemplate = vi.fn();

vi.mock('../modules/scheduling/services/api', async () => {
  const actual = await vi.importActual<typeof import('../modules/scheduling/services/api')>(
    '../modules/scheduling/services/api'
  );
  return {
    ...actual,
    schedulingService: {
      getTemplates: (...args: unknown[]) => mockGetTemplates(...args) as unknown,
      deleteTemplate: (...args: unknown[]) => mockDeleteTemplate(...args) as unknown,
      getPatterns: vi.fn().mockResolvedValue([]),
      getApparatusOptions: vi.fn().mockResolvedValue({ options: [], source: 'default' }),
    },
  };
});

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const buildTemplate = (positions: ShiftTemplateRecord['positions']): Record<string, unknown> => ({
  id: 'tmpl-1',
  organization_id: 'org-1',
  name: 'Day Shift',
  start_time_of_day: '07:00',
  end_time_of_day: '19:00',
  duration_hours: 12,
  min_staffing: 3,
  category: 'standard',
  positions,
  is_default: false,
  is_active: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
});

describe('ShiftTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: templates saved by TemplateFormModal store seats as
  // { position, required } objects. Rendering the object itself threw React
  // error #31 and blanked the page.
  it('renders structured position slots without crashing', async () => {
    mockGetTemplates.mockResolvedValue([
      buildTemplate([
        { position: 'officer', required: true },
        { position: 'firefighter', required: false },
      ]),
    ]);

    renderWithRouter(<ShiftTemplatesPage />);

    await waitFor(() => {
      expect(screen.getByText('Positions (2)')).toBeInTheDocument();
    });
    expect(screen.getByText('Officer')).toBeInTheDocument();
    expect(screen.getByText(/Firefighter/)).toBeInTheDocument();
  });

  it('still renders legacy string positions', async () => {
    mockGetTemplates.mockResolvedValue([buildTemplate(['officer', 'driver'])]);

    renderWithRouter(<ShiftTemplatesPage />);

    await waitFor(() => {
      expect(screen.getByText('Positions (2)')).toBeInTheDocument();
    });
    expect(screen.getByText('Officer')).toBeInTheDocument();
    expect(screen.getByText('Driver/Operator')).toBeInTheDocument();
  });
});

// Deleting a template used to fire on the first click of the trash icon, one
// tab-stop from Edit, with nothing to undo it.
describe('ShiftTemplatesPage template delete', () => {
  beforeEach(() => {
    mockGetTemplates.mockReset();
    mockGetTemplates.mockResolvedValue([buildTemplate(['officer'])]);
    mockDeleteTemplate.mockReset();
    mockDeleteTemplate.mockResolvedValue(undefined);
  });

  it('asks before deleting, and keeps the template on "Keep it"', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete Day Shift' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete "Day Shift"?');
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteTemplate).not.toHaveBeenCalled();
  });

  it('deletes once the officer confirms', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete Day Shift' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteTemplate).toHaveBeenCalledWith('tmpl-1'));
  });
});
