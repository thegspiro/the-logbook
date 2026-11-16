import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../../../test/utils';
import { OutsideApparatusSettings } from './OutsideApparatusSettings';
import type { ExternalAgency } from '../services/api';

const mockList = vi.fn();
const mockCreateAgency = vi.fn();
const mockUpdateAgency = vi.fn();
const mockDeleteAgency = vi.fn();
const mockCreateUnit = vi.fn();
const mockUpdateUnit = vi.fn();
const mockDeleteUnit = vi.fn();
const mockMerge = vi.fn();

vi.mock('../services/api', () => ({
  schedulingService: {
    getExternalAgencies: (...args: unknown[]) => mockList(...args) as unknown,
    createExternalAgency: (...args: unknown[]) => mockCreateAgency(...args) as unknown,
    updateExternalAgency: (...args: unknown[]) => mockUpdateAgency(...args) as unknown,
    deleteExternalAgency: (...args: unknown[]) => mockDeleteAgency(...args) as unknown,
    createExternalApparatus: (...args: unknown[]) => mockCreateUnit(...args) as unknown,
    updateExternalApparatus: (...args: unknown[]) => mockUpdateUnit(...args) as unknown,
    deleteExternalApparatus: (...args: unknown[]) => mockDeleteUnit(...args) as unknown,
    mergeExternalAgency: (...args: unknown[]) => mockMerge(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const agencies: ExternalAgency[] = [
  {
    id: 'a1',
    name: 'Township Fire Company',
    is_active: true,
    evaluate_shifts: false,
    apparatus: [{ id: 'u1', agency_id: 'a1', name: 'Engine 42', apparatus_type: 'engine', is_active: true }],
  },
];

describe('OutsideApparatusSettings', () => {
  beforeEach(() => {
    for (const mock of [
      mockList,
      mockCreateAgency,
      mockUpdateAgency,
      mockDeleteAgency,
      mockCreateUnit,
      mockUpdateUnit,
      mockDeleteUnit,
    ]) {
      mock.mockReset();
    }
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockList.mockResolvedValue({ agencies });
    mockCreateAgency.mockResolvedValue({ ...agencies[0], id: 'a2' });
    mockUpdateAgency.mockResolvedValue(agencies[0]);
    mockDeleteAgency.mockResolvedValue(undefined);
    mockCreateUnit.mockResolvedValue(agencies[0]?.apparatus[0]);
    mockUpdateUnit.mockResolvedValue(agencies[0]?.apparatus[0]);
    mockDeleteUnit.mockResolvedValue(undefined);
  });

  it('lists departments with their apparatus', async () => {
    renderWithRouter(<OutsideApparatusSettings />);

    const section = await screen.findByRole('region', { name: 'Township Fire Company' });
    expect(within(section).getByText('Engine 42')).toBeInTheDocument();
    expect(within(section).getByText('· engine')).toBeInTheDocument();
  });

  it('adds a department', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.type(await screen.findByLabelText('Add a department'), '  County Rescue ');
    await user.click(screen.getByRole('button', { name: 'Add department' }));

    await waitFor(() => expect(mockCreateAgency).toHaveBeenCalledWith({ name: 'County Rescue' }));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('adds apparatus under a department, leaving a blank type out', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    const section = await screen.findByRole('region', { name: 'Township Fire Company' });
    await user.type(within(section).getByLabelText('Add apparatus'), 'Tower 7');
    await user.click(within(section).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(mockCreateUnit).toHaveBeenCalledWith('a1', { name: 'Tower 7', apparatus_type: undefined })
    );
  });

  it('turns a unit off rather than deleting it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.click(await screen.findByRole('switch', { name: 'Offer Engine 42 to members' }));

    await waitFor(() => expect(mockUpdateUnit).toHaveBeenCalledWith('u1', { is_active: false }));
  });

  it('explains a refused delete of a unit shifts were logged on', async () => {
    mockDeleteUnit.mockRejectedValue(
      Object.assign(new Error('in use'), { isAxiosError: true, response: { status: 409, data: { detail: 'in use' } } })
    );
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.click(await screen.findByRole('button', { name: 'Delete Engine 42' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Engine 42?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete apparatus' }));

    await waitFor(() => expect(mockDeleteUnit).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Turn it off')));
  });

  it('renames a department', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.click(await screen.findByRole('button', { name: 'Rename Township Fire Company' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename department' });
    const field = within(dialog).getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Township FD');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(mockUpdateAgency).toHaveBeenCalledWith('a1', { name: 'Township FD' }));
  });

  it('says members cannot log outside shifts until a department is added', async () => {
    mockList.mockResolvedValue({ agencies: [] });
    renderWithRouter(<OutsideApparatusSettings />);

    expect(await screen.findByText(/members can't log shifts with other departments/)).toBeInTheDocument();
  });

  it('turns shift evaluations on for a department', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    const toggle = await screen.findByRole('checkbox', { name: /Evaluate shifts on/ });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    await waitFor(() => expect(mockUpdateAgency).toHaveBeenCalledWith('a1', { evaluate_shifts: true }));
  });
});

const county: ExternalAgency = {
  id: 'a-county',
  name: 'Arlington County',
  is_active: true,
  evaluate_shifts: true,
  apparatus: [
    { id: 'u-fas', agency_id: 'a-county', name: 'FAS', apparatus_type: null, is_active: true },
    { id: 'u-a106-dup', agency_id: 'a-county', name: 'a106', apparatus_type: null, is_active: true },
  ],
};
const countyFd: ExternalAgency = {
  id: 'a-county-fd',
  name: 'Arlington County Fire Department',
  is_active: true,
  evaluate_shifts: false,
  apparatus: [{ id: 'u-a106', agency_id: 'a-county-fd', name: 'A106', apparatus_type: null, is_active: true }],
};

describe('OutsideApparatusSettings: merging two spellings of one department', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockMerge.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockList.mockResolvedValue({ agencies: [county, countyFd] });
    mockMerge.mockResolvedValue({
      agency: countyFd,
      moved_apparatus: 1,
      combined_apparatus: 1,
      relabelled_shifts: 12,
    });
  });

  const openMerge = async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);
    await user.click(await screen.findByRole('button', { name: 'Merge Arlington County into another department' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge Arlington County' });
    return { user, dialog };
  };

  it('offers no merge while there is only one department', async () => {
    mockList.mockResolvedValue({ agencies });
    renderWithRouter(<OutsideApparatusSettings />);

    await screen.findByRole('region', { name: 'Township Fire Company' });
    expect(screen.queryByRole('button', { name: /^Merge / })).not.toBeInTheDocument();
  });

  it('says what will happen before anything does, and needs a department chosen', async () => {
    const { user, dialog } = await openMerge();

    const mergeButton = within(dialog).getByRole('button', { name: 'Merge departments' });
    expect(mergeButton).toBeDisabled();
    // Only the other department is offered as the one to keep.
    const select = within(dialog).getByLabelText('Merge into');
    expect(within(select).queryByRole('option', { name: 'Arlington County' })).not.toBeInTheDocument();

    await user.selectOptions(select, 'a-county-fd');

    expect(dialog).toHaveTextContent('1 apparatus moves to Arlington County Fire Department.');
    expect(dialog).toHaveTextContent('a106 is already listed there, so it is combined into one.');
    expect(dialog).toHaveTextContent(
      'Every shift logged with Arlington County will show Arlington County Fire Department instead'
    );
    expect(dialog).toHaveTextContent('Arlington County Fire Department does not evaluate shifts');
    expect(dialog).toHaveTextContent('cannot be undone');
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mergeButton).toBeEnabled();
  });

  it('previews a unit spelled with an accent on one side as combined, as the server will', async () => {
    mockList.mockResolvedValue({
      agencies: [
        {
          ...county,
          apparatus: [{ id: 'u-cafe', agency_id: 'a-county', name: 'Cafe', apparatus_type: null, is_active: true }],
        },
        {
          ...countyFd,
          apparatus: [
            { id: 'u-cafe-fd', agency_id: 'a-county-fd', name: 'Café', apparatus_type: null, is_active: true },
          ],
        },
      ],
    });
    const { user, dialog } = await openMerge();

    await user.selectOptions(within(dialog).getByLabelText('Merge into'), 'a-county-fd');

    expect(dialog).toHaveTextContent('Cafe is already listed there, so it is combined into one.');
    expect(dialog).not.toHaveTextContent('apparatus moves');
  });

  it('says when merging into a hidden department hides the moved apparatus from members', async () => {
    mockList.mockResolvedValue({ agencies: [county, { ...countyFd, is_active: false }] });
    const { user, dialog } = await openMerge();

    const select = within(dialog).getByLabelText('Merge into');
    expect(
      within(select).getByRole('option', { name: 'Arlington County Fire Department (hidden from members)' })
    ).toBeInTheDocument();
    await user.selectOptions(select, 'a-county-fd');

    expect(dialog).toHaveTextContent(
      "Arlington County Fire Department is hidden from members, so Arlington County's apparatus will be hidden from them too."
    );
  });

  it('says when merging a hidden department into an offered one makes its apparatus available', async () => {
    mockList.mockResolvedValue({ agencies: [{ ...county, is_active: false }, countyFd] });
    const { user, dialog } = await openMerge();

    await user.selectOptions(within(dialog).getByLabelText('Merge into'), 'a-county-fd');

    expect(dialog).toHaveTextContent(
      "Arlington County Fire Department is offered to members, so Arlington County's apparatus that are switched on become available to them."
    );
  });

  it('says nothing about visibility when both departments match', async () => {
    const { user, dialog } = await openMerge();

    await user.selectOptions(within(dialog).getByLabelText('Merge into'), 'a-county-fd');

    expect(dialog).not.toHaveTextContent('from members');
  });

  it('merges into the chosen department and reports what moved', async () => {
    const { user, dialog } = await openMerge();

    await user.selectOptions(within(dialog).getByLabelText('Merge into'), 'a-county-fd');
    await user.click(within(dialog).getByRole('button', { name: 'Merge departments' }));

    await waitFor(() => expect(mockMerge).toHaveBeenCalledWith('a-county', 'a-county-fd'));
    expect(toast.success).toHaveBeenCalledWith(
      'Arlington County merged into Arlington County Fire Department: 1 apparatus moved, 1 combined, 12 shifts relabelled'
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('keeps the dialog open and says so when the merge fails', async () => {
    mockMerge.mockRejectedValue(new Error('Choose a different department to merge into'));
    const { user, dialog } = await openMerge();

    await user.selectOptions(within(dialog).getByLabelText('Merge into'), 'a-county-fd');
    await user.click(within(dialog).getByRole('button', { name: 'Merge departments' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Choose a different department to merge into'));
    expect(screen.getByRole('dialog', { name: 'Merge Arlington County' })).toBeInTheDocument();
  });

  it('closes without merging when the officer keeps both', async () => {
    const { user, dialog } = await openMerge();

    await user.click(within(dialog).getByRole('button', { name: 'Keep both' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockMerge).not.toHaveBeenCalled();
  });
});
