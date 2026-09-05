import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ComplianceMatrix } from '../services/communicationsServices';

const getComplianceMatrix = vi.fn();
vi.mock('../services/api', () => ({
  trainingService: {
    getComplianceMatrix: (...args: unknown[]) => getComplianceMatrix(...args) as unknown,
  },
}));

const downloadCsv = vi.fn();
vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>();
  return { ...actual, downloadCsv: (...args: unknown[]) => downloadCsv(...args) as unknown };
});

// Import after the mocks are in place.
import ComplianceMatrixTab from './ComplianceMatrixTab';

const dateOffset = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Three members spanning the three standings, so the rail has a group for
 * each and the queue has somewhere to step.
 */
const matrix = (): ComplianceMatrix => ({
  as_of: '2026-08-31',
  threshold_type: 'all_required',
  generated_at: '2026-09-05T12:00:00Z',
  requirements: [
    {
      id: 'r1',
      name: 'Company Training Hours',
      requirement_type: 'hours',
      frequency: 'annual',
      target: 24,
      target_unit: 'hours',
    },
    {
      id: 'r2',
      name: 'SCBA Fit Test',
      requirement_type: 'certification',
      frequency: 'annual',
      target: null,
      target_unit: null,
    },
  ],
  members: [
    {
      user_id: 'u1',
      member_name: 'Doherty, Sean',
      membership_type: 'probationary',
      standing: 'non_compliant',
      completion_pct: 0,
      requirements_met: 0,
      requirements_total: 2,
      requirements: [
        {
          requirement_id: 'r1',
          requirement_name: 'Company Training Hours',
          status: 'in_progress',
          progress_current: 6,
          progress_required: 24,
          progress_unit: 'hours',
          base_required: 24,
          waived_months: 0,
          window_start: '2026-01-01',
          window_end: '2026-12-31',
        },
        {
          requirement_id: 'r2',
          requirement_name: 'SCBA Fit Test',
          status: 'not_started',
          waived_months: 0,
        },
      ],
    },
    {
      user_id: 'u2',
      member_name: 'Halloran, Britt',
      membership_type: 'active',
      standing: 'at_risk',
      completion_pct: 50,
      requirements_met: 1,
      requirements_total: 2,
      requirements: [
        {
          requirement_id: 'r1',
          requirement_name: 'Company Training Hours',
          status: 'in_progress',
          progress_current: 18,
          progress_required: 20,
          progress_unit: 'hours',
          base_required: 24,
          waived_months: 2,
          window_start: '2026-01-01',
          window_end: '2026-12-31',
        },
        {
          requirement_id: 'r2',
          requirement_name: 'SCBA Fit Test',
          status: 'completed',
          expiry_date: dateOffset(400),
        },
      ],
    },
    {
      user_id: 'u3',
      member_name: 'Alvarez, Marisol',
      membership_type: 'senior',
      standing: 'compliant',
      completion_pct: 100,
      requirements_met: 2,
      requirements_total: 2,
      requirements: [
        {
          requirement_id: 'r1',
          requirement_name: 'Company Training Hours',
          status: 'completed',
          progress_current: 30,
          progress_required: 24,
          progress_unit: 'hours',
        },
        {
          requirement_id: 'r2',
          requirement_name: 'SCBA Fit Test',
          status: 'completed',
          expiry_date: dateOffset(500),
        },
      ],
    },
  ],
});

const setUrl = (search: string) => {
  window.history.pushState({}, '', `/training/admin${search}`);
};

afterEach(() => {
  setUrl('');
});

describe('ComplianceMatrixTab', () => {
  beforeEach(() => {
    getComplianceMatrix.mockReset();
    getComplianceMatrix.mockResolvedValue(matrix());
    downloadCsv.mockReset();
    setUrl('');
  });

  it('states the evaluation window the whole screen is judged against', async () => {
    renderWithRouter(<ComplianceMatrixTab />);
    expect(await screen.findByText(/Evaluated through/)).toBeInTheDocument();
    expect(screen.getByText('Aug 31, 2026')).toBeInTheDocument();
    expect(screen.getByText('all requirements met')).toBeInTheDocument();
  });

  it('summarises the roster by standing', async () => {
    renderWithRouter(<ComplianceMatrixTab />);
    expect(
      await screen.findByText(/3 tracked members · 2 requirements · 1 non-compliant, 1 at risk/)
    ).toBeInTheDocument();
  });

  it('groups the queue and orders it worst first', async () => {
    renderWithRouter(<ComplianceMatrixTab />);
    const rail = within(await screen.findByRole('navigation', { name: 'Compliance queue' }));

    expect(rail.getByText('Non-compliant')).toBeInTheDocument();
    expect(rail.getByText('At risk')).toBeInTheDocument();
    expect(rail.getByText('Compliant')).toBeInTheDocument();

    // Worst first: two open items, then one, then none.
    const names = rail.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names[0]).toContain('Doherty, Sean');
    expect(names[1]).toContain('Halloran, Britt');
    expect(names[2]).toContain('Alvarez, Marisol');
  });

  it('opens on the worst item with its numbers spelled out', async () => {
    renderWithRouter(<ComplianceMatrixTab />);
    expect(await screen.findByRole('heading', { name: 'Doherty, Sean' })).toBeInTheDocument();
    expect(screen.getByText('Member 1 of 3 in the queue')).toBeInTheDocument();
    expect(screen.getByText('6 of 24 hours')).toBeInTheDocument();
    expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
  });

  it('steps to the next item in the queue', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceMatrixTab />);
    await screen.findByRole('heading', { name: 'Doherty, Sean' });

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('heading', { name: 'Halloran, Britt' })).toBeInTheDocument();
    expect(screen.getByText('Member 2 of 3 in the queue')).toBeInTheDocument();
  });

  it('wraps to the end of the queue when stepping back from the first item', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceMatrixTab />);
    await screen.findByRole('heading', { name: 'Doherty, Sean' });

    await user.click(screen.getByRole('button', { name: /Previous/ }));
    expect(await screen.findByRole('heading', { name: 'Alvarez, Marisol' })).toBeInTheDocument();
  });

  it('explains a waiver-reduced target on the row it changed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ComplianceMatrixTab />);
    await screen.findByRole('heading', { name: 'Doherty, Sean' });

    await user.click(await screen.findByRole('button', { name: /Halloran, Britt/ }));
    expect(await screen.findByText('Target reduced 24 → 20 hours for 2 waived months')).toBeInTheDocument();
    expect(screen.getByText('18 of 20 hours')).toBeInTheDocument();
  });

  it('links to a member training record that exists', async () => {
    renderWithRouter(<ComplianceMatrixTab />);
    const link = await screen.findByRole('link', { name: /Training record/ });
    expect(link).toHaveAttribute('href', '/members/u1/training');
  });

  describe('arriving from the dashboard link', () => {
    beforeEach(() => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(matrix());
      setUrl('?status=noncompliant');
    });

    it('filters to the members who are behind and says it did', async () => {
      renderWithRouter(<ComplianceMatrixTab />);
      expect(await screen.findByText('Non-compliant + at risk only')).toBeInTheDocument();
      expect(screen.getByText('2 members')).toBeInTheDocument();

      const rail = within(screen.getByRole('navigation', { name: 'Compliance queue' }));
      expect(rail.queryByText('Compliant')).not.toBeInTheDocument();
      expect(rail.queryByText('Alvarez, Marisol')).not.toBeInTheDocument();
    });

    it('keeps a member the dashboard flagged but the backend calls compliant', async () => {
      // Where an org sets a compliant threshold below 100%, a member can hold
      // unmet requirements and still be labelled compliant. The dashboard's
      // intervention list has no threshold — it is built from a non-empty
      // unmet list — so filtering by standing hid the very member the
      // coordinator was sent here to look at.
      const m = matrix();
      m.members
        .filter((x) => x.member_name === 'Halloran, Britt')
        .forEach((x) => {
          x.standing = 'compliant';
        });
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(m);

      renderWithRouter(<ComplianceMatrixTab />);

      const rail = within(await screen.findByRole('navigation', { name: 'Compliance queue' }));
      expect(rail.getByRole('button', { name: /Halloran, Britt/ })).toBeInTheDocument();
    });

    it('narrows the requirement axis to requirements someone is behind on', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByText('Non-compliant + at risk only');

      await user.click(screen.getByRole('tab', { name: 'By requirement' }));

      // SCBA Fit Test has one member behind; both requirements stay. Clearing
      // the filter must not change the department-wide percentages.
      expect(await screen.findByText('2 requirements')).toBeInTheDocument();
    });

    it('restores the full roster when the chip is cleared', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByText('Non-compliant + at risk only');

      await user.click(screen.getByRole('button', { name: 'Show all members' }));

      expect(await screen.findByText('3 members')).toBeInTheDocument();
      const rail = within(screen.getByRole('navigation', { name: 'Compliance queue' }));
      expect(rail.getByText('Compliant')).toBeInTheDocument();
      // The param goes too, so a refresh does not silently re-filter.
      expect(window.location.search).toBe('');
    });
  });

  describe('without a status param', () => {
    beforeEach(() => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(matrix());
      setUrl('');
    });

    it('shows the whole roster rather than hiding members nobody asked to hide', async () => {
      renderWithRouter(<ComplianceMatrixTab />);
      expect(await screen.findByText('3 members')).toBeInTheDocument();
      expect(screen.queryByText('Non-compliant + at risk only')).not.toBeInTheDocument();
    });
  });

  describe('by requirement', () => {
    beforeEach(() => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(matrix());
      setUrl('');
    });

    it('flips the axis and scores each requirement across the department', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByRole('heading', { name: 'Doherty, Sean' });

      await user.click(screen.getByRole('tab', { name: 'By requirement' }));

      expect(await screen.findByRole('heading', { name: 'Company Training Hours' })).toBeInTheDocument();
      expect(screen.getByText('Requirement 1 of 2 in the queue')).toBeInTheDocument();
      expect(screen.getByText('Members behind')).toBeInTheDocument();
    });

    it('flags a requirement one member is behind on, matching the dashboard', async () => {
      // The dashboard's requirements_at_risk lists a requirement whenever any
      // applicable member has not met it. This screen used its own 85% cutoff,
      // so 2-of-3 met (67%) would have been "Below target" but 9-of-10 (90%)
      // green — concealing the tenth member from a coordinator who arrived
      // from the dashboard's at-risk list.
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByRole('heading', { name: 'Doherty, Sean' });

      await user.click(screen.getByRole('tab', { name: 'By requirement' }));

      const rail = within(await screen.findByRole('navigation', { name: 'Compliance queue' }));
      expect(rail.getByText('Behind')).toBeInTheDocument();
      // SCBA Fit Test: met by 2 of 3, so it is behind, not "holding".
      expect(rail.getByRole('button', { name: /SCBA Fit Test/ })).toBeInTheDocument();
    });

    it('offers a record link for each member behind', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByRole('heading', { name: 'Doherty, Sean' });

      await user.click(screen.getByRole('tab', { name: 'By requirement' }));
      const links = await screen.findAllByRole('link', { name: /Record/ });
      expect(links.map((l) => l.getAttribute('href'))).toContain('/members/u1/training');
    });
  });

  describe('search and sort', () => {
    beforeEach(() => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(matrix());
      setUrl('');
    });

    it('narrows the queue to matching members', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByRole('heading', { name: 'Doherty, Sean' });

      await user.type(screen.getByRole('textbox', { name: 'Search members' }), 'alvarez');

      expect(await screen.findByText('1 members')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Doherty/ })).not.toBeInTheDocument();
    });

    it('reorders alphabetically without changing who is in the queue', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByRole('heading', { name: 'Doherty, Sean' });

      await user.click(screen.getByRole('button', { name: 'A–Z' }));

      const rail = within(screen.getByRole('navigation', { name: 'Compliance queue' }));
      // Grouping survives the sort; only the order inside a group changes.
      expect(rail.getByText('Non-compliant')).toBeInTheDocument();
      expect(rail.getAllByRole('button')).toHaveLength(3);
      expect(screen.getByText('3 members')).toBeInTheDocument();
    });
  });

  describe('export', () => {
    beforeEach(() => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(matrix());
      downloadCsv.mockReset();
      setUrl('');
    });

    it('exports the roster with its standings', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ComplianceMatrixTab />);
      await screen.findByRole('heading', { name: 'Doherty, Sean' });

      await user.click(screen.getByRole('button', { name: /Export CSV/ }));

      expect(downloadCsv).toHaveBeenCalledTimes(1);
      const [contents, filename] = downloadCsv.mock.calls[0] as [string, string];
      expect(filename).toBe('compliance-matrix.csv');
      expect(contents).toContain('Doherty, Sean');
      expect(contents).toContain('Non-compliant');
    });
  });

  describe('degraded payloads', () => {
    it('renders a member row when the server omits every added field', async () => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue({
        generated_at: '2026-09-05T12:00:00Z',
        requirements: [{ id: 'r1', name: 'Company Training Hours' }],
        members: [
          {
            user_id: 'u1',
            member_name: 'Boyle, Devon',
            completion_pct: 0,
            requirements: [
              {
                requirement_id: 'r1',
                requirement_name: 'Company Training Hours',
                status: 'not_started',
              },
            ],
          },
        ],
      });

      renderWithRouter(<ComplianceMatrixTab />);

      expect(await screen.findByRole('heading', { name: 'Boyle, Devon' })).toBeInTheDocument();
      expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
    });

    it('offers a way forward when there are no requirements to evaluate', async () => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue({
        generated_at: '2026-09-05T12:00:00Z',
        requirements: [],
        members: [],
      });

      renderWithRouter(<ComplianceMatrixTab />);

      expect(await screen.findByText('No active training requirements')).toBeInTheDocument();
    });

    it('reports a failed load instead of rendering an empty matrix', async () => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockRejectedValue(new Error('boom'));

      renderWithRouter(<ComplianceMatrixTab />);

      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load compliance matrix');
    });
  });

  describe('an all-clear department', () => {
    it('says nobody is behind rather than showing an empty pane', async () => {
      const clear = matrix();
      clear.members = clear.members.filter((m) => m.standing === 'compliant');
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(clear);
      setUrl('?status=noncompliant');

      renderWithRouter(<ComplianceMatrixTab />);

      expect(await screen.findByText('Nobody is behind')).toBeInTheDocument();
      expect(screen.getByText('Nothing in the queue')).toBeInTheDocument();
    });
  });

  it('waits for the request before drawing a verdict', async () => {
    getComplianceMatrix.mockReset();
    getComplianceMatrix.mockReturnValue(new Promise(() => {}));

    renderWithRouter(<ComplianceMatrixTab />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    // Nothing is asserted about compliance until the request settles.
    expect(screen.queryByRole('navigation', { name: 'Compliance queue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
