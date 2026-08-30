import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { EquipmentChecksTab } from './EquipmentChecksTab';

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: mockCheckPermission }),
}));

vi.mock('./MyChecklistsPage', () => ({
  default: () => <div>My checklists view</div>,
}));

vi.mock('./FleetBoardPage', () => ({
  default: () => <div>Fleet board view</div>,
}));

describe('EquipmentChecksTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the fleet board for someone who can see other members checks', async () => {
    mockCheckPermission.mockImplementation((p: string) => p === 'inventory.check_view');
    renderWithRouter(<EquipmentChecksTab />);
    expect(await screen.findByText('Fleet board view')).toBeInTheDocument();
  });

  it('opens the fleet board for a scheduling manager', async () => {
    mockCheckPermission.mockImplementation((p: string) => p === 'scheduling.manage');
    renderWithRouter(<EquipmentChecksTab />);
    expect(await screen.findByText('Fleet board view')).toBeInTheDocument();
  });

  it('opens a plain member onto their own checklists', () => {
    // Not a preference — the fleet endpoint is behind inventory.check_view and
    // would 403 them, so the board would render an error, not a page.
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<EquipmentChecksTab />);
    expect(screen.getByText('My checklists view')).toBeInTheDocument();
    expect(screen.queryByText('Fleet board view')).not.toBeInTheDocument();
  });
});
