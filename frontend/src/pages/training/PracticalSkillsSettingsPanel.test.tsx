import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetConfig = vi.fn();
const mockUpdateConfig = vi.fn();
vi.mock('../../services/api', () => ({
  trainingModuleConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PracticalSkillsSettingsPanel } from './PracticalSkillsSettingsPanel';
import { usePracticalSkillsStore } from '../../stores/practicalSkillsStore';

describe('PracticalSkillsSettingsPanel', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockUpdateConfig.mockReset();
    mockGetConfig.mockResolvedValue({ practical_skills_method: 'skills_testing' });
    mockUpdateConfig.mockResolvedValue({ practical_skills_method: 'shift_signoffs' });
    usePracticalSkillsStore.setState({ method: 'skills_testing', organizationId: 'org-1' });
  });

  it('shows the department’s current choice', async () => {
    renderWithRouter(<PracticalSkillsSettingsPanel />);

    expect(await screen.findByRole('radio', { name: /Skills Testing/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Shift report sign-offs/ })).not.toBeChecked();
    // Nothing to save until the choice changes.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('switches after the officer confirms, and updates the navigation at once', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PracticalSkillsSettingsPanel />);

    await user.click(await screen.findByRole('radio', { name: /Shift report sign-offs/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // The dialog says what is hidden and that nothing is deleted.
    expect(await screen.findByText(/Nothing is deleted/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to Shift report sign-offs' }));

    expect(mockUpdateConfig).toHaveBeenCalledWith({ practical_skills_method: 'shift_signoffs' });
    expect(usePracticalSkillsStore.getState().method).toBe('shift_signoffs');
  });

  it('changes nothing when the officer keeps the current setting', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PracticalSkillsSettingsPanel />);

    await user.click(await screen.findByRole('radio', { name: /Shift report sign-offs/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Keep current setting' }));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(usePracticalSkillsStore.getState().method).toBe('skills_testing');
  });
});
