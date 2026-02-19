import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus,
  Save,
  X,
  User,
  MapPin,
  Phone,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { MemberFormData } from '../types/member';
import { userService, organizationService, roleService, locationsService } from '../services/api';
import type { Location } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { getTodayLocalDate } from '../utils/dateFormatting';

const OPERATIONAL_RANKS = [
  { value: 'fire_chief', label: 'Fire Chief' },
  { value: 'deputy_chief', label: 'Deputy Chief' },
  { value: 'assistant_chief', label: 'Assistant Chief' },
  { value: 'captain', label: 'Captain' },
  { value: 'lieutenant', label: 'Lieutenant' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'firefighter', label: 'Firefighter' },
];

const AddMember: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [isSaving, setIsSaving] = useState(false);
  const [membershipIdPreview, setMembershipIdPreview] = useState<string | null>(null);
  const [membershipIdOverride, setMembershipIdOverride] = useState('');
  const [formData, setFormData] = useState<MemberFormData>({
    firstName: '',
    lastName: '',
    middleName: '',
    departmentId: '',
    dateOfBirth: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    preferredContact: 'phone',
    joinDate: getTodayLocalDate(tz),
    status: 'active',
    membershipType: 'probationary',
    rank: '',
    role: '',
    station: '',
    emergencyName1: '',
    emergencyRelationship1: '',
    emergencyPhone1: '',
    emergencyEmail1: '',
    emergencyName2: '',
    emergencyRelationship2: '',
    emergencyPhone2: '',
    emergencyEmail2: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Dropdown data
  const [availablePositions, setAvailablePositions] = useState<{ id: string; name: string }[]>([]);
  const [availableStations, setAvailableStations] = useState<Location[]>([]);

  useEffect(() => {
    organizationService.previewNextMembershipId().then((data) => {
      if (data.enabled && data.next_id) {
        setMembershipIdPreview(data.next_id);
      }
    }).catch(() => {
      // Silently ignore - membership ID may not be configured
    });

    // Load positions (roles) for dropdown
    roleService.getRoles().then((roles) => {
      setAvailablePositions(roles.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
    }).catch(() => {});

    // Load stations for dropdown (only top-level locations with an address)
    locationsService.getLocations({ is_active: true }).then((locs) => {
      const stations = locs.filter((l: Location) => l.address && !l.room_number);
      setAvailableStations(stations);
    }).catch(() => {});
  }, []);

  const handleInputChange = (
    field: keyof MemberFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Required fields
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.departmentId.trim()) newErrors.departmentId = 'Department ID is required';

    // Address
    if (!formData.street.trim()) newErrors.street = 'Street address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state.trim()) newErrors.state = 'State is required';
    if (!formData.zipCode.trim()) newErrors.zipCode = 'ZIP code is required';

    // Contact
    if (!formData.primaryPhone.trim()) newErrors.primaryPhone = 'Primary phone is required';
    if (!formData.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    // Emergency Contact 1 (required)
    if (!formData.emergencyName1.trim()) newErrors.emergencyName1 = 'Emergency contact name is required';
    if (!formData.emergencyRelationship1.trim()) newErrors.emergencyRelationship1 = 'Relationship is required';
    if (!formData.emergencyPhone1.trim()) newErrors.emergencyPhone1 = 'Emergency phone is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSaving(true);

    try {
      // Generate username from email (part before @)
      const username = formData.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');

      // Build emergency contacts array
      const emergencyContacts: Array<{
        name: string;
        relationship: string;
        phone: string;
        email?: string;
        is_primary: boolean;
      }> = [];

      // Primary emergency contact
      if (formData.emergencyName1) {
        emergencyContacts.push({
          name: formData.emergencyName1,
          relationship: formData.emergencyRelationship1,
          phone: formData.emergencyPhone1,
          email: formData.emergencyEmail1 || undefined,
          is_primary: true,
        });
      }

      // Secondary emergency contact (if provided)
      if (formData.emergencyName2) {
        emergencyContacts.push({
          name: formData.emergencyName2,
          relationship: formData.emergencyRelationship2,
          phone: formData.emergencyPhone2,
          email: formData.emergencyEmail2 || undefined,
          is_primary: false,
        });
      }

      // Call the API
      await userService.createMember({
        username,
        email: formData.email,
        first_name: formData.firstName,
        middle_name: formData.middleName || undefined,
        last_name: formData.lastName,
        badge_number: formData.departmentId || undefined,
        membership_id: membershipIdOverride || undefined,
        phone: formData.primaryPhone || undefined,
        mobile: formData.secondaryPhone || undefined,
        date_of_birth: formData.dateOfBirth || undefined,
        hire_date: formData.joinDate || undefined,
        rank: formData.rank || undefined,
        station: formData.station || undefined,
        address_street: formData.street || undefined,
        address_city: formData.city || undefined,
        address_state: formData.state || undefined,
        address_zip: formData.zipCode || undefined,
        address_country: 'USA',
        emergency_contacts: emergencyContacts,
        send_welcome_email: true,
      });

      toast.success('Member added successfully!');
      navigate('/members');
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'Failed to add member. Please try again.');
      toast.error(errorMessage);
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (Object.values(formData).some((val) => val !== '' && val !== 'active' && val !== 'phone')) {
      if (confirm('Are you sure you want to cancel? All unsaved changes will be lost.')) {
        navigate('/members');
      }
    } else {
      navigate('/members');
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-theme-input-bg backdrop-blur-sm border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 rounded-lg p-2">
                <UserPlus className="w-6 h-6 text-theme-text-primary" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Add New Member</h1>
                <p className="text-theme-text-muted text-sm">Enter member information</p>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm"
            >
              ← Back to Members
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Information */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center space-x-2 mb-4">
              <User className="w-5 h-5 text-blue-700 dark:text-blue-400" />
              <h2 className="text-xl font-bold text-theme-text-primary">Personal Information</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  First Name <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.firstName ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="John"
                />
                {errors.firstName && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.firstName}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Middle Name
                </label>
                <input
                  type="text"
                  value={formData.middleName}
                  onChange={(e) => handleInputChange('middleName', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Michael"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Last Name <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.lastName ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="Doe"
                />
                {errors.lastName && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.lastName}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Department ID <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.departmentId}
                  onChange={(e) => handleInputChange('departmentId', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.departmentId ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="FF-001"
                />
                {errors.departmentId && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.departmentId}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Membership ID - shown when membership IDs are enabled */}
            {membershipIdPreview && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Membership ID
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={membershipIdOverride}
                    onChange={(e) => setMembershipIdOverride(e.target.value)}
                    className="flex-1 max-w-xs px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={membershipIdPreview}
                  />
                  <span className="text-sm text-theme-text-muted">
                    {membershipIdOverride
                      ? 'Manual override'
                      : `Auto-assigned: ${membershipIdPreview}`
                    }
                  </span>
                </div>
                <p className="mt-1 text-xs text-theme-text-muted">
                  Leave blank to auto-assign the next ID. Enter a value to manually assign (e.g., for returning former members).
                </p>
              </div>
            )}
          </div>

          {/* Home Address */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center space-x-2 mb-4">
              <MapPin className="w-5 h-5 text-green-700 dark:text-green-400" />
              <h2 className="text-xl font-bold text-theme-text-primary">Home Address</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Street Address <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.street}
                  onChange={(e) => handleInputChange('street', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.street ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="123 Main Street"
                />
                {errors.street && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.street}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">
                    City <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className={`w-full px-4 py-2 bg-theme-input-bg border ${
                      errors.city ? 'border-red-500' : 'border-theme-input-border'
                    } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Springfield"
                  />
                  {errors.city && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.city}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">
                    State <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => handleInputChange('state', e.target.value)}
                    className={`w-full px-4 py-2 bg-theme-input-bg border ${
                      errors.state ? 'border-red-500' : 'border-theme-input-border'
                    } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="IL"
                    maxLength={2}
                  />
                  {errors.state && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.state}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-2">
                    ZIP Code <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.zipCode}
                    onChange={(e) => handleInputChange('zipCode', e.target.value)}
                    className={`w-full px-4 py-2 bg-theme-input-bg border ${
                      errors.zipCode ? 'border-red-500' : 'border-theme-input-border'
                    } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="62701"
                  />
                  {errors.zipCode && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.zipCode}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center space-x-2 mb-4">
              <Phone className="w-5 h-5 text-purple-700 dark:text-purple-400" />
              <h2 className="text-xl font-bold text-theme-text-primary">Contact Information</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Primary Phone <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  value={formData.primaryPhone}
                  onChange={(e) => handleInputChange('primaryPhone', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.primaryPhone ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="(555) 123-4567"
                />
                {errors.primaryPhone && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.primaryPhone}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Secondary Phone
                </label>
                <input
                  type="tel"
                  value={formData.secondaryPhone}
                  onChange={(e) => handleInputChange('secondaryPhone', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="(555) 987-6543"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Email <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.email ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="john.doe@example.com"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Preferred Contact Method
                </label>
                <select
                  value={formData.preferredContact}
                  onChange={(e) =>
                    handleInputChange('preferredContact', e.target.value as 'phone' | 'email' | 'text')
                  }
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="text">Text</option>
                </select>
              </div>
            </div>
          </div>

          {/* Department Information */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center space-x-2 mb-4">
              <Calendar className="w-5 h-5 text-orange-700 dark:text-orange-400" />
              <h2 className="text-xl font-bold text-theme-text-primary">Department Information</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Join Date
                </label>
                <input
                  type="date"
                  value={formData.joinDate}
                  onChange={(e) => handleInputChange('joinDate', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="leave">On Leave</option>
                  <option value="retired">Retired</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Membership Type <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <select
                  value={formData.membershipType}
                  onChange={(e) => handleInputChange('membershipType', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="probationary">Probationary</option>
                  <option value="regular">Regular</option>
                  <option value="life">Life</option>
                  <option value="administrative">Administrative</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Rank
                </label>
                <select
                  value={formData.rank}
                  onChange={(e) => handleInputChange('rank', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Rank</option>
                  {OPERATIONAL_RANKS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Position
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => handleInputChange('role', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Position</option>
                  {availablePositions.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Station
                </label>
                <select
                  value={formData.station}
                  onChange={(e) => handleInputChange('station', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Station</option>
                  {availableStations.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Emergency Contact 1 */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center space-x-2 mb-4">
              <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400" />
              <h2 className="text-xl font-bold text-theme-text-primary">Emergency Contact (Primary)</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Name <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.emergencyName1}
                  onChange={(e) => handleInputChange('emergencyName1', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.emergencyName1 ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="Jane Doe"
                />
                {errors.emergencyName1 && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.emergencyName1}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Relationship <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.emergencyRelationship1}
                  onChange={(e) => handleInputChange('emergencyRelationship1', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.emergencyRelationship1 ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="Spouse"
                />
                {errors.emergencyRelationship1 && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.emergencyRelationship1}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Phone <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  value={formData.emergencyPhone1}
                  onChange={(e) => handleInputChange('emergencyPhone1', e.target.value)}
                  className={`w-full px-4 py-2 bg-theme-input-bg border ${
                    errors.emergencyPhone1 ? 'border-red-500' : 'border-theme-input-border'
                  } rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="(555) 123-4567"
                />
                {errors.emergencyPhone1 && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.emergencyPhone1}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.emergencyEmail1}
                  onChange={(e) => handleInputChange('emergencyEmail1', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="jane.doe@example.com"
                />
              </div>
            </div>
          </div>

          {/* Emergency Contact 2 (Optional) */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <div className="flex items-center space-x-2 mb-4">
              <AlertCircle className="w-5 h-5 text-yellow-700 dark:text-yellow-400" />
              <h2 className="text-xl font-bold text-theme-text-primary">Emergency Contact (Secondary)</h2>
              <span className="text-sm text-theme-text-muted">(Optional)</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.emergencyName2}
                  onChange={(e) => handleInputChange('emergencyName2', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Bob Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Relationship
                </label>
                <input
                  type="text"
                  value={formData.emergencyRelationship2}
                  onChange={(e) => handleInputChange('emergencyRelationship2', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Parent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.emergencyPhone2}
                  onChange={(e) => handleInputChange('emergencyPhone2', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="(555) 987-6543"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.emergencyEmail2}
                  onChange={(e) => handleInputChange('emergencyEmail2', e.target.value)}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="bob.doe@example.com"
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="flex items-center space-x-2 px-6 py-3 bg-theme-surface-hover hover:bg-theme-surface-secondary text-theme-text-primary rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
              <span>Cancel</span>
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  <span>Save Member</span>
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default AddMember;
