/**
 * Member Profile Page
 *
 * Comprehensive view of a member's information including:
 * - Basic information
 * - Current month hours
 * - Upcoming shifts
 * - Training records
 * - Assigned inventory items
 * - Contact information
 * - Roles and permissions
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { userService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { UserWithRoles } from '../types/role';
import type { ContactInfoUpdate, NotificationPreferences } from '../types/user';

interface MonthlyHours {
  month: string;
  regular_hours: number;
  overtime_hours: number;
  total_hours: number;
}

interface Shift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  position: string;
  location?: string;
}

interface Training {
  id: string;
  name: string;
  certification_number?: string;
  completion_date: string;
  expiration_date?: string;
  status: 'current' | 'expiring_soon' | 'expired';
}

interface InventoryItem {
  id: string;
  name: string;
  item_number: string;
  assigned_date: string;
  condition: string;
  category: string;
}

export const MemberProfilePage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();

  const [user, setUser] = useState<UserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Placeholder data - these would come from API calls
  const [monthlyHours] = useState<MonthlyHours>({
    month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
    regular_hours: 160,
    overtime_hours: 12,
    total_hours: 172,
  });

  const [upcomingShifts] = useState<Shift[]>([
    {
      id: '1',
      date: '2026-01-20',
      start_time: '08:00',
      end_time: '16:00',
      position: 'Engine 1',
      location: 'Station 1',
    },
    {
      id: '2',
      date: '2026-01-23',
      start_time: '08:00',
      end_time: '16:00',
      position: 'Ladder 2',
      location: 'Station 2',
    },
    {
      id: '3',
      date: '2026-01-27',
      start_time: '08:00',
      end_time: '16:00',
      position: 'Engine 1',
      location: 'Station 1',
    },
  ]);

  const [trainings] = useState<Training[]>([
    {
      id: '1',
      name: 'EMT Certification',
      certification_number: 'EMT-2024-1234',
      completion_date: '2024-03-15',
      expiration_date: '2026-03-15',
      status: 'current',
    },
    {
      id: '2',
      name: 'Firefighter I',
      certification_number: 'FF1-2023-5678',
      completion_date: '2023-06-20',
      status: 'current',
    },
    {
      id: '3',
      name: 'Hazmat Operations',
      certification_number: 'HAZ-2024-9012',
      completion_date: '2024-08-10',
      expiration_date: '2026-02-10',
      status: 'expiring_soon',
    },
  ]);

  const [inventoryItems] = useState<InventoryItem[]>([
    {
      id: '1',
      name: 'Turnout Gear',
      item_number: 'TOG-042',
      assigned_date: '2024-01-15',
      condition: 'Good',
      category: 'PPE',
    },
    {
      id: '2',
      name: 'SCBA Unit',
      item_number: 'SCBA-128',
      assigned_date: '2024-01-15',
      condition: 'Excellent',
      category: 'Breathing Apparatus',
    },
    {
      id: '3',
      name: 'Radio - Portable',
      item_number: 'RAD-P-089',
      assigned_date: '2024-03-20',
      condition: 'Good',
      category: 'Communications',
    },
    {
      id: '4',
      name: 'Helmet',
      item_number: 'HLM-042',
      assigned_date: '2024-01-15',
      condition: 'Good',
      category: 'PPE',
    },
  ]);

  useEffect(() => {
    if (userId) {
      fetchUserData();
    }
  }, [userId]);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch user with roles
      const userData = await userService.getUserWithRoles(userId!);
      setUser(userData);
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError('Failed to load member information.');
    } finally {
      setLoading(false);
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
      case 'current':
        return 'bg-green-100 text-green-800';
      case 'expiring_soon':
        return 'bg-yellow-100 text-yellow-800';
      case 'expired':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleEditClick = () => {
    // Populate form with current user data
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

  if (error || !user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error || 'Member not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
        >
          ← Back
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
          {/* Current Month Hours */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Hours - {monthlyHours.month}
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600 font-medium">Regular Hours</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">
                  {monthlyHours.regular_hours}
                </p>
              </div>
              <div className="bg-amber-50 rounded-lg p-4">
                <p className="text-sm text-amber-600 font-medium">Overtime</p>
                <p className="text-2xl font-bold text-amber-900 mt-1">
                  {monthlyHours.overtime_hours}
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-green-600 font-medium">Total Hours</p>
                <p className="text-2xl font-bold text-green-900 mt-1">
                  {monthlyHours.total_hours}
                </p>
              </div>
            </div>
          </div>

          {/* Upcoming Shifts */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Shifts</h2>
            <div className="space-y-3">
              {upcomingShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  <div>
                    <p className="font-medium text-gray-900">{formatDate(shift.date)}</p>
                    <p className="text-sm text-gray-600">
                      {shift.start_time} - {shift.end_time}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900">{shift.position}</p>
                    {shift.location && (
                      <p className="text-sm text-gray-600">{shift.location}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Training & Certifications */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Training & Certifications
            </h2>
            <div className="space-y-3">
              {trainings.map((training) => (
                <div
                  key={training.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">{training.name}</h3>
                      {training.certification_number && (
                        <p className="text-sm text-gray-600 mt-1">
                          Cert #: {training.certification_number}
                        </p>
                      )}
                      <div className="flex gap-4 mt-2 text-sm text-gray-600">
                        <span>Completed: {formatDate(training.completion_date)}</span>
                        {training.expiration_date && (
                          <span>Expires: {formatDate(training.expiration_date)}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${getTrainingStatusColor(
                        training.status
                      )}`}
                    >
                      {training.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Assigned Inventory */}
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
              <div>
                <p className="text-xs text-gray-500 uppercase font-medium">Organization</p>
                <p className="text-sm text-gray-900 mt-1">Fire Department</p>
              </div>
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
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Assigned Equipment</span>
                <span className="text-sm font-semibold text-gray-900">
                  {inventoryItems.length}
                </span>
              </div>
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
