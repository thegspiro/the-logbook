import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { CurrentUser } from '../../../types/auth';

const mockGetConfig = vi.fn();
vi.mock('../../../services/api', () => ({
  trainingModuleConfigService: { getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown },
}));

// Import the gate and stores AFTER the mock is in place.
import { SkillsTestingRoute } from './SkillsTestingRoute';
import { useAuthStore } from '../../../stores/authStore';
import { usePracticalSkillsStore } from '../../../stores/practicalSkillsStore';
import { PracticalSkillsMethod } from '../../../constants/enums';

const member = (permissions: string[]): CurrentUser => ({
  id: 'u-1',
  username: 'alex',
  email: 'alex@example.test',
  organization_id: 'org-1',
  timezone: 'UTC',
  roles: [],
  positions: [],
  rank: null,
  membership_type: null,
  permissions,
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  password_expired: false,
  must_change_password: false,
});

const renderGate = () =>
  renderWithRouter(
    <SkillsTestingRoute>
      <p>The skills testing page</p>
    </SkillsTestingRoute>
  );

describe('SkillsTestingRoute', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    // Never settles unless a test says otherwise: the store's own load stays pending.
    mockGetConfig.mockReturnValue(new Promise(() => {}));
    useAuthStore.setState({ user: member([]) });
    usePracticalSkillsStore.setState({ method: null, organizationId: null });
  });

  it('shows the page to a department running Skills Testing', () => {
    usePracticalSkillsStore.setState({ method: PracticalSkillsMethod.SKILLS_TESTING, organizationId: 'org-1' });

    renderGate();

    expect(screen.getByText('The skills testing page')).toBeInTheDocument();
  });

  it('explains instead of showing the page to a sign-offs department', () => {
    usePracticalSkillsStore.setState({ method: PracticalSkillsMethod.SHIFT_SIGNOFFS, organizationId: 'org-1' });

    renderGate();

    expect(screen.queryByText('The skills testing page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Skills Testing is turned off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My Training' })).toBeInTheDocument();
    // A member cannot change the setting, so is not offered it.
    expect(screen.queryByRole('button', { name: 'Practical skills setting' })).not.toBeInTheDocument();
  });

  it('points an officer at the sign-off catalog and the setting', () => {
    useAuthStore.setState({ user: member(['training.manage']) });
    usePracticalSkillsStore.setState({ method: PracticalSkillsMethod.SHIFT_SIGNOFFS, organizationId: 'org-1' });

    renderGate();

    expect(screen.getByRole('button', { name: 'Skill Evaluations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practical skills setting' })).toBeInTheDocument();
  });

  it('holds the page back until the department’s choice is known', () => {
    renderGate();

    expect(screen.queryByText('The skills testing page')).not.toBeInTheDocument();
    expect(screen.queryByText('Skills Testing is turned off')).not.toBeInTheDocument();
  });

  // Matches the navigation: an unknown answer hides nothing.
  it('shows the page when the lookup failed', () => {
    usePracticalSkillsStore.setState({ method: null, organizationId: 'org-1' });

    renderGate();

    expect(screen.getByText('The skills testing page')).toBeInTheDocument();
  });
});

describe('the training routes', () => {
  // A new Skills Testing page added without the gate would be reachable by a
  // department that has switched it off.
  it('gate every Skills Testing route except the views of a result already on file', () => {
    const routes = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'routes.tsx'),
      'utf8'
    );
    const ungated = ['/training/skills-testing/print/scorecard'];
    const blocks = routes.split('<Route').slice(1);
    const skillsTesting = blocks.filter((block) => /path="\/training\/skills-testing/.test(block));

    expect(skillsTesting.length).toBeGreaterThan(0);
    for (const block of skillsTesting) {
      const routePath = /path="([^"]+)"/.exec(block)?.[1] ?? '';
      expect(block.includes('<SkillsTestingRoute>'), routePath).toBe(!ungated.includes(routePath));
    }
  });
});
