import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ShiftTemplateRecord } from '../modules/scheduling/services/api';
import ShiftTemplatesPage from './ShiftTemplatesPage';

const mockGetTemplates = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockGetPatterns = vi.fn();

vi.mock('../modules/scheduling/services/api', async () => {
  const actual = await vi.importActual<typeof import('../modules/scheduling/services/api')>(
    '../modules/scheduling/services/api'
  );
  return {
    ...actual,
    schedulingService: {
      getTemplates: (...args: unknown[]) => mockGetTemplates(...args) as unknown,
      deleteTemplate: (...args: unknown[]) => mockDeleteTemplate(...args) as unknown,
      getPatterns: (...args: unknown[]) => mockGetPatterns(...args) as unknown,
      getApparatusOptions: vi.fn().mockResolvedValue({ options: [], source: 'default' }),
    },
  };
});

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
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

// Every block starts from no patterns; a block that needs some sets its own
// after this runs (CLAUDE.md pitfall #28).
beforeEach(() => {
  mockGetPatterns.mockReset();
  mockGetPatterns.mockResolvedValue([]);
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
    mockDeleteTemplate.mockResolvedValue('deleted');
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  // A template that shifts or patterns use is deactivated rather than deleted
  // (the shifts keep its checklists); the dialog says so up front.
  it('says a template in use is deactivated rather than deleted', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete Day Shift' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('it is deactivated instead of deleted');
    expect(dialog).toHaveTextContent('equipment checklists');
    // Patterns no longer generate from a deactivated template.
    expect(dialog).toHaveTextContent('its patterns stop generating new shifts until it is reactivated');
    expect(dialog).not.toHaveTextContent('keep generating');
  });

  it('reports a deactivation as one', async () => {
    mockDeleteTemplate.mockResolvedValue('deactivated');
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete Day Shift' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0]?.[0]).toMatch(/"Day Shift" is still used .* deactivated instead of deleted/);
  });

  it('reports a deletion as one, and shows the server reason on failure', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete Day Shift' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Template deleted'));

    mockDeleteTemplate.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { detail: 'Shift template not found' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Day Shift' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]?.[0]).toContain('Shift template not found');
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

describe('ShiftTemplatesPage pattern held by an inactive template', () => {
  const pattern = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    id: 'pat-1',
    organization_id: 'org-1',
    name: 'A-Shift',
    pattern_type: 'daily',
    template_id: 'tmpl-1',
    start_date: '2026-10-01',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    mockGetTemplates.mockReset();
    mockGetTemplates.mockResolvedValue([{ ...buildTemplate(['officer']), is_active: false }]);
    mockGetPatterns.mockReset();
    mockGetPatterns.mockResolvedValue([
      pattern({ inactive_templates: ['Day Shift'] }),
      pattern({ id: 'pat-2', name: 'B-Shift', inactive_templates: [] }),
    ]);
  });

  it('warns on that pattern only, and in its edit form', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('tab', { name: /Patterns/ }));
    const notices = await screen.findAllByText(/Template inactive — this pattern is not generating shifts/);
    expect(notices).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Edit A-Shift' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Template inactive — this pattern is not generating shifts');
  });
});
