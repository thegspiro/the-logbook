/**
 * InterviewerPositionsConfig — choosing the positions an interview stage
 * needs an interview from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role } from '../../../../types/role';

const mocks = vi.hoisted(() => ({ getRoles: vi.fn() }));

vi.mock('../../../../services/api', () => ({
  roleService: { getRoles: (...a: unknown[]) => mocks.getRoles(...a) as unknown },
}));

import InterviewerPositionsConfig from './InterviewerPositionsConfig';

const role = (slug: string, name: string, priority: number, kind: Role['kind'] = 'office'): Role => ({
  id: `id-${slug}`,
  organization_id: 'org-1',
  name,
  slug,
  permissions: [],
  is_system: false,
  priority,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  kind,
});

const roles = [
  role('member', 'Member', 1, 'system'),
  role('board_of_directors', 'Board of Directors', 10, 'committee'),
  role('fire_chief', 'Fire Chief', 90, 'system'),
  role('president', 'President', 95),
];

describe('InterviewerPositionsConfig', () => {
  beforeEach(() => {
    mocks.getRoles.mockReset();
    mocks.getRoles.mockResolvedValue(roles);
  });

  it('offers every position but Member, most senior first', async () => {
    render(<InterviewerPositionsConfig value={[]} onChange={vi.fn()} />);

    await screen.findByLabelText('President');
    const labels = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(labels).toEqual(['President', 'Fire Chief', 'Board of Directors']);
  });

  it('ticks a position by its slug', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<InterviewerPositionsConfig value={['president']} onChange={onChange} />);

    await user.click(await screen.findByLabelText('Board of Directors'));

    expect(onChange).toHaveBeenCalledWith(['president', 'board_of_directors']);
  });

  it('unticks a stored position whatever its case or padding', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<InterviewerPositionsConfig value={[' Fire_Chief ', 'president']} onChange={onChange} />);

    const chief = await screen.findByLabelText('Fire Chief');
    expect(chief).toBeChecked();
    await user.click(chief);

    expect(onChange).toHaveBeenCalledWith(['president']);
  });

  it('keeps a required position the department no longer has, so it can be removed deliberately', async () => {
    render(<InterviewerPositionsConfig value={['chief']} onChange={vi.fn()} />);

    expect(await screen.findByLabelText('Chief (not a current position)')).toBeChecked();
  });

  it('says so when positions cannot be loaded, and still lists what is required', async () => {
    mocks.getRoles.mockRejectedValue(new Error('Network Error'));
    render(<InterviewerPositionsConfig value={['fire_chief']} onChange={vi.fn()} />);

    expect(await screen.findByRole('status')).toHaveTextContent('Positions could not be loaded');
    expect(screen.getByLabelText('Fire Chief (not a current position)')).toBeChecked();
  });
});
