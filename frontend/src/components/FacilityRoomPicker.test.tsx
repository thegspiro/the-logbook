import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetFacilities = vi.fn();
const mockGetRooms = vi.fn();

vi.mock('../services/api', () => ({
  facilitiesService: {
    getFacilities: (...args: unknown[]) => mockGetFacilities(...args) as unknown,
    getRooms: (...args: unknown[]) => mockGetRooms(...args) as unknown,
  },
}));

import FacilityRoomPicker from './FacilityRoomPicker';

const mockFacilities = [
  { id: 'f1', name: 'Station 1', isArchived: false, createdAt: '', updatedAt: '' },
  { id: 'f2', name: 'Station 2', isArchived: false, createdAt: '', updatedAt: '' },
];

const mockRooms = [
  { id: 'r1', facilityId: 'f1', name: 'Conference Room', roomNumber: '101', roomType: 'training_room', floor: 1, capacity: 30, createdAt: '', updatedAt: '' },
  { id: 'r2', facilityId: 'f1', name: 'Kitchen', roomType: 'kitchen', createdAt: '', updatedAt: '' },
];

describe('FacilityRoomPicker', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFacilities.mockResolvedValue(mockFacilities);
    mockGetRooms.mockResolvedValue(mockRooms);
  });

  it('renders facility and room selectors', async () => {
    render(<FacilityRoomPicker value={null} onChange={mockOnChange} />);

    expect(screen.getByLabelText('Select facility')).toBeInTheDocument();
    expect(screen.getByLabelText('Select room')).toBeInTheDocument();
  });

  it('loads facilities on mount', async () => {
    render(<FacilityRoomPicker value={null} onChange={mockOnChange} />);

    await waitFor(() => {
      expect(mockGetFacilities).toHaveBeenCalledWith({ is_archived: false });
    });
  });

  it('hides facility selector when facilityId is provided', async () => {
    render(<FacilityRoomPicker value={null} onChange={mockOnChange} facilityId="f1" />);

    expect(screen.queryByLabelText('Select facility')).not.toBeInTheDocument();

    // Room selector appears after rooms finish loading
    await waitFor(() => {
      expect(screen.getByLabelText('Select room')).toBeInTheDocument();
    });
  });

  it('loads rooms when facility is selected', async () => {
    const user = userEvent.setup();
    render(<FacilityRoomPicker value={null} onChange={mockOnChange} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Select facility')).toBeInTheDocument();
    });

    const facilitySelect = screen.getByLabelText('Select facility');
    await user.selectOptions(facilitySelect, 'f1');

    await waitFor(() => {
      expect(mockGetRooms).toHaveBeenCalledWith({ facility_id: 'f1' });
    });
  });

  it('calls onChange with room data when room is selected', async () => {
    const user = userEvent.setup();
    render(<FacilityRoomPicker value={null} onChange={mockOnChange} facilityId="f1" />);

    await waitFor(() => {
      const roomSelect = screen.getByLabelText('Select room');
      expect(roomSelect).toBeInTheDocument();
    });

    // Wait for rooms to load
    await waitFor(() => {
      expect(screen.getByText(/Conference Room/)).toBeInTheDocument();
    });

    const roomSelect = screen.getByLabelText('Select room');
    await user.selectOptions(roomSelect, 'r1');

    expect(mockOnChange).toHaveBeenCalledWith('r1', expect.objectContaining({ name: 'Conference Room' }));
  });

  it('shows room details when a room is selected', async () => {
    mockGetRooms.mockResolvedValue(mockRooms);
    render(<FacilityRoomPicker value="r1" onChange={mockOnChange} facilityId="f1" />);

    await waitFor(() => {
      expect(screen.getByText('Conference Room (#101)')).toBeInTheDocument();
      expect(screen.getByText('Capacity: 30')).toBeInTheDocument();
      expect(screen.getByText('Floor 1')).toBeInTheDocument();
    });
  });

  it('clears selection when onChange called with null', async () => {
    const user = userEvent.setup();
    render(<FacilityRoomPicker value="r1" onChange={mockOnChange} facilityId="f1" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Select room')).toBeInTheDocument();
    });

    const roomSelect = screen.getByLabelText('Select room');
    await user.selectOptions(roomSelect, '');

    expect(mockOnChange).toHaveBeenCalledWith(null, null);
  });

  it('shows placeholder when disabled', () => {
    render(<FacilityRoomPicker value={null} onChange={mockOnChange} disabled />);

    const roomSelect = screen.getByLabelText('Select room');
    expect(roomSelect).toBeDisabled();
  });
});
