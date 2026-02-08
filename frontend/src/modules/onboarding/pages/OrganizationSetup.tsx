import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Upload,
  MapPin,
  Phone,
  Mail,
  Clock,
  FileText,
  ChevronDown,
  ChevronUp,
  X,
  Check,
  AlertCircle,
  Image as ImageIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { isValidImageFile } from '../utils/validation';
import { useOnboardingSession } from '../hooks/useOnboardingSession';
import { useApiRequest, useUnsavedChanges, useFormChanged } from '../hooks';
import {
  ProgressIndicator,
  LoadingOverlay,
  ErrorAlert,
  BackButton,
} from '../components';
import { useOnboardingStore } from '../store';

// Types
type OrganizationType = 'fire_department' | 'ems_only' | 'fire_ems_combined';
type IdentifierType = 'fdid' | 'state_id' | 'department_id';

interface AddressData {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

interface OrganizationFormData {
  // Basic Info
  name: string;
  slug: string;
  organizationType: OrganizationType;
  timezone: string;
  // Contact Info
  phone: string;
  fax: string;
  email: string;
  website: string;
  // Addresses
  mailingAddress: AddressData;
  physicalAddressSame: boolean;
  physicalAddress: AddressData;
  // Identifiers
  identifierType: IdentifierType;
  fdid: string;
  stateId: string;
  departmentId: string;
  // Additional Info
  county: string;
  foundedYear: string;
  taxId: string;
  logo: string | null;
}

// US States for dropdown
const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
  { value: 'DC', label: 'District of Columbia' },
];

// US Timezones
const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (No DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
];

const emptyAddress: AddressData = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'USA',
};

const initialFormData: OrganizationFormData = {
  name: '',
  slug: '',
  organizationType: 'fire_department',
  timezone: 'America/New_York',
  phone: '',
  fax: '',
  email: '',
  website: '',
  mailingAddress: { ...emptyAddress },
  physicalAddressSame: true,
  physicalAddress: { ...emptyAddress },
  identifierType: 'department_id',
  fdid: '',
  stateId: '',
  departmentId: '',
  county: '',
  foundedYear: '',
  taxId: '',
  logo: null,
};

// Section Header Component
const SectionHeader: React.FC<{
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  required?: boolean;
  isComplete?: boolean;
}> = ({ title, icon, expanded, onToggle, required, isComplete }) => (
  <button
    type="button"
    onClick={onToggle}
    className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800/70 rounded-lg transition-colors"
  >
    <div className="flex items-center gap-3">
      <span className="text-red-400">{icon}</span>
      <span className="text-white font-semibold">{title}</span>
      {required && !isComplete && <span className="text-red-400 text-sm">*</span>}
      {isComplete && <Check className="w-5 h-5 text-green-400 ml-2" />}
    </div>
    {expanded ? (
      <ChevronUp className="w-5 h-5 text-slate-400" />
    ) : (
      <ChevronDown className="w-5 h-5 text-slate-400" />
    )}
  </button>
);

// Input Field Component
const InputField: React.FC<{
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  helpText?: string;
  error?: string;
  onBlur?: () => void;
}> = ({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  maxLength,
  helpText,
  error,
  onBlur,
}) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-slate-200 mb-1">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    <input
      type={type}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`w-full px-3 py-2 bg-slate-900/50 border rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all ${
        error ? 'border-red-500' : 'border-slate-600'
      }`}
      aria-required={required}
      aria-invalid={!!error}
    />
    {helpText && <p className="mt-1 text-xs text-slate-400">{helpText}</p>}
    {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
  </div>
);

// Select Field Component
const SelectField: React.FC<{
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  helpText?: string;
  error?: string;
}> = ({ label, id, value, onChange, options, required, helpText, error }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-slate-200 mb-1">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-3 py-2 bg-slate-900/50 border rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all ${
        error ? 'border-red-500' : 'border-slate-600'
      }`}
      aria-required={required}
      aria-invalid={!!error}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
    {helpText && <p className="mt-1 text-xs text-slate-400">{helpText}</p>}
    {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
  </div>
);

// Address Form Component
const AddressForm: React.FC<{
  address: AddressData;
  onChange: (address: AddressData) => void;
  idPrefix: string;
  required?: boolean;
  errors?: Record<string, string>;
}> = ({ address, onChange, idPrefix, required, errors = {} }) => {
  const updateField = (field: keyof AddressData, value: string) => {
    onChange({ ...address, [field]: value });
  };

  // Map parent error keys (e.g., "mailingLine1") to field names (e.g., "line1")
  const getFieldError = (field: string) => {
    return errors[`${idPrefix}${field.charAt(0).toUpperCase() + field.slice(1)}`] || errors[field];
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <InputField
          label="Street Address"
          id={`${idPrefix}-line1`}
          value={address.line1}
          onChange={(v) => updateField('line1', v)}
          placeholder="123 Main Street"
          required={required}
          maxLength={255}
          error={getFieldError('line1')}
        />
      </div>
      <div className="md:col-span-2">
        <InputField
          label="Address Line 2"
          id={`${idPrefix}-line2`}
          value={address.line2}
          onChange={(v) => updateField('line2', v)}
          placeholder="Suite, Unit, Building (optional)"
          maxLength={255}
          error={getFieldError('line2')}
        />
      </div>
      <InputField
        label="City"
        id={`${idPrefix}-city`}
        value={address.city}
        onChange={(v) => updateField('city', v)}
        placeholder="City"
        required={required}
        maxLength={100}
        error={getFieldError('city')}
      />
      <SelectField
        label="State"
        id={`${idPrefix}-state`}
        value={address.state}
        onChange={(v) => updateField('state', v)}
        options={[{ value: '', label: 'Select State' }, ...US_STATES]}
        required={required}
        error={getFieldError('state')}
      />
      <InputField
        label="ZIP Code"
        id={`${idPrefix}-zip`}
        value={address.zipCode}
        onChange={(v) => updateField('zipCode', v)}
        placeholder="12345 or 12345-6789"
        required={required}
        maxLength={20}
        error={getFieldError('zipCode')}
      />
      <InputField
        label="Country"
        id={`${idPrefix}-country`}
        value={address.country}
        onChange={(v) => updateField('country', v)}
        placeholder="USA"
        maxLength={100}
        error={getFieldError('country')}
      />
    </div>
  );
};

const OrganizationSetup: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [formData, setFormData] = useState<OrganizationFormData>(initialFormData);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Warn before leaving with unsaved changes
  const hasUnsavedChanges = useFormChanged(formData, initialFormData);
  useUnsavedChanges({
    hasUnsavedChanges,
    message: 'You have unsaved organization information. Are you sure you want to leave?'
  });

  // Section expansion state
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    contact: false,
    mailing: false,
    physical: false,
    identifiers: false,
    additional: false,
    logo: false,
  });

  // Zustand store
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const setDepartmentName = useOnboardingStore((state) => state.setDepartmentName);
  const logoData = useOnboardingStore((state) => state.logoData);
  const setLogoData = useOnboardingStore((state) => state.setLogoData);

  // Hooks
  const { initializeSession, hasSession, isLoading: sessionLoading, saveOrganization } = useOnboardingSession();
  const { error, canRetry, clearError } = useApiRequest();
  const [isSaving, setIsSaving] = useState(false);

  // Initialize session and restore any saved data
  useEffect(() => {
    if (!hasSession && !sessionLoading) {
      initializeSession().catch((err) => {
        console.error('Failed to initialize session:', err);
        toast.error('Failed to start onboarding session. Please refresh the page.');
      });
    }
  }, [hasSession, sessionLoading, initializeSession]);

  // Restore department name from store if available
  useEffect(() => {
    if (departmentName) {
      setFormData((prev) => ({ ...prev, name: departmentName }));
    }
    if (logoData) {
      setFormData((prev) => ({ ...prev, logo: logoData }));
    }
  }, [departmentName, logoData]);

  // Auto-generate slug from name
  useEffect(() => {
    if (formData.name && !formData.slug) {
      const slug = formData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setFormData((prev) => ({ ...prev, slug }));
    }
  }, [formData.name, formData.slug]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const updateFormData = <K extends keyof OrganizationFormData>(
    field: K,
    value: OrganizationFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setValidationErrors((prev) => ({ ...prev, [field]: '' }));
    clearError();
  };

  // Logo handling
  const handleLogoChange = (file: File | null) => {
    if (!file) {
      updateFormData('logo', null);
      setLogoData(null);
      return;
    }

    const validation = isValidImageFile(file);
    if (!validation.valid) {
      toast.error(validation.error || 'Invalid file');
      return;
    }

    if (validation.warning) {
      toast(validation.warning, { icon: '⚠️' });
    }

    setIsProcessingFile(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      updateFormData('logo', base64);
      setLogoData(base64);
      setIsProcessingFile(false);
    };
    reader.onerror = () => {
      toast.error('Failed to read image file');
      setIsProcessingFile(false);
    };
    reader.readAsDataURL(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0] || null;
    handleLogoChange(file);
  };

  // Validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    // Required fields
    if (!formData.name.trim()) {
      errors.name = 'Organization name is required';
    } else if (formData.name.length < 2) {
      errors.name = 'Organization name must be at least 2 characters';
    }

    // Mailing address validation
    if (!formData.mailingAddress.line1.trim()) {
      errors.mailingLine1 = 'Street address is required';
    }
    if (!formData.mailingAddress.city.trim()) {
      errors.mailingCity = 'City is required';
    }
    if (!formData.mailingAddress.state) {
      errors.mailingState = 'State is required';
    }
    if (!formData.mailingAddress.zipCode.trim()) {
      errors.mailingZip = 'ZIP code is required';
    } else if (!/^(\d{5}(-\d{4})?|[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d)$/.test(formData.mailingAddress.zipCode.trim())) {
      errors.mailingZip = 'Invalid ZIP code format. Expected: 12345 or 12345-6789';
    }

    // Physical address validation (if different)
    if (!formData.physicalAddressSame) {
      if (!formData.physicalAddress.line1.trim()) {
        errors.physicalLine1 = 'Street address is required';
      }
      if (!formData.physicalAddress.city.trim()) {
        errors.physicalCity = 'City is required';
      }
      if (!formData.physicalAddress.state) {
        errors.physicalState = 'State is required';
      }
      if (!formData.physicalAddress.zipCode.trim()) {
        errors.physicalZip = 'ZIP code is required';
      }
    }

    // Email validation (optional but must be valid if provided)
    if (formData.email && !/^[^@]+@[^@]+\.[^@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format';
    }

    // Website validation (optional but must be valid if provided)
    if (formData.website && formData.website.trim()) {
      const website = formData.website.trim();
      // Check if URL has protocol, if not, will be auto-prepended
      const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
      if (!urlPattern.test(website)) {
        errors.website = 'Invalid website URL format';
      }
    }

    // Phone validation (optional but must be valid if provided)
    if (formData.phone) {
      const cleaned = formData.phone.replace(/[\s\-\.\(\)]/g, '');
      if (!/^\+?[\d]{10,15}$/.test(cleaned)) {
        errors.phone = 'Invalid phone number format';
      }
    }

    // Identifier validation based on type
    if (formData.identifierType === 'fdid' && !formData.fdid.trim()) {
      errors.fdid = 'FDID is required when selected as identifier type';
    }
    if (formData.identifierType === 'state_id' && !formData.stateId.trim()) {
      errors.stateId = 'State ID is required when selected as identifier type';
    }

    setValidationErrors(errors);

    // Expand sections with errors
    if (errors.name || errors.slug) {
      setExpandedSections((prev) => ({ ...prev, basic: true }));
    }
    if (errors.email || errors.phone) {
      setExpandedSections((prev) => ({ ...prev, contact: true }));
    }
    if (errors.mailingLine1 || errors.mailingCity || errors.mailingState || errors.mailingZip) {
      setExpandedSections((prev) => ({ ...prev, mailing: true }));
    }
    if (errors.physicalLine1 || errors.physicalCity || errors.physicalState || errors.physicalZip) {
      setExpandedSections((prev) => ({ ...prev, physical: true }));
    }
    if (errors.fdid || errors.stateId) {
      setExpandedSections((prev) => ({ ...prev, identifiers: true }));
    }

    return Object.keys(errors).length === 0;
  };

  const handleContinue = async () => {
    if (!validateForm()) {
      // Format validation errors into a readable list
      const errorMessages = Object.values(validationErrors);
      const errorCount = errorMessages.length;

      if (errorCount === 1) {
        toast.error(errorMessages[0]);
      } else {
        // Show summary with count
        toast.error(
          `Please fix ${errorCount} errors:\n• ${errorMessages.join('\n• ')}`,
          { duration: 8000 } // Longer duration for multiple errors
        );
      }
      return;
    }

    setIsSaving(true);

    try {
      // Store name in Zustand for other components
      setDepartmentName(formData.name);

      // Prepare API payload
      const payload = {
        name: formData.name.trim(),
        slug: formData.slug || undefined,
        organization_type: formData.organizationType,
        timezone: formData.timezone,
        phone: formData.phone || undefined,
        fax: formData.fax || undefined,
        email: formData.email || undefined,
        website: formData.website || undefined,
        mailing_address: {
          line1: formData.mailingAddress.line1.trim(),
          line2: formData.mailingAddress.line2 || undefined,
          city: formData.mailingAddress.city.trim(),
          state: formData.mailingAddress.state,
          zip_code: formData.mailingAddress.zipCode.trim(),
          country: formData.mailingAddress.country || 'USA',
        },
        physical_address_same: formData.physicalAddressSame,
        physical_address: formData.physicalAddressSame
          ? undefined
          : {
              line1: formData.physicalAddress.line1.trim(),
              line2: formData.physicalAddress.line2 || undefined,
              city: formData.physicalAddress.city.trim(),
              state: formData.physicalAddress.state,
              zip_code: formData.physicalAddress.zipCode.trim(),
              country: formData.physicalAddress.country || 'USA',
            },
        identifier_type: formData.identifierType,
        fdid: formData.fdid || undefined,
        state_id: formData.stateId || undefined,
        department_id: formData.departmentId || undefined,
        county: formData.county || undefined,
        founded_year: formData.foundedYear ? parseInt(formData.foundedYear, 10) : undefined,
        tax_id: formData.taxId || undefined,
        logo: formData.logo || undefined,
      };

      // Save to API
      await saveOrganization(payload);

      toast.success('Organization created successfully!');

      // Navigate to next step (navigation choice)
      navigate('/onboarding/navigation-choice');
    } catch (err: any) {
      console.error('Failed to save organization:', err);
      // Show the actual error message from the backend (includes validation details)
      const errorMessage = err?.message || 'Failed to save organization. Please try again.';
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Check if sections are complete
  const isSectionComplete = {
    basic: formData.name.trim().length >= 2,
    contact: true, // All fields optional
    mailing: formData.mailingAddress.line1.trim() && formData.mailingAddress.city.trim() && formData.mailingAddress.state && formData.mailingAddress.zipCode.trim(),
    physical: formData.physicalAddressSame || (formData.physicalAddress.line1.trim() && formData.physicalAddress.city.trim() && formData.physicalAddress.state),
    identifiers: formData.identifierType === '' ||
                 (formData.identifierType === 'fdid' && formData.fdid.trim()) ||
                 (formData.identifierType === 'state_id' && formData.stateId.trim()) ||
                 (formData.identifierType === 'department_id'),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Back Button */}
        <div className="mb-4">
          <BackButton to="/" label="Back to Welcome" />
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Organization Setup
          </h1>
          <p className="text-lg text-slate-300">
            Let's set up your fire department or emergency services organization
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 space-y-4">
          {/* Basic Information */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Basic Information"
              icon={<Building2 className="w-5 h-5" />}
              expanded={expandedSections.basic}
              onToggle={() => toggleSection('basic')}
              required
              isComplete={isSectionComplete.basic}
            />
            {expandedSections.basic && (
              <div className="p-4 space-y-4 bg-slate-900/30">
                <InputField
                  label="Organization Name"
                  id="org-name"
                  value={formData.name}
                  onChange={(v) => updateFormData('name', v)}
                  placeholder="e.g., Springfield Volunteer Fire Department"
                  required
                  maxLength={255}
                  error={validationErrors.name}
                />

                <InputField
                  label="URL Slug"
                  id="org-slug"
                  value={formData.slug}
                  onChange={(v) => updateFormData('slug', v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="e.g., springfield-vfd"
                  maxLength={100}
                  helpText="Used in URLs. Auto-generated from name if left blank."
                />

                <SelectField
                  label="Organization Type"
                  id="org-type"
                  value={formData.organizationType}
                  onChange={(v) => updateFormData('organizationType', v as OrganizationType)}
                  options={[
                    { value: 'fire_department', label: 'Fire Department' },
                    { value: 'ems_only', label: 'EMS Only' },
                    { value: 'fire_ems_combined', label: 'Fire/EMS Combined' },
                  ]}
                  required
                />

                <SelectField
                  label="Timezone"
                  id="org-timezone"
                  value={formData.timezone}
                  onChange={(v) => updateFormData('timezone', v)}
                  options={US_TIMEZONES}
                  required
                />
              </div>
            )}
          </div>

          {/* Contact Information */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Contact Information"
              icon={<Phone className="w-5 h-5" />}
              expanded={expandedSections.contact}
              onToggle={() => toggleSection('contact')}
            />
            {expandedSections.contact && (
              <div className="p-4 space-y-4 bg-slate-900/30">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InputField
                    label="Phone Number"
                    id="org-phone"
                    value={formData.phone}
                    onChange={(v) => updateFormData('phone', v)}
                    placeholder="(555) 123-4567"
                    type="tel"
                    maxLength={20}
                    error={validationErrors.phone}
                  />
                  <InputField
                    label="Fax Number"
                    id="org-fax"
                    value={formData.fax}
                    onChange={(v) => updateFormData('fax', v)}
                    placeholder="(555) 123-4568"
                    type="tel"
                    maxLength={20}
                  />
                </div>
                <InputField
                  label="Email Address"
                  id="org-email"
                  value={formData.email}
                  onChange={(v) => updateFormData('email', v)}
                  placeholder="contact@department.org"
                  type="email"
                  maxLength={255}
                  error={validationErrors.email}
                />
                <InputField
                  label="Website"
                  id="org-website"
                  value={formData.website}
                  onChange={(v) => updateFormData('website', v)}
                  onBlur={() => {
                    const website = formData.website.trim();
                    if (website && !website.startsWith('http://') && !website.startsWith('https://')) {
                      updateFormData('website', `https://${website}`);
                    }
                  }}
                  placeholder="https://www.department.org"
                  type="url"
                  maxLength={255}
                  helpText="Will automatically prepend https:// if not provided"
                />
              </div>
            )}
          </div>

          {/* Mailing Address */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Mailing Address"
              icon={<Mail className="w-5 h-5" />}
              expanded={expandedSections.mailing}
              onToggle={() => toggleSection('mailing')}
              required
              isComplete={isSectionComplete.mailing}
              isComplete={isSectionComplete.contact}
            />
            {expandedSections.mailing && (
              <div className="p-4 bg-slate-900/30">
                <AddressForm
                  address={formData.mailingAddress}
                  onChange={(addr) => updateFormData('mailingAddress', addr)}
                  idPrefix="mailing"
                  required
                  errors={validationErrors}
                />
              </div>
            )}
          </div>

          {/* Physical Address */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Physical Address"
              icon={<MapPin className="w-5 h-5" />}
              expanded={expandedSections.physical}
              onToggle={() => toggleSection('physical')}
            />
            {expandedSections.physical && (
              <div className="p-4 space-y-4 bg-slate-900/30">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.physicalAddressSame}
                    onChange={(e) => updateFormData('physicalAddressSame', e.target.checked)}
                    className="w-5 h-5 rounded border-slate-600 bg-slate-900/50 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                  />
                  <span className="text-slate-200">Same as mailing address</span>
                </label>

                {!formData.physicalAddressSame && (
                  <AddressForm
                    address={formData.physicalAddress}
                    onChange={(addr) => updateFormData('physicalAddress', addr)}
                    idPrefix="physical"
                    required
              isComplete={isSectionComplete.physical}
                    errors={validationErrors}
                  />
                )}
              </div>
            )}
          </div>

          {/* Department Identifiers */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Department Identifiers"
              icon={<FileText className="w-5 h-5" />}
              expanded={expandedSections.identifiers}
              onToggle={() => toggleSection('identifiers')}
            />
            {expandedSections.identifiers && (
              <div className="p-4 space-y-4 bg-slate-900/30">
                <p className="text-sm text-slate-400 mb-4">
                  Select the primary identifier your department uses for official reporting.
                </p>

                <div className="space-y-3">
                  {/* Identifier Type Selection */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      {
                        value: 'fdid',
                        label: 'FDID',
                        description: 'Fire Department ID (NFIRS)',
                      },
                      {
                        value: 'state_id',
                        label: 'State ID',
                        description: 'State license/certification number',
                      },
                      {
                        value: 'department_id',
                        label: 'Department ID',
                        description: 'Internal department ID only',
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={`flex flex-col p-4 rounded-lg border cursor-pointer transition-all ${
                          formData.identifierType === option.value
                            ? 'border-red-500 bg-red-500/10'
                            : 'border-slate-600 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="identifierType"
                            value={option.value}
                            checked={formData.identifierType === option.value}
                            onChange={(e) =>
                              updateFormData('identifierType', e.target.value as IdentifierType)
                            }
                            className="text-red-500 focus:ring-red-500"
                          />
                          <span className="text-white font-medium">{option.label}</span>
                        </div>
                        <span className="text-xs text-slate-400 mt-1 ml-6">
                          {option.description}
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* Show input based on selection */}
                  {formData.identifierType === 'fdid' && (
                    <InputField
                      label="Fire Department ID (FDID)"
                      id="fdid"
                      value={formData.fdid}
                      onChange={(v) => updateFormData('fdid', v)}
                      placeholder="e.g., 12345"
                      required
                      maxLength={50}
                      helpText="Your NFIRS Fire Department ID"
                      error={validationErrors.fdid}
                    />
                  )}

                  {formData.identifierType === 'state_id' && (
                    <InputField
                      label="State ID"
                      id="state-id"
                      value={formData.stateId}
                      onChange={(v) => updateFormData('stateId', v)}
                      placeholder="State license/certification number"
                      required
                      maxLength={50}
                      helpText="Your state license or certification number"
                      error={validationErrors.stateId}
                    />
                  )}

                  {formData.identifierType === 'department_id' && (
                    <InputField
                      label="Department ID"
                      id="dept-id"
                      value={formData.departmentId}
                      onChange={(v) => updateFormData('departmentId', v)}
                      placeholder="Internal department identifier (optional)"
                      maxLength={50}
                      helpText="Your internal department ID (if applicable)"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Additional Information */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Additional Information"
              icon={<Clock className="w-5 h-5" />}
              expanded={expandedSections.additional}
              onToggle={() => toggleSection('additional')}
            />
            {expandedSections.additional && (
              <div className="p-4 space-y-4 bg-slate-900/30">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InputField
                    label="County/Jurisdiction"
                    id="org-county"
                    value={formData.county}
                    onChange={(v) => updateFormData('county', v)}
                    placeholder="e.g., Jefferson County"
                    maxLength={100}
                  />
                  <InputField
                    label="Year Founded"
                    id="org-founded"
                    value={formData.foundedYear}
                    onChange={(v) => updateFormData('foundedYear', v.replace(/\D/g, '').slice(0, 4))}
                    placeholder="e.g., 1920"
                    type="text"
                    maxLength={4}
                  />
                </div>
                <InputField
                  label="Tax ID (EIN)"
                  id="org-taxid"
                  value={formData.taxId}
                  onChange={(v) => updateFormData('taxId', v)}
                  placeholder="XX-XXXXXXX"
                  maxLength={50}
                  helpText="For 501(c)(3) organizations"
                />
              </div>
            )}
          </div>

          {/* Logo Upload */}
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <SectionHeader
              title="Organization Logo"
              icon={<ImageIcon className="w-5 h-5" />}
              expanded={expandedSections.logo}
              onToggle={() => toggleSection('logo')}
            />
            {expandedSections.logo && (
              <div className="p-4 bg-slate-900/30">
                <div className="relative">
                  <LoadingOverlay isVisible={isProcessingFile} message="Processing image..." />

                  {!formData.logo ? (
                    <div
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer ${
                        dragActive
                          ? 'border-red-500 bg-red-500/10'
                          : 'border-slate-600 hover:border-red-500 hover:bg-white/5'
                      }`}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          fileInputRef.current?.click();
                        }
                      }}
                      aria-label="Upload organization logo"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={(e) => handleLogoChange(e.target.files?.[0] || null)}
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        aria-label="File input for logo"
                      />
                      <div className="flex flex-col items-center space-y-3">
                        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center">
                          <Upload className="w-8 h-8 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-white font-medium mb-1">
                            Drop your logo here, or click to browse
                          </p>
                          <p className="text-sm text-slate-400">PNG, JPG or WebP (max 5MB)</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border-2 border-slate-600 rounded-lg p-6 bg-slate-900/50">
                      <div className="flex items-start space-x-4">
                        <div className="flex-shrink-0 w-24 h-24 bg-white rounded-lg flex items-center justify-center overflow-hidden">
                          <img
                            src={formData.logo}
                            alt="Organization logo preview"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-white font-medium">Logo uploaded</p>
                              <p className="text-sm text-slate-400 mt-1">
                                Click to change or drag a new image
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                updateFormData('logo', null);
                                setLogoData(null);
                                if (fileInputRef.current) {
                                  fileInputRef.current.value = '';
                                }
                              }}
                              className="flex-shrink-0 ml-4 p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                              aria-label="Remove logo"
                            >
                              <X className="w-5 h-5 text-red-400" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-3 text-sm text-red-400 hover:text-red-300 font-medium transition-colors"
                          >
                            Change logo
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-400 flex items-start">
                  <ImageIcon className="w-4 h-4 mr-1 flex-shrink-0 mt-0.5" />
                  <span>
                    Your logo will be displayed in the header and on reports. You can change it
                    later in settings.
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* Error Alert */}
          {error && (
            <ErrorAlert
              message={error}
              canRetry={canRetry}
              onRetry={handleContinue}
              onDismiss={clearError}
            />
          )}

          {/* Validation Errors Summary */}
          {Object.keys(validationErrors).length > 0 && (
            <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-400 font-medium">Please fix the following errors:</p>
                  <ul className="mt-2 text-sm text-red-300 list-disc list-inside">
                    {Object.entries(validationErrors).map(([key, msg]) => (
                      <li key={key}>{msg}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Continue Button */}
          <div className="pt-4 sticky bottom-0 md:relative bg-gradient-to-t from-slate-900 via-slate-900 to-transparent md:bg-none pb-4 md:pb-0 -mx-6 px-6 md:mx-0 md:px-0">
            <button
              onClick={handleContinue}
              disabled={isSaving}
              className={`w-full px-6 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                !isSaving
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02]'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isSaving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating Organization...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Continue
                  <Check className="w-5 h-5" />
                </span>
              )}
            </button>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator
            currentStep={1}
            totalSteps={10}
            className="pt-4 border-t border-white/10"
          />
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-slate-400 text-sm">
            Need help?{' '}
            <a
              href="/docs"
              className="text-red-400 hover:text-red-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Documentation
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default OrganizationSetup;
