/**
 * The one form for a Training event (owner decision, 2026-11-10): four steps —
 * Event Details, Training Info, Settings, Review — drawn from the event form's
 * own sections and model, with the training session's fields on a step of
 * their own. It saves through the events endpoints and always sends
 * `training_details`, so every Training event it creates has a session to
 * file its credit under.
 *
 * The model and the session's fields are its host's (`EventComposer`), which
 * draws the single-page form instead when the type is not Training, so a type
 * change in either form carries every value to the other.
 *
 * Each step is checked before Next; a refused save, or a 422, puts every
 * message under its field and goes to the earliest step holding one (forms
 * review F-3/F-4). The one toast is a save, refused by the form or by the
 * server, that sends the form back to an earlier step: it names the step, not
 * the refusal, which the focused field already reads out (forms batch 17).
 *
 * The same steps edit an existing Training event. An edit sends every training
 * field the form owns, blanks as null (pitfall #1), except where the session's
 * fields are not this editor's to change: on a finalized event only Counts
 * toward attendance goes, and a training manager without events.manage, whom
 * the API refuses training details from (403), sends none.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Loader2,
  QrCode,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import type { EventCreate, EventUpdate, RecurringEventCreate } from '../../types/event';
import type { TrainingCourse } from '../../types/training';
import type { User } from '../../types/user';
import { trainingService, userService } from '../../services/api';
import { useRanks } from '../../hooks/useRanks';
import { useTrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { useMandatoryTierPrefill } from '../../hooks/useMandatoryTierPrefill';
import { linkedAttendanceLabel, useRetiredAttendanceRequirements } from '../../hooks/useRetiredAttendanceRequirements';
import { getErrorDetail } from '../../utils/errorHandling';
import { mapServerFieldErrors } from '../../utils/serverFieldErrors';
import { displayNameOf } from '../../utils/memberName';
import { isActiveAccount } from '../../constants/enums';
import { getEventTypeBadgeColor } from '../../utils/eventHelpers';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { EventFormModel } from '../event-form/useEventFormModel';
import { EVENT_FIELDS, EVENT_FIELD_IDS, type EventField } from '../event-form/eventFormConstants';
import { NoticesSection } from '../event-form/sections/NoticesSection';
import { DetailsSection } from '../event-form/sections/DetailsSection';
import { ScheduleSection } from '../event-form/sections/ScheduleSection';
import { LocationSection } from '../event-form/sections/LocationSection';
import { AttendanceSection } from '../event-form/sections/AttendanceSection';
import { RsvpSection } from '../event-form/sections/RsvpSection';
import { CheckInSection } from '../event-form/sections/CheckInSection';
import { NotificationsSection } from '../event-form/sections/NotificationsSection';
import { AttachmentsSection } from '../event-form/sections/AttachmentsSection';
import { TrainingInfoStep, type TrainingInfoAccess, type TrainingReadOnlyNotice } from './TrainingInfoStep';
import { TrainingReviewStep, type ReviewTarget, type SeriesOccurrence } from './TrainingReviewStep';
import { MandatoryPrefillNote } from './MandatoryPrefillNote';
import {
  TRAINING_FIELDS,
  applyLibraryCourse,
  scheduledHours,
  strippedForFinalized,
  toAttachPayload,
  toUpdatePayload,
  validateTrainingDetails,
  withCourseChoice,
  reconcileTemplateTraining,
  withLoadedCourseHours,
  withoutSessionSettingCopies,
  type InstructorOption,
  type SessionSettingCopy,
  type TrainingDetailsForm,
  type TrainingField,
} from './trainingDetailsModel';

const DETAILS = 0;
const TRAINING = 1;
const SETTINGS = 2;
const REVIEW = 3;
type WizardStep = typeof DETAILS | typeof TRAINING | typeof SETTINGS | typeof REVIEW;

/**
 * The toast naming the step a refused save went back to. One id, so a later
 * refusal replaces it rather than stacking beside it, and so it can be taken
 * down once the officer moves on: left up, it names a step they are no
 * longer on.
 */
export const STEP_TOAST_ID = 'training-wizard-step';

/** Each step's name: the stepper, the step line and the toast all read it here. */
const STEP_TITLES: Record<WizardStep, string> = {
  [DETAILS]: 'Event Details',
  [TRAINING]: 'Training Info',
  [SETTINGS]: 'Settings',
  [REVIEW]: 'Review',
};
const STEPS: { title: string; icon: LucideIcon }[] = [
  { title: STEP_TITLES[DETAILS], icon: Calendar },
  { title: STEP_TITLES[TRAINING], icon: GraduationCap },
  { title: STEP_TITLES[SETTINGS], icon: SlidersHorizontal },
  { title: STEP_TITLES[REVIEW], icon: ClipboardCheck },
];

const STEP_HEADING_ID = 'training-wizard-step';
const TYPE_HINT_ID = 'training-wizard-type-hint';

const REVIEW_TARGET_STEP: Record<ReviewTarget, WizardStep> = {
  details: DETAILS,
  training: TRAINING,
  settings: SETTINGS,
};

/** The step each event field is entered on. */
const EVENT_FIELD_STEP: Record<EventField, WizardStep> = {
  title: DETAILS,
  description: DETAILS,
  event_type: DETAILS,
  start_datetime: DETAILS,
  end_datetime: DETAILS,
  recurrence_end_date: DETAILS,
  recurrence_custom_days: DETAILS,
  location: DETAILS,
  location_details: DETAILS,
  mandatory_membership_types: SETTINGS,
  rsvp_deadline: SETTINGS,
  max_attendees: SETTINGS,
};

/** Both forms' fields, for placing a 422 from the one request that carries them all. */
const SERVER_FIELDS = { ...EVENT_FIELDS, ...TRAINING_FIELDS };
type ServerField = keyof typeof SERVER_FIELDS;

type EventErrors = Partial<Record<EventField, string>>;
type TrainingErrors = Partial<Record<TrainingField, string>>;
/** A refusal no single control owns, and the step it is about. */
interface StepMessage {
  step: WizardStep;
  message: string;
}

/**
 * The banner's list of field refusals, read from `onStep`. One 422 can refuse
 * fields on two steps while the form shows one, so the head says how many are
 * on this step and which steps hold the rest, rather than "marked below" over
 * a step that marks only some of them. In the order the fields are drawn, so
 * the list reads as the form does.
 */
const describeRefusals = (eventErrors: EventErrors, trainingErrors: TrainingErrors, onStep: WizardStep): string => {
  const refusals = [
    ...(Object.keys(EVENT_FIELD_IDS) as EventField[]).map((f) => ({
      step: EVENT_FIELD_STEP[f],
      message: eventErrors[f],
    })),
    ...(Object.keys(TRAINING_FIELDS) as TrainingField[]).map((f) => ({
      step: TRAINING,
      message: trainingErrors[f],
    })),
  ].filter((r): r is { step: WizardStep; message: string } => Boolean(r.message));
  const only = refusals.length === 1 ? refusals[0] : undefined;
  if (refusals.length === 0) return '';
  if (only?.step === onStep) return only.message;
  const list = refusals.map((r) => r.message).join(' · ');
  const here = refusals.filter((r) => r.step === onStep).length;
  if (here === refusals.length) return `Fix the ${refusals.length} fields marked below.\n${list}`;
  const elsewhere = [...new Set(refusals.map((r) => r.step))]
    .filter((s) => s !== onStep)
    .sort()
    .map((s) => `${refusals.filter((r) => r.step === s).length} on ${STEP_TITLES[s]}`);
  const where = [...(here ? [`${here} marked below`] : []), ...elsewhere].join(', ');
  const noun = refusals.length === 1 ? 'field' : 'fields';
  return `Fix the ${refusals.length} refused ${noun}: ${where}.\n${list}`;
};

interface FocusRequest {
  id: string;
  seq: number;
  /** Run once the control was found and focused. */
  onFound?: (() => void) | undefined;
  /** Run when the step does not draw the control; the step line has focus. */
  onMissing?: (() => void) | undefined;
}

interface TrainingEventWizardProps {
  /**
   * The event form's model, owned by the host (`EventComposer`) so that every
   * value survives a hand-off to or from the single-page form.
   */
  model: EventFormModel;
  /** The training session's fields, owned by the host for the same reason. */
  training: TrainingDetailsForm;
  setTraining: Dispatch<SetStateAction<TrainingDetailsForm>>;
  /** Save a single event. Throw on failure: the wizard shows why. */
  onSubmit: (data: EventCreate) => Promise<void>;
  /** Save a series. Throw on failure: the wizard shows why. */
  onSubmitRecurring?: ((data: RecurringEventCreate) => Promise<void>) | undefined;
  onCancel: () => void;
  /** Whether anything was entered or changed: Cancel then asks before discarding it. */
  isDirty?: boolean | undefined;
  /**
   * Training Admin fixes the type and says so; the Events page offers the type
   * picker, where choosing another type returns to the single-page form.
   */
  typeLocked?: boolean | undefined;
  /** Says where the fixed event type comes from. */
  typeNote?: string | undefined;
  /** Replaces the hint under the type picker (null for none); must carry the id `training-wizard-type-hint`. */
  typeHint?: React.ReactNode;
  submitLabel?: string | undefined;
  recurringSubmitLabel?: string | undefined;
  /** The recurring label for a phone under 480px, where the full one wraps. */
  recurringSubmitShortLabel?: string | undefined;
  /** The submit button while the save runs. */
  submittingLabel?: string | undefined;
  /** The banner's message for a refused save that names no reason. */
  failureMessage?: string | undefined;
  /** An edit's save (the model has an editing event id). Throw on failure: the wizard shows why. */
  onSubmitUpdate?: ((data: EventUpdate) => Promise<void>) | undefined;
  /** What an edit may change on Training Info; a create is always `edit`. */
  trainingAccess?: TrainingInfoAccess | undefined;
  readOnlyNotice?: TrainingReadOnlyNotice | undefined;
  /** custom_fields' copies of session settings this form cannot show, which an edit's save keeps. */
  keptSettingCopies?: readonly SessionSettingCopy[] | undefined;
  /** The training details as stored, for the Review step's "was" notes. */
  originalTraining?: TrainingDetailsForm | undefined;
  /** The stored session's course name, for a course the library no longer lists. */
  storedCourseName?: string | undefined;
  /** The step to open on: the event page's "Edit training details" opens Training Info. */
  initialStep?: 'details' | 'training' | undefined;
  /** On a series edit, the "This event only / This and all future events" choice, drawn on Review. */
  scopeChoice?: React.ReactNode;
  /** On an edit, who runs the event, for Review. */
  organizerNames?: { organizer?: string | null | undefined; alternate?: string | null | undefined } | undefined;
  /** On a series edit, the occurrence's start and its series' (ISO instants), for Review. */
  seriesOccurrence?: SeriesOccurrence | undefined;
  /** Told whether Event Details is the open step, for what the host draws above the steps. */
  onDetailsStepChange?: ((onDetails: boolean) => void) | undefined;
  /**
   * Applies a reading of the stored details (not an edit) to the host's
   * training value and to what it compares that value with for unsaved
   * changes. Without it the reading goes through `setTraining`.
   */
  onReadStoredTraining?: ((read: (value: TrainingDetailsForm) => TrainingDetailsForm) => void) | undefined;
  /**
   * On a create from a template with training details: what the template
   * filled Training Info with. Once the Course Library and the member list
   * have answered, it is checked against them (`reconcileTemplateTraining`)
   * through `onReadStoredTraining`, and any fallback is noted on Training Info.
   */
  templateTraining?: TrainingDetailsForm | undefined;
}

export const TrainingEventWizard: React.FC<TrainingEventWizardProps> = ({
  model,
  training,
  setTraining,
  onSubmit,
  onSubmitRecurring,
  onCancel,
  isDirty = false,
  typeLocked = true,
  typeNote = 'Set by Training Admin. Other event types use the Events page.',
  typeHint,
  submitLabel = 'Create Training Session',
  recurringSubmitLabel = 'Create Recurring Sessions',
  recurringSubmitShortLabel = 'Create sessions',
  submittingLabel = 'Creating...',
  failureMessage,
  onSubmitUpdate,
  trainingAccess = 'edit',
  readOnlyNotice,
  keptSettingCopies,
  originalTraining,
  storedCourseName,
  initialStep = 'details',
  scopeChoice,
  organizerNames,
  seriesOccurrence,
  onDetailsStepChange,
  onReadStoredTraining,
  templateTraining,
}) => {
  // Every rank, not only the active ladder: a member can still hold a rank the
  // department has since retired, and it should read as its name, not its code.
  const { formatRank } = useRanks(false);
  const { confirm } = useConfirm();
  const editing = Boolean(model.editingEventId);
  // A series is created as one; an edit changes one occurrence or the rest of
  // its series through the scope choice, never the recurrence itself.
  const creatingSeries = model.isRecurring && !editing;
  const [step, setStep] = useState<WizardStep>(initialStep === 'training' ? TRAINING : DETAILS);
  useEffect(() => {
    onDetailsStepChange?.(step === DETAILS);
  }, [step, onDetailsStepChange]);
  // The step the step toast names, while it is up.
  const toastStep = useRef<WizardStep | null>(null);
  const dismissStepToast = () => {
    toastStep.current = null;
    toast.dismiss(STEP_TOAST_ID);
  };
  const showStepToast = (target: WizardStep, message: string) => {
    toastStep.current = target;
    toast.error(message, { id: STEP_TOAST_ID });
  };
  useEffect(() => {
    if (toastStep.current !== null && toastStep.current !== step) dismissStepToast();
  });
  // A type changed away from Training swaps this form out; its toast goes too.
  useEffect(() => () => void toast.dismiss(STEP_TOAST_ID), []);
  const [trainingErrors, setTrainingErrors] = useState<TrainingErrors>({});
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  // Answered either way: a template's details wait for both lists to settle.
  const [coursesSettled, setCoursesSettled] = useState(false);
  // The event's length as the form opened on it: the stored length, which a
  // library course without hours credited (withLoadedCourseHours).
  const [lengthAtOpen] = useState(() =>
    scheduledHours(model.formData.start_datetime, model.formData.end_datetime, model.tz)
  );
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersSettled, setUsersSettled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Focus is moved after the step it targets has rendered: to the first
  // refused field, or to the step's heading when the step changes. Only then
  // is it known whether the field's control is drawn at all (a member-type
  // box under an unticked Mandatory is not), so what follows from finding it
  // or not is decided there too.
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusSeq = useRef(0);
  // Whether the banner lists field refusals and nothing else, so that it goes
  // once every one of them has been corrected rather than still asking for
  // fixes with nothing left marked.
  const fieldBanner = useRef(false);

  // The phone's fixed Previous/Next bar and fixed header. The form's
  // `clear-of-action-bar` scroll margin keeps a control the browser scrolls
  // into view by its box clear of the bar, but Chrome scrolls a focused
  // textarea by its caret, so Description reached by Tab came to rest almost
  // wholly behind the bar with the margin unused (WCAG 2.4.11), and WebKit
  // scrolls a focused field up to the viewport's top, under the header. After
  // the browser's own scroll, a focused control still reaching under either
  // is scrolled clear, never so far down that its top leaves the viewport.
  //
  // What it describes comes too. A refused Next, a refused Days group and a
  // mapped 422 focus the field so its reason is read, and the reason sits
  // under the control (under the second row of days, for the Days group): a
  // control scrolled clear by its own box left the reason behind the bar, a
  // focused field with no message for anyone not using a screen reader. The
  // reason is brought clear only as far as keeps the control below the
  // header.
  //
  // The step line is left where the browser puts it. It takes focus on every
  // step change and keeps it while the officer scrolls the new step, so a
  // correction landing a frame late (WebKit can draw none for a while) would
  // pull the page back up under a finger already scrolling it.
  const stepBarRef = useRef<HTMLDivElement>(null);
  const keepFocusClearOfBar = (event: React.FocusEvent<HTMLFormElement>) => {
    const target = event.target;
    const bar = stepBarRef.current;
    if (!bar || bar.contains(target) || target.id === STEP_HEADING_ID) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== target || getComputedStyle(bar).position !== 'fixed') return;
      const gap = 8;
      const banner = document.querySelector('header[role="banner"]');
      const top =
        (banner && getComputedStyle(banner).position === 'fixed' ? banner.getBoundingClientRect().bottom : 0) + gap;
      const bottom = bar.getBoundingClientRect().top - gap;
      const rect = target.getBoundingClientRect();
      const describedBottom = Math.max(
        rect.bottom,
        ...(target.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .map((id) => (id ? document.getElementById(id) : null))
          .filter((el): el is HTMLElement => el !== null && el.getClientRects().length > 0)
          .map((el) => el.getBoundingClientRect().bottom)
      );
      const by =
        rect.top < top
          ? rect.top - top
          : Math.max(
              0,
              Math.min(rect.bottom - bottom, rect.top - gap),
              Math.min(describedBottom - bottom, rect.top - top)
            );
      // Absolute, so a smooth scroll still under way is replaced rather than added to.
      if (by !== 0) window.scrollTo({ top: window.scrollY + by, behavior: 'instant' });
    });
  };
  const requestFocus = (id: string, outcome: Pick<FocusRequest, 'onFound' | 'onMissing'> = {}) => {
    focusSeq.current += 1;
    setFocusRequest({ id, seq: focusSeq.current, ...outcome });
  };
  useEffect(() => {
    if (!focusRequest) return;
    const target = document.getElementById(focusRequest.id);
    if (target) {
      target.focus();
      focusRequest.onFound?.();
      return;
    }
    // Never left on <body>: the step line says where the form now is.
    document.getElementById(STEP_HEADING_ID)?.focus();
    focusRequest.onMissing?.();
  }, [focusRequest]);

  useEffect(() => {
    trainingService
      .getCourses()
      .then((list) => {
        setCourses(list);
        setCoursesLoaded(true);
      })
      .catch(() => {
        /* non-critical: the library choice offers nothing */
      })
      .finally(() => setCoursesSettled(true));
  }, []);
  useEffect(() => {
    userService
      .getUsers()
      .then((list) => {
        setUsers(list);
        setUsersLoaded(true);
      })
      .catch(() => {
        /* non-critical: the lead instructor list is empty */
      })
      .finally(() => setUsersSettled(true));
  }, []);
  const members = useMemo<InstructorOption[]>(
    () =>
      users.map((user) => {
        const name = displayNameOf(user) || user.username;
        return {
          id: user.id,
          name,
          label: user.rank ? `${name} (${formatRank(user.rank)})` : name,
          former: !isActiveAccount(user.status),
        };
      }),
    [users, formatRank]
  );

  // Once the Course Library has loaded, an edited library session's hours
  // equal to the stored length follow the length again when its course has
  // none, as a course-less session's do. Only while untouched, and only on an
  // editable step: a locked one shows and keeps the hours as stored.
  const libraryHoursRead = useRef(false);
  useEffect(() => {
    if (!coursesLoaded || libraryHoursRead.current) return;
    libraryHoursRead.current = true;
    if (!originalTraining || trainingAccess !== 'edit') return;
    (onReadStoredTraining ?? setTraining)((prev) =>
      prev.course_mode === originalTraining.course_mode &&
      prev.course_id === originalTraining.course_id &&
      prev.credit_hours === originalTraining.credit_hours &&
      prev.credit_hours_source === originalTraining.credit_hours_source
        ? withLoadedCourseHours(prev, courses, lengthAtOpen)
        : prev
    );
  }, [coursesLoaded, courses, originalTraining, trainingAccess, lengthAtOpen, onReadStoredTraining, setTraining]);
  // A template's training details, checked once against the lists they name:
  // a course the library no longer lists, or an instructor who is no longer a
  // current member, falls back with a note. Applied as a reading, not an
  // edit, so Cancel does not take it for one. A list that failed to load is
  // skipped rather than taken as empty.
  const [templateNotes, setTemplateNotes] = useState<string[]>([]);
  const templateRead = useRef(false);
  useEffect(() => {
    if (!templateTraining || templateRead.current || !coursesSettled || !usersSettled) return;
    templateRead.current = true;
    const listedCourses = coursesLoaded ? courses : undefined;
    const listedMembers = usersLoaded ? members : undefined;
    setTemplateNotes(reconcileTemplateTraining(training, templateTraining, listedCourses, listedMembers).notes);
    (onReadStoredTraining ?? setTraining)(
      (prev) => reconcileTemplateTraining(prev, templateTraining, listedCourses, listedMembers).value
    );
  }, [
    templateTraining,
    coursesSettled,
    usersSettled,
    coursesLoaded,
    usersLoaded,
    courses,
    members,
    training,
    onReadStoredTraining,
    setTraining,
  ]);
  // The stored details read the same way, so Review does not call the
  // reading a change the officer made.
  const original = useMemo(
    () =>
      originalTraining && trainingAccess === 'edit'
        ? withLoadedCourseHours(originalTraining, courses, lengthAtOpen)
        : originalTraining,
    [originalTraining, trainingAccess, courses, lengthAtOpen]
  );

  const linkageData = useTrainingLinkageData(training.program_id || undefined);
  // The stored links too, so one unticked in this edit keeps its name.
  const linkedAttendanceIds = useMemo(
    () => [...training.attendance_requirement_ids, ...(originalTraining?.attendance_requirement_ids ?? [])],
    [training.attendance_requirement_ids, originalTraining?.attendance_requirement_ids]
  );
  const retiredAttendanceNames = useRetiredAttendanceRequirements(linkedAttendanceIds, linkageData);
  const selectedCourse =
    training.course_mode === 'library' ? courses.find((c) => c.id === training.course_id) : undefined;
  const { formData, tz } = model;
  const durationHours = useMemo(
    () => scheduledHours(formData.start_datetime, formData.end_datetime, tz),
    [formData.start_datetime, formData.end_datetime, tz]
  );

  const prefill = useMandatoryTierPrefill(
    model,
    // A link kept to a requirement since deactivated is named as Review and
    // the event page name it, never by its id.
    (id) =>
      linkageData.requirements.find((r) => r.id === id)?.name ??
      linkedAttendanceLabel(id, linkageData.requirements, retiredAttendanceNames),
    originalTraining?.attendance_requirement_ids
  );

  const updateTraining = (patch: Partial<TrainingDetailsForm>) => {
    setTraining((prev) => {
      const next = { ...prev, ...patch };
      const courseOf = (v: TrainingDetailsForm) => courses.find((c) => c.id === v.course_id);
      return withCourseChoice(next, courseOf(next), { value: prev, course: courseOf(prev) });
    });
    // Only the officer's ticks: loading an event's links never pre-fills.
    if (patch.attendance_requirement_ids) prefill.requirementsChanged(patch.attendance_requirement_ids);
    clearTrainingErrors(Object.keys(patch));
  };

  /** Take down the refusals under the fields a change just wrote. */
  const clearTrainingErrors = (keys: string[]) => {
    const touched = keys.map((key) =>
      key === 'instructor' ? 'instructor_id' : key === 'credit_hours_source' ? 'credit_hours' : key
    );
    if (touched.some((key) => key in trainingErrors)) {
      setTrainingErrors((prev) => {
        const next = { ...prev };
        for (const key of touched) delete next[key as TrainingField];
        return next;
      });
    }
  };

  const pickCourse = (course: TrainingCourse | undefined) => {
    if (!course) {
      updateTraining({ course_id: '' });
      return;
    }
    const picked = applyLibraryCourse(
      training,
      course,
      // A course's named instructor is matched to a current member only.
      members.filter((m) => !m.former),
      linkageData.programs.map((p) => p.id),
      training.course_mode === 'library' ? courses.find((c) => c.id === training.course_id) : undefined
    );
    setTraining(picked);
    // The course's hours, expiry, instructor and type replace what was there,
    // so a refusal of the value replaced no longer describes the field.
    clearTrainingErrors([
      'course_id',
      ...(Object.keys(picked) as (keyof TrainingDetailsForm)[]).filter((key) => picked[key] !== training[key]),
    ]);
    if (course.max_participants) model.update({ max_attendees: course.max_participants });
  };

  /** The refusals on one step, or on every step when `onStep` is omitted. */
  const collect = (onStep?: WizardStep): { event: EventErrors; training: TrainingErrors; messages: StepMessage[] } => {
    const event: EventErrors = {};
    for (const [field, message] of Object.entries(model.validate()) as [EventField, string][]) {
      if (onStep === undefined || EVENT_FIELD_STEP[field] === onStep) event[field] = message;
    }
    // Every series refusal is a field's now (a custom pattern with no day
    // is refused under Days of the Week), so nothing here is step-wide.
    const messages: StepMessage[] = [];
    // Locked fields are sent as stored or not at all, so a check the officer
    // could not act on would only block the save.
    const trainingInvalid =
      trainingAccess === 'edit' && (onStep === undefined || onStep === TRAINING)
        ? validateTrainingDetails(training, durationHours)
        : {};
    return { event, training: trainingInvalid, messages };
  };

  /**
   * Show refusals: each under its field, a summary in the step's banner, and
   * the wizard on the earliest step holding one, focused on its first field.
   * Returns whether there was anything to show.
   *
   * When that takes the form to another step (a save pressed on Review), a
   * toast names the step, so that something on screen says the save did not
   * go through; the refusal itself is read out by the focused field. A field
   * whose control the step does not draw cannot hold or read out its
   * refusal, so it is announced in the banner instead.
   */
  const showErrors = (
    eventErrors: EventErrors,
    trainingErrorsToShow: TrainingErrors,
    messages: StepMessage[],
    extra: string[] = []
  ): boolean => {
    // The type picker draws no message under itself, and Training Admin has
    // no picker at all, so a refusal of the type goes in the banner.
    const { event_type: typeMessage, ...rest } = eventErrors;
    const fieldErrors: EventErrors = rest;
    const allMessages = typeMessage ? [...messages, { step: DETAILS, message: typeMessage }] : messages;
    const steps = [
      ...Object.keys(fieldErrors).map((field) => EVENT_FIELD_STEP[field as EventField]),
      ...(Object.keys(trainingErrorsToShow).length ? [TRAINING] : []),
      ...allMessages.map((m) => m.step),
    ];
    if (steps.length === 0 && extra.length === 0) return false;
    const target = steps.length ? (Math.min(...steps) as WizardStep) : REVIEW;

    model.setFieldErrors(fieldErrors);
    setTrainingErrors(trainingErrorsToShow);
    const summary = describeRefusals(fieldErrors, trainingErrorsToShow, target);
    const others = [...allMessages.map((m) => m.message), ...extra];
    const firstField =
      target === TRAINING
        ? (Object.keys(TRAINING_FIELDS) as TrainingField[]).find((f) => trainingErrorsToShow[f])
        : (Object.keys(EVENT_FIELD_IDS) as EventField[]).find((f) => fieldErrors[f] && EVENT_FIELD_STEP[f] === target);
    // The focused field reads its own refusal out, so the field summary is
    // shown but not announced (forms batch 17); only what no focused field
    // says goes in the announced banner.
    model.showFormErrorSummary(firstField ? summary || null : null);
    model.showFormError([firstField ? '' : summary, others.join(' ')].filter(Boolean).join('\n') || null);
    // A banner of field refusals only is cleared once the last is fixed.
    fieldBanner.current = others.length === 0 && summary !== '';
    const moved = target !== step;
    setStep(target);

    if (firstField) {
      const field = firstField;
      const controlId =
        target === TRAINING
          ? TRAINING_FIELDS[field as TrainingField].id
          : // The "Other" location box and the fallback box share the field.
            field === 'location' && model.locations.length === 0
            ? 'location-text-fallback'
            : EVENT_FIELD_IDS[field as EventField];
      requestFocus(controlId, {
        onFound: () => {
          if (moved) showStepToast(target, `Back to ${STEP_TITLES[target]}: fix the flagged field`);
        },
        onMissing: () => {
          model.showFormErrorSummary(null);
          model.showFormError([summary, ...others].filter(Boolean).join('\n') || null);
          if (moved) showStepToast(target, `Back to ${STEP_TITLES[target]}: nothing was saved`);
        },
      });
    } else {
      requestFocus(STEP_HEADING_ID);
    }
    return true;
  };

  const clearAllErrors = () => {
    fieldBanner.current = false;
    model.clearErrors();
    setTrainingErrors({});
  };

  const { fieldErrors: eventFieldErrors, showFormError, showFormErrorSummary } = model;
  useEffect(() => {
    if (Object.keys(eventFieldErrors).length > 0 || Object.keys(trainingErrors).length > 0) return;
    // The field summary goes with the last field refusal; the banner goes too
    // when it held nothing else.
    showFormErrorSummary(null);
    if (fieldBanner.current) {
      fieldBanner.current = false;
      showFormError(null);
    }
  }, [eventFieldErrors, trainingErrors, showFormError, showFormErrorSummary]);

  /** Cancel, asking first when something would be lost. */
  const requestCancel = async () => {
    if (!isDirty) {
      onCancel();
      return;
    }
    const discard = await confirm({
      title: editing ? 'Discard your changes?' : 'Discard this event?',
      message: editing ? 'Your changes to this event have not been saved.' : 'Nothing you entered has been saved.',
      confirmLabel: editing ? 'Discard changes' : 'Discard',
      cancelLabel: 'Keep editing',
      variant: 'warning',
    });
    if (discard) onCancel();
  };

  /**
   * Leave `leaving` for `next`. Its own refusals go, as they always have; a
   * refusal on another step stays under its field until that field is
   * edited, or a fresh check or save replaces it, so a 422 that named fields
   * on two steps still marks the second once the first is fixed. Arriving on
   * a step that holds one focuses it, which reads the refusal out.
   */
  const goTo = (leaving: WizardStep, next: WizardStep) => {
    setStep(next);
    const eventLeft = Object.fromEntries(
      Object.entries(model.fieldErrors).filter(([field]) => EVENT_FIELD_STEP[field as EventField] !== leaving)
    ) as EventErrors;
    const trainingLeft: TrainingErrors = leaving === TRAINING ? {} : trainingErrors;
    const summary = describeRefusals(eventLeft, trainingLeft, next);
    if (!summary) {
      clearAllErrors();
      requestFocus(STEP_HEADING_ID);
      return;
    }
    model.setFieldErrors(eventLeft);
    setTrainingErrors(trainingLeft);
    model.showFormErrorSummary(summary);
    // A banner of field refusals only is now said by the summary.
    if (fieldBanner.current) model.showFormError(null);
    const firstHere =
      next === TRAINING
        ? (Object.keys(TRAINING_FIELDS) as TrainingField[]).find((f) => trainingLeft[f])
        : (Object.keys(EVENT_FIELD_IDS) as EventField[]).find((f) => eventLeft[f] && EVENT_FIELD_STEP[f] === next);
    requestFocus(
      firstHere === undefined
        ? STEP_HEADING_ID
        : next === TRAINING
          ? TRAINING_FIELDS[firstHere as TrainingField].id
          : EVENT_FIELD_IDS[firstHere as EventField]
    );
  };

  const handleNext = () => {
    const { event, training: trainingInvalid, messages } = collect(step);
    if (showErrors(event, trainingInvalid, messages)) return;
    goTo(step, Math.min(REVIEW, step + 1) as WizardStep);
  };

  const handlePrevious = () => {
    goTo(step, Math.max(DETAILS, step - 1) as WizardStep);
  };

  /** A refused save: a 422 under the fields it names, anything else in the banner. */
  const showSubmitError = (err: unknown, recurring: boolean) => {
    const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
    if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
      const eventErrors: EventErrors = {};
      const trainingErrorsFromServer: TrainingErrors = {};
      for (const [field, message] of Object.entries(mapped.fieldErrors) as [ServerField, string][]) {
        if (field in TRAINING_FIELDS) trainingErrorsFromServer[field as TrainingField] = message;
        else eventErrors[field as EventField] = message;
      }
      showErrors(eventErrors, trainingErrorsFromServer, [], mapped.unmatched);
      return;
    }
    fieldBanner.current = false;
    model.showFormErrorSummary(null);
    model.showFormError(
      mapped?.unmatched.join(' ') ||
        getErrorDetail(err) ||
        failureMessage ||
        (recurring ? 'Failed to create recurring events. Try again.' : 'Failed to create event. Try again.')
    );
    requestFocus(STEP_HEADING_ID);
  };

  /**
   * An edit's `training_details`: every field (pitfall #1) but an unchanged
   * Requirement, only the attendance links on a finalized event, nothing for
   * a reader.
   */
  const trainingUpdate = () => {
    if (trainingAccess === 'readonly') return undefined;
    const full = toUpdatePayload(training, durationHours, original);
    return trainingAccess === 'finalized' ? strippedForFinalized(full) : full;
  };

  const handleUpdate = async () => {
    if (!onSubmitUpdate) return;
    // The model's update payload: a blank sent as null, as the event form's.
    const { training_details: _none, ...eventFields } = model.buildSinglePayload();
    // Only where every session setting is sent: a finalized edit sends the
    // attendance links alone, and a reader nothing, so there the copies are
    // still news.
    if (trainingAccess === 'edit' && eventFields.custom_fields) {
      eventFields.custom_fields = withoutSessionSettingCopies(eventFields.custom_fields, keptSettingCopies);
    }
    const details = trainingUpdate();
    const payload: EventUpdate = details ? { ...eventFields, training_details: details } : eventFields;
    setIsSubmitting(true);
    try {
      await onSubmitUpdate(payload);
    } catch (err: unknown) {
      showSubmitError(err, false);
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    dismissStepToast();
    const { event, training: trainingInvalid, messages } = collect();
    if (showErrors(event, trainingInvalid, messages)) return;
    clearAllErrors();
    if (editing) {
      await handleUpdate();
      return;
    }

    // Creates leave a blank out (pitfall #1). Always sent: the session is
    // what files the event's credit, under the title when there is no course.
    const single: EventCreate = {
      ...model.buildSinglePayload(),
      training_details: toAttachPayload(training, durationHours),
    };
    const recurring = creatingSeries && Boolean(onSubmitRecurring);
    setIsSubmitting(true);
    try {
      if (recurring && onSubmitRecurring) {
        const series = model.buildRecurringPayload(single);
        if ('error' in series) {
          showErrors({}, {}, [{ step: DETAILS, message: series.error }]);
          setIsSubmitting(false);
          return;
        }
        await onSubmitRecurring(series.recurring);
      } else {
        await onSubmit(single);
      }
    } catch (err: unknown) {
      showSubmitError(err, recurring);
      setIsSubmitting(false);
    }
  };

  const fullSubmitLabel = creatingSeries ? recurringSubmitLabel : submitLabel;
  const stepTitle = STEP_TITLES[step];

  // The session's fields are locked with the rest once attendance is
  // finalized, apart from Counts toward attendance; a training manager, who
  // cannot change it either, is not told they can.
  const lockBody = (
    <>
      <p id={model.lockNoticeId} className="text-theme-alert-warning-text text-sm">
        Its type, category, schedule, check-in rules and training details are locked because members&apos; credited
        hours were calculated from them.
        {trainingAccess === 'finalized' &&
          ' Counts toward attendance can still be changed: it changes how the session is graded, not members’ records.'}{' '}
        Title, description, location and directions, and the attendance, RSVP and notification settings, can still be
        edited.
      </p>
      <p className="text-theme-alert-warning-text text-sm">
        To change a locked setting, someone who can reopen attendance reopens it from the event page first.
        {model.initialRecurrence?.is_recurring &&
          ' To change these for later events in the series, edit one whose attendance is still open.'}
      </p>
    </>
  );

  return (
    <div className="space-y-8">
      {/* Above the steps, so every step opens under it. */}
      <NoticesSection model={model} show="lock" lockBody={lockBody} />

      {/* === Progress === */}
      <nav aria-label="Progress" className="card p-4 sm:p-6">
        <ol className="flex items-center justify-between">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const isActive = index === step;
            const isComplete = index < step;
            return (
              <React.Fragment key={item.title}>
                <li className="flex flex-col items-center" aria-current={isActive ? 'step' : undefined}>
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all sm:h-12 sm:w-12 ${
                      isComplete
                        ? 'border-green-700 bg-green-700'
                        : isActive
                          ? 'border-red-600 bg-red-800'
                          : 'bg-theme-input-bg border-theme-input-border'
                    }`}
                    aria-hidden="true"
                  >
                    {isComplete ? (
                      <CheckCircle className="h-6 w-6 text-white" />
                    ) : (
                      <Icon className={`h-6 w-6 ${isActive ? 'text-white' : 'text-theme-text-muted'}`} />
                    )}
                  </span>
                  <span
                    className={`mt-2 hidden text-sm font-medium sm:block ${
                      isActive ? 'text-theme-text-primary' : 'text-theme-text-muted'
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="sr-only">
                    {item.title}
                    {isComplete ? ' (completed)' : isActive ? ' (current step)' : ''}
                  </span>
                </li>
                {index < STEPS.length - 1 && (
                  <li aria-hidden="true" className="bg-theme-surface-hover mx-2 h-0.5 flex-1 sm:mx-4" />
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </nav>

      {/* A real form: Enter in a field is Next, checked as Next is, and on
          Review it saves. Under 768px the navigation is a bar fixed above the
          bottom nav, and the card is the steps alone: `.card`'s backdrop
          filter makes it the containing block of anything fixed inside it,
          which pinned the bar to the card's bottom edge, over the step's last
          control, instead of to the viewport. The form's own bottom padding
          lets that control scroll clear of the bar, and its controls' scroll
          margin keeps one reached by Tab from coming to rest behind it. From
          768px the form is the card and the navigation sits at its foot. */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < REVIEW) handleNext();
          else void handleSubmit();
        }}
        onFocus={keepFocusClearOfBar}
        className="md:card max-md:clear-of-action-bar space-y-8 max-md:pb-24 md:p-8"
      >
        <div className="max-md:card space-y-8 p-4 sm:p-8 md:p-0">
          {/* The caption is the phone stepper's: from 768px the stepper names
              the step itself, so the line is read to a screen reader only.
              It stays the focus target after a step change at every width,
              and `md:contents` keeps the emptied row from adding a gap. */}
          <div className="flex items-center justify-between gap-3 md:contents">
            <p
              id={STEP_HEADING_ID}
              tabIndex={-1}
              className="text-theme-text-muted text-sm focus:outline-hidden md:sr-only"
            >
              Step {step + 1} of {STEPS.length} · {stepTitle}
            </p>
            {/* The phone's Cancel: the fixed bar holds only Previous and Next. */}
            <button
              type="button"
              onClick={() => {
                void requestCancel();
              }}
              className="touch-target-phone text-theme-text-secondary text-sm font-medium underline md:hidden"
            >
              Cancel
            </button>
          </div>

          <NoticesSection model={model} show="error" />

          {step === DETAILS && (
            <>
              <DetailsSection
                model={model}
                hideTypePicker={typeLocked}
                typeFirst
                typeHintId={TYPE_HINT_ID}
                typeHint={
                  typeHint !== undefined ? (
                    typeHint
                  ) : (
                    <p id={TYPE_HINT_ID} className="text-theme-text-muted mt-2 text-sm">
                      Training uses this step-by-step form. Pick another type to go back to the single-page form; your
                      entries carry over.
                    </p>
                  )
                }
                beforeTitle={
                  typeLocked && (
                    <div>
                      <span className="form-label">Event Type</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${getEventTypeBadgeColor(formData.event_type)}`}
                      >
                        Training
                      </span>
                      <p className="text-theme-text-muted mt-1 text-sm">{typeNote}</p>
                    </div>
                  )
                }
                titlePlaceholder="e.g., CPR/AED Renewal Training"
                titleHint="Becomes the event title, and the course name when no course is chosen."
                categoryLabel="Event Category"
                categoryHint="The department's own event categories."
                markOptional
              />
              <hr className="border-theme-surface-border" />
              <ScheduleSection
                model={model}
                showRecurrence={!editing}
                rollingHint="Each new occurrence copies the training details and attendance links (set on the next step) from the latest one."
              />
              <hr className="border-theme-surface-border" />
              <LocationSection model={model} variant="training" />
            </>
          )}

          {step === TRAINING && (
            <TrainingInfoStep
              value={training}
              onChange={updateTraining}
              onPickCourse={pickCourse}
              errors={trainingErrors}
              eventTitle={formData.title}
              durationHours={durationHours}
              courses={courses}
              members={members}
              linkageData={linkageData}
              isSeries={model.isRecurring}
              access={trainingAccess}
              readOnlyNotice={readOnlyNotice}
              storedCourseName={storedCourseName}
              coursesLoaded={coursesLoaded}
              retiredAttendanceNames={retiredAttendanceNames}
              templateNotes={templateNotes}
            />
          )}

          {step === SETTINGS && (
            <>
              <h2 className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
                <SlidersHorizontal className="h-5 w-5 text-red-700" aria-hidden="true" />
                <span>Settings</span>
              </h2>
              {/* Opens on All members: ticking Mandatory with nothing narrower
                chosen means everyone, said on screen rather than refused,
                unless Counts toward attendance suggests who. */}
              <AttendanceSection
                model={prefill.attendanceModel}
                scopeOnTick="all"
                typesInRow
                typesHint={false}
                scopeNote={
                  prefill.note && (
                    <MandatoryPrefillNote
                      note={prefill.note}
                      membershipTypes={model.membershipTypes}
                      mandatoryScope={model.mandatoryScope}
                    />
                  )
                }
                scopeNotePlacement={prefill.note?.kind === 'not-filled' ? 'before' : 'after'}
              />
              <hr className="border-theme-surface-border" />
              <RsvpSection
                model={model}
                variant="steps"
                maxAttendeesFromCourse={
                  Boolean(selectedCourse?.max_participants) &&
                  formData.max_attendees === selectedCourse?.max_participants
                }
              />
              <hr className="border-theme-surface-border" />
              <CheckInSection
                model={model}
                variant="steps"
                intro={
                  <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                    <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-green-800 dark:text-green-300">QR Code Check-In</p>
                      <p className="text-theme-text-secondary text-sm">
                        A QR code will be automatically generated for this training. Members can scan it to check in and
                        verify their attendance.
                      </p>
                    </div>
                  </div>
                }
              />
              <hr className="border-theme-surface-border" />
              <NotificationsSection model={model} variant="steps" />
            </>
          )}

          {step === REVIEW && (
            <>
              <TrainingReviewStep
                model={model}
                training={training}
                durationHours={durationHours}
                courses={courses}
                linkageData={linkageData}
                onEdit={(target) => goTo(REVIEW, REVIEW_TARGET_STEP[target])}
                editing={editing}
                original={original}
                scopeChoice={scopeChoice}
                organizerNames={organizerNames}
                storedCourseName={storedCourseName}
                unmapped={formData.is_mandatory && prefill.note ? prefill.note.unmapped : []}
                seriesOccurrence={seriesOccurrence}
                retiredAttendanceNames={retiredAttendanceNames}
              />
              <AttachmentsSection existingAttachments={model.existingAttachments} />
              {model.existingAttachments.length > 0 && (
                <p className="text-theme-text-muted text-sm">Attachments are managed on the event page.</p>
              )}
              <div className="border-theme-surface-border rounded-lg border p-4">
                <label className="text-theme-text-primary mobile-touch-target inline-flex cursor-pointer items-center justify-start gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={formData.is_draft || false}
                    onChange={(e) => model.setIsDraft(e.target.checked)}
                    aria-describedby="training-draft-hint"
                    className="form-checkbox"
                  />
                  Save as Draft
                </label>
                <p id="training-draft-hint" className="text-theme-text-muted ml-6 text-sm">
                  Members don&apos;t see a draft. Publish it later from the event page.
                </p>
              </div>
            </>
          )}
        </div>

        {/* === Navigation === inside the card from 768px; under it, a bar
            fixed above the bottom nav (action-bar-safe clears it and the
            home indicator, pitfall #21), Previous one share and Next two.
            Outside the phone card, so `fixed` resolves to the viewport. */}
        <div
          ref={stepBarRef}
          role="group"
          aria-label="Step navigation"
          className="border-theme-surface-border max-md:bg-theme-nav-bg max-md:action-bar-safe flex items-center gap-3 border-t pt-6 max-md:fixed max-md:right-0 max-md:bottom-0 max-md:left-[var(--side-nav-width,0px)] max-md:z-30 max-md:gap-2 max-md:px-4 max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.08)]"
        >
          <button
            type="button"
            onClick={handlePrevious}
            disabled={step === DETAILS}
            className="btn-secondary flex items-center justify-center gap-1 px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 max-md:min-w-0 max-md:flex-1 max-md:px-3"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
            Previous
          </button>
          <div className="ml-auto flex gap-3 max-md:ml-0 max-md:min-w-0 max-md:flex-[2]">
            <button
              type="button"
              onClick={() => {
                void requestCancel();
              }}
              className="btn-secondary px-5 py-3 text-sm font-medium max-md:hidden"
            >
              Cancel
            </button>
            {step < REVIEW ? (
              // Keyed apart from the save button, so the press that reaches
              // Review is never taken for a press of the button drawn there.
              <button
                key="next"
                type="submit"
                className="btn-primary flex items-center justify-center gap-1 px-6 py-3 text-sm font-medium max-md:w-full max-md:px-3"
              >
                Next
                <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
              </button>
            ) : (
              <button
                key="save"
                type="submit"
                disabled={isSubmitting}
                aria-label={isSubmitting ? submittingLabel : fullSubmitLabel}
                className="btn-success flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium disabled:cursor-not-allowed max-md:w-full max-md:px-3"
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                )}
                {isSubmitting ? (
                  submittingLabel
                ) : creatingSeries ? (
                  <>
                    <span className="hidden min-[480px]:inline">{recurringSubmitLabel}</span>
                    <span className="min-[480px]:hidden">{recurringSubmitShortLabel}</span>
                  </>
                ) : (
                  submitLabel
                )}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
