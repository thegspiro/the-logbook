import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

// The app shell mounts ConfirmProvider; an open assignment form needs it to ask before discarding.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

const mockGetOfficers = vi.fn();
const mockSetOfficer = vi.fn();
const mockClearOfficer = vi.fn();

vi.mock('../../../services/api', () => ({
  officersService: {
    getOfficers: (...args: unknown[]) => mockGetOfficers(...args) as unknown,
    setOfficer: (...args: unknown[]) => mockSetOfficer(...args) as unknown,
    clearOfficer: (...args: unknown[]) => mockClearOfficer(...args) as unknown,
  },
}));

// Imported after the mock so the store binds to it.
import OfficersPanel from './OfficersPanel';
import { useOfficersStore } from '../store/officersStore';
import type { DepartmentOfficer } from '../types';

const makeOffice = (overrides: Partial<DepartmentOfficer> = {}): DepartmentOfficer => ({
  office_key: 'president',
  label: 'President',
  category: 'administrative',
  default_title: 'President',
  position_slugs: ['president'],
  user_id: null,
  name: '',
  title: 'President',
  email: '',
  phone: '',
  source: 'unset',
  auto_candidates: [],
  ...overrides,
});

const directory = (offices: DepartmentOfficer[]) => ({
  offices,
  variables: [{ name: 'president_name', description: 'Full name of the current President' }],
});

const members = [{ id: 'u1', full_name: 'Jane Doe', email: 'jane@fd.org' }];

describe('OfficersPanel', () => {
  beforeEach(() => {
    useOfficersStore.setState({
      offices: [],
      variables: [],
      isLoading: false,
      savingOfficeKey: null,
      error: null,
      hasLoaded: false,
    });
    vi.clearAllMocks();
  });

  it('renders each office with its holder and source badge', async () => {
    mockGetOfficers.mockResolvedValue(
      directory([
        makeOffice({ name: 'Jane Doe', user_id: 'u1', source: 'assigned' }),
        makeOffice({
          office_key: 'chief',
          label: 'Chief',
          category: 'operational',
          default_title: 'Chief',
          position_slugs: ['chief'],
          name: 'Rob Hayes',
          title: 'Chief',
          source: 'auto',
        }),
      ])
    );

    render(<OfficersPanel members={members} isLoadingMembers={false} />);

    expect(await screen.findByText('President')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Rob Hayes')).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
    expect(screen.getByText('Auto-detected')).toBeInTheDocument();
    expect(screen.getByText('Administrative (Corporate) Officers')).toBeInTheDocument();
    expect(screen.getByText('Operational (Line) Officers')).toBeInTheDocument();
  });

  it('lists the signature variables the offices expose', async () => {
    mockGetOfficers.mockResolvedValue(directory([makeOffice()]));

    render(<OfficersPanel members={members} isLoadingMembers={false} />);

    expect(await screen.findByText('{{president_name}}')).toBeInTheDocument();
  });

  it('omits untouched fields from the save payload', async () => {
    const user = userEvent.setup();
    mockGetOfficers.mockResolvedValue(directory([makeOffice()]));
    mockSetOfficer.mockResolvedValue(directory([makeOffice({ name: 'Jane Doe', user_id: 'u1', source: 'assigned' })]));

    render(<OfficersPanel members={members} isLoadingMembers={false} />);

    expect(await screen.findByText('Assign')).toBeInTheDocument();
    await user.click(screen.getByText('Assign'));

    await user.selectOptions(screen.getByLabelText('Member'), 'u1');
    await user.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockSetOfficer).toHaveBeenCalledWith('president', {
        user_id: 'u1',
        display_name: undefined,
        title: undefined,
        email: undefined,
        phone: undefined,
      })
    );
  });

  it('seeds the edit form from the stored overrides, not the resolved values', async () => {
    const user = userEvent.setup();
    mockGetOfficers.mockResolvedValue(
      directory([
        makeOffice({
          user_id: 'u1',
          name: 'Jane Doe',
          email: 'jane@fd.org',
          source: 'assigned',
          override_email: 'office@fd.org',
        }),
      ])
    );

    render(<OfficersPanel members={members} isLoadingMembers={false} />);

    expect(await screen.findByText('Assign')).toBeInTheDocument();
    await user.click(screen.getByText('Assign'));

    expect(screen.getByLabelText('Email override')).toHaveValue('office@fd.org');
    // Name is inherited from the member, so it is not an override.
    expect(screen.getByLabelText('Name override')).toHaveValue('');
  });

  it('clears an assignment', async () => {
    const user = userEvent.setup();
    mockGetOfficers.mockResolvedValue(directory([makeOffice({ name: 'Jane Doe', user_id: 'u1', source: 'assigned' })]));
    mockClearOfficer.mockResolvedValue(directory([makeOffice()]));

    render(<OfficersPanel members={members} isLoadingMembers={false} />);

    expect(await screen.findByText('Clear')).toBeInTheDocument();
    await user.click(screen.getByText('Clear'));

    await waitFor(() => expect(mockClearOfficer).toHaveBeenCalledWith('president'));
  });

  it('keeps the form open with a refused field flagged, and the banner quiet', async () => {
    const user = userEvent.setup();
    mockGetOfficers.mockResolvedValue(directory([makeOffice()]));
    mockSetOfficer.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'title', message: 'Value is too long.' }] } },
    });

    render(<OfficersPanel members={members} isLoadingMembers={false} />);
    await user.click(await screen.findByText('Assign'));
    await user.type(screen.getByLabelText('Signature title'), 'Chief of Department');
    await user.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(screen.getByLabelText('Signature title')).toHaveAccessibleDescription(
        'Signature title is too long — keep it to 150 characters.'
      )
    );
    expect(screen.getByLabelText('Signature title')).toHaveValue('Chief of Department');
    expect(useOfficersStore.getState().error).toBeNull();
  });

  it('asks before Cancel throws a typed override away', async () => {
    const user = userEvent.setup();
    mockGetOfficers.mockResolvedValue(directory([makeOffice()]));

    render(<OfficersPanel members={members} isLoadingMembers={false} />);
    await user.click(await screen.findByText('Assign'));
    await user.type(screen.getByLabelText('Name override'), 'Pat');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Name override')).toHaveValue('Pat');
  });
});
