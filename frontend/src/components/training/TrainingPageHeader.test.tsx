import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GraduationCap } from 'lucide-react';
import { PracticalSkillsMethod } from '../../constants/enums';

const mockCheckPermission = vi.fn<(permission: string) => boolean>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ checkPermission: (permission: string) => mockCheckPermission(permission) }),
}));

let mockMethod: PracticalSkillsMethod | null = null;
vi.mock('../../stores/practicalSkillsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/practicalSkillsStore')>()),
  usePracticalSkillsMethod: () => mockMethod,
}));

import { TrainingPageHeader } from './TrainingPageHeader';

const renderAt = (path: string, ui: React.ReactElement) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

const strip = () => screen.getByRole('navigation', { name: 'Training sections' });
const stripLinks = () =>
  within(strip())
    .getAllByRole('link')
    .map((link) => link.textContent);
// The trail opens with an icon-only Home link, which has no text to compare.
const trailLinks = () =>
  within(screen.getByRole('navigation', { name: /breadcrumb/i }))
    .getAllByRole('link')
    .map((link) => link.textContent)
    .filter(Boolean);

describe('TrainingPageHeader', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockMethod = null;
  });

  describe('section strip', () => {
    it('offers every member the six sections and marks the one open', () => {
      renderAt('/training/programs', <TrainingPageHeader icon={GraduationCap} title="Training Programs" />);

      expect(stripLinks()).toEqual([
        'My Training',
        'Submit Training',
        'Course Library',
        'Programs',
        'Skills Testing',
        'Knowledge Tests',
      ]);
      expect(within(strip()).getByRole('link', { name: 'Programs' })).toHaveAttribute('aria-current', 'page');
    });

    it('drops Skills Testing for a department that signs skills off on shift reports', () => {
      mockMethod = PracticalSkillsMethod.SHIFT_SIGNOFFS;
      renderAt('/training/my-training', <TrainingPageHeader icon={GraduationCap} title="My Training" />);

      expect(stripLinks()).not.toContain('Skills Testing');
    });

    it('treats /training as My Training, without a trail back to itself', () => {
      renderAt('/training', <TrainingPageHeader icon={GraduationCap} title="My Training" />);

      expect(within(strip()).getByRole('link', { name: 'My Training' })).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument();
    });

    it('does not let the alias claim the pages under /training as a prefix', () => {
      renderAt('/training/cohorts', <TrainingPageHeader icon={GraduationCap} title="Course Cohorts" />);

      expect(within(strip()).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    });
  });

  describe('trail', () => {
    it('starts from the named section for a page whose URL sits under none', () => {
      renderAt(
        '/training/record-crew',
        <TrainingPageHeader icon={GraduationCap} title="Record Crew Training" section="/training/submit" />
      );

      expect(within(strip()).getByRole('link', { name: 'Submit Training' })).toHaveAttribute('aria-current', 'page');
      expect(trailLinks()).toEqual(['Submit Training']);
      expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toHaveTextContent('Record Crew Training');
    });

    it('puts Training Administration before a section it does not sit inside', () => {
      mockCheckPermission.mockImplementation((permission) => permission === 'training.manage');
      renderAt(
        '/training/programs/p-1',
        <TrainingPageHeader icon={GraduationCap} title="Firefighter I" underHub="/training/admin" />
      );

      expect(trailLinks()).toEqual(['Training Administration', 'Programs']);
    });

    it('leaves the hub out for a member who cannot open it', () => {
      renderAt(
        '/training/programs/p-1',
        <TrainingPageHeader icon={GraduationCap} title="Firefighter I" underHub="/training/admin" />
      );

      expect(trailLinks()).toEqual(['Programs']);
    });

    it('reaches the hub alone from an officer page outside every section', () => {
      mockCheckPermission.mockImplementation((permission) => permission === 'training.manage');
      renderAt(
        '/training/cohorts',
        <TrainingPageHeader icon={GraduationCap} title="Course Cohorts" underHub="/training/admin" />
      );

      expect(trailLinks()).toEqual(['Training Administration']);
    });
  });
});
