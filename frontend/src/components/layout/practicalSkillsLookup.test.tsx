/**
 * The navigation bars ask for the Training module's practical-skills setting
 * only while that module is on.
 *
 * Both bars are mounted on every page and the server refuses the setting while
 * Training is off, so a department without Training drew a refused request on
 * every page it opened. The bars pass the module check into the hook, as the
 * command palette does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithRouter } from '../../test/utils';

let trainingOn = false;
const practicalSkillsAsked = vi.fn();

vi.mock('../../stores/practicalSkillsStore', () => ({
  usePracticalSkillsMethod: (...args: unknown[]) => {
    practicalSkillsAsked(...args);
    return null;
  },
  offersSkillsTesting: () => true,
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: () => true };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isLoading: false,
    isModuleOn: (id: string) => (id === 'training' ? trainingOn : true),
  }),
}));

vi.mock('../../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (s: { unreadCount: number }) => unknown) => selector({ unreadCount: 0 }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

vi.mock('../../stores/pendingSyncStore', () => ({
  usePendingSyncStore: (selector: (s: { count: number; status: string }) => unknown) =>
    selector({ count: 0, status: 'idle' }),
}));

vi.mock('../../hooks/useOfflineSyncEngine', () => ({ triggerOfflineDrain: vi.fn() }));

import { SideNavigation } from './SideNavigation';
import { TopNavigation } from './TopNavigation';

const bars = [
  ['side', () => <SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />],
  ['top', () => <TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />],
] as const;

describe.each(bars)('the %s navigation', (_name, bar) => {
  beforeEach(() => {
    practicalSkillsAsked.mockReset();
  });

  it('does not ask for the practical-skills setting while Training is off', () => {
    trainingOn = false;
    renderWithRouter(bar());

    expect(practicalSkillsAsked).toHaveBeenCalled();
    expect(practicalSkillsAsked.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  });

  it('asks while Training is on', () => {
    trainingOn = true;
    renderWithRouter(bar());

    expect(practicalSkillsAsked).toHaveBeenLastCalledWith(true);
  });
});
