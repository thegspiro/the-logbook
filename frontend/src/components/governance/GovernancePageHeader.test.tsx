import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Vote } from 'lucide-react';

const mockCheckPermission = vi.fn<(permission: string) => boolean>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ checkPermission: (permission: string) => mockCheckPermission(permission) }),
}));

const mockIsModuleOn = vi.fn<(module: string) => boolean>();
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isLoading: false,
    isModuleOn: (module: string) => mockIsModuleOn(module),
  }),
}));

import { GovernancePageHeader } from './GovernancePageHeader';

const renderAt = (path: string, ui: React.ReactElement) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

const stripLinks = () =>
  within(screen.getByRole('navigation', { name: 'Governance sections' }))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('GovernancePageHeader', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockIsModuleOn.mockReset();
    mockIsModuleOn.mockReturnValue(true);
  });

  it('offers every member the chart, elections, minutes and action items, but not Legal Documents', () => {
    renderAt('/elections', <GovernancePageHeader icon={Vote} title="Elections" />);

    expect(stripLinks()).toEqual(['Org Chart', 'Elections', 'Minutes', 'Action Items']);
    expect(screen.getByRole('link', { name: 'Elections' })).toHaveAttribute('aria-current', 'page');
  });

  it('adds Legal Documents for a viewer who can review them', () => {
    mockCheckPermission.mockImplementation((permission) => permission === 'legal.propose');
    renderAt('/governance/legal', <GovernancePageHeader icon={Vote} title="Legal Documents" />);

    expect(stripLinks()).toContain('Legal Documents');
    expect(screen.getByRole('link', { name: 'Legal Documents' })).toHaveAttribute('aria-current', 'page');
  });

  it('drops a section whose module is switched off', () => {
    mockIsModuleOn.mockImplementation((module) => module !== 'minutes');
    renderAt('/elections', <GovernancePageHeader icon={Vote} title="Elections" />);

    expect(stripLinks()).toEqual(['Org Chart', 'Elections']);
  });

  it('traces a detail page back to its section', () => {
    renderAt('/elections/e-1', <GovernancePageHeader icon={Vote} title="2027 Officer Election" />);

    const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(trail).getByRole('link', { name: 'Elections' })).toHaveAttribute('href', '/elections');
    expect(trail).toHaveTextContent('2027 Officer Election');
  });
});
