import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CallTypeRequirementPicker } from './CallTypeRequirementPicker';
import { useDialog } from '../../hooks/useDialog';
import { AlertCircle, CheckCircle, X } from 'lucide-react';
import { CourseLibraryPicker } from './CourseLibraryPicker';
import { RecencyWindowField } from './RecencyWindowField';
import { EvaluationRequirementFields } from './EvaluationRequirementFields';
import { ChecklistItemsEditor } from './ChecklistItemsEditor';
import { ChangeScopeDialog } from './ChangeScopeDialog';
import { useCourseLibrary } from '../../hooks/useCourseLibrary';
import { useTimezone } from '../../hooks/useTimezone';
import { useDiscardGuard } from '../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../hooks/useFieldErrors';
import { FIELD_ERROR_CLASS, FormField } from '../ux/FormField';
import { ErrorSummary } from '../ux/ErrorSummary';
import { firstRefused, saveExceptRefused } from '../../utils/saveExceptRefused';
import { eventService } from '../../services/api';
import { blankToNull } from '../../utils/formValues';
import { formatCalendarDate, getTodayLocalDate } from '../../utils/dateFormatting';
import { canSplitForNewMembers, existingMemberPolicyOf } from '../../utils/requirementGrandfathering';
import { ExistingMemberPolicy, RequirementChangeScope } from '../../constants/enums';
import type {
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  DueDateType,
  RequirementFrequency,
  RequirementType,
  TrainingType,
} from '../../types/training';

const MEMBERSHIP_TYPES = [
  { value: 'active', label: 'Active' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'life', label: 'Life' },
  { value: 'retired', label: 'Retired' },
  { value: 'honorary', label: 'Honorary' },
] as const;

/**
 * The membership types of the operational members who are still serving.
 *
 * `retired` is an operational-class rung in `_SPLIT` (backend/app/utils/
 * membership.py), but a department reads "operational members" as the people
 * who ride, and ticking Retired from this shortcut held stepped-back members
 * to riding requirements (owner decision 2026-11-06). An officer who does
 * mean them ticks Retired by hand. `prospective` is left out because
 * prospects are not member accounts and are never graded.
 */
const OPERATIONAL_MEMBERSHIP_TYPES: readonly string[] = ['active', 'probationary', 'life'];

/**
 * Department tiers the shortcut also selects, when the department has them.
 * `senior` is a shipped default rung for long-serving members who still ride
 * (owner request 2026-11-16), but tiers are configurable per department, so it
 * is added only once the department's own tier list names it — otherwise the
 * shortcut would save a type no member can hold.
 */
const OPERATIONAL_TIER_IDS: readonly string[] = ['senior'];

interface MembershipTypeOption {
  value: string;
  label: string;
}

/**
 * The built-in types followed by the department's own tiers that are not among
 * them. A requirement grades on the member's stored `membership_type`, and a
 * custom tier such as `senior` is stored under its own id — so a list without
 * it scoped those members out of the requirement with no way to tick them back
 * in. Built-in labels win on a shared id so the familiar names stay put.
 */
const mergeMembershipTypeOptions = (
  builtIn: readonly MembershipTypeOption[],
  tiers: readonly MembershipTypeOption[]
): MembershipTypeOption[] => {
  const merged = [...builtIn];
  for (const tier of tiers) {
    if (tier.value && !merged.some((option) => option.value === tier.value)) {
      merged.push({ value: tier.value, label: tier.label || tier.value });
    }
  }
  return merged;
};

type RequirementField = 'name' | 'description' | 'target' | 'audience' | 'cutoff' | 'deadline' | 'year';

/** Mirrors TrainingRequirementBase.name (max_length=255). */
const NAME_MAX_LENGTH = 255;

/**
 * The input that holds each type's target, and what it is called. A type with
 * no number to set (skills evaluation, checklist) has no entry: nothing about
 * its target can be refused.
 */
const TARGET_INPUT: Partial<Record<RequirementType, { id: string; label: string; missing?: string }>> = {
  hours: {
    id: 'req-required-hours',
    label: 'Required hours',
    missing: 'Enter the hours an hours requirement asks for.',
  },
  courses: {
    id: 'req-course-search',
    label: 'Courses',
    missing: 'Select at least one course from the library for a courses requirement.',
  },
  certification: { id: 'req-course-search', label: 'Courses' },
  shifts: { id: 'req-required-shifts', label: 'Required shifts', missing: 'Enter the number of shifts to work.' },
  calls: { id: 'req-required-calls', label: 'Required calls', missing: 'Enter the number of calls to run.' },
  evaluated_shifts: {
    id: 'req-required-evaluated-shifts',
    label: 'Required evaluated shifts',
    missing: 'Enter the number of evaluated shifts.',
  },
  evaluated_calls: {
    id: 'req-required-evaluated-calls',
    label: 'Required evaluated calls',
    missing: 'Enter the number of evaluated calls.',
  },
  transports: {
    id: 'req-required-transports',
    label: 'Required transports',
    missing: 'Enter the number of transports.',
  },
  refusals: { id: 'req-required-refusals', label: 'Required refusals', missing: 'Enter the number of refusals.' },
  session_attendance: {
    id: 'req-attendance-pct',
    label: 'Sessions to attend',
    missing: 'Enter the share of linked sessions to attend.',
  },
  knowledge_test: {
    id: 'req-passing-score',
    label: 'Passing score',
    missing: 'Enter the passing score for a knowledge test.',
  },
};

/**
 * Every request key that depends on the requirement's type. An edit whose
 * target is refused leaves all of them out, the type included, so the stored
 * type keeps its stored target: leaving out only the number could pair a new
 * type with the target of the old one, which the backend reads as a
 * requirement that can never be met.
 */
const TYPE_DEPENDENT_KEYS = [
  'requirement_type',
  'required_hours',
  'required_courses',
  'recency_days',
  'required_shifts',
  'required_calls',
  'required_transports',
  'required_refusals',
  'required_attendance_pct',
  'allows_chief_override',
  'evaluation_excludes_lowest_rating',
  'required_call_types',
  'checklist_items',
  'passing_score',
  'max_attempts',
  'shift_credited',
] as const;

/** The grandfathering pair is one decision: refusing either keeps both as stored. */
const GRANDFATHERING_KEYS = ['new_member_cutoff_date', 'existing_member_deadline'] as const;

const REQUIREMENT_KEYS: Record<RequirementField, readonly string[]> = {
  name: ['name'],
  description: ['description'],
  target: TYPE_DEPENDENT_KEYS,
  audience: ['applies_to_all', 'required_membership_types'],
  cutoff: GRANDFATHERING_KEYS,
  deadline: GRANDFATHERING_KEYS,
  year: ['year'],
};

function requirementFields(type: RequirementType): FieldSpecs<RequirementField> {
  const target = TARGET_INPUT[type];
  // Ordered as on screen, so the first refusal takes focus.
  return {
    name: { id: 'req-name', label: 'Name' },
    description: { id: 'req-description', label: 'Description' },
    target: {
      id: target?.id ?? 'req-requirement-type',
      label: target?.label ?? 'Requirement type',
      apiKeys: [
        'required_hours',
        'required_courses',
        'required_shifts',
        'required_calls',
        'required_transports',
        'required_refusals',
        'required_attendance_pct',
        'passing_score',
        'requirement_type',
      ],
    },
    year: { id: 'req-year', label: 'Year' },
    audience: {
      id: 'req-applies-to-all',
      label: 'Who it applies to',
      apiKeys: ['applies_to_all', 'required_membership_types'],
    },
    cutoff: { id: 'req-cutoff-date', label: 'Existing members joined before', apiKeys: ['new_member_cutoff_date'] },
    deadline: { id: 'req-catch-up-deadline', label: 'Catch-up deadline', apiKeys: ['existing_member_deadline'] },
  };
}

/**
 * Full create/edit form for a training requirement.
 *
 * Shared by the Training Admin requirements page and the Training Programs
 * requirements tab so both surfaces edit the same fields with the same
 * validation — a second, partial copy of this form would let one surface
 * silently drop fields the other persists.
 */
export interface RequirementModalProps {
  requirement: TrainingRequirement | null;
  template?: TrainingRequirementCreate | null;
  categories: TrainingCategory[];
  onClose: () => void;
  /**
   * Rejects when the save fails, so the form can put the reason on its field.
   * `keepOpen` marks an edit saved without a refused field: apply it, but leave
   * the form open with that field flagged.
   */
  onSave: (
    data: TrainingRequirementCreate | TrainingRequirementUpdate,
    isEdit: boolean,
    id?: string,
    options?: { keepOpen: boolean }
  ) => Promise<void>;
}

export const RequirementModal: React.FC<RequirementModalProps> = ({
  requirement,
  template,
  categories,
  onClose,
  onSave,
}) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);

  const seed = requirement ?? template;
  const seedFrequency = seed?.frequency || 'annual';
  const [formData, setFormData] = useState({
    name: seed?.name || '',
    description: seed?.description || '',
    requirement_type: seed?.requirement_type || 'hours',
    training_type: seed?.training_type || '',
    required_hours: seed?.required_hours || undefined,
    required_shifts: seed?.required_shifts || undefined,
    required_calls: seed?.required_calls || undefined,
    required_transports: seed?.required_transports || undefined,
    required_refusals: seed?.required_refusals || undefined,
    required_attendance_pct: seed?.required_attendance_pct || undefined,
    allows_chief_override: seed?.allows_chief_override ?? false,
    evaluation_excludes_lowest_rating: seed?.evaluation_excludes_lowest_rating ?? false,
    required_call_types: seed?.required_call_types ?? ([] as string[]),
    checklist_items: seed?.checklist_items ?? [],
    passing_score: seed?.passing_score || undefined,
    max_attempts: seed?.max_attempts || undefined,
    frequency: seedFrequency,
    // A one-time requirement has no recurring cycle, so it must never carry a
    // year: "One time" next to "2026" reads as "only required during 2026",
    // when in fact the completion counts permanently (the backend returns an
    // unbounded date window for one_time and ignores `year` entirely).
    year: seedFrequency === 'one_time' ? undefined : seed?.year || (new Date().getFullYear() as number | undefined),
    allows_external_credit: seed?.allows_external_credit ?? false,
    // null until the officer touches it: a new requirement then follows its
    // type (SHIFTS on, HOURS off), matching the backend default.
    shift_credited: seed?.shift_credited ?? null,
    applies_to_all: seed?.applies_to_all ?? true,
    required_membership_types: seed?.required_membership_types || ([] as string[]),
    due_date: seed?.due_date || '',
    start_date: seed?.start_date || '',
    due_date_type: seed?.due_date_type || 'calendar_period',
    rolling_period_months: seed?.rolling_period_months || 12,
    period_start_month: seed?.period_start_month || 1,
    period_start_day: seed?.period_start_day || 1,
    period_end_month: seed?.period_end_month || (undefined as number | undefined),
    period_end_day: seed?.period_end_day || (undefined as number | undefined),
    include_current_month_mode:
      seed?.include_current_month == null ? 'inherit' : seed.include_current_month ? 'include' : 'exclude',
    category_ids: seed?.category_ids || ([] as string[]),
  });

  // Linked course-library ids. Kept out of `formData` because it is an id list
  // the picker owns, not a text field.
  const [requiredCourses, setRequiredCourses] = useState<string[]>(seed?.required_courses ?? []);
  // Grandfathering: how members who joined before the cutoff are treated.
  const seedPolicy = existingMemberPolicyOf(seed);
  const [existingPolicy, setExistingPolicy] = useState<ExistingMemberPolicy>(seedPolicy);
  const [cutoffDate, setCutoffDate] = useState<string>(seed?.new_member_cutoff_date || today);
  const [catchUpDeadline, setCatchUpDeadline] = useState<string>(seed?.existing_member_deadline || '');
  // An edit waits here while the chief chooses who the change reaches.
  const [pendingUpdate, setPendingUpdate] = useState<TrainingRequirementUpdate | null>(null);
  const [recencyDays, setRecencyDays] = useState<number | undefined>(seed?.recency_days ?? undefined);
  const { courses, loading: coursesLoading, error: coursesError } = useCourseLibrary();

  const [saving, setSaving] = useState(false);
  // The button's disabled state lags a double-click by a render, and saving
  // used to clear before the request returned, so both clicks created a row.
  const savingRef = useRef(false);

  const fields = useMemo(() => requirementFields(formData.requirement_type), [formData.requirement_type]);
  const fieldErrors = useFieldErrors(fields);
  const { errors } = fieldErrors;
  // Bumped when a refusal no field answers for is shown, to move focus there.
  const [summaryFocus, setSummaryFocus] = useState(0);
  // An edit waits here, with the fields refused before it was sent, while the
  // chief chooses who the change reaches.
  const pendingRefused = useRef<FieldErrors<RequirementField>>({});
  const edited = (...names: RequirementField[]) => {
    for (const name of names) fieldErrors.setError(name, null);
  };

  // Escape, the X and Cancel ask before typed changes are thrown away (forms
  // review F-6). A field left out of a partial save still counts as unsaved.
  const snapshot = JSON.stringify([
    formData,
    requiredCourses,
    existingPolicy,
    cutoffDate,
    catchUpDeadline,
    recencyDays,
  ]);
  const [baseline, setBaseline] = useState(snapshot);
  const requestClose = useDiscardGuard({ isDirty: snapshot !== baseline || fieldErrors.hasErrors, onClose });
  const dialogRef = useDialog<HTMLDivElement>({ onClose: requestClose });

  // A one-time requirement never recurs, so every cycle-related control (due
  // date type, calendar period, year) is hidden rather than shown with values
  // the backend ignores — that pairing is what made one-time requirements read
  // as annual.
  const isOneTime = formData.frequency === 'one_time';

  const [membershipTypeOptions, setMembershipTypeOptions] = useState<MembershipTypeOption[]>([...MEMBERSHIP_TYPES]);
  // The department's tiers come from the events endpoint because it is open to
  // every signed-in member; the tier config endpoint needs members.manage, which
  // a training officer editing requirements usually does not hold.
  useEffect(() => {
    let cancelled = false;
    eventService
      .getVisibleEventTypesWithCategories()
      .then((data) => {
        if (!cancelled && Array.isArray(data?.membership_types)) {
          setMembershipTypeOptions(mergeMembershipTypeOptions(MEMBERSHIP_TYPES, data.membership_types));
        }
      })
      .catch(() => {
        // The built-in list stays, and a saved type it lacks is still rendered below.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // A type the requirement already carries stays visible even when neither list
  // names it, so an officer can still untick it.
  const renderedMembershipTypes = mergeMembershipTypeOptions(
    membershipTypeOptions,
    formData.required_membership_types.map((value) => ({ value, label: value }))
  );

  const operationalTypes = [
    ...OPERATIONAL_MEMBERSHIP_TYPES,
    ...OPERATIONAL_TIER_IDS.filter((id) => membershipTypeOptions.some((option) => option.value === id)),
  ];
  const operationalLabels = operationalTypes.map(
    (type) => membershipTypeOptions.find((option) => option.value === type)?.label ?? type
  );
  const operationalSummary =
    operationalLabels.length > 1
      ? `${operationalLabels.slice(0, -1).join(', ')} and ${operationalLabels[operationalLabels.length - 1] ?? ''}`
      : (operationalLabels[0] ?? '');
  const allOperationalSelected = operationalTypes.every((t) => formData.required_membership_types.includes(t));
  // Adds whichever operational types are missing, or clears them all when
  // they are already ticked; any other category (Retired, Administrative,
  // Honorary) is left as the officer set it.
  const toggleOperational = () => {
    edited('audience');
    setFormData((prev) => {
      const hasAll = operationalTypes.every((t) => prev.required_membership_types.includes(t));
      return {
        ...prev,
        required_membership_types: hasAll
          ? prev.required_membership_types.filter((t) => !operationalTypes.includes(t))
          : [
              ...prev.required_membership_types,
              ...operationalTypes.filter((t) => !prev.required_membership_types.includes(t)),
            ],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    // Each refusal is said on its field rather than in a toast that vanished
    // (forms review F-3); the checks mirror the backend's create validator.
    const problems: FieldErrors<RequirementField> = {};
    if (!formData.name.trim()) problems.name = 'Give the requirement a name.';

    const checklistItems = formData.checklist_items.filter((i) => i.text.trim());
    const targetMissing: Partial<Record<RequirementType, boolean>> = {
      hours: !formData.required_hours,
      courses: requiredCourses.length === 0,
      shifts: !formData.required_shifts,
      calls: !formData.required_calls,
      evaluated_shifts: !formData.required_shifts,
      evaluated_calls: !formData.required_calls,
      transports: !formData.required_transports,
      refusals: !formData.required_refusals,
      session_attendance: !formData.required_attendance_pct,
      knowledge_test: !formData.passing_score,
    };
    const missingTarget = TARGET_INPUT[formData.requirement_type]?.missing;
    if (targetMissing[formData.requirement_type] && missingTarget) problems.target = missingTarget;

    // A requirement that applies to nobody silently disappears from every
    // member's compliance view — refuse it unless the record targets by
    // role/position (set outside this form)
    const hasRoleTargeting = (seed?.required_roles?.length || 0) > 0 || (seed?.required_positions?.length || 0) > 0;
    if (!formData.applies_to_all && formData.required_membership_types.length === 0 && !hasRoleTargeting) {
      problems.audience = 'Select at least one member category, or check "Applies to all members".';
    }

    if (!isOneTime && formData.year != null && (formData.year < 2020 || formData.year > 2100)) {
      problems.year = 'Enter a year from 2020 to 2100, or leave it empty for the current year.';
    }

    const grandfathers = existingPolicy !== ExistingMemberPolicy.APPLY_TO_ALL;
    if (grandfathers && !cutoffDate) {
      problems.cutoff = 'Choose the date that separates existing members from new members.';
    }
    if (existingPolicy === ExistingMemberPolicy.CATCH_UP && !catchUpDeadline) {
      problems.deadline = 'Choose the date existing members have until.';
    }

    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    // A new requirement is not created until every field is fixed (create
    // forms do not partially save); an edit saves the rest.
    if (!requirement && Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }

    // One-time requirements have no cycle to configure — the calendar period
    // and year are meaningless for them and only make the requirement look
    // like it repeats, so they are never persisted.
    const usesCalendarPeriod = !isOneTime && formData.due_date_type === 'calendar_period';
    const data = {
      name: formData.name,
      description: blankToNull(formData.description),
      requirement_type: formData.requirement_type,
      // "Any Type" is an explicit null rather than an omitted key: an update
      // omits a key to leave the stored value alone, so dropping it here kept
      // a narrowed type (e.g. continuing education) after the officer widened
      // the requirement back to every type.
      training_type: (formData.training_type as TrainingType) || null,
      required_hours: formData.requirement_type === 'hours' ? (formData.required_hours ?? null) : null,
      // Always sent so switching a requirement off the course/certification
      // types clears stale links — a leftover course id silently narrows the
      // hours evaluator to only that course's records.
      required_courses:
        formData.requirement_type === 'courses' || formData.requirement_type === 'certification' ? requiredCourses : [],
      // Every target below is sent on every save, as an explicit null when
      // it does not apply, so switching a requirement's type clears the old
      // target instead of leaving it behind to be evaluated against.
      recency_days:
        formData.requirement_type === 'courses' || formData.requirement_type === 'certification'
          ? (recencyDays ?? null)
          : null,
      required_shifts:
        formData.requirement_type === 'shifts' || formData.requirement_type === 'evaluated_shifts'
          ? (formData.required_shifts ?? null)
          : null,
      required_calls:
        formData.requirement_type === 'calls' || formData.requirement_type === 'evaluated_calls'
          ? (formData.required_calls ?? null)
          : null,
      required_transports: formData.requirement_type === 'transports' ? (formData.required_transports ?? null) : null,
      required_refusals: formData.requirement_type === 'refusals' ? (formData.required_refusals ?? null) : null,
      required_attendance_pct:
        formData.requirement_type === 'session_attendance' ? (formData.required_attendance_pct ?? null) : null,
      allows_chief_override: formData.requirement_type === 'session_attendance' && formData.allows_chief_override,
      // A boolean on every save: the column refuses null.
      evaluation_excludes_lowest_rating:
        formData.requirement_type === 'evaluated_shifts' && formData.evaluation_excludes_lowest_rating,
      // An empty list means every call counts, so switching away clears it.
      required_call_types: formData.requirement_type === 'calls' ? formData.required_call_types : [],
      checklist_items: formData.requirement_type === 'checklist' ? checklistItems : null,
      passing_score: formData.requirement_type === 'knowledge_test' ? (formData.passing_score ?? null) : null,
      max_attempts: formData.requirement_type === 'knowledge_test' ? (formData.max_attempts ?? null) : null,
      frequency: formData.frequency,
      // Sent on every save, as null when the box is emptied: a stored year pins
      // an annual window to that year, so an omitted key kept grading against
      // the old year instead of falling back to the current one.
      year: !isOneTime ? (formData.year ?? null) : null,
      allows_external_credit: formData.allows_external_credit,
      ...(formData.requirement_type === 'hours' || formData.requirement_type === 'shifts'
        ? { shift_credited: formData.shift_credited ?? formData.requirement_type === 'shifts' }
        : {}),
      applies_to_all: formData.applies_to_all,
      // Sent on every save, as [] when none is selected: an omitted key leaves
      // the stored list in place, and a stale member category outranks role
      // and position targeting when the requirement decides who it applies to.
      required_membership_types: formData.required_membership_types,
      // null when cleared, so emptying a date removes it instead of keeping the old one.
      due_date: blankToNull(formData.due_date),
      start_date: blankToNull(formData.start_date),
      due_date_type: formData.due_date_type,
      rolling_period_months:
        !isOneTime && formData.due_date_type === 'rolling' ? formData.rolling_period_months : undefined,
      period_start_month: usesCalendarPeriod ? formData.period_start_month : undefined,
      period_start_day: usesCalendarPeriod ? formData.period_start_day : undefined,
      // null for "Default (end of year)" / "Last day of month": a stored end
      // month keeps the custom window in force, so omitting it on a clear kept
      // grading against the old window. The end day means nothing without an
      // end month, and its input is disabled then, so it clears with it.
      period_end_month: usesCalendarPeriod ? (formData.period_end_month ?? null) : undefined,
      period_end_day: usesCalendarPeriod
        ? formData.period_end_month
          ? (formData.period_end_day ?? null)
          : null
        : undefined,
      include_current_month:
        formData.include_current_month_mode === 'inherit' ? null : formData.include_current_month_mode === 'include',
      // Sent on every save, as [] when none is selected, so removing the last
      // category stops it from crediting training rather than keeping it.
      category_ids: formData.category_ids,
      // Sent on every save, as an explicit null when unset, so switching back
      // to "apply to everyone" actually clears a stored cutoff.
      new_member_cutoff_date: grandfathers ? cutoffDate : null,
      existing_member_deadline: existingPolicy === ExistingMemberPolicy.CATCH_UP ? catchUpDeadline : null,
      // Preserve registry attribution when creating from a standards template
      ...(!requirement && template?.source ? { source: template.source } : {}),
      ...(!requirement && template?.registry_name ? { registry_name: template.registry_name } : {}),
      ...(!requirement && template?.registry_code ? { registry_code: template.registry_code } : {}),
    };

    if (requirement) {
      // Every edit asks who it reaches before anything is sent.
      pendingRefused.current = problems;
      setPendingUpdate(data);
      return;
    }
    await persist(data);
  };

  /** Show a failed save on the fields it names, or in the form when none does. */
  const showFailure = (err: unknown) => {
    const placed = fieldErrors.setFromApiError(err, 'Could not save the requirement. Try again.');
    if (Object.keys(placed).length > 0) fieldErrors.focusFirst(placed);
    else setSummaryFocus((n) => n + 1);
  };

  const persist = async (
    data: TrainingRequirementCreate | TrainingRequirementUpdate,
    // Fields refused before sending; only an edit for everyone reaches here with any.
    refused: FieldErrors<RequirementField> = {},
    // A save for new members creates a copy, so like a create it saves whole or not at all.
    partial = false
  ) => {
    savingRef.current = true;
    setSaving(true);
    try {
      if (!requirement || !partial) {
        await onSave(data, !!requirement, requirement?.id);
        return;
      }
      const payload = data as Record<string, unknown>;
      const result = await saveExceptRefused<RequirementField, void>({
        payload,
        refused,
        keysFor: (field) => REQUIREMENT_KEYS[field],
        // A full save keeps the three-argument call every caller was written
        // against; only a save that left a field out asks to stay open.
        send: (body) =>
          Object.keys(payload).some((key) => !(key in body))
            ? onSave(body, true, requirement.id, { keepOpen: true })
            : onSave(body, true, requirement.id),
        place: (err) => placeApiError(fields, err),
      });
      const first = firstRefused(Object.keys(fields) as RequirementField[], result.refused);
      if (first) {
        // The form stays open with the refused field flagged; what did save is
        // no longer an unsaved change.
        fieldErrors.setErrors(result.refused);
        fieldErrors.setFormError(
          `Requirement saved, except ${fields[first].label.toLowerCase()}. Fix it and save again.`
        );
        fieldErrors.focusFirst(result.refused);
        setBaseline(snapshot);
      }
    } catch (err: unknown) {
      showFailure(err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const grandfatheringChanged =
    !!requirement &&
    ((requirement.new_member_cutoff_date ?? null) !==
      (existingPolicy === ExistingMemberPolicy.APPLY_TO_ALL ? null : cutoffDate) ||
      (requirement.existing_member_deadline ?? null) !==
        (existingPolicy === ExistingMemberPolicy.CATCH_UP ? catchUpDeadline : null));

  const newMembersUnavailableReason = !canSplitForNewMembers(requirement)
    ? `This requirement already holds the earlier standard for members who joined before ${formatCalendarDate(
        requirement?.applies_to_joined_before
      )}. To change the standard for new members, edit the newer copy instead.`
    : grandfatheringChanged
      ? 'You changed how existing members are treated. Save that for everyone first, then edit the standard for new members separately.'
      : null;

  /** The target's refusal sits on whichever input holds this type's target. */
  const targetError = (id: string) => (errors.target && fields.target.id === id ? errors.target : undefined);
  const targetAria = (id: string, describedBy?: string) =>
    targetError(id)
      ? { 'aria-invalid': true as const, 'aria-describedby': [`${id}-error`, describedBy].filter(Boolean).join(' ') }
      : describedBy
        ? { 'aria-describedby': describedBy }
        : {};
  const targetMessage = (id: string) =>
    targetError(id) ? (
      <p id={`${id}-error`} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
        {targetError(id)}
      </p>
    ) : null;
  /** Error text and its id, for a hand-built field. */
  const fieldMessage = (name: RequirementField) =>
    errors[name] ? (
      <p id={`${fields[name].id}-error`} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
        {errors[name]}
      </p>
    ) : null;
  const fieldAria = (name: RequirementField) =>
    errors[name] ? { 'aria-invalid': true as const, 'aria-describedby': `${fields[name].id}-error` } : {};

  const handleCategoryToggle = (categoryId: string) => {
    setFormData((prev) => ({
      ...prev,
      category_ids: prev.category_ids.includes(categoryId)
        ? prev.category_ids.filter((id) => id !== categoryId)
        : [...prev.category_ids, categoryId],
    }));
  };

  return (
    <>
      <div
        className="modal-overlay z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="requirement-modal-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') requestClose();
        }}
      >
        <div ref={dialogRef} className="modal-panel max-h-[90dvh] w-full max-w-3xl overflow-y-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 id="requirement-modal-title" className="text-theme-text-primary text-xl font-bold">
              {requirement ? 'Edit Requirement' : 'Create Requirement'}
            </h3>
            <button
              type="button"
              onClick={requestClose}
              className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-2 transition-colors"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <form
            noValidate
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="space-y-6"
          >
            <ErrorSummary
              items={fieldErrors.summary}
              formError={fieldErrors.formError}
              focusKey={summaryFocus}
              title="Fix these and save again"
            />

            {/* Basic Info */}
            <div className="space-y-4">
              <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                Basic Information
              </h4>

              <FormField
                id={fields.name.id}
                label="Name"
                required
                error={errors.name}
                maxLength={NAME_MAX_LENGTH}
                count={formData.name.length}
                labelClassName="text-theme-text-secondary mb-2 block text-sm font-medium"
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      edited('name');
                    }}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., Annual Training Hours"
                  />
                )}
              </FormField>

              <FormField
                id={fields.description.id}
                label="Description"
                error={errors.description}
                labelClassName="text-theme-text-secondary mb-2 block text-sm font-medium"
              >
                {(field) => (
                  <textarea
                    {...field}
                    value={formData.description}
                    onChange={(e) => {
                      setFormData({ ...formData, description: e.target.value });
                      edited('description');
                    }}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="Describe the requirement..."
                    rows={3}
                  />
                )}
              </FormField>

              <div>
                <label
                  htmlFor="req-requirement-type"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Requirement Type{' '}
                  <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                    *
                  </span>
                </label>
                <select
                  id="req-requirement-type"
                  value={formData.requirement_type}
                  onChange={(e) => {
                    const reqType = e.target.value as RequirementType;
                    // Auto-set related fields when there's a direct mapping
                    const trainingTypeMap: Record<string, string> = {
                      certification: 'certification',
                      skills_evaluation: 'skills_practice',
                    };
                    const dueDateTypeMap: Record<string, DueDateType> = {
                      certification: 'certification_period',
                    };
                    const autoTrainingType = trainingTypeMap[reqType];
                    const autoDueDateType = dueDateTypeMap[reqType];
                    setFormData({
                      ...formData,
                      requirement_type: reqType,
                      ...(autoTrainingType ? { training_type: autoTrainingType } : {}),
                      ...(autoDueDateType ? { due_date_type: autoDueDateType } : {}),
                    });
                    edited('target');
                  }}
                  className="form-input"
                  aria-required="true"
                  {...targetAria('req-requirement-type')}
                >
                  <option value="hours">Hours</option>
                  <option value="courses">Courses</option>
                  <option value="certification">Certification</option>
                  <option value="shifts">Shifts</option>
                  <option value="calls">Calls</option>
                  <option value="skills_evaluation">Skills Evaluation</option>
                  <option value="checklist">Checklist</option>
                  <option value="knowledge_test">Knowledge Test</option>
                  <option value="evaluated_shifts">Evaluated Shifts</option>
                  <option value="transports">Transports</option>
                  <option value="refusals">Refusals</option>
                  <option value="evaluated_calls">Evaluated Calls</option>
                  <option value="session_attendance">Session Attendance</option>
                </select>
              </div>

              {/* Neither applies to session attendance, which counts linked
                  sessions attended and reads no record's type or hours. */}
              {formData.requirement_type !== 'session_attendance' && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="req-training-type"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Training Type
                    </label>
                    <select
                      id="req-training-type"
                      value={formData.training_type}
                      onChange={(e) => setFormData({ ...formData, training_type: e.target.value })}
                      className="form-input"
                    >
                      <option value="">Any Type</option>
                      <option value="certification">Certification</option>
                      <option value="continuing_education">Continuing Education</option>
                      <option value="skills_practice">Skills Practice</option>
                      <option value="orientation">Orientation</option>
                      <option value="refresher">Refresher</option>
                      <option value="specialty">Specialty</option>
                      <option value="policy_acknowledgment">Policy Acknowledgment</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="req-required-hours"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Required Hours
                      {formData.requirement_type === 'hours' && (
                        <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                          {' '}
                          *
                        </span>
                      )}
                    </label>
                    <input
                      id="req-required-hours"
                      type="number"
                      value={formData.required_hours || ''}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          required_hours: e.target.value ? Number(e.target.value) : undefined,
                        });
                        edited('target');
                      }}
                      className="form-input placeholder-theme-text-muted"
                      placeholder="e.g., 36"
                      min="0"
                      step="0.5"
                      {...(formData.requirement_type === 'hours' ? { 'aria-required': true as const } : {})}
                      {...targetAria('req-required-hours')}
                    />
                    {targetMessage('req-required-hours')}
                  </div>
                </div>
              )}

              {/* Per-type quantity fields */}
              {/* Courses are picked from the library, never typed: compliance
                matches a member's records by course id, so a typed-in course
                name never matches and the requirement could never complete. */}
              {(formData.requirement_type === 'courses' || formData.requirement_type === 'certification') && (
                <CourseLibraryPicker
                  idPrefix="req"
                  courses={courses}
                  loading={coursesLoading}
                  error={coursesError}
                  variant={formData.requirement_type === 'certification' ? 'certification' : 'courses'}
                  selectedIds={requiredCourses}
                  onChange={(ids) => {
                    setRequiredCourses(ids);
                    edited('target');
                  }}
                  fieldError={targetError('req-course-search')}
                />
              )}

              {(formData.requirement_type === 'courses' || formData.requirement_type === 'certification') && (
                <RecencyWindowField idPrefix="req" value={recencyDays} onChange={setRecencyDays} />
              )}

              {formData.requirement_type === 'shifts' && (
                <div>
                  <label
                    htmlFor="req-required-shifts"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Required Shifts{' '}
                    <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                      *
                    </span>
                  </label>
                  <input
                    id="req-required-shifts"
                    type="number"
                    value={formData.required_shifts || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        required_shifts: e.target.value ? Number(e.target.value) : undefined,
                      });
                      edited('target');
                    }}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 12"
                    min="1"
                    aria-required="true"
                    {...targetAria('req-required-shifts')}
                  />
                  {targetMessage('req-required-shifts')}
                </div>
              )}

              {formData.requirement_type === 'calls' && (
                <div>
                  <label
                    htmlFor="req-required-calls"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Required Calls{' '}
                    <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                      *
                    </span>
                  </label>
                  <input
                    id="req-required-calls"
                    type="number"
                    value={formData.required_calls || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, required_calls: e.target.value ? Number(e.target.value) : undefined });
                      edited('target');
                    }}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 24"
                    min="1"
                    aria-required="true"
                    {...targetAria('req-required-calls')}
                  />
                  {targetMessage('req-required-calls')}
                  <div className="mt-3">
                    <CallTypeRequirementPicker
                      value={formData.required_call_types}
                      onChange={(next) => setFormData({ ...formData, required_call_types: next })}
                    />
                  </div>
                </div>
              )}

              <EvaluationRequirementFields
                idPrefix="req"
                type={formData.requirement_type}
                shifts={formData.required_shifts?.toString() ?? ''}
                calls={formData.required_calls?.toString() ?? ''}
                transports={formData.required_transports?.toString() ?? ''}
                refusals={formData.required_refusals?.toString() ?? ''}
                excludesLowest={formData.evaluation_excludes_lowest_rating}
                onShiftsChange={(v) => {
                  setFormData({ ...formData, required_shifts: v ? Number(v) : undefined });
                  edited('target');
                }}
                onCallsChange={(v) => {
                  setFormData({ ...formData, required_calls: v ? Number(v) : undefined });
                  edited('target');
                }}
                onTransportsChange={(v) => {
                  setFormData({ ...formData, required_transports: v ? Number(v) : undefined });
                  edited('target');
                }}
                onRefusalsChange={(v) => {
                  setFormData({ ...formData, required_refusals: v ? Number(v) : undefined });
                  edited('target');
                }}
                onExcludesLowestChange={(v) => setFormData({ ...formData, evaluation_excludes_lowest_rating: v })}
                error={errors.target}
              />

              {formData.requirement_type === 'session_attendance' && (
                <div>
                  <label
                    htmlFor="req-attendance-pct"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Sessions to Attend (%){' '}
                    <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                      *
                    </span>
                  </label>
                  <input
                    id="req-attendance-pct"
                    type="number"
                    value={formData.required_attendance_pct || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        required_attendance_pct: e.target.value ? Number(e.target.value) : undefined,
                      });
                      edited('target');
                    }}
                    className="form-input placeholder-theme-text-muted"
                    placeholder="e.g., 60"
                    min="1"
                    max="100"
                    aria-required="true"
                    aria-describedby="req-attendance-pct-help"
                    {...targetAria('req-attendance-pct', 'req-attendance-pct-help')}
                  />
                  {targetMessage('req-attendance-pct')}
                  <p id="req-attendance-pct-help" className="text-theme-text-muted mt-1 text-xs">
                    Of the training sessions linked to this requirement and held in the period. Link sessions when you
                    create them or from their event pages; sessions not linked are optional. A waiver or leave covering
                    a session&apos;s day excuses the member from it.
                  </p>
                  <label className="text-theme-text-primary mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={formData.allows_chief_override}
                      onChange={(e) => setFormData({ ...formData, allows_chief_override: e.target.checked })}
                    />
                    Allow the Chief to override it for a member
                  </label>
                </div>
              )}

              {formData.requirement_type === 'checklist' && (
                <ChecklistItemsEditor
                  idPrefix="req"
                  items={formData.checklist_items}
                  onChange={(items) => setFormData({ ...formData, checklist_items: items })}
                />
              )}

              {formData.requirement_type === 'knowledge_test' && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="req-passing-score"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Passing Score (%){' '}
                      <span aria-hidden="true" className="text-red-700 dark:text-red-400">
                        *
                      </span>
                    </label>
                    <input
                      id="req-passing-score"
                      type="number"
                      value={formData.passing_score || ''}
                      onChange={(e) => {
                        setFormData({
                          ...formData,
                          passing_score: e.target.value ? Number(e.target.value) : undefined,
                        });
                        edited('target');
                      }}
                      className="form-input placeholder-theme-text-muted"
                      placeholder="e.g., 80"
                      min="1"
                      max="100"
                      aria-required="true"
                      {...targetAria('req-passing-score')}
                    />
                    {targetMessage('req-passing-score')}
                  </div>
                  <div>
                    <label
                      htmlFor="req-max-attempts"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Max Attempts
                    </label>
                    <input
                      id="req-max-attempts"
                      type="number"
                      value={formData.max_attempts || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, max_attempts: e.target.value ? Number(e.target.value) : undefined })
                      }
                      className="form-input placeholder-theme-text-muted"
                      placeholder="Unlimited"
                      min="1"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Due Date Configuration */}
            <div className="space-y-4">
              <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                Due Date Configuration
              </h4>

              {/* Frequency comes first: it decides whether any of the recurring
                cycle controls below apply at all. */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="req-frequency" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Frequency
                  </label>
                  <select
                    id="req-frequency"
                    value={formData.frequency}
                    onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RequirementFrequency })}
                    className="form-input"
                  >
                    <option value="annual">Annual</option>
                    <option value="biannual">Every 2 Years</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                    <option value="one_time">One Time</option>
                  </select>
                </div>

                {!isOneTime && (
                  <div>
                    <label htmlFor="req-year" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                      Year
                    </label>
                    <input
                      id="req-year"
                      type="number"
                      value={formData.year || ''}
                      onChange={(e) => {
                        setFormData({ ...formData, year: e.target.value ? Number(e.target.value) : undefined });
                        edited('year');
                      }}
                      className="form-input placeholder-theme-text-muted"
                      placeholder="e.g., 2026"
                      min="2020"
                      max="2100"
                      {...fieldAria('year')}
                    />
                    {fieldMessage('year')}
                  </div>
                )}
              </div>

              {isOneTime && (
                <div className="flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2">
                  <CheckCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    One-time requirements never reset. Once a member completes this, they stay compliant permanently —
                    there is no renewal cycle, compliance period, or year to configure.
                  </p>
                </div>
              )}

              {!isOneTime && (
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Due Date Type</label>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label="Due date type">
                    {[
                      {
                        value: 'calendar_period',
                        label: 'Calendar Period',
                        desc: 'Due by end of period (e.g., Dec 31)',
                      },
                      { value: 'rolling', label: 'Rolling', desc: 'Due X months from last completion' },
                      { value: 'certification_period', label: 'Cert Period', desc: 'Due when certification expires' },
                      { value: 'fixed_date', label: 'Fixed Date', desc: 'Due by a specific date' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={formData.due_date_type === option.value}
                        onClick={() => setFormData({ ...formData, due_date_type: option.value as DueDateType })}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          formData.due_date_type === option.value
                            ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                            : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                        }`}
                      >
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-theme-text-muted mt-1 text-xs">{option.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Rolling period options */}
              {!isOneTime && formData.due_date_type === 'rolling' && (
                <div>
                  <label
                    htmlFor="req-rolling-period"
                    className="text-theme-text-secondary mb-2 block text-sm font-medium"
                  >
                    Rolling Period (Months)
                  </label>
                  <input
                    id="req-rolling-period"
                    type="number"
                    value={formData.rolling_period_months}
                    onChange={(e) => setFormData({ ...formData, rolling_period_months: Number(e.target.value) })}
                    className="form-input"
                    min="1"
                    max="120"
                  />
                  <p className="text-theme-text-muted mt-1 text-sm">
                    Training must be completed every {formData.rolling_period_months} months from the last completion
                    date.
                  </p>
                </div>
              )}

              {/* Calendar period options */}
              {!isOneTime && formData.due_date_type === 'calendar_period' && (
                <>
                  <div className="grid grid-cols-2 items-end gap-4">
                    <div>
                      <label
                        htmlFor="req-period-start-month"
                        className="text-theme-text-secondary mb-2 block text-sm font-medium"
                      >
                        Period Start Month
                      </label>
                      <select
                        id="req-period-start-month"
                        value={formData.period_start_month}
                        onChange={(e) => setFormData({ ...formData, period_start_month: Number(e.target.value) })}
                        className="form-input"
                      >
                        {[
                          'January',
                          'February',
                          'March',
                          'April',
                          'May',
                          'June',
                          'July',
                          'August',
                          'September',
                          'October',
                          'November',
                          'December',
                        ].map((month, idx) => (
                          <option key={idx} value={idx + 1}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="req-period-start-day"
                        className="text-theme-text-secondary mb-2 block text-sm font-medium"
                      >
                        Period Start Day
                      </label>
                      <input
                        id="req-period-start-day"
                        type="number"
                        value={formData.period_start_day}
                        onChange={(e) => setFormData({ ...formData, period_start_day: Number(e.target.value) })}
                        className="form-input"
                        min="1"
                        max="31"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 items-end gap-4">
                    <div>
                      <label
                        htmlFor="req-period-end-month"
                        className="text-theme-text-secondary mb-2 block text-sm font-medium"
                      >
                        Period End Month (Optional)
                      </label>
                      <select
                        id="req-period-end-month"
                        value={formData.period_end_month || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            period_end_month: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        className="form-input"
                      >
                        <option value="">Default (end of year)</option>
                        {[
                          'January',
                          'February',
                          'March',
                          'April',
                          'May',
                          'June',
                          'July',
                          'August',
                          'September',
                          'October',
                          'November',
                          'December',
                        ].map((month, idx) => (
                          <option key={idx} value={idx + 1}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="req-period-end-day"
                        className="text-theme-text-secondary mb-2 block text-sm font-medium"
                      >
                        Period End Day
                      </label>
                      <input
                        id="req-period-end-day"
                        type="number"
                        value={formData.period_end_day || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            period_end_day: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        className="form-input"
                        min="1"
                        max="31"
                        disabled={!formData.period_end_month}
                        placeholder={formData.period_end_month ? 'Last day of month' : ''}
                      />
                    </div>
                  </div>
                  {formData.period_end_month && formData.period_start_month > formData.period_end_month && (
                    <p className="text-theme-text-muted text-sm">
                      Cross-year window: completions accepted from month {formData.period_start_month} of the previous
                      year through month {formData.period_end_month}, day {formData.period_end_day || 'last'} of the
                      current year.
                    </p>
                  )}
                </>
              )}

              {/* Fixed date option */}
              {!isOneTime && formData.due_date_type === 'fixed_date' && (
                <div>
                  <label htmlFor="req-due-date" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Due Date
                  </label>
                  <input
                    id="req-due-date"
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="form-input"
                  />
                </div>
              )}

              {/* Evaluation period boundary (per-requirement override) */}
              <div>
                <label
                  htmlFor="req-include-current-month"
                  className="text-theme-text-secondary mb-2 block text-sm font-medium"
                >
                  Evaluation Period
                </label>
                <select
                  id="req-include-current-month"
                  value={formData.include_current_month_mode}
                  onChange={(e) => setFormData({ ...formData, include_current_month_mode: e.target.value })}
                  className="form-input"
                >
                  <option value="inherit">Use department default</option>
                  <option value="include">Count the current (in-progress) month</option>
                  <option value="exclude">Stop at the end of the previous month</option>
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Controls whether this requirement counts the in-progress month. Choose &ldquo;stop at the end of the
                  previous month&rdquo; for drills held late in the month so members aren&rsquo;t flagged early.
                  Defaults to the department-wide compliance setting.
                </p>
              </div>
            </div>

            {/* Categories */}
            {categories.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                  Training Categories
                </h4>
                <p className="text-theme-text-muted text-sm">
                  Select categories that can satisfy this requirement. Training sessions tagged with these categories
                  will count towards completion.
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Training categories">
                  {categories
                    .filter((c) => c.active)
                    .map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => handleCategoryToggle(category.id)}
                        aria-pressed={formData.category_ids.includes(category.id)}
                        className={`flex items-center space-x-2 rounded-lg border px-3 py-2 transition-colors ${
                          formData.category_ids.includes(category.id)
                            ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                            : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                        }`}
                      >
                        {category.color && (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: category.color }}
                            aria-hidden="true"
                          />
                        )}
                        <span>{category.name}</span>
                        {formData.category_ids.includes(category.id) && (
                          <CheckCircle className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* External / imported training credit — flagged so the officer makes
              a deliberate choice about whether third-party courses count. */}
            {(formData.requirement_type === 'hours' || formData.requirement_type === 'courses') && (
              <div className="space-y-3">
                <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                  External / Imported Training Credit
                </h4>
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <AlertCircle
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <div className="space-y-2">
                    <p className="text-theme-text-secondary text-sm">
                      {formData.allows_external_credit ? (
                        <>
                          Imported courses <strong>will</strong> count toward this requirement when they carry a
                          matching category (e.g. a Vector Solutions completion).
                        </>
                      ) : (
                        <>
                          By default, courses imported from an external provider (e.g. Vector Solutions){' '}
                          <strong>will not</strong> count toward this requirement — it can only be satisfied by an
                          in-house session, a skills test, or manual sign-off.
                        </>
                      )}
                    </p>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={formData.allows_external_credit}
                        onChange={(e) => setFormData({ ...formData, allows_external_credit: e.target.checked })}
                        className="form-checkbox mt-0.5"
                      />
                      <span className="text-theme-text-secondary text-sm">
                        Accept external / imported training credit for this requirement
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Which requirements are graded from shifts worked. A ticked SHIFTS
              requirement is counted from finalized shift attendance on every
              screen; a ticked HOURS requirement only on the scheduling Shift
              Compliance report, the training screens grading it from records. */}
            {(formData.requirement_type === 'hours' || formData.requirement_type === 'shifts') && (
              <div className="space-y-3">
                <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                  Shift Credit
                </h4>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={formData.shift_credited ?? formData.requirement_type === 'shifts'}
                    onChange={(e) => setFormData({ ...formData, shift_credited: e.target.checked })}
                    className="form-checkbox mt-0.5"
                  />
                  <span className="text-theme-text-secondary text-sm">
                    Shift attendance satisfies this requirement
                    <span className="text-theme-text-muted block text-xs">
                      {formData.requirement_type === 'shifts'
                        ? 'Counted from finalized shifts worked, including counted external shifts, on every compliance screen. Unticked, it counts training records instead and is left off the Shift Compliance report.'
                        : 'Graded from shifts worked on the scheduling Shift Compliance report. Leave unticked for training hours, which are graded from training records.'}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Assignment */}
            <div className="space-y-4">
              <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                Assignment
              </h4>

              <div>
                <label className="flex cursor-pointer items-center space-x-3">
                  <input
                    id="req-applies-to-all"
                    type="checkbox"
                    checked={formData.applies_to_all}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        applies_to_all: e.target.checked,
                        ...(e.target.checked ? { required_membership_types: [] } : {}),
                      });
                      edited('audience');
                    }}
                    className="form-checkbox"
                    {...fieldAria('audience')}
                  />
                  <span className="text-theme-text-secondary">Applies to all members</span>
                </label>
                <p className="text-theme-text-muted mt-1 ml-8 text-sm">
                  When checked, this requirement applies to everyone in the organization.
                </p>
                {fieldMessage('audience')}
              </div>

              {/* Member Categories - shown when not applies_to_all */}
              {!formData.applies_to_all && (
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Member Categories</label>
                  <p className="text-theme-text-muted mb-3 text-sm">
                    Select which member categories this requirement applies to.
                  </p>
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      aria-pressed={allOperationalSelected}
                      onClick={toggleOperational}
                      className={`mobile-touch-target inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                        allOperationalSelected
                          ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                          : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:text-theme-text-primary'
                      }`}
                    >
                      {allOperationalSelected && (
                        <CheckCircle className="h-4 w-4 text-red-700 dark:text-red-300" aria-hidden="true" />
                      )}
                      Operational members
                    </button>
                    <span className="text-theme-text-muted text-xs">
                      {operationalSummary} — the operational members still serving. Tick Retired yourself to include
                      them.
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3" role="group" aria-label="Member categories">
                    {renderedMembershipTypes.map((memberType) => (
                      <label
                        key={memberType.value}
                        className={`flex cursor-pointer items-center space-x-3 rounded-lg border px-3 py-2 transition-colors ${
                          formData.required_membership_types.includes(memberType.value)
                            ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                            : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.required_membership_types.includes(memberType.value)}
                          onChange={() => {
                            edited('audience');
                            setFormData((prev) => ({
                              ...prev,
                              required_membership_types: prev.required_membership_types.includes(memberType.value)
                                ? prev.required_membership_types.filter((v) => v !== memberType.value)
                                : [...prev.required_membership_types, memberType.value],
                            }));
                          }}
                          className="form-checkbox"
                        />
                        <span className="text-sm">{memberType.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="req-start-date" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Start Date
                  </label>
                  <input
                    id="req-start-date"
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="form-input"
                  />
                </div>
              </div>
            </div>

            {/* Existing members (grandfathering) */}
            <div className="space-y-4">
              <h4 className="text-theme-text-primary border-theme-surface-border border-b pb-2 font-semibold">
                Existing Members
              </h4>
              <p className="text-theme-text-muted text-sm">
                Decide whether members who were already on the roster are held to this requirement. A member&rsquo;s
                join date is their hire date, or the date their account was created if no hire date is recorded.
              </p>
              {requirement?.applies_to_joined_before && (
                <div className="flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2">
                  <CheckCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    This is the earlier standard. It only applies to members who joined before{' '}
                    {formatCalendarDate(requirement.applies_to_joined_before)}; a newer copy covers everyone after.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="radiogroup" aria-label="Existing members">
                {[
                  {
                    value: ExistingMemberPolicy.APPLY_TO_ALL,
                    label: 'Apply to everyone',
                    desc: 'Every member it applies to is held to it now',
                  },
                  {
                    value: ExistingMemberPolicy.EXEMPT,
                    label: 'Exempt existing members',
                    desc: 'Only members who join on or after the cutoff',
                  },
                  {
                    value: ExistingMemberPolicy.CATCH_UP,
                    label: 'Give a catch-up deadline',
                    desc: 'Existing members have until a date to meet it',
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={existingPolicy === option.value}
                    onClick={() => {
                      setExistingPolicy(option.value);
                      edited('cutoff', 'deadline');
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      existingPolicy === option.value
                        ? 'text-theme-text-primary border-red-500 bg-red-500/20'
                        : 'border-theme-input-border bg-theme-input-bg text-theme-text-secondary hover:border-theme-input-border'
                    }`}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-theme-text-muted mt-1 text-xs">{option.desc}</div>
                  </button>
                ))}
              </div>
              {existingPolicy !== ExistingMemberPolicy.APPLY_TO_ALL && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="req-cutoff-date"
                      className="text-theme-text-secondary mb-2 block text-sm font-medium"
                    >
                      Existing members joined before
                    </label>
                    <input
                      id="req-cutoff-date"
                      type="date"
                      value={cutoffDate}
                      onChange={(e) => {
                        setCutoffDate(e.target.value);
                        edited('cutoff');
                      }}
                      className="form-input"
                      aria-required="true"
                      {...fieldAria('cutoff')}
                    />
                    {fieldMessage('cutoff')}
                  </div>
                  {existingPolicy === ExistingMemberPolicy.CATCH_UP && (
                    <div>
                      <label
                        htmlFor="req-catch-up-deadline"
                        className="text-theme-text-secondary mb-2 block text-sm font-medium"
                      >
                        Existing members must meet it by
                      </label>
                      <input
                        id="req-catch-up-deadline"
                        type="date"
                        value={catchUpDeadline}
                        onChange={(e) => {
                          setCatchUpDeadline(e.target.value);
                          edited('deadline');
                        }}
                        className="form-input"
                        aria-required="true"
                        {...fieldAria('deadline')}
                      />
                      {fieldMessage('deadline')}
                    </div>
                  )}
                </div>
              )}
              {existingPolicy === ExistingMemberPolicy.CATCH_UP && (
                <p className="text-theme-text-muted text-xs">
                  Until the deadline, an existing member who hasn&rsquo;t met this sees it as due by that date, and it
                  doesn&rsquo;t count against their compliance.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="border-theme-surface-border flex justify-end space-x-3 border-t pt-4">
              <button
                type="button"
                onClick={requestClose}
                className="bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-success">
                {saving ? 'Saving...' : requirement ? 'Update Requirement' : 'Create Requirement'}
              </button>
            </div>
          </form>
        </div>
      </div>
      {/* A sibling of the editor's overlay, not a child: the overlay closes the
        editor on Escape, and an Escape meant for this dialog would otherwise
        bubble up and discard every unsaved edit. */}
      <ChangeScopeDialog
        isOpen={pendingUpdate !== null}
        today={today}
        newMembersUnavailableReason={newMembersUnavailableReason}
        onCancel={() => setPendingUpdate(null)}
        onChoose={(scope, effectiveDate) => {
          const data = pendingUpdate;
          setPendingUpdate(null);
          if (!data) return;
          const forEveryone = scope !== RequirementChangeScope.NEW_MEMBERS_ONLY;
          const refused = pendingRefused.current;
          if (!forEveryone && Object.keys(refused).length > 0) {
            fieldErrors.setFormError('Saving for new members makes a new copy, so fix these first.');
            fieldErrors.focusFirst(refused);
            return;
          }
          void persist(
            {
              ...data,
              apply_to: scope,
              ...(!forEveryone && effectiveDate ? { effective_date: effectiveDate } : {}),
            },
            refused,
            forEveryone
          );
        }}
      />
    </>
  );
};
