import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ShiftTemplateRecord } from '../modules/scheduling/services/api';
import ShiftTemplatesPage from './ShiftTemplatesPage';

const mockGetTemplates = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockGetPatterns = vi.fn();
const mockUpdateTemplate = vi.fn();

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
      updateTemplate: (...args: unknown[]) => mockUpdateTemplate(...args) as unknown,
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

// The page must not load patterns at all (W32-6); every block starts from a
// reset mock so the "not called" check below means this render.
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

describe('ShiftTemplatesPage reactivating a template', () => {
  beforeEach(() => {
    mockGetTemplates.mockReset();
    mockGetTemplates.mockResolvedValue([{ ...buildTemplate(['officer']), is_active: false }]);
    mockUpdateTemplate.mockReset();
    mockUpdateTemplate.mockResolvedValue(buildTemplate(['officer']));
    toastSuccess.mockReset();
  });

  it('reactivates the template and reloads the list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Reactivate Day Shift' }));

    expect(mockUpdateTemplate).toHaveBeenCalledWith('tmpl-1', { is_active: true });
    await waitFor(() => expect(mockGetTemplates).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith('"Day Shift" is active again. Patterns using it generate shifts again.');
  });
});

// W32-6: this page carried a second pattern list and form beside Planning ›
// Patterns, and only this one could edit. Patterns now live in one place.
describe('ShiftTemplatesPage and patterns', () => {
  beforeEach(() => {
    mockGetTemplates.mockReset();
    mockGetTemplates.mockResolvedValue([buildTemplate(['officer'])]);
  });

  it('offers no pattern tab or form, and points to Shift patterns', async () => {
    renderWithRouter(<ShiftTemplatesPage />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Shift Templates' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Pattern/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shift patterns' })).toHaveAttribute(
      'href',
      '/scheduling/admin/planning/patterns'
    );
    expect(mockGetPatterns).not.toHaveBeenCalled();
  });
});
