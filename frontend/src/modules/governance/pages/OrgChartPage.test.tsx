import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithRouter } from '../../../test/utils';
import type { OrgChart, OrgChartNode } from '../types/orgChart';

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
  userId: null,
  holderName: null,
  displayName: null,
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
  holderName: 'Dana Reyes',
  responsibility: 'Overall operational command.',
});
const training = node({
  id: 'training',
  title: 'Training Officer',
  parentId: 'chief',
  depth: 1,
  sortOrder: 0,
  holderName: 'Sam Okafor',
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
  ...overrides,
});

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

  it('marks a seat nobody holds as vacant rather than leaving a blank line', async () => {
    renderWithRouter(<OrgChartPage />);
    await screen.findByRole('heading', { name: /Safety Officer/i });
    expect(screen.getByText('Vacant')).toBeInTheDocument();
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
    mockGetChart.mockResolvedValue({ nodes: [], canManage: false, members: [] });
    const { unmount } = renderWithRouter(<OrgChartPage />);
    expect(await screen.findByText(/has not published its organizational chart/i)).toBeInTheDocument();
    unmount();

    useOrgChartStore.setState({ chart: null, isLoading: false, isSaving: false, error: null });
    mockGetChart.mockResolvedValue({ nodes: [], canManage: true, members: [] });
    renderWithRouter(<OrgChartPage />);
    expect(await screen.findByRole('button', { name: /Add the first position/i })).toBeInTheDocument();
  });

  it('sends an emptied field as an explicit null so clearing a holder persists', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true, members: [{ id: 'user-1', name: 'Dana Reyes' }] }));
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
      userId: null,
      displayName: null,
      responsibility: 'Drill scheduling and certification tracking.',
      contactEmail: 'training@department.org',
      contactPhone: null,
      isPublished: true,
    });
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
      userId: undefined,
      displayName: undefined,
      responsibility: undefined,
      contactEmail: undefined,
      contactPhone: undefined,
      isPublished: true,
    });
  });

  it('adds a report under the position whose button was pressed', async () => {
    mockGetChart.mockResolvedValue(chart({ canManage: true }));
    mockCreateNode.mockResolvedValue(chart({ canManage: true }));
    renderWithRouter(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Add a position reporting to Fire Chief/i }));
    expect(await screen.findByText(/This position will report to Fire Chief/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Position title/i), 'Deputy Chief');
    await userEvent.click(screen.getByRole('button', { name: /Save position/i }));

    await waitFor(() => expect(mockCreateNode).toHaveBeenCalled());
    expect(mockCreateNode).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'chief' }));
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
