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

interface MemberStats {
  total: number;
  active: number;
  inactive: number;
  onLeave: number;
  retired: number;
}

const Members: React.FC = () => {
  const navigate = useNavigate();
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
    } catch (err) {
      // Error silently handled - contact info settings default to disabled
    }
  };

  const filteredMembers = members.filter((member) => {
    const fullName = `${member.first_name || ''} ${member.last_name || ''}`.toLowerCase();
    const searchLower = searchQuery.toLowerCase();

    const matchesSearch =
      fullName.includes(searchLower) ||
      (member.username && member.username.toLowerCase().includes(searchLower)) ||
      (member.badge_number && member.badge_number.toLowerCase().includes(searchLower)) ||
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
        return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'inactive':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
      case 'leave':
      case 'on_leave':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'retired':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const getInitials = (firstName?: string, lastName?: string) => {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || '?';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 rounded-lg p-2">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Membership Management</h1>
              <p className="text-slate-400 text-sm">Manage department members and records</p>
            </div>
          </div>
        </div>
        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm flex-1">{error}</p>
            <button
              onClick={loadMembers}
              className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Total Members</p>
            <p className="text-white text-2xl font-bold mt-1">{stats.total}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Active</p>
            <p className="text-green-400 text-2xl font-bold mt-1">{stats.active}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Inactive</p>
            <p className="text-slate-400 text-2xl font-bold mt-1">{stats.inactive}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">On Leave</p>
            <p className="text-yellow-400 text-2xl font-bold mt-1">{stats.onLeave}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Retired</p>
            <p className="text-blue-400 text-2xl font-bold mt-1">{stats.retired}</p>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Search */}
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, badge number, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-slate-400" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="leave">On Leave</option>
                <option value="retired">Retired</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate('/members/import')}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Import CSV</span>
              </button>
              <button
                onClick={() => navigate('/members/add')}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Member</span>
              </button>
            </div>
          </div>
        </div>

        {/* Contact Info Privacy Notice */}
        {contactInfoEnabled.enabled && (
          <div className="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-blue-300 text-sm">
              <strong>Privacy Notice:</strong> Contact information is displayed for department purposes only.
              This information should not be used for commercial purposes or shared outside the organization.
            </p>
          </div>
        )}

        {/* Members Table */}
        {loading ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-slate-300">Loading members...</p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <Users className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">No Members Found</h3>
            <p className="text-slate-300 mb-6">
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
          <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-900/50 border-b border-white/10">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                      Member
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                      Badge #
                    </th>
                    {contactInfoEnabled.enabled && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                        Contact
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                      Hire Date
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-white/5 transition-colors">
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
                            <div className="text-white font-medium">
                              {member.first_name} {member.last_name}
                            </div>
                            <div className="text-slate-400 text-sm">@{member.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-white font-mono">{member.badge_number || '-'}</div>
                      </td>
                      {contactInfoEnabled.enabled && (
                        <td className="px-6 py-4">
                          <div className="text-sm">
                            {contactInfoEnabled.show_phone && member.phone && (
                              <div className="flex items-center text-slate-300 mb-1">
                                <Phone className="w-3 h-3 mr-1" />
                                {member.phone}
                              </div>
                            )}
                            {contactInfoEnabled.show_mobile && member.mobile && !member.phone && (
                              <div className="flex items-center text-slate-300 mb-1">
                                <Phone className="w-3 h-3 mr-1" />
                                {member.mobile}
                              </div>
                            )}
                            {contactInfoEnabled.show_email && member.email && (
                              <div className="flex items-center text-slate-400 text-xs">
                                <Mail className="w-3 h-3 mr-1" />
                                {member.email}
                              </div>
                            )}
                            {!member.phone && !member.mobile && !member.email && (
                              <span className="text-slate-500">-</span>
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
                        <div className="text-sm text-slate-300">
                          {member.hire_date
                            ? new Date(member.hire_date).toLocaleDateString()
                            : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => navigate(`/members/${member.id}`)}
                            className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                            title="View/Edit Profile"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Members;
