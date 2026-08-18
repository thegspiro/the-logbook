import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetLevels = vi.fn();
const mockCreateLevel = vi.fn();
const mockUpdateLevel = vi.fn();
const mockDeleteLevel = vi.fn();
const mockGetPrograms = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../../modules/apparatus/services/api', () => ({
  evocLevelService: {
    getLevels: (...a: unknown[]) => mockGetLevels(...a) as unknown,
    createLevel: (...a: unknown[]) => mockCreateLevel(...a) as unknown,
    updateLevel: (...a: unknown[]) => mockUpdateLevel(...a) as unknown,
    deleteLevel: (...a: unknown[]) => mockDeleteLevel(...a) as unknown,
  },
}));

vi.mock('../../services/api', () => ({
  trainingProgramService: {
    getPrograms: (...a: unknown[]) => mockGetPrograms(...a) as unknown,
  },
}));

vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EvocLevelsSettingsSection from './EvocLevelsSettingsSection';

const level = (overrides: Record<string, unknown> = {}) => ({
  id: 'lvl-3',
  organizationId: 'org-1',
  levelNumber: 3,
  name: 'EVOC 3 - Engine / Pumper',
  code: 'EVOC3',
  description: 'Engines and pumpers.',
  isCumulative: true,
  trainingProgramId: null,
  isSystem: false,
  sortOrder: 3,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('EvocLevelsSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLevels.mockResolvedValue([level()]);
    mockGetPrograms.mockResolvedValue([
      { id: 'prog-1', name: 'Driver Operator Pipeline', is_template: false },
      { id: 'tpl-1', name: 'Template Program', is_template: true },
    ]);
    mockCreateLevel.mockResolvedValue(level({ id: 'new' }));
    mockUpdateLevel.mockResolvedValue(level());
    mockDeleteLevel.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue(true);
  });

  it('requests inactive levels too, since this is the only place to reactivate one', async () => {
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');
    expect(mockGetLevels).toHaveBeenCalledWith({ activeOnly: false });
  });

  it('shows when a level has no certifying program', async () => {
    render(<EvocLevelsSettingsSection />);
    expect(await screen.findByText(/No certifying program/i)).toBeInTheDocument();
  });

  it('names the certifying program when one is linked', async () => {
    mockGetLevels.mockResolvedValue([level({ trainingProgramId: 'prog-1' })]);
    render(<EvocLevelsSettingsSection />);
    await screen.findByText(/Certified by/i);
    expect(screen.getByText('Driver Operator Pipeline')).toBeInTheDocument();
  });

  it('excludes template programs from the certifying-program picker', async () => {
    const user = userEvent.setup();
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: /add level/i }));

    const select = screen.getByLabelText(/certifying training program/i);
    expect(select).toHaveTextContent('Driver Operator Pipeline');
    expect(select).not.toHaveTextContent('Template Program');
  });

  it('suggests the next free level number when adding', async () => {
    const user = userEvent.setup();
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: /add level/i }));

    expect(screen.getByLabelText('Level')).toHaveValue(4);
  });

  it('omits blank optional fields when creating', async () => {
    const user = userEvent.setup();
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: /add level/i }));
    await user.type(screen.getByLabelText('Name'), 'EVOC 4 - Aerial');
    await user.type(screen.getByLabelText('Code'), 'evoc4');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    // Blank optional fields are omitted rather than sent as '', which a
    // Pydantic validator would reject with a 422. The code field normalizes
    // to upper case as you type.
    await waitFor(() =>
      expect(mockCreateLevel).toHaveBeenCalledWith({
        levelNumber: 4,
        name: 'EVOC 4 - Aerial',
        code: 'EVOC4',
        description: undefined,
        isCumulative: true,
        trainingProgramId: undefined,
        sortOrder: 4,
        isActive: true,
      })
    );
  });

  it('sends an explicit null to unlink a certifying program', async () => {
    // On an update, an omitted key means "leave it alone" — clearing the link
    // has to travel as null or the old program silently survives the save.
    const user = userEvent.setup();
    mockGetLevels.mockResolvedValue([level({ trainingProgramId: 'prog-1' })]);
    render(<EvocLevelsSettingsSection />);
    await screen.findByText(/Certified by/i);

    await user.click(screen.getByRole('button', { name: /edit evoc 3/i }));
    await user.selectOptions(screen.getByLabelText(/certifying training program/i), '');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateLevel).toHaveBeenCalledWith('lvl-3', {
        levelNumber: 3,
        name: 'EVOC 3 - Engine / Pumper',
        code: 'EVOC3',
        description: 'Engines and pumpers.',
        isCumulative: true,
        trainingProgramId: null,
        isActive: true,
      })
    );
  });

  it('rejects an out-of-range level number before calling the API', async () => {
    const user = userEvent.setup();
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: /add level/i }));
    await user.clear(screen.getByLabelText('Level'));
    await user.type(screen.getByLabelText('Level'), '11');
    await user.type(screen.getByLabelText('Name'), 'Too high');
    await user.type(screen.getByLabelText('Code'), 'X');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(mockCreateLevel).not.toHaveBeenCalled();
  });

  it('toggles a level between active and inactive', async () => {
    const user = userEvent.setup();
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(mockUpdateLevel).toHaveBeenCalledWith('lvl-3', { isActive: false }));
  });

  it('marks inactive levels in the list', async () => {
    mockGetLevels.mockResolvedValue([level({ isActive: false })]);
    render(<EvocLevelsSettingsSection />);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
  });

  it('asks before deleting and does nothing when declined', async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue(false);
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: /delete evoc 3/i }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ confirmLabel: 'Delete level', cancelLabel: 'Keep it' })
      )
    );
    expect(mockDeleteLevel).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    const user = userEvent.setup();
    render(<EvocLevelsSettingsSection />);
    await screen.findByText('EVOC 3 - Engine / Pumper');

    await user.click(screen.getByRole('button', { name: /delete evoc 3/i }));

    await waitFor(() => expect(mockDeleteLevel).toHaveBeenCalledWith('lvl-3'));
  });

  it('explains the consequence when the ladder is empty', async () => {
    mockGetLevels.mockResolvedValue([]);
    render(<EvocLevelsSettingsSection />);
    expect(await screen.findByText(/apparatus cannot carry a driving requirement/i)).toBeInTheDocument();
  });
});
