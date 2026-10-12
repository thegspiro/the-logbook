import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { MemberQualification } from '../../types/user';

const mockList = vi.fn();
const mockSave = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../services/api', () => ({
  memberQualificationService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    save: (...args: unknown[]) => mockSave(...args) as unknown,
    remove: (...args: unknown[]) => mockRemove(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks
import { QualificationsSection } from './QualificationsSection';

const EMT: MemberQualification = {
  id: 'q1',
  user_id: 'u1',
  qualification_code: 'emt',
  label: 'EMT',
  positions: ['ems'],
  granted_on: '2019-05-01',
  expires_on: '2027-03-31',
  notes: 'State #42',
  source: 'manual',
  in_force: true,
};

const FROM_RECORD: MemberQualification = {
  ...EMT,
  id: 'q2',
  qualification_code: 'driver_operator',
  label: 'Driver / Operator',
  positions: ['driver'],
  notes: null,
  source: 'training_record',
  in_force: false,
};

const renderSection = () => renderWithRouter(<QualificationsSection userId="u1" memberName="Pat Medic" tz="UTC" />);

describe('QualificationsSection', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue([EMT, FROM_RECORD]);
    mockSave.mockReset();
    mockSave.mockResolvedValue([EMT]);
    mockRemove.mockReset();
    mockRemove.mockResolvedValue([FROM_RECORD]);
  });

  it('lists each qualification with whether the scheduler counts it and where it came from', async () => {
    renderSection();

    expect(await screen.findByText('EMT')).toBeInTheDocument();
    expect(screen.getByText('In force')).toBeInTheDocument();
    expect(screen.getByText('Not in force')).toBeInTheDocument();
    expect(screen.getByText(/Entered directly/)).toBeInTheDocument();
    expect(screen.getByText(/From a training record/)).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith('u1');
  });

  it('adds a licence the member already held, sending every field', async () => {
    mockList.mockResolvedValue([]);
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: /Add/ }));
    await user.selectOptions(screen.getByLabelText('Qualification'), 'paramedic');
    await user.type(screen.getByLabelText(/Granted/), '2016-09-15');
    await user.click(screen.getByRole('button', { name: 'Save qualification' }));

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    // A blank expiry is an explicit null — "does not expire" — not an omitted key.
    expect(mockSave).toHaveBeenCalledWith('u1', 'paramedic', {
      granted_on: '2016-09-15',
      expires_on: null,
      notes: null,
    });
  });

  it('refuses an expiry before the grant date without calling the server', async () => {
    mockList.mockResolvedValue([]);
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: /Add/ }));
    await user.selectOptions(screen.getByLabelText('Qualification'), 'emt');
    await user.type(screen.getByLabelText(/Granted/), '2020-01-01');
    await user.type(screen.getByLabelText(/Expires/), '2019-01-01');
    await user.click(screen.getByRole('button', { name: 'Save qualification' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be before');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('warns that editing a record-derived grant makes it a direct entry', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Edit Driver / Operator' }));

    expect(screen.getByText(/voiding that record will no longer remove it/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Expires/));
    await user.click(screen.getByRole('button', { name: 'Save qualification' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('u1', 'driver_operator', {
        granted_on: '2019-05-01',
        expires_on: null,
        notes: null,
      })
    );
  });

  it('removes a qualification only after confirmation', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Remove EMT' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Pat Medic will no longer be cleared/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('u1', 'emt'));
  });
});
