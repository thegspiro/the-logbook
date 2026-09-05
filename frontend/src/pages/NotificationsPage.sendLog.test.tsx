/**
 * The Send Log tab, once it stopped being an organization-wide view.
 *
 * `GET /notifications/logs` used to filter on `organization_id` alone, so the
 * tab listed the subject, body and recipient address of every notification the
 * department had sent anyone. It now defaults to `scope=mine` and the tab asks
 * for nothing else, which makes it the caller's own delivery history — email
 * as well as in-app, with delivery status.
 *
 * "Mark all as read" moved with it: it writes `scope=mine`, and because the
 * caller's own rows include their in-app notifications, it has to reconcile
 * the inbox tab and the global unread badge in the same breath. Leaving those
 * alone showed one notification read on this tab and unread on the next.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';
import { NotificationLogScope } from '../constants/enums';

vi.mock('../services/api', () => ({
  notificationsService: {
    getRules: vi.fn(),
    getSummary: vi.fn(),
    getLogs: vi.fn(),
    markAllLogsRead: vi.fn(),
    getMyNotifications: vi.fn(),
  },
}));

const clearGlobalUnread = vi.fn();

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => false }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 1, decrement: vi.fn(), clear: clearGlobalUnread }),
}));

vi.mock('../components/NotificationCard', () => ({ default: () => null }));

const emailLog = {
  id: 'log-1',
  organization_id: 'org-1',
  channel: 'email',
  subject: 'Drill on Thursday',
  message: 'Bring turnout gear.',
  recipient_email: 'me@example.test',
  recipient_name: 'Me',
  delivered: true,
  read: false,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
};

const emptyPage = { logs: [] as (typeof emailLog)[], total: 0, skip: 0, limit: 50 };

const renderLogTab = () =>
  render(
    <MemoryRouter initialEntries={['/notifications?tab=log']}>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.mocked(notificationsService.getLogs).mockReset();
  vi.mocked(notificationsService.getLogs).mockResolvedValue({
    logs: [emailLog],
    total: 1,
    skip: 0,
    limit: 50,
  });
  vi.mocked(notificationsService.markAllLogsRead).mockReset();
  vi.mocked(notificationsService.markAllLogsRead).mockResolvedValue({ marked_read: 1 });
  vi.mocked(notificationsService.getMyNotifications).mockReset();
  vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({
    logs: [],
    total: 0,
    skip: 0,
    limit: 20,
  });
  vi.mocked(notificationsService.getRules).mockReset();
  vi.mocked(notificationsService.getSummary).mockReset();
  clearGlobalUnread.mockReset();
});

describe('NotificationsPage send log', () => {
  it('requests the caller-scoped log for a user holding no permission', async () => {
    renderLogTab();

    await waitFor(() => expect(notificationsService.getLogs).toHaveBeenCalled());
    expect(notificationsService.getLogs).toHaveBeenCalledWith({
      scope: NotificationLogScope.MINE,
      skip: 0,
      limit: 50,
    });
    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();
  });

  it('marks the caller-scoped logs read and reconciles the unread badge', async () => {
    const user = userEvent.setup();
    renderLogTab();

    const button = await screen.findByRole('button', { name: /mark all as read/i });
    await user.click(button);

    await waitFor(() =>
      expect(notificationsService.markAllLogsRead).toHaveBeenCalledWith({ scope: NotificationLogScope.MINE })
    );
    // Same rows, so the same read state has to land on the inbox tab's count.
    await waitFor(() => expect(clearGlobalUnread).toHaveBeenCalled());
  });

  it('holds a loading state rather than claiming the log is empty', async () => {
    // The page-level skeleton is unreachable here: for a member without
    // notifications.view the permission effect sets `loading` false
    // synchronously, so the page renders while this request is still in
    // flight. Without a flag of its own the tab announced "No Notifications
    // Found" about a log it had not fetched yet.
    let release!: (value: { logs: typeof emptyPage.logs; total: number; skip: number; limit: number }) => void;
    vi.mocked(notificationsService.getLogs).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    renderLogTab();

    // The tab is on screen — this is not a page still behind its skeleton.
    await screen.findByRole('tab', { name: /send log/i });
    expect(screen.queryByText('No Notifications Found')).toBeNull();

    release({ logs: [emailLog], total: 1, skip: 0, limit: 50 });

    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();
  });

  it('shows the empty state once an empty log has actually arrived', async () => {
    vi.mocked(notificationsService.getLogs).mockResolvedValue(emptyPage);

    renderLogTab();

    expect(await screen.findByText('No Notifications Found')).toBeInTheDocument();
  });

  it('keeps a send-log failure out of the inbox it did not affect', async () => {
    // The log is prefetched on mount for a tab the member may never open. Its
    // failure used to write the page-wide `error`, which renders above every
    // tab, so a working inbox was captioned with a send-log failure.
    vi.mocked(notificationsService.getLogs).mockRejectedValue(new Error('log fetch exploded'));

    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <ConfirmProvider>
          <NotificationsPage />
        </ConfirmProvider>
      </MemoryRouter>
    );

    await screen.findByRole('tab', { name: /my notifications/i });
    await waitFor(() => expect(notificationsService.getLogs).toHaveBeenCalled());
    expect(screen.queryByText(/log fetch exploded/i)).toBeNull();
  });

  it('reports that failure on the Send Log itself', async () => {
    vi.mocked(notificationsService.getLogs).mockRejectedValue(new Error('log fetch exploded'));

    renderLogTab();

    expect(await screen.findByText(/log fetch exploded/i)).toBeInTheDocument();
  });

  it('offers the rest of a history longer than one page', async () => {
    // The fetch takes the newest page and the tab claims to show every
    // notification sent to the member, so the remainder needs a way in.
    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [emailLog],
      total: 3,
      skip: 0,
      limit: 50,
    });

    renderLogTab();

    const more = await screen.findByRole('button', { name: /load more \(2 remaining\)/i });

    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [{ ...emailLog, id: 'log-2', subject: 'Hydrant testing' }],
      total: 3,
      skip: 1,
      limit: 50,
    });
    await userEvent.setup().click(more);

    expect(await screen.findByText('Hydrant testing')).toBeInTheDocument();
    // Appended, not replaced.
    expect(screen.getByText('Drill on Thursday')).toBeInTheDocument();
    expect(notificationsService.getLogs).toHaveBeenLastCalledWith({
      scope: NotificationLogScope.MINE,
      skip: 1,
      limit: 50,
    });
  });

  it('asks the server for the selected channel rather than filtering a page', async () => {
    // Filtering the loaded prefix made the panel claim "No email
    // notifications sent to you" whenever the newest page held none, however
    // many older ones existed, and left the total counting a different set
    // than the list above it.
    const user = userEvent.setup();
    renderLogTab();
    await screen.findByText('Drill on Thursday');

    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [{ ...emailLog, id: 'log-9', subject: 'Roster posted', channel: 'in_app' }],
      total: 1,
      skip: 0,
      limit: 50,
    });
    await user.click(screen.getByRole('button', { name: 'In-App' }));

    expect(await screen.findByText('Roster posted')).toBeInTheDocument();
    expect(notificationsService.getLogs).toHaveBeenLastCalledWith({
      scope: NotificationLogScope.MINE,
      channel: 'in_app',
      skip: 0,
      limit: 50,
    });
  });

  it('does not re-render a row a newer notification shifted into the next page', async () => {
    // The list is newest-first and `skip` is an offset, so a notification
    // arriving between the two requests pushes a loaded row into the next
    // page's range and it comes back a second time.
    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [emailLog],
      total: 3,
      skip: 0,
      limit: 50,
    });
    renderLogTab();

    const more = await screen.findByRole('button', { name: /load more/i });
    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [emailLog, { ...emailLog, id: 'log-3', subject: 'Hydrant testing' }],
      total: 3,
      skip: 1,
      limit: 50,
    });
    await userEvent.setup().click(more);

    await screen.findByText('Hydrant testing');
    expect(screen.getAllByText('Drill on Thursday')).toHaveLength(1);
  });

  it('ignores a superseded channel fetch that resolves late', async () => {
    // Each pill change starts a request; they can resolve in any order. An
    // older one landing last put the previous channel's rows and total under
    // the newly selected pill.
    const user = userEvent.setup();
    renderLogTab();
    await screen.findByText('Drill on Thursday');

    let releaseEmail!: (value: { logs: (typeof emailLog)[]; total: number; skip: number; limit: number }) => void;
    vi.mocked(notificationsService.getLogs).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseEmail = resolve;
      })
    );
    await user.click(screen.getByRole('button', { name: 'Email' }));

    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [{ ...emailLog, id: 'log-app', subject: 'Roster posted', channel: 'in_app' }],
      total: 1,
      skip: 0,
      limit: 50,
    });
    await user.click(screen.getByRole('button', { name: 'In-App' }));
    expect(await screen.findByText('Roster posted')).toBeInTheDocument();

    // The Email request now finishes, after the In-App one it lost to. Flush
    // it before asserting, or the assertion passes on the tick before it
    // could have landed and proves nothing.
    await act(async () => {
      releaseEmail({
        logs: [{ ...emailLog, id: 'log-mail', subject: 'Stale email row' }],
        total: 9,
        skip: 0,
        limit: 50,
      });
    });

    expect(screen.queryByText('Stale email row')).toBeNull();
    expect(screen.getByText('Roster posted')).toBeInTheDocument();
  });

  it('advances paging by rows the server gave, not rows it kept', async () => {
    // A page that re-serves an already-loaded row still consumed that offset.
    // Deriving the next skip from the deduplicated length asked for the same
    // row again and left Load more on screen forever.
    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [emailLog],
      total: 4,
      skip: 0,
      limit: 50,
    });
    renderLogTab();

    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: /load more/i });
    // The second page re-serves the first row and adds two.
    vi.mocked(notificationsService.getLogs).mockResolvedValueOnce({
      logs: [
        emailLog,
        { ...emailLog, id: 'log-4', subject: 'Ladder drill' },
        { ...emailLog, id: 'log-5', subject: 'Pump test' },
      ],
      total: 4,
      skip: 1,
      limit: 50,
    });
    await user.click(more);

    await screen.findByText('Pump test');
    // Four rows consumed against a total of four: nothing left to fetch, even
    // though the duplicate leaves only three on screen. Counting the retained
    // three against the total kept the button up and re-requested an offset
    // whose rows were already held.
    await waitFor(() => expect(screen.queryByRole('button', { name: /load more/i })).toBeNull());
  });

  it('does not leave the previous channel on screen when a filtered fetch fails', async () => {
    const user = userEvent.setup();
    renderLogTab();
    await screen.findByText('Drill on Thursday');

    vi.mocked(notificationsService.getLogs).mockRejectedValueOnce(new Error('channel fetch failed'));
    await user.click(screen.getByRole('button', { name: 'In-App' }));

    expect(await screen.findByText(/channel fetch failed/i)).toBeInTheDocument();
    // The email row belonged to the previous selection, not this one.
    expect(screen.queryByText('Drill on Thursday')).toBeNull();
  });

  it('does not offer Load more when the page is the whole history', async () => {
    renderLogTab();

    await screen.findByText('Drill on Thursday');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('does not show organization-wide statistics above a caller-scoped log', async () => {
    // `GET /notifications/summary` counts the whole department's sends. Above
    // a log listing only the caller's, those numbers read as a tally of it.
    renderLogTab();

    await screen.findByText('Drill on Thursday');
    expect(screen.queryByRole('region', { name: /notification statistics/i })).toBeNull();
  });
});
