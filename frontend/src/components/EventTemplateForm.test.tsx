import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCourses = vi.fn();
const getUsers = vi.fn();
vi.mock('../services/api', () => ({
  trainingService: { getCourses: (...args: unknown[]) => getCourses(...args) as unknown },
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
}));
vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));
// The category, program, phase and requirement lists a template's links are
// picked from and checked against. Reset in the top-level beforeEach.
const linkage = vi.hoisted(() => {
  const initial: Record<string, unknown> = {};
  return { value: initial };
});
vi.mock('../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => linkage.value,
}));
const offering = (lists: {
  categories?: unknown[];
  programs?: unknown[];
  phases?: unknown[];
  requirements?: unknown[];
}) => ({
  categories: lists.categories ?? [],
  programs: lists.programs ?? [],
  phases: lists.phases ?? [],
  requirements: lists.requirements ?? [],
  requirementsLoaded: true,
  loaded: { categories: true, requirements: true, programs: true, phasesFor: 'prog-1' },
  settled: true,
});

import { EventTemplateForm } from './EventTemplateForm';
import type { EventTemplate, EventTemplateCreate, EventTemplateTrainingDetails } from '../types/event';

// Every block starts from these; a block that needs others installs them in
// its own beforeEach (pitfall #28).
beforeEach(() => {
  getCourses.mockReset();
  getCourses.mockResolvedValue([]);
  getUsers.mockReset();
  getUsers.mockResolvedValue([]);
  linkage.value = offering({});
});

describe('EventTemplateForm reminder audience', () => {
  it('persists the selected reminder audience in the template', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Department meeting');
    await user.click(screen.getByRole('button', { name: 'Reminders' }));
    await user.click(screen.getByLabelText('Send reminders'));
    await user.selectOptions(screen.getByLabelText(/who should receive reminders/i), 'all');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        send_reminders: true,
        reminder_target: 'all',
      })
    );
  });

  it('preserves intentional zero-minute check-in windows', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Starts on time');
    await user.click(screen.getByRole('button', { name: /check-in settings/i }));
    await user.selectOptions(screen.getByLabelText(/check-in window type/i), 'window');
    await user.type(screen.getByLabelText(/minutes before start/i), '0');
    await user.type(screen.getByLabelText(/minutes after end/i), '0');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        check_in_minutes_before: 0,
        check_in_minutes_after: 0,
      })
    );
  });

  it('defaults mandatory templates to all-member reminders', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Mandatory meeting');
    await user.click(screen.getByRole('button', { name: /rsvp & attendance/i }));
    await user.click(screen.getByLabelText(/mandatory attendance/i));
    await user.click(screen.getByRole('button', { name: /reminders/i }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        is_mandatory: true,
        send_reminders: true,
        reminder_target: 'all',
      })
    );
  });

  it('defaults mandatory templates after reminders are enabled first', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Mandatory meeting');
    await user.click(screen.getByRole('button', { name: /reminders/i }));
    await user.click(screen.getByLabelText(/send reminders/i));
    await user.click(screen.getByRole('button', { name: /rsvp & attendance/i }));
    await user.click(screen.getByLabelText(/mandatory attendance/i));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        is_mandatory: true,
        send_reminders: true,
        reminder_target: 'all',
      })
    );
  });

  it('never submits the none audience when reminders are re-enabled on edit', async () => {
    // A template saved with reminders off persists reminder_target 'none'.
    // Re-checking "Send reminders" must submit a real audience, not 'none' —
    // 'none' with send_reminders true makes the scheduler silently send nothing.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <EventTemplateForm
        initialData={{
          id: 'template-2',
          organization_id: 'org-1',
          name: 'Reminders were off',
          event_type: 'business_meeting',
          requires_rsvp: false,
          is_mandatory: false,
          allow_guests: false,
          require_checkout: false,
          send_reminders: false,
          reminder_target: 'none',
          reminder_schedule: [24],
          is_active: true,
          created_at: '2026-08-14T00:00:00Z',
          updated_at: '2026-08-14T00:00:00Z',
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reminders' }));
    await user.click(screen.getByLabelText('Send reminders'));
    // The audience select must show the value that will actually be submitted
    expect(screen.getByLabelText(/who should receive reminders/i)).toHaveValue('going');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        send_reminders: true,
        reminder_target: 'going',
      })
    );
  });

  it('does not re-enable reminders when they were explicitly disabled', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <EventTemplateForm
        initialData={{
          id: 'template-1',
          organization_id: 'org-1',
          name: 'No reminders',
          event_type: 'business_meeting',
          requires_rsvp: false,
          is_mandatory: false,
          allow_guests: false,
          require_checkout: false,
          send_reminders: true,
          reminder_target: 'going',
          reminder_schedule: [24],
          is_active: true,
          created_at: '2026-08-14T00:00:00Z',
          updated_at: '2026-08-14T00:00:00Z',
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText(/send reminders/i));
    await user.click(screen.getByRole('button', { name: /rsvp & attendance/i }));
    await user.click(screen.getByLabelText(/mandatory attendance/i));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        is_mandatory: true,
        send_reminders: false,
        reminder_target: 'none',
      })
    );
  });
});

describe('EventTemplateForm clearing a field (workflow review W21)', () => {
  const template: EventTemplate = {
    id: 'tpl-1',
    organization_id: 'org-1',
    name: 'Monday Drill',
    event_type: 'training',
    default_title: 'Monday Night Drill',
    default_location: 'Station 1',
    default_duration_minutes: 120,
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
    require_checkout: false,
    send_reminders: false,
    reminder_target: 'none',
    reminder_schedule: [],
    is_active: true,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
  };

  // An edit left out the fields it had emptied, and the update path reads an
  // omitted key as "leave alone": the old location and duration came back.
  it('sends a cleared field as null when editing, so the clear is saved', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm initialData={template} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.clear(screen.getByLabelText('Default Location'));
    await user.clear(screen.getByLabelText('Default Duration (minutes)'));
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ default_location: null, default_duration_minutes: null })
    );
  });

  // reminder_schedule is NOT NULL JSON, so an emptied schedule is an empty
  // list rather than null; omitting it kept the old schedule.
  it('sends an emptied reminder schedule as an empty list when editing', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <EventTemplateForm
        initialData={{ ...template, send_reminders: true, reminder_target: 'going', reminder_schedule: [168, 24] }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText(/Reminder Schedule/));
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reminder_schedule: [] }));
  });

  it('still leaves blank fields out when creating', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Bare');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    const sent = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('default_location');
    expect(sent).not.toHaveProperty('default_duration_minutes');
    expect(sent).not.toHaveProperty('reminder_schedule');
  });
});

// Forms review F-3: an empty submit was refused by the browser's required
// bubble, which vanished after a few seconds and was tied to no field.
describe('EventTemplateForm required name and save errors', () => {
  it('names a missing template name under the field and focuses it', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    const name = screen.getByRole('textbox', { name: 'Template Name' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for the template.');
    expect(name).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('puts a 422 from a rejected save on the field it names', async () => {
    const onSubmit = vi.fn().mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'default_location', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Template Name' }), 'Drill');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    const field = await screen.findByRole('textbox', { description: 'Value is too long.' });
    expect(field).toHaveAccessibleName('Default Location');
    expect(field).toHaveFocus();
  });

  it('shows any other failed save inside the form', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server unavailable'));
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Template Name' }), 'Drill');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
  });
});

// Owner decision 2026-11-20: a Training template stores the session's
// training details, edited in a Training Details section.
describe('EventTemplateForm training details', () => {
  const PUMP = {
    id: 'course-pump',
    organization_id: 'org-1',
    name: 'Pump Operations',
    code: 'PUMP',
    training_type: 'skills_practice',
    credit_hours: 2,
    expiration_months: 24,
    instructor: 'Owen Kittredge',
    max_participants: 40,
    active: true,
    created_at: '',
    updated_at: '',
  };
  const OWEN = { id: 'm-owen', username: 'okitt', first_name: 'Owen', last_name: 'Kittredge', status: 'active' };
  const PUMP_DETAILS: EventTemplateTrainingDetails = {
    course_mode: 'library',
    course_id: PUMP.id,
    course_name: null,
    course_code: null,
    training_type: 'skills_practice',
    credit_hours: 2,
    credit_hours_source: 'course',
    instructor_id: OWEN.id,
    instructor: 'Owen Kittredge',
    issues_certification: false,
    certification_number_prefix: null,
    issuing_agency: null,
    expiration_months: null,
  };
  const stored: EventTemplate = {
    id: 'tpl-1',
    organization_id: 'org-1',
    name: 'Pump Drill',
    event_type: 'training',
    default_title: 'Pump Drill',
    default_duration_minutes: 120,
    max_attendees: 12,
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
    require_checkout: false,
    send_reminders: false,
    reminder_target: 'none',
    reminder_schedule: [],
    is_active: true,
    created_at: '',
    updated_at: '',
    training_details: PUMP_DETAILS,
  };

  beforeEach(() => {
    getCourses.mockReset();
    getCourses.mockResolvedValue([PUMP]);
    getUsers.mockReset();
    getUsers.mockResolvedValue([OWEN]);
  });

  const sent = (onSubmit: ReturnType<typeof vi.fn>) => onSubmit.mock.calls[0]?.[0] as EventTemplateCreate;
  const save = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Save Template' }));

  it('loads the Course Library and members only once the type is Training', async () => {
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('heading', { name: 'Training Details' })).not.toBeInTheDocument();
    expect(getCourses).not.toHaveBeenCalled();
    expect(getUsers).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Event Type'), 'training');
    expect(screen.getByRole('heading', { name: 'Training Details' })).toBeInTheDocument();
    await waitFor(() => expect(getCourses).toHaveBeenCalledTimes(1));
    expect(getUsers).toHaveBeenCalledTimes(1);
  });

  it('saves a new Training template with its whole training details', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Template Name' }), 'Rope Rescue');
    await user.selectOptions(screen.getByLabelText('Event Type'), 'training');
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await user.type(screen.getByLabelText(/^Course Name/), 'Rope Rescue Ops');
    await user.selectOptions(screen.getByLabelText(/Training Type/), 'refresher');
    await save(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        event_type: 'training',
        training_details: {
          course_mode: 'oneoff',
          course_id: null,
          course_name: 'Rope Rescue Ops',
          course_code: null,
          training_type: 'refresher',
          credit_hours: null,
          credit_hours_source: 'duration',
          instructor_id: null,
          instructor: null,
          issues_certification: false,
          certification_number_prefix: null,
          issuing_agency: null,
          expiration_months: null,
          category_id: null,
          program_id: null,
          phase_id: null,
          requirement_id: null,
          attendance_requirement_ids: [],
          counts_toward_certification: true,
          auto_create_records: true,
          require_completion_confirmation: false,
          approval_deadline_days: 7,
        },
      })
    );
  });

  // Owner decision 2026-11-23: the links and completion settings are kept.
  describe('links and completion settings', () => {
    const CATEGORY = { id: 'cat-1', name: 'Pumps', active: true };
    const PROGRAM = { id: 'prog-1', name: 'Driver/Operator', active: true };
    const PHASE = { id: 'phase-1', program_id: 'prog-1', phase_number: 1, name: 'Phase 1' };
    const ATTENDANCE = { id: 'att-1', name: 'Company drills', requirement_type: 'session_attendance', active: true };
    const linked: EventTemplate = {
      ...stored,
      training_details: {
        ...PUMP_DETAILS,
        category_id: CATEGORY.id,
        program_id: PROGRAM.id,
        phase_id: PHASE.id,
        attendance_requirement_ids: [ATTENDANCE.id],
        counts_toward_certification: false,
        auto_create_records: true,
        require_completion_confirmation: true,
        approval_deadline_days: 14,
      },
    };

    it('opens a stored template on its links and saves them back', async () => {
      linkage.value = offering({
        categories: [CATEGORY],
        programs: [PROGRAM],
        phases: [PHASE],
        requirements: [ATTENDANCE],
      });
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<EventTemplateForm initialData={linked} onSubmit={onSubmit} onCancel={vi.fn()} />);

      expect(await screen.findByRole('checkbox', { name: /Company drills/ })).toBeChecked();
      await save(user);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(sent(onSubmit).training_details).toEqual(
        expect.objectContaining({
          category_id: CATEGORY.id,
          program_id: PROGRAM.id,
          phase_id: PHASE.id,
          attendance_requirement_ids: [ATTENDANCE.id],
          counts_toward_certification: false,
          require_completion_confirmation: true,
          approval_deadline_days: 14,
        })
      );
    });

    it('leaves out a link no longer active, with a note', async () => {
      linkage.value = offering({ categories: [], programs: [PROGRAM], phases: [PHASE], requirements: [] });
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<EventTemplateForm initialData={linked} onSubmit={onSubmit} onCancel={vi.fn()} />);

      expect(
        await screen.findByText("This template's category is no longer offered, so Category starts empty.")
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "One of this template's Counts toward attendance requirements is no longer active, so it is left unticked."
        )
      ).toBeInTheDocument();
      await save(user);

      expect(sent(onSubmit).training_details).toEqual(
        expect.objectContaining({ category_id: null, program_id: PROGRAM.id, attendance_requirement_ids: [] })
      );
    });
  });

  it('leaves the key out of a new template of another type', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Template Name' }), 'Monthly Meeting');
    await save(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('training_details');
  });

  it('clears them when an edited Training template becomes another type', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm initialData={stored} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Event Type'), 'business_meeting');
    await save(user);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'business_meeting', training_details: null })
    );
  });

  it('opens a stored template on its details, refreshed from the course', async () => {
    getCourses.mockResolvedValue([{ ...PUMP, credit_hours: 3 }]);
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm initialData={stored} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(3));
    expect(screen.getByLabelText(/^Course/, { selector: 'select' })).toHaveValue(PUMP.id);
    expect(screen.getByLabelText(/Lead Instructor/)).toHaveValue(OWEN.id);
    await save(user);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(sent(onSubmit).training_details).toEqual(
      expect.objectContaining({ course_id: PUMP.id, credit_hours: 3, credit_hours_source: 'course' })
    );
  });

  it('opens on No course yet, with a note, when the stored course is no longer listed', async () => {
    getCourses.mockResolvedValue([]);
    render(<EventTemplateForm initialData={stored} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(
      await screen.findByText(
        "This template's course is no longer in the Course Library, so the session starts on No course yet."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /No course yet/ })).toBeChecked();
  });

  it('pre-fills from a picked library course without touching Max Attendees', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <EventTemplateForm initialData={{ ...stored, training_details: null }} onSubmit={onSubmit} onCancel={vi.fn()} />
    );

    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    expect(await screen.findByRole('option', { name: 'PUMP - Pump Operations' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^Course/, { selector: 'select' }), PUMP.id);
    expect(screen.getByLabelText(/Training Type/)).toHaveValue('skills_practice');
    expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(2);
    await save(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(sent(onSubmit).max_attendees).toBe(12);
    expect(sent(onSubmit).training_details).toEqual(
      expect.objectContaining({
        course_mode: 'library',
        course_id: PUMP.id,
        credit_hours: 2,
        credit_hours_source: 'course',
        instructor_id: OWEN.id,
        issues_certification: true,
        expiration_months: 24,
      })
    );
  });

  it('names a library choice with no course under Course, and does not save', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <EventTemplateForm initialData={{ ...stored, training_details: null }} onSubmit={onSubmit} onCancel={vi.fn()} />
    );

    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await save(user);

    expect(screen.getByLabelText(/^Course/, { selector: 'select' })).toHaveAccessibleDescription(
      'Choose a course from the Course Library.'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts a 422 on a training detail's field", async () => {
    const onSubmit = vi.fn().mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ field: 'training_details.course_name', message: 'Value is too long.' }] },
      },
    });
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Template Name' }), 'Ropes');
    await user.selectOptions(screen.getByLabelText('Event Type'), 'training');
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await user.type(screen.getByLabelText(/^Course Name/), 'Ropes');
    await save(user);

    const field = await screen.findByRole('textbox', { description: /Value is too long\./ });
    expect(field).toHaveAccessibleName(/Course Name/);
  });
});
