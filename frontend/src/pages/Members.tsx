import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  UserPlus,
  Upload,
  Search,
  Filter,
  Edit,
  Trash2,
  Phone,
  Mail,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { userService } from '../services/api';
import { User } from '../types/user';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import { useAuthStore } from '../stores/authStore';

interface MemberStats {
  total: number;
  active: number;
  inactive: number;
  onLeave: number;
  retired: number;
}

const Members: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { user: currentUser } = useAuthStore();
  const [members, setMembers] = useState<User[]>([]);
  const [stats, setStats] = useState<MemberStats>({
    total: 0,
    active: 0,
    inactive: 0,
    onLeave: 0,
    retired: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactInfoEnabled, setContactInfoEnabled] = useState({
    enabled: false,
    show_email: false,
    show_phone: false,
    show_mobile: false,
  });

  useEffect(() => {
    loadMembers();
    checkContactInfoSettings();
  }, []);

  const loadMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const users = await userService.getUsers();
      setMembers(users);

      // Calculate stats from real data
      const calculatedStats: MemberStats = {
        total: users.length,
        active: users.filter(u => u.status === 'active').length,
        inactive: users.filter(u => u.status === 'inactive').length,
        onLeave: users.filter(u => u.status === 'leave' || u.status === 'on_leave').length,
        retired: users.filter(u => u.status === 'retired').length,
      };
      setStats(calculatedStats);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load the member list. Please check your connection and refresh the page.'));
    } finally {
      setLoading(false);
    }
  };

  const checkContactInfoSettings = async () => {
    try {
      const settings = await userService.checkContactInfoEnabled();
      setContactInfoEnabled(settings);
    } catch (_err) {
      // Error silently handled - contact info settings default to disabled
    }
  };

  const handleDeleteMember = async (member: User) => {
    const name = `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.username;
    if (!confirm(`Are you sure you want to delete ${name}? This action cannot be easily undone.`)) {
      return;
    }

    try {
      setError(null);
      await userService.deleteUser(member.id);
      await loadMembers();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to delete the member. Please check your connection and try again.'));
    }
  };

  const filteredMembers = members.filter((member) => {
    const fullName = `${member.first_name || ''} ${member.last_name || ''}`.toLowerCase();
    const searchLower = searchQuery.toLowerCase();

    const matchesSearch =
      fullName.includes(searchLower) ||
      (member.username && member.username.toLowerCase().includes(searchLower)) ||
      (member.membership_number && member.membership_number.toLowerCase().includes(searchLower)) ||
      (member.email && member.email.toLowerCase().includes(searchLower));

    const matchesFilter =
      filterStatus === 'all' ||
      member.status === filterStatus ||
      (filterStatus === 'leave' && (member.status === 'leave' || member.status === 'on_leave'));

    return matchesSearch && matchesFilter;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
      case 'inactive':
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
      case 'leave':
      case 'on_leave':
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
      case 'retired':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
      default:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
    }
  };

  const getInitials = (firstName?: string, lastName?: string) => {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || '?';
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 rounded-lg p-2">
              <Users className="w-6 h-6 text-theme-text-primary" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl sm:text-2xl font-bold">Membership Management</h1>
              <p className="text-theme-text-muted text-sm hidden sm:block">Manage department members and records</p>
            </div>
          </div>
        </div>
        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0" />
            <p className="text-red-700 dark:text-red-300 text-sm flex-1">{error}</p>
            <button
              onClick={loadMembers}
              className="flex items-center gap-1 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Members</p>
            <p className="text-theme-text-primary text-2xl font-bold mt-1">{stats.total}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Active</p>
            <p className="text-green-700 dark:text-green-400 text-2xl font-bold mt-1">{stats.active}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Inactive</p>
            <p className="text-theme-text-muted text-2xl font-bold mt-1">{stats.inactive}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">On Leave</p>
            <p className="text-yellow-700 dark:text-yellow-400 text-2xl font-bold mt-1">{stats.onLeave}</p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Retired</p>
            <p className="text-blue-700 dark:text-blue-400 text-2xl font-bold mt-1">{stats.retired}</p>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Search */}
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
              <input
                type="text"
                placeholder="Search by name, membership number, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-theme-text-muted" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="leave">On Leave</option>
                <option value="retired">Retired</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 sm:space-x-3 w-full md:w-auto">
              <button
                onClick={() => navigate('/members/import')}
                className="flex items-center justify-center space-x-2 px-3 sm:px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex-1 md:flex-none"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Import CSV</span>
                <span className="sm:hidden">Import</span>
              </button>
              <button
                onClick={() => navigate('/members/add')}
                className="flex items-center justify-center space-x-2 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex-1 md:flex-none"
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Member</span>
                <span className="sm:hidden">Add</span>
              </button>
            </div>
          </div>
        </div>

        {/* Contact Info Privacy Notice */}
        {contactInfoEnabled.enabled && (
          <div className="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-blue-700 dark:text-blue-300 text-sm">
              <strong>Privacy Notice:</strong> Contact information is displayed for department purposes only.
              This information should not be used for commercial purposes or shared outside the organization.
            </p>
          </div>
        )}

        {/* Members Table */}
        {loading ? (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
            <p className="text-theme-text-secondary">Loading members...</p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <Users className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Members Found</h3>
            <p className="text-theme-text-secondary mb-6">
              {searchQuery || filterStatus !== 'all'
                ? 'Try adjusting your search or filters'
                : 'Get started by adding your first member or importing from CSV'}
            </p>
            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => navigate('/members/import')}
                className="flex items-center space-x-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                <Upload className="w-5 h-5" />
                <span>Import CSV</span>
              </button>
              <button
                onClick={() => navigate('/members/add')}
                className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <UserPlus className="w-5 h-5" />
                <span>Add Member</span>
              </button>
            </div>
          </div>
        ) : (
          <>
          {/* Mobile card view */}
          <div className="md:hidden space-y-3">
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center min-w-0 flex-1">
                    {member.photo_url ? (
                      <img
                        src={member.photo_url}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                        {getInitials(member.first_name, member.last_name)}
                      </div>
                    )}
                    <div className="ml-3 min-w-0">
                      <div className="text-theme-text-primary font-medium truncate">
                        {member.first_name} {member.last_name}
                      </div>
                      <div className="text-theme-text-muted text-sm">@{member.username}</div>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded border flex-shrink-0 ml-2 ${getStatusColor(member.status)}`}
                  >
                    {member.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <div className="text-theme-text-muted space-y-1">
                    {member.membership_number && (
                      <div className="font-mono text-xs">#{member.membership_number}</div>
                    )}
                    {contactInfoEnabled.enabled && contactInfoEnabled.show_phone && member.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {member.phone}
                      </div>
                    )}
                    {contactInfoEnabled.enabled && contactInfoEnabled.show_email && member.email && (
                      <div className="flex items-center gap-1 truncate">
                        <Mail className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{member.email}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-1 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/members/${member.id}`)}
                      className="p-2 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="View/Edit Profile"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    {currentUser?.id !== member.id && (
                      <button
                        onClick={() => handleDeleteMember(member)}
                        className="p-2 text-red-700 dark:text-red-400 hover:bg-red-500/10 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                      Member
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                      Member #
                    </th>
                    {contactInfoEnabled.enabled && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        Contact
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                      Hire Date
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-surface-border">
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-theme-surface-secondary transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {member.photo_url ? (
                            <img
                              src={member.photo_url}
                              alt=""
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                              {getInitials(member.first_name, member.last_name)}
                            </div>
                          )}
                          <div className="ml-3">
                            <div className="text-theme-text-primary font-medium">
                              {member.first_name} {member.last_name}
                            </div>
                            <div className="text-theme-text-muted text-sm">@{member.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {member.membership_number && (
                          <div className="text-theme-text-primary font-mono text-sm">{member.membership_number}</div>
                        )}
                        {!member.membership_number && (
                          <div className="text-theme-text-muted">-</div>
                        )}
                      </td>
                      {contactInfoEnabled.enabled && (
                        <td className="px-6 py-4">
                          <div className="text-sm">
                            {contactInfoEnabled.show_phone && member.phone && (
                              <div className="flex items-center text-theme-text-secondary mb-1">
                                <Phone className="w-3 h-3 mr-1" />
                                {member.phone}
                              </div>
                            )}
                            {contactInfoEnabled.show_mobile && member.mobile && !member.phone && (
                              <div className="flex items-center text-theme-text-secondary mb-1">
                                <Phone className="w-3 h-3 mr-1" />
                                {member.mobile}
                              </div>
                            )}
                            {contactInfoEnabled.show_email && member.email && (
                              <div className="flex items-center text-theme-text-muted text-xs">
                                <Mail className="w-3 h-3 mr-1" />
                                {member.email}
                              </div>
                            )}
                            {!member.phone && !member.mobile && !member.email && (
                              <span className="text-theme-text-muted">-</span>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded border ${getStatusColor(
                            member.status
                          )}`}
                        >
                          {member.status.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-theme-text-secondary">
                          {member.hire_date
                            ? formatDate(member.hire_date, tz)
                            : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => navigate(`/members/${member.id}`)}
                            className="p-2 text-blue-700 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                            title="View/Edit Profile"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {currentUser?.id !== member.id && (
                            <button
                              onClick={() => handleDeleteMember(member)}
                              className="p-2 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </main>
    </div>
  );
};

export default Members;
