import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import type { ShiftTemplateRecord } from '../modules/scheduling/services/api';
import ShiftTemplatesPage from './ShiftTemplatesPage';

const mockGetTemplates = vi.fn();

vi.mock('../modules/scheduling/services/api', async () => {
  const actual = await vi.importActual<typeof import('../modules/scheduling/services/api')>(
    '../modules/scheduling/services/api'
  );
  return {
    ...actual,
    schedulingService: {
      getTemplates: (...args: unknown[]) => mockGetTemplates(...args) as unknown,
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
