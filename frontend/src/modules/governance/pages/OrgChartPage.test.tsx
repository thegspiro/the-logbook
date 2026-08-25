import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithRouter } from '../../../test/utils';
import { OrgChartHolderSource, type OrgChart, type OrgChartNode } from '../types/orgChart';

const mockGetChart = vi.fn();
const mockCreateNode = vi.fn();
const mockUpdateNode = vi.fn();
const mockMoveNode = vi.fn();
const mockDeleteNode = vi.fn();

vi.mock('../services/api', () => ({
  orgChartService: {
    getChart: () => mockGetChart() as unknown,
    createNode: (...args: unknown[]) => mockCreateNode(...args) as unknown,
    updateNode: (...args: unknown[]) => mockUpdateNode(...args) as unknown,
    moveNode: (...args: unknown[]) => mockMoveNode(...args) as unknown,
    deleteNode: (...args: unknown[]) => mockDeleteNode(...args) as unknown,
  },
}));

import OrgChartPage from './OrgChartPage';
import { useOrgChartStore } from '../store/orgChartStore';

const node = (overrides: Partial<OrgChartNode> & Pick<OrgChartNode, 'id' | 'title'>): OrgChartNode => ({
  parentId: null,
  responsibility: null,
  holders: [],
  holderSource: OrgChartHolderSource.MANUAL,
  positionId: null,
  rankCode: null,
  sourceLabel: null,
  contactEmail: null,
  contactPhone: null,
  sortOrder: 0,
  isPublished: true,
  depth: 0,
  ...overrides,
});

const chief = node({
  id: 'chief',
  title: 'Fire Chief',
  holders: [{ userId: 'user-1', name: 'Dana Reyes' }],
  responsibility: 'Overall operational command.',
});
const training = node({
  id: 'training',
  title: 'Training Officer',
  parentId: 'chief',
  depth: 1,
  sortOrder: 0,
  holders: [{ userId: 'user-2', name: 'Sam Okafor' }],
  responsibility: 'Drill scheduling and certification tracking.',
  contactEmail: 'training@department.org',
});
const safety = node({
  id: 'safety',
  title: 'Safety Officer',
  parentId: 'chief',
  depth: 1,
  sortOrder: 1,
});

const chart = (overrides: Partial<OrgChart> = {}): OrgChart => ({
  nodes: [chief, training, safety],
  canManage: false,
  members: [],
  positions: [],
  ranks: [],
  ...overrides,
});

/**
 * `window.matchMedia` is mocked to `matches: false` for the whole suite, so
 * every test below renders the outline — the layout a phone gets. The diagram
 * is exercised by explicitly switching to it, which is also how a desktop
 * reader would get back to the outline.
 */
describe('OrgChartPage', () => {
  beforeEach(() => {
    useOrgChartStore.setState({ chart: null, isLoading: false, isSaving: false, error: null });
    vi.clearAllMocks();
    mockGetChart.mockResolvedValue(chart());
  });

  it('shows every seat with who holds it and what they cover', async () => {
    renderWithRouter(<OrgChartPage />);

    expect(await screen.findByRole('heading', { name: /Fire Chief/i })).toBeInTheDocument();
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Drill scheduling and certification tracking.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /training@department.org/ })).toHaveAttribute(
      'href',
      'mailto:training@department.org'
    );
  });

  it('lists everybody in a seat several people hold', async () => {
    mockGetChart.mockResolvedValue(
      chart({
        nodes: [
          node({
            id: 'trustees',
            title: 'Trustees',
            holders: [
              { userId: null, name: 'Jonathan Green' },
              { userId: 'user-9', name: 'Thomas Martin' },
              { userId: null, name: 'Shelly Hernandez' },
            ],
          }),
        ],
      })
    );
    renderWithRouter(<OrgChartPage />);

    // One box, three names — not three sibling boxes each repeating the
    // trustees' area of responsibility.
    await screen.findByRole('heading', { name: /Trustees/i });
    expect(screen.getByText('Jonathan Green')).toBeInTheDocument();
    expect(screen.getByText('Thomas Martin')).toBeInTheDocument();
    expect(screen.getByText('Shelly Hernandez')).toBeInTheDocument();
  });

  it('says which role a seat follows so its names are not mistaken for a hand-typed list', async () => {
    mockGetChart.mockResolvedValue(
      chart({
        nodes: [
          node({
            id: 'chief',
            title: 'Chief',
            holderSource: OrgChartHolderSource.POSITION,
            positionId: 'pos-chief',
            sourceLabel: 'Fire Chief',
            holders: [{ userId: 'user-1', name: 'Shelly Hernandez' }],
          }),
        ],
      })
    );
    renderWithRouter(<OrgChartPage />);

    await screen.findByRole('heading', { name: /^Chief$/i });
    expect(screen.getByText(/Follows the Fire Chief role/i)).toBeInTheDocument();
    expect(screen.getByText('Shelly Hernandez')).toBeInTheDocument();
  });

  it('marks a seat nobody holds as vacant rather than leaving a blank line', async () => {
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Safety Officer/i });
    expect(screen.getByText('Vacant')).toBeInTheDocument();
  });

  it('draws the chain of command as a diagram when the reader asks for one', async () => {
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Fire Chief/i });

    await userEvent.click(screen.getByRole('button', { name: /Show the chart as a diagram/i }));

    // Every seat is still there, now inside the diagram rather than indented
    // in a flat list. That the boxes are *nested* is the stylesheet's job —
    // what this pins is that switching layout loses nobody.
    const diagram = within(await screen.findByRole('region', { name: /Organizational chart diagram/i }));
    expect(diagram.getByRole('heading', { name: /Fire Chief/i })).toBeInTheDocument();
    expect(diagram.getByRole('heading', { name: /Training Officer/i })).toBeInTheDocument();
    expect(diagram.getByRole('heading', { name: /Safety Officer/i })).toBeInTheDocument();
  });

  it('reorders siblings sideways in the diagram, where a row runs left to right', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockMoveNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Fire Chief/i });

    await userEvent.click(screen.getByRole('button', { name: /Show the chart as a diagram/i }));
    // An up arrow would be pointing at the wrong axis once siblings sit in a row.
    await userEvent.click(await screen.findByRole('button', { name: /Move Safety Officer left/i }));

    await waitFor(() => expect(mockMoveNode).toHaveBeenCalledWith('safety', { parentId: 'chief', position: 0 }));
  });

  it('offers no editing controls to a member who cannot manage the chart', async () => {
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Fire Chief/i });

    expect(screen.queryByRole('button', { name: /Add position/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Fire Chief/i })).not.toBeInTheDocument();
  });

  it('keeps a match visible together with who it reports to', async () => {
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Fire Chief/i });

    await userEvent.type(screen.getByLabelText(/Search the organizational chart/i), 'drill');

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Safety Officer/i })).not.toBeInTheDocument();
    });
    // The ancestor comes along: a bare list of matches would show a position
    // with no indication of where it sits in the chain of command.
    expect(screen.getByRole('heading', { name: /Fire Chief/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Training Officer/i })).toBeInTheDocument();
  });

  it('finds a seat by the name of whoever holds it', async () => {
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Fire Chief/i });

    await userEvent.type(screen.getByLabelText(/Search the organizational chart/i), 'okafor');

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Safety Officer/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /Training Officer/i })).toBeInTheDocument();
  });

  it('tells a member with no chart to ask an officer, and an officer how to start one', async () => {
    mockGetChart.mockResolvedValue(chart({ nodes: [] }));
    const { unmount } = renderWithRouter(<OrgChartPage />);
    expect(await screen.findByText(/has not published its organizational chart/i)).toBeInTheDocument();
    unmount();

    useOrgChartStore.setState({ chart: null, isLoading: false, isSaving: false, error: null });
    mockGetChart.mockResolvedValue(chart({ nodes: [], canManage: true }));
    renderWithRouter(<OrgChartPage />);
    expect(await screen.findByRole('button', { name: /Add the first position/i })).toBeInTheDocument();
  });

  it('sends every field the form owns on a save so a cleared box persists', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true, members: [{ id: 'user-2', name: 'Sam Okafor' }] }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Training Officer/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    // Update payloads are read with `exclude_unset`, so an omitted key means
    // "leave it alone" — a cleared box has to travel as null or the old value
    // survives behind a success toast.
    expect(mockUpdateNode).toHaveBeenCalledWith('training', {
      title: 'Training Officer',
      responsibility: 'Drill scheduling and certification tracking.',
      contactEmail: 'training@department.org',
      contactPhone: null,
      isPublished: true,
      holderSource: 'manual',
      positionId: null,
      rankCode: null,
      holders: [{ userId: 'user-2', displayName: undefined }],
    });
  });

  it('empties a seat with an empty holder list rather than by omitting the key', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true, members: [{ id: 'user-2', name: 'Sam Okafor' }] }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Training Officer/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Remove person 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    expect(mockUpdateNode).toHaveBeenCalledWith('training', expect.objectContaining({ holders: [] }));
  });

  it('omits blanks when adding a position so an empty string never reaches the API', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockCreateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^Add position$/i }));
    await userEvent.type(await screen.findByLabelText(/Position title/i), 'Quartermaster');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockCreateNode).toHaveBeenCalled());
    expect(mockCreateNode).toHaveBeenCalledWith({
      title: 'Quartermaster',
      parentId: undefined,
      responsibility: undefined,
      contactEmail: undefined,
      contactPhone: undefined,
      isPublished: true,
      holderSource: 'manual',
      positionId: undefined,
      rankCode: undefined,
      holders: [],
    });
  });

  it('adds a report under the position whose button was pressed', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockCreateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Add a position reporting to Fire Chief/i }));
    expect(await screen.findByLabelText(/Reports to/i)).toHaveValue('chief');

    await userEvent.type(screen.getByLabelText(/Position title/i), 'Deputy Chief');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockCreateNode).toHaveBeenCalled());
    expect(mockCreateNode).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'chief' }));
  });

  it('lets a position be added straight to the top of the chart', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockCreateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^Add position$/i }));
    expect(await screen.findByLabelText(/Reports to/i)).toHaveValue('');

    await userEvent.type(screen.getByLabelText(/Position title/i), 'Board of Directors');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockCreateNode).toHaveBeenCalled());
    expect(mockCreateNode).toHaveBeenCalledWith(expect.objectContaining({ parentId: undefined }));
  });

  it('moves a position onto a different reporting line when it is re-parented', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    mockMoveNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/Reports to/i), 'training');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    // Two calls, not one: /move renumbers the siblings the seat lands among,
    // which a field update has no business doing.
    await waitFor(() => expect(mockMoveNode).toHaveBeenCalled());
    expect(mockMoveNode).toHaveBeenCalledWith('safety', { parentId: 'training', position: 0 });
  });

  it('does not move a position whose reporting line was left alone', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    expect(mockMoveNode).not.toHaveBeenCalled();
  });

  it('promotes a position to the top of the chart', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    mockMoveNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Training Officer/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/Reports to/i), '');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockMoveNode).toHaveBeenCalled());
    // One root already exists, so the promoted seat lands after it.
    expect(mockMoveNode).toHaveBeenCalledWith('training', { parentId: null, position: 1 });
  });

  it('keeps a position out of its own reporting-line list', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Fire Chief/i }));
    const reportsTo = await screen.findByLabelText(/Reports to/i);

    // Offering a choice the server will refuse is a worse answer than not
    // offering it: the Chief cannot report to itself or to its own reports.
    const options = within(reportsTo)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options.some((label) => label?.includes('Fire Chief'))).toBe(false);
    expect(options.some((label) => label?.includes('Training Officer'))).toBe(false);
    expect(options[0]).toMatch(/Top of the chart/i);
  });

  it('records a holder who has no account here', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Add a person/i }));
    await userEvent.type(await screen.findByLabelText(/Their name/i), 'Rev. J. Alvarez');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    expect(mockUpdateNode).toHaveBeenCalledWith(
      'safety',
      expect.objectContaining({
        holders: [{ userId: undefined, displayName: 'Rev. J. Alvarez' }],
      })
    );
  });

  it('lists several people in one position rather than making the admin add sibling boxes', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true, members: [{ id: 'user-3', name: 'Thomas Martin' }] }));
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Add a person/i }));
    await userEvent.type(await screen.findByLabelText(/Their name/i), 'Jonathan Green');
    await userEvent.click(screen.getByRole('button', { name: /Add a person/i }));
    await userEvent.selectOptions(await screen.findByLabelText('Person 2'), 'user-3');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    expect(mockUpdateNode).toHaveBeenCalledWith(
      'safety',
      expect.objectContaining({
        holders: [
          { userId: undefined, displayName: 'Jonathan Green' },
          { userId: 'user-3', displayName: undefined },
        ],
      })
    );
  });

  it('points a seat at a role so it follows whoever holds it', async () => {
    mockGetChart.mockResolvedValue(
      chart({
        canManage: true,
        positions: [{ id: 'pos-chief', name: 'Fire Chief', holderCount: 1 }],
      })
    );
    mockUpdateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/Who holds it/i), 'position');
    await userEvent.selectOptions(await screen.findByLabelText(/Which role/i), 'pos-chief');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockUpdateNode).toHaveBeenCalled());
    expect(mockUpdateNode).toHaveBeenCalledWith(
      'safety',
      expect.objectContaining({ holderSource: 'position', positionId: 'pos-chief', rankCode: null })
    );
  });

  it('says how many members hold a role before the seat is pointed at it', async () => {
    mockGetChart.mockResolvedValue(
      chart({
        canManage: true,
        positions: [{ id: 'pos-empty', name: 'Zamboni Driver', holderCount: 0 }],
      })
    );
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/Who holds it/i), 'position');

    // A role nobody holds shows the seat as vacant, which is accurate — but
    // worth knowing before saving rather than after.
    expect(await screen.findByRole('option', { name: /Zamboni Driver \(0 members\)/i })).toBeInTheDocument();
  });

  it('refuses to save a seat that follows a role without saying which one', async () => {
    mockGetChart.mockResolvedValue(
      chart({ canManage: true, positions: [{ id: 'pos-chief', name: 'Fire Chief', holderCount: 1 }] })
    );
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Safety Officer/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/Who holds it/i), 'position');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose the role/i);
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  it('does not seed a role-sourced seat with the roster it happens to resolve to', async () => {
    mockGetChart.mockResolvedValue(
      chart({
        canManage: true,
        positions: [{ id: 'pos-chief', name: 'Fire Chief', holderCount: 1 }],
        nodes: [
          node({
            id: 'chief',
            title: 'Chief',
            holderSource: OrgChartHolderSource.POSITION,
            positionId: 'pos-chief',
            sourceLabel: 'Fire Chief',
            holders: [{ userId: 'user-1', name: 'Shelly Hernandez' }],
          }),
        ],
      })
    );
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Edit Chief/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/Who holds it/i), 'manual');

    // Seeding the current holders in would turn "follows the Fire Chief role"
    // into a snapshot of it the moment somebody switched back to a typed list.
    expect(screen.queryByDisplayValue('Shelly Hernandez')).not.toBeInTheDocument();
    expect(screen.getByText(/Nobody yet/i)).toBeInTheDocument();
  });

  it('says how many reports a removal will promote before it happens', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockDeleteNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Remove Fire Chief/i }));

    expect(await screen.findByText(/2 positions reporting to Fire Chief will move up/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Remove it/i }));
    await waitFor(() => expect(mockDeleteNode).toHaveBeenCalledWith('chief'));
  });

  it('does not remove a position when the confirmation is declined', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Remove Safety Officer/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Keep it/i }));

    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  it('nudges a seat by its index among its own siblings', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockMoveNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Move Safety Officer up/i }));

    await waitFor(() => expect(mockMoveNode).toHaveBeenCalledWith('safety', { parentId: 'chief', position: 0 }));
  });

  it('disables the nudge at each end of a sibling run', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    expect(await screen.findByRole('button', { name: /Move Training Officer up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Move Safety Officer down/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Move Safety Officer up/i })).toBeEnabled();
  });

  it('labels a seat the membership cannot see', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true, nodes: [chief, { ...training, isPublished: false }] }));
    renderWithRouter(<OrgChartPage />);

    expect(await screen.findByText('Hidden')).toBeInTheDocument();
  });
});
