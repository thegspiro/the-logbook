import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
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
  Download,
  Printer,
} from 'lucide-react';
import { userService } from '../services/api';
import { User } from '../types/user';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';
import { formatDate, getTodayLocalDate } from '../utils/dateFormatting';
import { useAuthStore } from '../stores/authStore';
import { DeleteMemberModal } from '../components/DeleteMemberModal';
import { Breadcrumbs, SkeletonPage, EmptyState, Pagination, Avatar } from '../components/ux';
import { SortableHeader, sortItems } from '../components/ux/SortableHeader';
import type { SortDirection } from '../components/ux/SortableHeader';
import type { MemberStats } from '../types/member';
import { UserStatus } from '../constants/enums';

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
    expiringCertifications: 0,
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
  const [deleteModalMember, setDeleteModalMember] = useState<User | null>(null);

  // Bulk selection state (#33)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sorting state (#30)
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Pagination state (#11)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    void loadMembers();
    void checkContactInfoSettings();
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
        active: users.filter((u) => u.status === UserStatus.ACTIVE).length,
        inactive: users.filter((u) => u.status === UserStatus.INACTIVE).length,
        onLeave: users.filter((u) => u.status === UserStatus.LEAVE).length,
        retired: users.filter((u) => u.status === UserStatus.RETIRED).length,
        expiringCertifications: 0,
      };
      setStats(calculatedStats);
    } catch (err: unknown) {
      setError(
        getErrorMessage(err, 'Unable to load the member list. Please check your connection and refresh the page.')
      );
    } finally {
      setLoading(false);
    }
  };

  useRegisterPullToRefresh(loadMembers);

  const checkContactInfoSettings = async () => {
    try {
      const settings = await userService.checkContactInfoEnabled();
      setContactInfoEnabled(settings);
    } catch (_err) {
      // Error silently handled - contact info settings default to disabled
    }
  };

  const handleDeleteMember = (member: User) => {
    setDeleteModalMember(member);
  };

  const handleSoftDelete = async (userId: string) => {
    try {
      setError(null);
      await userService.deleteUserWithMode(userId, false);
      setDeleteModalMember(null);
      await loadMembers();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to deactivate the member. Please try again.'));
    }
  };

  const handleHardDelete = async (userId: string) => {
    try {
      setError(null);
      await userService.deleteUserWithMode(userId, true);
      setDeleteModalMember(null);
      await loadMembers();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to permanently delete the member. Please try again.'));
    }
  };

  const filteredMembers = useMemo(() => {
    let result = members.filter((member) => {
      const fullName = `${member.first_name || ''} ${member.last_name || ''}`.toLowerCase();
      const searchLower = searchQuery.toLowerCase();

      const matchesSearch =
        fullName.includes(searchLower) ||
        (member.username && member.username.toLowerCase().includes(searchLower)) ||
        (member.membership_number && member.membership_number.toLowerCase().includes(searchLower)) ||
        (member.email && member.email.toLowerCase().includes(searchLower));

      const matchesFilter = filterStatus === 'all' || member.status === filterStatus || filterStatus === member.status;

      return matchesSearch && matchesFilter;
    });

    // Apply sorting (#30)
    result = sortItems(result, sortField, sortDirection, (item, field) => {
      switch (field) {
        case 'name':
          return `${item.first_name || ''} ${item.last_name || ''}`;
        case 'status':
          return item.status;
        case 'hire_date':
          return item.hire_date || '';
        case 'membership_number':
          return item.membership_number || '';
        default:
          return (item as unknown as Record<string, unknown>)[field] as string;
      }
    });

    return result;
  }, [members, searchQuery, filterStatus, sortField, sortDirection]);

  // Paginated subset (#11)
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize);
  }, [filteredMembers, currentPage, pageSize]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus, sortField, sortDirection]);

  const handleSort = (field: string, direction: SortDirection) => {
    setSortField(direction ? field : null);
    setSortDirection(direction);
  };

  // #33: Bulk selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === paginatedMembers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedMembers.map((m) => m.id)));
    }
  }, [paginatedMembers, selectedIds.size]);

  // #48: CSV export for members (also used for bulk export of selected)
  const handleExportCSV = useCallback(() => {
    const exportSet = selectedIds.size > 0 ? filteredMembers.filter((m) => selectedIds.has(m.id)) : filteredMembers;
    const headers = ['First Name', 'Last Name', 'Username', 'Email', 'Status', 'Membership #', 'Hire Date'];
    const rows = exportSet.map((m) => [
      m.first_name || '',
      m.last_name || '',
      m.username || '',
      m.email || '',
      m.status || '',
      m.membership_number || '',
      m.hire_date ? formatDate(m.hire_date, tz) : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `members-${getTodayLocalDate(tz)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredMembers, selectedIds, tz]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case UserStatus.ACTIVE:
        return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
      case UserStatus.INACTIVE:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
      case UserStatus.LEAVE:
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
      case UserStatus.RETIRED:
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
      default:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
    }
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Breadcrumbs />

        {/* Page Header */}
        <div className="mb-6 flex items-center justify-between sm:mb-8">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-blue-600 p-2">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">Membership Management</h1>
              <p className="text-theme-text-muted hidden text-sm sm:block">Manage department members and records</p>
            </div>
          </div>
          {filteredMembers.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="btn-secondary inline-flex items-center gap-2"
              title="Export to CSV"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
        </div>
        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
            <p className="flex-1 text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={() => {
                void loadMembers();
              }}
              className="flex items-center gap-1 text-sm text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Members</p>
            <p className="text-theme-text-primary mt-1 text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Active</p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">{stats.active}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Inactive</p>
            <p className="text-theme-text-muted mt-1 text-2xl font-bold">{stats.inactive}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">On Leave</p>
            <p className="mt-1 text-2xl font-bold text-yellow-700 dark:text-yellow-400">{stats.onLeave}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Retired</p>
            <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-400">{stats.retired}</p>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="card mb-6 p-4">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            {/* Search */}
            <div className="relative w-full flex-1 md:max-w-md">
              <Search className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform" />
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                type="text"
                aria-label="Search by name, membership number, or email..."
                placeholder="Search by name, membership number, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="text-theme-text-muted h-5 w-5" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden max-md:min-h-[44px]"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="leave">On Leave</option>
                <option value="retired">Retired</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex w-full items-center space-x-2 sm:space-x-3 md:w-auto">
              <button
                onClick={() => void navigate('/members/import')}
                className="flex flex-1 items-center justify-center space-x-2 rounded-lg bg-purple-600 px-3 py-2 text-white transition-colors hover:bg-purple-700 max-md:min-h-[44px] sm:px-4 md:flex-none"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Import CSV</span>
                <span className="sm:hidden">Import</span>
              </button>
              <button
                onClick={() => void navigate('/members/add')}
                className="btn-info flex flex-1 items-center justify-center space-x-2 px-3 sm:px-4 md:flex-none"
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Member</span>
                <span className="sm:hidden">Add</span>
              </button>
            </div>
          </div>
        </div>

        {/* Contact Info Privacy Notice */}
        {contactInfoEnabled.enabled && (
          <div className="mb-6 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>Privacy Notice:</strong> Contact information is displayed for department purposes only. This
              information should not be used for commercial purposes or shared outside the organization.
            </p>
          </div>
        )}

        {/* Members Table */}
        {loading ? (
          <SkeletonPage rows={8} showStats={false} />
        ) : filteredMembers.length === 0 ? (
          <div className="card p-12">
            <EmptyState
              icon={Users}
              title="No Members Found"
              description={
                searchQuery || filterStatus !== 'all'
                  ? 'Try adjusting your search or filters'
                  : 'Get started by adding your first member or importing from CSV'
              }
              actions={
                !(searchQuery || filterStatus !== 'all')
                  ? [
                      {
                        label: 'Import CSV',
                        onClick: () => void navigate('/members/import'),
                        icon: Upload,
                        variant: 'secondary',
                      },
                      { label: 'Add Member', onClick: () => void navigate('/members/add'), icon: UserPlus },
                    ]
                  : undefined
              }
            />
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="space-y-3 md:hidden">
              {paginatedMembers.map((member) => (
                <div key={member.id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 flex-1 items-center">
                      <Avatar
                        firstName={member.first_name}
                        lastName={member.last_name}
                        photoUrl={member.photo_url}
                        size="md"
                      />
                      <div className="ml-3 min-w-0">
                        <div className="text-theme-text-primary truncate font-medium">
                          {member.first_name} {member.last_name}
                        </div>
                        <div className="text-theme-text-muted text-sm">@{member.username}</div>
                      </div>
                    </div>
                    <span
                      className={`ml-2 shrink-0 rounded-sm border px-2 py-1 text-xs font-semibold ${getStatusColor(member.status)}`}
                    >
                      {member.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <div className="text-theme-text-muted space-y-1">
                      {member.membership_number && <div className="font-mono text-xs">#{member.membership_number}</div>}
                      {contactInfoEnabled.enabled && contactInfoEnabled.show_phone && member.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {member.phone}
                        </div>
                      )}
                      {contactInfoEnabled.enabled && contactInfoEnabled.show_email && member.email && (
                        <div className="flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{member.email}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center space-x-1">
                      <button
                        onClick={() => void navigate(`/members/${member.id}`)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-blue-700 transition-colors hover:bg-blue-500/10 dark:text-blue-400"
                        title="View/Edit Profile"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      {currentUser?.id !== member.id && (
                        <button
                          onClick={() => handleDeleteMember(member)}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bulk action bar (#33) */}
            {selectedIds.size > 0 && (
              <div className="mb-3 hidden items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 md:flex">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {selectedIds.size} selected
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => void navigate(`/members/print-labels?ids=${[...selectedIds].join(',')}`)}
                    className="inline-flex items-center gap-1 rounded-sm bg-emerald-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-emerald-700"
                  >
                    <Printer className="h-3 w-3" />
                    Print Badges
                  </button>
                  <button
                    onClick={handleExportCSV}
                    className="inline-flex items-center gap-1 rounded-sm bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700"
                  >
                    <Download className="h-3 w-3" />
                    Export Selected
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}

            {/* Desktop table view */}
            <div className="card hidden overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-theme-input-bg border-theme-surface-border border-b">
                    <tr>
                      <th scope="col" className="w-10 py-3 pr-1 pl-4">
                        <input
                          type="checkbox"
                          checked={paginatedMembers.length > 0 && selectedIds.size === paginatedMembers.length}
                          onChange={toggleSelectAll}
                          className="border-theme-input-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
                          aria-label="Select all members"
                        />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortableHeader
                          label="Member"
                          field="name"
                          currentSort={sortField}
                          currentDirection={sortDirection}
                          onSort={handleSort}
                        />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortableHeader
                          label="Member #"
                          field="membership_number"
                          currentSort={sortField}
                          currentDirection={sortDirection}
                          onSort={handleSort}
                        />
                      </th>
                      {contactInfoEnabled.enabled && (
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Contact
                        </th>
                      )}
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortableHeader
                          label="Status"
                          field="status"
                          currentSort={sortField}
                          currentDirection={sortDirection}
                          onSort={handleSort}
                        />
                      </th>
                      <th scope="col" className="px-6 py-3 text-left">
                        <SortableHeader
                          label="Hire Date"
                          field="hire_date"
                          currentSort={sortField}
                          currentDirection={sortDirection}
                          onSort={handleSort}
                        />
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary px-6 py-3 text-right text-xs font-medium tracking-wider uppercase"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {paginatedMembers.map((member) => (
                      <tr
                        key={member.id}
                        className={`hover:bg-theme-surface-secondary transition-colors ${selectedIds.has(member.id) ? 'bg-blue-500/5' : ''}`}
                      >
                        <td className="w-10 py-4 pr-1 pl-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(member.id)}
                            onChange={() => toggleSelect(member.id)}
                            className="border-theme-input-border focus:ring-theme-focus-ring rounded-sm text-blue-600"
                            aria-label={`Select ${member.first_name} ${member.last_name}`}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <Avatar
                              firstName={member.first_name}
                              lastName={member.last_name}
                              photoUrl={member.photo_url}
                              size="md"
                            />
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
                          {!member.membership_number && <div className="text-theme-text-muted">-</div>}
                        </td>
                        {contactInfoEnabled.enabled && (
                          <td className="px-6 py-4">
                            <div className="text-sm">
                              {contactInfoEnabled.show_phone && member.phone && (
                                <div className="text-theme-text-secondary mb-1 flex items-center">
                                  <Phone className="mr-1 h-3 w-3" />
                                  {member.phone}
                                </div>
                              )}
                              {contactInfoEnabled.show_mobile && member.mobile && !member.phone && (
                                <div className="text-theme-text-secondary mb-1 flex items-center">
                                  <Phone className="mr-1 h-3 w-3" />
                                  {member.mobile}
                                </div>
                              )}
                              {contactInfoEnabled.show_email && member.email && (
                                <div className="text-theme-text-muted flex items-center text-xs">
                                  <Mail className="mr-1 h-3 w-3" />
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
                            className={`rounded border px-2 py-1 text-xs font-semibold ${getStatusColor(
                              member.status
                            )}`}
                          >
                            {member.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-theme-text-secondary text-sm">
                            {member.hire_date ? formatDate(member.hire_date, tz) : '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => void navigate(`/members/${member.id}`)}
                              className="rounded-sm p-2 text-blue-700 transition-colors hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              title="View/Edit Profile"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            {currentUser?.id !== member.id && (
                              <button
                                onClick={() => handleDeleteMember(member)}
                                className="rounded-sm p-2 text-red-700 transition-colors hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
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
            {/* Pagination (#11) */}
            <Pagination
              currentPage={currentPage}
              totalItems={filteredMembers.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
              className="mt-4"
            />
          </>
        )}
      </main>

      {deleteModalMember && (
        <DeleteMemberModal
          isOpen={!!deleteModalMember}
          onClose={() => setDeleteModalMember(null)}
          member={
            deleteModalMember
              ? {
                  id: deleteModalMember.id,
                  full_name:
                    deleteModalMember.full_name ||
                    `${deleteModalMember.first_name || ''} ${deleteModalMember.last_name || ''}`.trim(),
                  username: deleteModalMember.username,
                  status: deleteModalMember.status,
                }
              : null
          }
          onSoftDelete={handleSoftDelete}
          onHardDelete={handleHardDelete}
        />
      )}
    </div>
  );
};

export default Members;
