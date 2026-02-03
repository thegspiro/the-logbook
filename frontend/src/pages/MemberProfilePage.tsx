/**
 * Member Profile Page
 *
 * Comprehensive view of a member's information including:
 * - Basic information
 * - Current month hours
 * - Upcoming shifts
 * - Training records
 * - Assigned inventory items
 * - Apparatus certifications
 * - Contact information
 * - Roles and permissions
 *
 * Module sections are conditionally rendered based on AVAILABLE_MODULES.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { userService, organizationService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { UserWithRoles } from '../types/role';
import type { ContactInfoUpdate, NotificationPreferences } from '../types/user';
import { AVAILABLE_MODULES } from '../types/modules';

/** Check if a module is enabled by its id. */
function isModuleEnabled(moduleId: string): boolean {
  const mod = AVAILABLE_MODULES.find((m) => m.id === moduleId);
  return mod?.enabled ?? false;
}

export const MemberProfilePage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  const [user, setUser] = useState<UserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventoryModuleEnabled, setInventoryModuleEnabled] = useState(false);

  // Edit mode states
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<ContactInfoUpdate>({
    email: '',
    phone: '',
    mobile: '',
    notification_preferences: {
      email: true,
      sms: false,
      push: false,
    },
  });

  // Module data states
  const [trainings, setTrainings] = useState<TrainingRecord[]>([]);
  const [trainingsLoading, setTrainingsLoading] = useState(false);

  const [permanentInventory, setPermanentInventory] = useState<UserInventoryItem[]>([]);
  const [activeCheckouts, setActiveCheckouts] = useState<UserCheckoutItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const [operatorCerts, setOperatorCerts] = useState<ApparatusOperator[]>([]);
  const [operatorCertsLoading, setOperatorCertsLoading] = useState(false);

  // Module enablement checks
  const trainingEnabled = isModuleEnabled('training');
  const inventoryEnabled = isModuleEnabled('inventory');
  const apparatusEnabled = isModuleEnabled('apparatus');
  const schedulingEnabled = isModuleEnabled('scheduling');

  useEffect(() => {
    if (userId) {
      fetchUserData();
      fetchModuleStatus();
    }
  }, [userId]);

  const fetchModuleStatus = async () => {
    try {
      const response = await organizationService.getEnabledModules();
      setInventoryModuleEnabled(response.enabled_modules.includes('inventory'));
    } catch (err) {
      // If we can't fetch module status, default to not showing inventory
      console.error('Error fetching module status:', err);
      setInventoryModuleEnabled(false);
    }
  };

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);
      const userData = await userService.getUserWithRoles(userId!);
      setUser(userData);
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError('Failed to load member information.');
    } finally {
      setLoading(false);
    }
  };

  const fetchModuleData = async () => {
    // Fetch training records
    if (trainingEnabled) {
      setTrainingsLoading(true);
      try {
        const records = await trainingService.getRecords({ user_id: userId! });
        setTrainings(records);
      } catch (err) {
        console.error('Error fetching training records:', err);
      } finally {
        setTrainingsLoading(false);
      }
    }

    // Fetch inventory
    if (inventoryEnabled) {
      setInventoryLoading(true);
      try {
        const inv = await inventoryService.getUserInventory(userId!);
        setPermanentInventory(inv.permanent_assignments);
        setActiveCheckouts(inv.active_checkouts);
      } catch (err) {
        console.error('Error fetching inventory:', err);
      } finally {
        setInventoryLoading(false);
      }
    }

    // Fetch apparatus operator certifications
    if (apparatusEnabled) {
      setOperatorCertsLoading(true);
      try {
        const operators = await apparatusOperatorService.getOperators({ userId: userId! });
        setOperatorCerts(operators);
      } catch (err) {
        console.error('Error fetching apparatus certifications:', err);
      } finally {
        setOperatorCertsLoading(false);
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getTrainingStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'scheduled':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  /** Check if a training record's certification is expiring within 90 days. */
  const isExpiringSoon = (record: TrainingRecord): boolean => {
    if (!record.expiration_date) return false;
    const expDate = new Date(record.expiration_date);
    const now = new Date();
    const daysUntilExpiry = (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry > 0 && daysUntilExpiry <= 90;
  };

  const isExpired = (record: TrainingRecord): boolean => {
    if (!record.expiration_date) return false;
    return new Date(record.expiration_date) < new Date();
  };

  const getConditionColor = (condition: string) => {
    switch (condition.toLowerCase()) {
      case 'excellent':
        return 'bg-green-100 text-green-800';
      case 'good':
        return 'bg-blue-100 text-blue-800';
      case 'fair':
        return 'bg-yellow-100 text-yellow-800';
      case 'poor':
      case 'damaged':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleEditClick = () => {
    setEditForm({
      email: user?.email || '',
      phone: user?.phone || '',
      mobile: user?.mobile || '',
      notification_preferences: user?.notification_preferences || {
        email: true,
        sms: false,
        push: false,
      },
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSaveContact = async () => {
    if (!user || !userId) return;

    try {
      setSaving(true);
      setError(null);

      const updatedUser = await userService.updateContactInfo(userId, editForm);
      setUser(updatedUser);
      setIsEditing(false);
    } catch (err: any) {
      console.error('Error updating contact info:', err);
      setError(err.response?.data?.detail || 'Failed to update contact information.');
    } finally {
      setSaving(false);
    }
  };

  const handleFormChange = (field: keyof ContactInfoUpdate, value: string) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNotificationToggle = (type: keyof NotificationPreferences) => {
    setEditForm((prev) => ({
      ...prev,
      notification_preferences: {
        ...prev.notification_preferences!,
        [type]: !prev.notification_preferences![type],
      },
    }));
  };

  // Check if current user can edit this profile
  const canEdit = currentUser?.id === userId;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error || 'Member not found'}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">Member not found</p>
        </div>
      </div>
    );
  }

  // Derived stats
  const completedTrainings = trainings.filter((t) => t.status === 'completed' && !isExpired(t));
  const expiringTrainings = trainings.filter((t) => t.status === 'completed' && isExpiringSoon(t));
  const totalInventory = permanentInventory.length + activeCheckouts.length;
  const certifiedApparatus = operatorCerts.filter((o) => o.isCertified);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
        >
          &larr; Back
        </button>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 rounded-full bg-indigo-100 flex items-center justify-center">
                <span className="text-2xl font-bold text-indigo-600">
                  {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  {user.full_name || user.username}
                </h1>
                <p className="text-gray-500 mt-1">@{user.username}</p>
                {user.badge_number && (
                  <p className="text-sm text-gray-600 mt-1">Badge #{user.badge_number}</p>
                )}
                <div className="flex gap-2 mt-2">
                  {user.roles.map((role) => (
                    <span
                      key={role.id}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        role.is_system ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <span
              className={`px-3 py-1 text-sm font-semibold rounded-full ${
                user.status === 'active'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {user.status}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Training & Certifications */}
          {trainingEnabled && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Training & Certifications
              </h2>
              {trainingsLoading ? (
                <p className="text-sm text-gray-500">Loading training records...</p>
              ) : trainings.length === 0 ? (
                <p className="text-sm text-gray-500">No training records found.</p>
              ) : (
                <div className="space-y-3">
                  {trainings.map((training) => (
                    <div
                      key={training.id}
                      className="border border-gray-200 rounded-lg p-4 hover:border-gray-300"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{training.course_name || training.course_id}</h3>
                          {training.certification_number && (
                            <p className="text-sm text-gray-600 mt-1">
                              Cert #: {training.certification_number}
                            </p>
                          )}
                          <div className="flex gap-4 mt-2 text-sm text-gray-600">
                            {training.completion_date && (
                              <span>Completed: {formatDate(training.completion_date)}</span>
                            )}
                            {training.expiration_date && (
                              <span>Expires: {formatDate(training.expiration_date)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${getTrainingStatusColor(
                              training.status
                            )}`}
                          >
                            {training.status.replace('_', ' ')}
                          </span>
                          {isExpired(training) && (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              expired
                            </span>
                          )}
                          {isExpiringSoon(training) && (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              expiring soon
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Assigned Inventory - Only shown if inventory module is enabled */}
          {inventoryModuleEnabled && (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Assigned Inventory</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Item
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Item #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Condition
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Assigned
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {inventoryItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {item.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.item_number}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.category}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              item.condition === 'Excellent'
                                ? 'bg-green-100 text-green-800'
                                : item.condition === 'Good'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {item.condition}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {formatDate(item.assigned_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Contact & Additional Info */}
        <div className="space-y-6">
          {/* Contact Information */}
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Contact Information</h2>
              {canEdit && !isEditing && (
                <button
                  onClick={handleEditClick}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Edit
                </button>
              )}
            </div>

            {!isEditing ? (
              <div className="space-y-3">
                {user.email && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Email</p>
                    <p className="text-sm text-gray-900 mt-1">{user.email}</p>
                  </div>
                )}
                {user.phone && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Phone</p>
                    <p className="text-sm text-gray-900 mt-1">{user.phone}</p>
                  </div>
                )}
                {user.mobile && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Mobile</p>
                    <p className="text-sm text-gray-900 mt-1">{user.mobile}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-medium mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => handleFormChange('email', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-medium mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => handleFormChange('phone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-medium mb-1">
                    Mobile
                  </label>
                  <input
                    type="tel"
                    value={editForm.mobile}
                    onChange={(e) => handleFormChange('mobile', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <label className="block text-xs text-gray-500 uppercase font-medium mb-3">
                    Notification Preferences
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.notification_preferences?.email}
                        onChange={() => handleNotificationToggle('email')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">Email notifications</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.notification_preferences?.sms}
                        onChange={() => handleNotificationToggle('sms')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">SMS notifications</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.notification_preferences?.push}
                        onChange={() => handleNotificationToggle('push')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">Push notifications</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={handleSaveContact}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-white text-gray-700 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>

                {error && (
                  <div className="mt-2 text-sm text-red-600">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Employment Info */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Employment</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium">Status</p>
                <p className="text-sm text-gray-900 mt-1 capitalize">{user.status}</p>
              </div>
              {user.hire_date && (
                <div>
                  <p className="text-xs text-gray-500 uppercase font-medium">Hire Date</p>
                  <p className="text-sm text-gray-900 mt-1">{formatDate(user.hire_date)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Active Certifications</span>
                <span className="text-sm font-semibold text-gray-900">
                  {trainings.filter((t) => t.status === 'current').length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Expiring Soon</span>
                <span className="text-sm font-semibold text-yellow-600">
                  {trainings.filter((t) => t.status === 'expiring_soon').length}
                </span>
              </div>
              {inventoryModuleEnabled && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Assigned Equipment</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {inventoryItems.length}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Upcoming Shifts</span>
                <span className="text-sm font-semibold text-gray-900">
                  {upcomingShifts.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemberProfilePage;
