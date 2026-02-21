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
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { TrainingSessionCreate, TrainingType, TrainingCourse } from '../types/training';
import type { User } from '../types/user';
import type { Location } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';
import { userService, schedulingService, locationsService, trainingSessionService, trainingService } from '../services/api';

/**
 * Create Training Session Page
 *
 * Creates a training event that automatically:
 * - Generates an Event with QR code for check-in
 * - Links to a TrainingCourse (existing or new)
 * - Auto-creates TrainingRecords when members check in
 */
const CreateTrainingSessionPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [availableCourses, setAvailableCourses] = useState<TrainingCourse[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [apparatusList, setApparatusList] = useState<Array<{ id: string; name: string }>>([]);
  const [instructorId, setInstructorId] = useState('');
  const [apparatusId, setApparatusId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationMode, setLocationMode] = useState<'select' | 'other'>('select');

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
    trainingService.getCourses().then(setAvailableCourses).catch(() => {});
    userService.getUsers().then(setMembers).catch(() => {});
    schedulingService.getBasicApparatus({ is_active: true }).then((data) => {
      setApparatusList(data.map((a: Record<string, unknown>) => ({ id: a.id as string, name: (a.name || a.unit_number || 'Unknown') as string })));
    }).catch(() => {});
    locationsService.getLocations({ is_active: true }).then((data) => {
      setLocations(data);
      if (data.length === 0) setLocationMode('other');
    }).catch(() => {
      setLocationMode('other');
    });
  }, []);

  const updateField = (field: keyof TrainingSessionCreate, value: any) => {
    setFormData({ ...formData, [field]: value });
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

    setSaving(true);

    try {
      // Convert local datetime-local values to UTC before sending to backend
      const submitData = {
        ...formData,
        start_datetime: localToUTC(formData.start_datetime, tz),
        end_datetime: localToUTC(formData.end_datetime, tz),
      };

      // Create training session (creates Event + TrainingCourse link)
      const response = await trainingSessionService.createSession(submitData);

      toast.success('Training session created successfully!');

      // Navigate to the event page to view QR code
      if (response.event_id) {
        navigate(`/events/${response.event_id}`);
      } else {
        navigate('/training/officer');
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
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border mb-8">
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
                        <CheckCircle className="w-6 h-6 text-theme-text-primary" />
                      ) : (
                        <Icon className={`w-6 h-6 ${isActive ? 'text-theme-text-primary' : 'text-theme-text-muted'}`} />
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
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-8 border border-theme-surface-border space-y-8">
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
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    ) : (
                      <input
                        type="text"
                        value={formData.location_details || ''}
                        onChange={(e) => updateField('location_details', e.target.value)}
                        placeholder="Additional directions or room info"
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                      <MapPin className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
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
                    className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
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
                    className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
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
                      className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                      Max Participants
                    </label>
                    <input
                      type="number"
                      value={formData.max_attendees || ''}
                      onChange={(e) => updateField('max_attendees', parseInt(e.target.value) || undefined)}
                      placeholder="Unlimited"
                      className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                  <AlertCircle className="w-5 h-5 text-blue-700 mt-0.5 mr-3 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-blue-700 font-semibold mb-2">Course Selection</p>
                    <div className="space-y-3">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          checked={!formData.use_existing_course}
                          onChange={() => updateField('use_existing_course', false)}
                          className="w-4 h-4 text-red-600 focus:ring-red-500"
                        />
                        <span className="text-theme-text-secondary text-sm">Create new course for this training</span>
                      </label>
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          checked={formData.use_existing_course}
                          onChange={() => updateField('use_existing_course', true)}
                          className="w-4 h-4 text-red-600 focus:ring-red-500"
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
                    onChange={(e) => updateField('course_id', e.target.value)}
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">Select a course...</option>
                    {availableCourses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code ? `${course.code} - ` : ''}{course.name}
                      </option>
                    ))}
                  </select>
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                      className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">Select instructor...</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.first_name} {m.last_name}{m.rank ? ` (${m.rank})` : ''}
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
                      className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
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
                          className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                          className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                        onChange={(e) => updateField('expiration_months', parseInt(e.target.value) || undefined)}
                        placeholder="e.g., 24 (for 2 years)"
                        className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                  <QrCode className="w-5 h-5 text-green-700 mt-0.5 mr-3 flex-shrink-0" />
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
                    className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500 mt-1"
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
                    className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500 mt-1"
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
                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {saving ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    <span>Create Training Session</span>
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
