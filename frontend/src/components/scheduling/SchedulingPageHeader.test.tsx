import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CalendarDays, Clock, Users } from 'lucide-react';

const mockCheckPermission = vi.fn<(permission: string) => boolean>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ checkPermission: (permission: string) => mockCheckPermission(permission) }),
}));

import { SchedulingPageHeader } from './SchedulingPageHeader';

const renderAt = (path: string, ui: React.ReactElement) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

const VIEWS = [
  { label: 'Schedule', path: '/scheduling', icon: CalendarDays, replace: true },
  { label: 'My Shifts', path: '/scheduling?tab=my-shifts', icon: Clock, replace: true },
];

describe('SchedulingPageHeader', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
  });

  it('draws the member views as the strip, in violet, marking the named one', () => {
    renderAt(
      '/scheduling?tab=my-shifts',
      <SchedulingPageHeader
        icon={Clock}
        title="Shift Scheduling"
        sections={VIEWS}
        section="/scheduling?tab=my-shifts"
      />
    );

    const strip = screen.getByRole('navigation', { name: 'Scheduling views' });
    const current = within(strip).getByRole('link', { name: 'My Shifts' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('href', '/scheduling?tab=my-shifts');
    expect(current.className).toContain('border-violet-600');
    expect(within(strip).getByRole('link', { name: 'Schedule' })).not.toHaveAttribute('aria-current');
  });

  it('draws no trail on a view of the page, though its link carries a query', () => {
    renderAt(
      '/scheduling?tab=my-shifts',
      <SchedulingPageHeader
        icon={Clock}
        title="Shift Scheduling"
        sections={VIEWS}
        section="/scheduling?tab=my-shifts"
      />
    );

    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument();
  });

  it('gives an administration page a trail to its hub and no strip', () => {
    mockCheckPermission.mockImplementation((permission) => permission === 'scheduling.manage');
    renderAt(
      '/scheduling/admin/platoons',
      <SchedulingPageHeader icon={Users} title="Platoons" underHub="/scheduling/admin" />
    );

    expect(screen.queryByRole('navigation', { name: 'Scheduling views' })).not.toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(trail).getByRole('link', { name: 'Scheduling Administration' })).toHaveAttribute(
      'href',
      '/scheduling/admin'
    );
    expect(trail).toHaveTextContent('Platoons');
    expect(screen.getByRole('heading', { level: 1, name: 'Platoons' })).toBeInTheDocument();
  });
});
