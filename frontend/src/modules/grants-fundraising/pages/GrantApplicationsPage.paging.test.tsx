/**
 * The applications page pages through the server (GF-33) and opens a
 * dashboard card's status group (GF-27a).
 *
 * It used to fetch 1,000 applications once and silently drop the rest, and a
 * KPI card counting two or five statuses linked to a list of one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { GrantApplication, GrantApplicationQuery } from '../types';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const listApplicationsPage = vi.fn();
vi.mock('../services/api', () => ({
  grantsService: {
    listApplicationsPage: (...args: unknown[]) => listApplicationsPage(...args) as unknown,
  },
}));

import GrantApplicationsPage from './GrantApplicationsPage';

function app(n: number, status = 'submitted'): GrantApplication {
  return {
    id: `app-${n}`,
    grantProgramName: `Program ${n}`,
    grantAgency: 'FEMA',
    applicationStatus: status,
    priority: 'medium',
  } as unknown as GrantApplication;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <GrantApplicationsPage />
    </MemoryRouter>
  );
}

function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

function callsFor(status: string): GrantApplicationQuery[] {
  return listApplicationsPage.mock.calls
    .map((call) => call[0] as GrantApplicationQuery)
    .filter((q) => q.status === status);
}

describe('GrantApplicationsPage paging and grouped filters', () => {
  beforeEach(() => {
    listApplicationsPage.mockReset();
    listApplicationsPage.mockResolvedValue({ items: [], total: 0 });
  });

  it('opens a dashboard group: every column asks for its status within the group', async () => {
    renderAt('/grants/applications?group=active');

    await waitFor(() => expect(callsFor('closed')).toHaveLength(1));
    for (const status of ['active', 'reporting', 'submitted', 'closed']) {
      expect(callsFor(status)[0]).toMatchObject({ status, statusGroup: 'active', skip: 0 });
    }
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('group:active');
  });

  it('a single-status link only fetches that column', async () => {
    renderAt('/grants/applications?status=submitted');

    await waitFor(() => expect(callsFor('submitted')).toHaveLength(1));
    expect(listApplicationsPage).toHaveBeenCalledTimes(1);
  });

  it('a pipeline column shows the server total and pages with Show more', async () => {
    listApplicationsPage.mockImplementation((q: GrantApplicationQuery) =>
      Promise.resolve(
        q.status === 'submitted'
          ? {
              items: Array.from({ length: q.skip === 0 ? 25 : 5 }, (_, i) => app((q.skip ?? 0) + i)),
              total: 30,
            }
          : { items: [], total: 0 }
      )
    );
    renderAt('/grants/applications');

    await waitFor(() => expect(screen.getByTestId('column-total-submitted')).toHaveTextContent('30'));
    expect(screen.getByText('Program 24')).toBeInTheDocument();
    expect(screen.queryByText('Program 25')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more (5 more)' }));

    expect(await screen.findByText('Program 29')).toBeInTheDocument();
    expect(callsFor('submitted')[1]).toMatchObject({ skip: 25, limit: 25 });
    expect(screen.getByText('Program 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });

  it('the table pages and sorts on the server', async () => {
    listApplicationsPage.mockImplementation((q: GrantApplicationQuery) =>
      Promise.resolve({
        items: Array.from({ length: q.status ? 0 : 25 }, (_, i) => app((q.skip ?? 0) + i)),
        total: q.status ? 0 : 60,
      })
    );
    renderAt('/grants/applications');
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));

    expect(await screen.findByText('Program 0')).toBeInTheDocument();
    const tableCall = () =>
      listApplicationsPage.mock.calls.map((c) => c[0] as GrantApplicationQuery).filter((q) => !q.status);
    expect(last(tableCall())).toMatchObject({ sort: 'applicationDeadline', order: 'asc', skip: 0, limit: 25 });

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(last(tableCall())).toMatchObject({ skip: 25 }));

    const table = screen.getByRole('table');
    await userEvent.click(within(table).getByRole('button', { name: /amount requested/i }));
    await waitFor(() => expect(last(tableCall())).toMatchObject({ sort: 'amountRequested', order: 'asc', skip: 0 }));
  });

  it('search goes to the server', async () => {
    renderAt('/grants/applications?status=denied');
    await waitFor(() => expect(callsFor('denied')).toHaveLength(1));

    await userEvent.type(screen.getByRole('textbox', { name: /search by program or agency/i }), 'safer');

    await waitFor(() => expect(last(callsFor('denied'))).toMatchObject({ search: 'safer' }));
  });
});
