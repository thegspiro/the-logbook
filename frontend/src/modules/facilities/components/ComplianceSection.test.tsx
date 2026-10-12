import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { COMPLIANCE_TYPE_OPTIONS } from '../constants';

const getComplianceChecklists = vi.fn();
const createComplianceChecklist = vi.fn();
const deleteComplianceChecklist = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getComplianceChecklists: (...args: unknown[]) => getComplianceChecklists(...args) as unknown,
    createComplianceChecklist: (...args: unknown[]) => createComplianceChecklist(...args) as unknown,
    deleteComplianceChecklist: (...args: unknown[]) => deleteComplianceChecklist(...args) as unknown,
  },
}));

import ComplianceSection from './ComplianceSection';

// Mirrors ComplianceType in backend/app/models/facilities.py. Any value the
// form offers outside this set is a guaranteed 422 from the create endpoint.
const BACKEND_COMPLIANCE_TYPES = [
  'ada',
  'fire_code',
  'building_code',
  'health',
  'environmental',
  'osha',
  'nfpa',
  'other',
];

// The shape FacilityComplianceChecklistResponse actually serializes:
// camelCase aliases of the ORM columns, so the name arrives as checklistName.
const storedChecklist = {
  id: 'checklist-1',
  organizationId: 'org-1',
  facilityId: 'facility-1',
  checklistName: 'NFPA 1500 Annual Review',
  description: null,
  complianceType: 'nfpa',
  dueDate: null,
  isCompleted: false,
  completedDate: null,
  completedBy: null,
  createdBy: 'user-1',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const renderSection = () =>
  render(
    <ConfirmProvider>
      <ComplianceSection facilityId="facility-1" canCreate canDelete />
    </ConfirmProvider>
  );

describe('ComplianceSection', () => {
  beforeEach(() => {
    getComplianceChecklists.mockReset();
    createComplianceChecklist.mockReset();
    deleteComplianceChecklist.mockReset();
    getComplianceChecklists.mockResolvedValue([storedChecklist]);
    createComplianceChecklist.mockResolvedValue(storedChecklist);
    deleteComplianceChecklist.mockResolvedValue(undefined);
  });

  it('renders the stored checklist name from the response', async () => {
    renderSection();

    expect(await screen.findByText('NFPA 1500 Annual Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete NFPA 1500 Annual Review' })).toBeInTheDocument();
  });

  it('creates a checklist with the checklist_name key the backend requires', async () => {
    renderSection();
    await screen.findByText('Compliance Checklists (1)');

    fireEvent.click(screen.getByRole('button', { name: /Add Checklist/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g., NFPA 1500 Annual Review'), {
      target: { value: '  OSHA walkthrough  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));

    await waitFor(() => expect(createComplianceChecklist).toHaveBeenCalledTimes(1));
    // Blank optional fields are omitted from a create payload (pitfall #1).
    expect(createComplianceChecklist).toHaveBeenCalledWith({
      facility_id: 'facility-1',
      compliance_type: 'nfpa',
      checklist_name: 'OSHA walkthrough',
    });
  });

  it('sends the optional fields when they are filled in', async () => {
    renderSection();
    await screen.findByText('Compliance Checklists (1)');

    fireEvent.click(screen.getByRole('button', { name: /Add Checklist/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g., NFPA 1500 Annual Review'), {
      target: { value: 'Health permit' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'health' } });
    fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));

    await waitFor(() => expect(createComplianceChecklist).toHaveBeenCalledTimes(1));
    expect(createComplianceChecklist).toHaveBeenCalledWith({
      facility_id: 'facility-1',
      compliance_type: 'health',
      checklist_name: 'Health permit',
      description: 'Kitchen',
      due_date: '2026-12-31',
    });
  });

  it('offers only compliance types the backend accepts', () => {
    expect([...COMPLIANCE_TYPE_OPTIONS].sort()).toEqual([...BACKEND_COMPLIANCE_TYPES].sort());
  });
});
