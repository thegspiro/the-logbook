import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  GraduationCap,
  FileText,
  AlertCircle,
  CheckCircle,
  QrCode,
  ArrowLeft,
  MapPin,
  Repeat,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { TrainingSessionCreate, TrainingType, TrainingCourse } from '../types/training';
import type { RecurrencePattern } from '../types/event';
import type { User } from '../types/user';
import type { Location } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';
import { userService, locationsService, trainingSessionService, trainingService } from '../services/api';
import { schedulingService } from '../modules/scheduling/services/api';
import { useRanks } from '../hooks/useRanks';

const RECURRENCE_PATTERNS: { value: RecurrencePattern; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly (same date)' },
  { value: 'monthly_weekday', label: 'Monthly (by weekday)' },
  { value: 'annually', label: 'Annually' },
  { value: 'annually_weekday', label: 'Annually (by weekday)' },
  { value: 'custom', label: 'Custom Days' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ORDINALS = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: '5th' },
  { value: -1, label: 'Last' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Create Training Session Page
 *
 * Creates a training event that automatically:
 * - Generates an Event with QR code for check-in
 * - Links to a TrainingCourse (existing or new)
 * - Auto-creates TrainingRecords when members check in
 * - Supports recurring sessions with the same recurrence patterns as events
 */
const CreateTrainingSessionPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { formatRank } = useRanks();
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [availableCourses, setAvailableCourses] = useState<TrainingCourse[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [apparatusList, setApparatusList] = useState<Array<{ id: string; name: string }>>([]);
  const [instructorId, setInstructorId] = useState('');
  const [apparatusId, setApparatusId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationMode, setLocationMode] = useState<'select' | 'other'>('select');

  // Recurrence state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>('weekly');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceCustomDays, setRecurrenceCustomDays] = useState<number[]>([]);
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(0);
  const [recurrenceWeekOrdinal, setRecurrenceWeekOrdinal] = useState(1);
  const [recurrenceMonth, setRecurrenceMonth] = useState(1);

  // Form data
  const [formData, setFormData] = useState<TrainingSessionCreate>({
    title: '',
    description: '',
    location_id: undefined,
    location: '',
    location_details: '',
    start_datetime: '',
    end_datetime: '',
    requires_rsvp: true,
    rsvp_deadline: '',
    max_attendees: undefined,
    is_mandatory: false,
    use_existing_course: false,
    course_id: '',
    course_name: '',
    course_code: '',
    training_type: 'continuing_education',
    credit_hours: 0,
    instructor: '',
    issues_certification: false,
    certification_number_prefix: '',
    issuing_agency: '',
    expiration_months: undefined,
    prerequisites: [],
    materials_required: [],
    auto_create_records: true,
    require_completion_confirmation: false,
  });

  useEffect(() => {
    // Load available courses, members, apparatus, and locations from API
    trainingService.getCourses().then(setAvailableCourses).catch(() => { /* non-critical */ });
    userService.getUsers().then(setMembers).catch(() => { /* non-critical */ });
    schedulingService.getBasicApparatus({ is_active: true }).then((data) => {
      setApparatusList(data.map((a) => ({ id: a.id, name: a.name || a.unit_number || 'Unknown' })));
    }).catch(() => { /* non-critical */ });
    locationsService.getLocations({ is_active: true }).then((data) => {
      setLocations(data);
      if (data.length === 0) setLocationMode('other');
    }).catch(() => {
      setLocationMode('other');
    });
  }, []);

  const updateField = (field: keyof TrainingSessionCreate, value: TrainingSessionCreate[keyof TrainingSessionCreate]) => {
    setFormData({ ...formData, [field]: value });
  };

  const getRecurrenceLabel = (): string => {
    const match = RECURRENCE_PATTERNS.find(p => p.value === recurrencePattern);
    return match?.label ?? recurrencePattern;
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.title || !formData.start_datetime || !formData.end_datetime) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!formData.use_existing_course && !formData.course_name) {
      toast.error('Please provide a course name or select an existing course');
      return;
    }

    if (isRecurring && !recurrenceEndDate) {
      toast.error('Recurrence end date is required');
      return;
    }

    if (isRecurring && recurrencePattern === 'custom' && recurrenceCustomDays.length === 0) {
      toast.error('Select at least one day for custom recurrence');
      return;
    }

    setSaving(true);

    try {
      // Convert local datetime-local values to UTC before sending to backend
      // Use || to coerce empty strings to undefined so they are omitted from
      // the JSON payload. Pydantic rejects "" for Optional[UUID] / Optional[datetime].
      const submitData: TrainingSessionCreate = {
        ...formData,
        start_datetime: localToUTC(formData.start_datetime, tz),
        end_datetime: localToUTC(formData.end_datetime, tz),
        rsvp_deadline: formData.rsvp_deadline ? localToUTC(formData.rsvp_deadline, tz) : undefined,
        description: formData.description?.trim() || undefined,
        location_id: formData.location_id || undefined,
        location: formData.location?.trim() || undefined,
        location_details: formData.location_details?.trim() || undefined,
        course_id: formData.course_id || undefined,
        course_name: formData.course_name?.trim() || undefined,
        course_code: formData.course_code?.trim() || undefined,
        instructor: formData.instructor?.trim() || undefined,
        certification_number_prefix: formData.certification_number_prefix?.trim() || undefined,
        issuing_agency: formData.issuing_agency?.trim() || undefined,
      };

      if (isRecurring) {
        // Create recurring training sessions
        const needsWeekday = recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday';
        const recurringData = {
          ...submitData,
          recurrence_pattern: recurrencePattern,
          recurrence_end_date: localToUTC(recurrenceEndDate + 'T23:59', tz),
          recurrence_custom_days: recurrencePattern === 'custom' ? recurrenceCustomDays : undefined,
          recurrence_weekday: needsWeekday ? recurrenceWeekday : undefined,
          recurrence_week_ordinal: needsWeekday ? recurrenceWeekOrdinal : undefined,
          recurrence_month: recurrencePattern === 'annually_weekday' ? recurrenceMonth : undefined,
        };

        const sessions = await trainingSessionService.createRecurringSessions(recurringData);
        toast.success(`Created ${sessions.length} recurring training sessions!`);

        // Navigate to the first event in the series
        const firstSession = sessions[0];
        if (firstSession?.event_id) {
          navigate(`/events/${firstSession.event_id}`);
        } else {
          navigate('/training/admin');
        }
      } else {
        // Create single training session
        const response = await trainingSessionService.createSession(submitData);
        toast.success('Training session created successfully!');

        if (response.event_id) {
          navigate(`/events/${response.event_id}`);
        } else {
          navigate('/training/officer');
        }
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create training session'));
      setSaving(false);
    }
  };

  const steps = [
    { number: 1, title: 'Event Details', icon: Calendar },
    { number: 2, title: 'Training Info', icon: GraduationCap },
    { number: 3, title: 'Settings', icon: FileText },
    { number: 4, title: 'Review', icon: CheckCircle },
  ];

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/training/officer')}
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Training Sessions
          </button>
          <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
            <Calendar className="w-8 h-8 text-red-700" />
            <span>Create Training Session</span>
          </h1>
          <p className="text-theme-text-muted mt-1">
            Schedule a training event with automatic attendance tracking via QR code
          </p>
        </div>

        {/* Progress Steps */}
        <div className="card mb-8 p-6">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.number === currentStep;
              const isComplete = step.number < currentStep;

              return (
                <React.Fragment key={step.number}>
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                        isComplete
                          ? 'bg-green-600 border-green-600'
                          : isActive
                          ? 'bg-red-600 border-red-600'
                          : 'bg-theme-input-bg border-theme-input-border'
                      }`}
                    >
                      {isComplete ? (
                        <CheckCircle className="w-6 h-6 text-white" />
                      ) : (
                        <Icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-theme-text-muted'}`} />
                      )}
                    </div>
                    <p
                      className={`mt-2 text-sm font-medium ${
                        isActive ? 'text-theme-text-primary' : 'text-theme-text-muted'
                      }`}
                    >
                      {step.title}
                    </p>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="flex-1 h-0.5 bg-theme-surface-hover mx-4" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Form Content */}
        <div className="card p-8 space-y-8">
          {/* Step 1: Event Details */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-theme-text-primary mb-4">Event Details</h2>

              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                  Training Title <span className="text-red-700">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder="e.g., CPR/AED Renewal Training"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="Training objectives, topics covered, etc."
                  rows={4}
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              {/* Date and Time */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                    Start Date & Time <span className="text-red-700">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    step="900"
                    value={formatForDateTimeInput(formData.start_datetime, tz)}
                    onChange={(e) => updateField('start_datetime', e.target.value)}
                    className="form-input py-3"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                    End Date & Time <span className="text-red-700">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    step="900"
                    value={formatForDateTimeInput(formData.end_datetime, tz)}
                    onChange={(e) => updateField('end_datetime', e.target.value)}
                    className="form-input py-3"
                  />
                </div>
              </div>

              {/* Recurring Training */}
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="is-recurring"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="form-checkbox"
                  />
                  <label htmlFor="is-recurring" className="text-theme-text-secondary text-sm flex items-center gap-2">
                    <Repeat className="w-4 h-4" />
                    Make this a recurring training session
                  </label>
                </div>

                {isRecurring && (
                  <div className="space-y-4 pl-6 border-l-2 border-red-500/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                          Repeats <span className="text-red-700">*</span>
                        </label>
                        <select
                          value={recurrencePattern}
                          onChange={(e) => setRecurrencePattern(e.target.value as RecurrencePattern)}
                          className="form-input py-3"
                        >
                          {RECURRENCE_PATTERNS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                          Repeat Until <span className="text-red-700">*</span>
                        </label>
                        <input
                          type="date"
                          value={recurrenceEndDate}
                          onChange={(e) => setRecurrenceEndDate(e.target.value)}
                          className="form-input py-3"
                        />
                      </div>
                    </div>

                    {recurrencePattern === 'custom' && (
                      <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                          Days of the Week
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map((day, index) => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => {
                                setRecurrenceCustomDays((prev) =>
                                  prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]
                                );
                              }}
                              className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                recurrenceCustomDays.includes(index)
                                  ? 'bg-red-700 text-white border-red-700'
                                  : 'text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary'
                              }`}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {(recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Which Occurrence
                          </label>
                          <select
                            value={recurrenceWeekOrdinal}
                            onChange={(e) => setRecurrenceWeekOrdinal(parseInt(e.target.value))}
                            className="form-input py-3"
                          >
                            {ORDINALS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                            Day of Week
                          </label>
                          <select
                            value={recurrenceWeekday}
                            onChange={(e) => setRecurrenceWeekday(parseInt(e.target.value))}
                            className="form-input py-3"
                          >
                            {WEEKDAYS.map((day, index) => (
                              <option key={day} value={index}>{day}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {recurrencePattern === 'annually_weekday' && (
                      <div className="max-w-xs">
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                          Month
                        </label>
                        <select
                          value={recurrenceMonth}
                          onChange={(e) => setRecurrenceMonth(parseInt(e.target.value))}
                          className="form-input py-3"
                        >
                          {MONTHS.map((m, index) => (
                            <option key={m} value={index + 1}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Location */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Location
                    </label>
                    {locations.length > 0 ? (
                      <select
                        value={locationMode === 'other' ? '__other__' : (formData.location_id || '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__other__') {
                            setLocationMode('other');
                            updateField('location_id', undefined);
                            updateField('location', '');
                          } else if (val) {
                            setLocationMode('select');
                            updateField('location_id', val);
                            updateField('location', undefined);
                          } else {
                            setLocationMode('select');
                            updateField('location_id', undefined);
                            updateField('location', undefined);
                          }
                        }}
                        className="form-input py-3"
                      >
                        <option value="">-- Select a location --</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}{loc.building ? ` (${loc.building})` : ''}{loc.room_number ? ` #${loc.room_number}` : ''}
                          </option>
                        ))}
                        <option value="__other__">Other (off-site / enter manually)</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={formData.location || ''}
                        onChange={(e) => updateField('location', e.target.value)}
                        placeholder="e.g., Station 1 Training Room"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      {locationMode === 'other' ? 'Location Name / Address' : 'Location Details'}
                    </label>
                    {locationMode === 'other' && locations.length > 0 ? (
                      <input
                        type="text"
                        value={formData.location || ''}
                        onChange={(e) => updateField('location', e.target.value)}
                        placeholder="e.g., City Hall — 123 Main St"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    ) : (
                      <input
                        type="text"
                        value={formData.location_details || ''}
                        onChange={(e) => updateField('location_details', e.target.value)}
                        placeholder="Additional directions or room info"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    )}
                  </div>
                </div>
                {/* Selected location details */}
                {locationMode === 'select' && formData.location_id && (() => {
                  const selected = locations.find(l => l.id === formData.location_id);
                  if (!selected) return null;
                  const address = [selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(', ');
                  return (
                    <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                      <MapPin className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <div className="text-sm">
                        <p className="font-medium text-theme-text-primary">{selected.name}</p>
                        {address && <p className="text-theme-text-secondary">{address}</p>}
                        <div className="flex flex-wrap gap-3 mt-1">
                          {selected.building && <span className="text-xs text-theme-text-muted">Building: {selected.building}</span>}
                          {selected.floor && <span className="text-xs text-theme-text-muted">Floor {selected.floor}</span>}
                          {selected.capacity && <span className="text-xs text-theme-text-muted">Capacity: {selected.capacity}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* RSVP Settings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="requires_rsvp"
                    checked={formData.requires_rsvp}
                    onChange={(e) => updateField('requires_rsvp', e.target.checked)}
                    className="form-checkbox"
                  />
                  <label htmlFor="requires_rsvp" className="text-theme-text-secondary text-sm">
                    Require RSVP
                  </label>
                </div>
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="is_mandatory"
                    checked={formData.is_mandatory}
                    onChange={(e) => updateField('is_mandatory', e.target.checked)}
                    className="form-checkbox"
                  />
                  <label htmlFor="is_mandatory" className="text-theme-text-secondary text-sm">
                    Mandatory Training
                  </label>
                </div>
              </div>

              {formData.requires_rsvp && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      RSVP Deadline
                    </label>
                    <input
                      type="datetime-local"
                      step="900"
                      value={formatForDateTimeInput(formData.rsvp_deadline, tz)}
                      onChange={(e) => updateField('rsvp_deadline', e.target.value)}
                      className="form-input py-3"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Max Participants
                    </label>
                    <input
                      type="number"
                      value={formData.max_attendees || ''}
                      onChange={(e) => { const n = parseInt(e.target.value); updateField('max_attendees', Number.isNaN(n) ? undefined : n); }}
                      placeholder="Unlimited"
                      className="form-input placeholder-theme-text-muted py-3"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Training Info */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-theme-text-primary mb-4">Training Information</h2>

              {/* Use Existing Course or Create New */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-blue-700 mt-0.5 mr-3 shrink-0" />
                  <div className="flex-1">
                    <p className="text-blue-700 font-semibold mb-2">Course Selection</p>
                    <div className="space-y-3">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          checked={!formData.use_existing_course}
                          onChange={() => updateField('use_existing_course', false)}
                          className="w-4 h-4 text-blue-600 focus:ring-theme-focus-ring"
                        />
                        <span className="text-theme-text-secondary text-sm">Create new course for this training</span>
                      </label>
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          checked={formData.use_existing_course}
                          onChange={() => updateField('use_existing_course', true)}
                          className="w-4 h-4 text-blue-600 focus:ring-theme-focus-ring"
                        />
                        <span className="text-theme-text-secondary text-sm">Use existing course template</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {formData.use_existing_course ? (
                /* Existing Course Selection */
                <div>
                  <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                    Select Course <span className="text-red-700">*</span>
                  </label>
                  <select
                    value={formData.course_id}
                    onChange={(e) => {
                      const courseId = e.target.value;
                      updateField('course_id', courseId);
                      // Auto-populate fields from selected course
                      const course = availableCourses.find(c => c.id === courseId);
                      if (course) {
                        setFormData(prev => ({
                          ...prev,
                          course_id: courseId,
                          course_name: course.name,
                          course_code: course.code || '',
                          training_type: course.training_type || prev.training_type,
                          credit_hours: course.credit_hours ?? prev.credit_hours,
                          instructor: course.instructor || prev.instructor,
                          expiration_months: course.expiration_months ?? prev.expiration_months,
                          max_attendees: course.max_participants ?? prev.max_attendees,
                        }));
                      }
                    }}
                    className="form-input py-3"
                  >
                    <option value="">Select a course...</option>
                    {availableCourses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code ? `${course.code} - ` : ''}{course.name}
                      </option>
                    ))}
                  </select>
                  {/* Show selected course details */}
                  {formData.course_id && (() => {
                    const course = availableCourses.find(c => c.id === formData.course_id);
                    if (!course) return null;
                    return (
                      <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                        <p className="text-sm font-medium text-theme-text-primary">{course.name}</p>
                        {course.description && (
                          <p className="text-xs text-theme-text-secondary mt-1">{course.description}</p>
                        )}
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-theme-text-muted">
                          <span>Type: {course.training_type}</span>
                          {course.credit_hours != null && <span>Credits: {course.credit_hours}h</span>}
                          {course.expiration_months && <span>Expires: {course.expiration_months} months</span>}
                          {course.instructor && <span>Instructor: {course.instructor}</span>}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                /* New Course Fields */
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                        Course Name <span className="text-red-700">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.course_name}
                        onChange={(e) => updateField('course_name', e.target.value)}
                        placeholder="e.g., CPR/AED for Healthcare Providers"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                        Course Code
                      </label>
                      <input
                        type="text"
                        value={formData.course_code}
                        onChange={(e) => updateField('course_code', e.target.value)}
                        placeholder="e.g., CPR-HCP"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                        Training Type <span className="text-red-700">*</span>
                      </label>
                      <select
                        value={formData.training_type}
                        onChange={(e) => updateField('training_type', e.target.value as TrainingType)}
                        className="form-input py-3"
                      >
                        <option value="certification">Certification</option>
                        <option value="continuing_education">Continuing Education</option>
                        <option value="skills_practice">Skills Practice</option>
                        <option value="orientation">Orientation</option>
                        <option value="refresher">Refresher</option>
                        <option value="specialty">Specialty</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                        Credit Hours <span className="text-red-700">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={formData.credit_hours}
                        onChange={(e) => updateField('credit_hours', parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Lead Instructor
                    </label>
                    <select
                      value={instructorId}
                      onChange={(e) => {
                        setInstructorId(e.target.value);
                        const member = members.find(m => m.id === e.target.value);
                        updateField('instructor', member ? `${member.first_name} ${member.last_name}` : '');
                      }}
                      className="form-input py-3"
                    >
                      <option value="">Select instructor...</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.first_name} {m.last_name}{m.rank ? ` (${formatRank(m.rank)})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Apparatus
                    </label>
                    <select
                      value={apparatusId}
                      onChange={(e) => setApparatusId(e.target.value)}
                      className="form-input py-3"
                    >
                      <option value="">No apparatus</option>
                      {apparatusList.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-theme-text-muted mt-1">
                      Apparatus used during this training session
                    </p>
                  </div>
                </>
              )}

              {/* Certification Settings */}
              <div className="border-t border-theme-surface-border pt-6">
                <div className="flex items-center space-x-3 mb-4">
                  <input
                    type="checkbox"
                    id="issues_certification"
                    checked={formData.issues_certification}
                    onChange={(e) => updateField('issues_certification', e.target.checked)}
                    className="form-checkbox"
                  />
                  <label htmlFor="issues_certification" className="text-theme-text-primary font-semibold">
                    This training issues a certification
                  </label>
                </div>

                {formData.issues_certification && (
                  <div className="space-y-4 pl-7">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                          Issuing Agency
                        </label>
                        <input
                          type="text"
                          value={formData.issuing_agency}
                          onChange={(e) => updateField('issuing_agency', e.target.value)}
                          placeholder="e.g., American Heart Association"
                          className="form-input placeholder-theme-text-muted py-3"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                          Cert Number Prefix
                        </label>
                        <input
                          type="text"
                          value={formData.certification_number_prefix}
                          onChange={(e) => updateField('certification_number_prefix', e.target.value)}
                          placeholder="e.g., AHA-CPR-"
                          className="form-input placeholder-theme-text-muted py-3"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                        Expiration (months)
                      </label>
                      <input
                        type="number"
                        value={formData.expiration_months || ''}
                        onChange={(e) => { const n = parseInt(e.target.value); updateField('expiration_months', Number.isNaN(n) ? undefined : n); }}
                        placeholder="e.g., 24 (for 2 years)"
                        className="form-input placeholder-theme-text-muted py-3"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Settings */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-theme-text-primary mb-4">Attendance & Completion Settings</h2>

              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <QrCode className="w-5 h-5 text-green-700 mt-0.5 mr-3 shrink-0" />
                  <div>
                    <p className="text-green-700 font-semibold mb-1">QR Code Check-In</p>
                    <p className="text-theme-text-secondary text-sm">
                      A QR code will be automatically generated for this training. Members can scan it to check in
                      and verify their attendance.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <input
                    type="checkbox"
                    id="auto_create_records"
                    checked={formData.auto_create_records}
                    onChange={(e) => updateField('auto_create_records', e.target.checked)}
                    className="form-checkbox mt-1"
                  />
                  <div>
                    <label htmlFor="auto_create_records" className="text-theme-text-primary font-semibold block">
                      Auto-create training records on check-in
                    </label>
                    <p className="text-theme-text-muted text-sm mt-1">
                      Automatically create a training record for each member who checks in via QR code
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <input
                    type="checkbox"
                    id="require_completion_confirmation"
                    checked={formData.require_completion_confirmation}
                    onChange={(e) => updateField('require_completion_confirmation', e.target.checked)}
                    className="form-checkbox mt-1"
                  />
                  <div>
                    <label htmlFor="require_completion_confirmation" className="text-theme-text-primary font-semibold block">
                      Require instructor confirmation
                    </label>
                    <p className="text-theme-text-muted text-sm mt-1">
                      Training records will be marked as "pending" until instructor confirms completion
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-theme-text-primary mb-4">Review Training Session</h2>

              <div className="bg-theme-input-bg/50 rounded-lg p-6 space-y-4">
                <ReviewSection title="Event Details">
                  <ReviewItem label="Title" value={formData.title} />
                  <ReviewItem label="Start" value={formatDateTime(formData.start_datetime, tz)} />
                  <ReviewItem label="End" value={formatDateTime(formData.end_datetime, tz)} />
                  {(formData.location_id || formData.location) && (
                    <ReviewItem
                      label="Location"
                      value={
                        formData.location_id
                          ? locations.find(l => l.id === formData.location_id)?.name || 'Selected location'
                          : formData.location || ''
                      }
                    />
                  )}
                  <ReviewItem label="RSVP Required" value={formData.requires_rsvp ? 'Yes' : 'No'} />
                  <ReviewItem label="Mandatory" value={formData.is_mandatory ? 'Yes' : 'No'} />
                </ReviewSection>

                {isRecurring && (
                  <ReviewSection title="Recurrence">
                    <ReviewItem label="Pattern" value={getRecurrenceLabel()} />
                    <ReviewItem label="Repeat Until" value={recurrenceEndDate} />
                    {recurrencePattern === 'custom' && recurrenceCustomDays.length > 0 && (
                      <ReviewItem
                        label="Days"
                        value={recurrenceCustomDays.map(d => WEEKDAYS[d] ?? '').join(', ')}
                      />
                    )}
                    {(recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday') && (
                      <ReviewItem
                        label="Occurrence"
                        value={`${ORDINALS.find(o => o.value === recurrenceWeekOrdinal)?.label ?? ''} ${WEEKDAYS[recurrenceWeekday] ?? ''}`}
                      />
                    )}
                    {recurrencePattern === 'annually_weekday' && (
                      <ReviewItem label="Month" value={MONTHS[recurrenceMonth - 1] ?? ''} />
                    )}
                  </ReviewSection>
                )}

                <ReviewSection title="Training Details">
                  <ReviewItem
                    label="Course"
                    value={formData.use_existing_course ? 'Using existing course' : formData.course_name || 'N/A'}
                  />
                  <ReviewItem label="Training Type" value={formData.training_type} />
                  <ReviewItem label="Hours" value={`${formData.credit_hours} hours`} />
                  {formData.instructor && <ReviewItem label="Instructor" value={formData.instructor} />}
                  {formData.issues_certification && (
                    <>
                      <ReviewItem label="Issues Certification" value="Yes" />
                      {formData.issuing_agency && <ReviewItem label="Issuing Agency" value={formData.issuing_agency} />}
                    </>
                  )}
                </ReviewSection>

                <ReviewSection title="Attendance Settings">
                  <ReviewItem label="QR Code Check-In" value="Enabled" />
                  <ReviewItem
                    label="Auto-create Records"
                    value={formData.auto_create_records ? 'Yes' : 'No'}
                  />
                  <ReviewItem
                    label="Require Confirmation"
                    value={formData.require_completion_confirmation ? 'Yes' : 'No'}
                  />
                </ReviewSection>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-6 border-t border-theme-surface-border">
            <button
              onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
              className="px-6 py-3 bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            {currentStep < 4 ? (
              <button
                onClick={() => setCurrentStep(currentStep + 1)}
                className="btn-primary font-medium px-6 py-3"
              >
                Next
              </button>
            ) : (
              <button
                onClick={() => { void handleSubmit(); }}
                disabled={saving}
                className="btn-success disabled:cursor-not-allowed flex font-medium items-center px-6 py-3 space-x-2"
              >
                {saving ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    <span>{isRecurring ? 'Create Recurring Sessions' : 'Create Training Session'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

const ReviewSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-theme-text-primary font-semibold mb-3">{title}</h3>
    <div className="space-y-2">{children}</div>
  </div>
);

const ReviewItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between text-sm">
    <span className="text-theme-text-muted">{label}:</span>
    <span className="text-theme-text-primary font-medium capitalize">{value}</span>
  </div>
);

export default CreateTrainingSessionPage;
