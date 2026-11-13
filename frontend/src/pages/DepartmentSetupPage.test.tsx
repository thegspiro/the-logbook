/**
 * Department Setup (workflow review W06).
 *
 * W06-5: every review step's button read only "Mark as reviewed", so a
 * screen reader listing the page's buttons heard the same words twice with no
 * clue which step each confirmed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import { organizationService } from '../services/api';
import type { SetupChecklistItem } from '../services/api';
import DepartmentSetupPage from './DepartmentSetupPage';

vi.mock('../services/api', () => ({
  organizationService: {
    getSetupChecklist: vi.fn(),
    acknowledgeSetupChecklistItem: vi.fn(),
  },
}));

const reviewItem = (key: string, title: string, is_complete: boolean): SetupChecklistItem => ({
  key,
  title,
  description: `${title} description`,
  path: '/settings',
  category: 'essential',
  is_complete,
  count: 0,
  required: true,
  kind: 'review',
});

beforeEach(() => {
  vi.mocked(organizationService.getSetupChecklist).mockReset();
  vi.mocked(organizationService.getSetupChecklist).mockResolvedValue({
    items: [
      reviewItem('organization_settings', 'Review Organization Settings', false),
      reviewItem('modules', 'Review Enabled Modules', true),
    ],
    completed_count: 1,
    total_count: 2,
  } as never);
});

describe('DepartmentSetupPage', () => {
  it('names each review button after its step', async () => {
    renderWithRouter(<DepartmentSetupPage />);

    expect(
      await screen.findByRole('button', { name: 'Mark Review Organization Settings as reviewed' })
    ).toHaveTextContent('Mark as reviewed');
    expect(screen.getByRole('button', { name: 'Mark Review Enabled Modules as not reviewed' })).toHaveTextContent(
      'Mark as not reviewed'
    );
  });
});
