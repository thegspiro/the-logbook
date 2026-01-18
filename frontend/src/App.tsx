import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import MemberListPage from './pages/MemberListPage'
import MemberProfilePage from './pages/MemberProfilePage'
import SettingsPage from './pages/SettingsPage'
import MembersAdminPage from './pages/MembersAdminPage'
import RoleManagementPage from './pages/RoleManagementPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuthStore } from './stores/authStore'

function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, user, logout, checkPermission } = useAuthStore()

  const isActive = (path: string) => {
    return location.pathname === path
      ? 'border-blue-500 text-gray-900'
      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Don't show navigation on login/register pages
  if (location.pathname === '/login' || location.pathname === '/register') {
    return null
  }

  // Don't show navigation if not authenticated
  if (!isAuthenticated) {
    return null
  }

  const canAccessMembersAdmin = checkPermission('users.update_roles') ||
                                 checkPermission('users.view') ||
                                 checkPermission('organization.update_settings')

  const canAccessRoles = checkPermission('roles.create') ||
                         checkPermission('roles.update') ||
                         checkPermission('roles.delete')

  const canAccessSettings = checkPermission('organization.update_settings')

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <h1 className="text-xl font-bold text-gray-900">The Logbook</h1>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link
                to="/"
                className={`${isActive('/')} inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
              >
                Members
              </Link>
              {canAccessMembersAdmin && (
                <Link
                  to="/admin/members"
                  className={`${isActive('/admin/members')} inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  Members Admin
                </Link>
              )}
              {canAccessRoles && (
                <Link
                  to="/admin/roles"
                  className={`${isActive('/admin/roles')} inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  Role Management
                </Link>
              )}
              {canAccessSettings && (
                <Link
                  to="/settings"
                  className={`${isActive('/settings')} inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  Settings
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center">
            <span className="text-sm text-gray-700 mr-4">
              {user?.first_name} {user?.last_name}
            </span>
            <button
              onClick={handleLogout}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}

function App() {
  const { loadUser, isLoading } = useAuthStore()

  useEffect(() => {
    // Load user from token on app mount
    loadUser()
  }, [loadUser])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navigation />

        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MemberListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/members/:userId"
            element={
              <ProtectedRoute>
                <MemberProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/members"
            element={
              <ProtectedRoute requiredPermission="users.view">
                <MembersAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/roles"
            element={
              <ProtectedRoute requiredPermission="roles.view">
                <RoleManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute requiredPermission="organization.update_settings">
                <SettingsPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </div>
    </Router>
  )
}

export default App
