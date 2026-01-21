import React, { useState, useEffect } from 'react';
import { Users, FileText, Settings } from 'lucide-react';
import { AppLayout } from '../components/layout';
import { useNavigate } from 'react-router-dom';

/**
 * Main Dashboard Component
 *
 * This is the primary landing page after onboarding completion.
 * Users are automatically redirected here after creating their admin account.
 */
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [departmentName, setDepartmentName] = useState('Fire Department');

  useEffect(() => {
    // Load department name for display
    const savedDepartmentName = sessionStorage.getItem('departmentName');
    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    }
  }, []);

  return (
    <AppLayout>
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8 border border-white/20 mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">
            Welcome to {departmentName}!
          </h2>
          <p className="text-slate-300 text-lg">
            Your intranet platform is now set up and ready to use.
          </p>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div
            onClick={() => navigate('/members')}
            className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 cursor-pointer hover:bg-white/15 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Total Members</p>
                <p className="text-white text-3xl font-bold mt-1">1</p>
              </div>
              <div className="bg-blue-600 rounded-full p-3">
                <Users className="w-6 h-6 text-white" />
              </div>
            </div>
            <p className="text-slate-300 text-xs mt-2">Click to manage members →</p>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Documents</p>
                <p className="text-white text-3xl font-bold mt-1">0</p>
              </div>
              <div className="bg-green-600 rounded-full p-3">
                <FileText className="w-6 h-6 text-white" />
              </div>
            </div>
            <p className="text-slate-300 text-xs mt-2">No documents yet</p>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Setup Status</p>
                <p className="text-white text-3xl font-bold mt-1">100%</p>
              </div>
              <div className="bg-purple-600 rounded-full p-3">
                <Settings className="w-6 h-6 text-white" />
              </div>
            </div>
            <p className="text-slate-300 text-xs mt-2">Configuration complete</p>
          </div>
        </div>

        {/* Getting Started Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8 border border-white/20">
          <h3 className="text-2xl font-bold text-white mb-4">Getting Started</h3>
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <h4 className="text-white font-semibold mb-2">✅ Onboarding Complete</h4>
              <p className="text-slate-300 text-sm">
                You've successfully completed the initial setup. Your department's information,
                email configuration, file storage, authentication platform, and IT team contacts
                have all been configured.
              </p>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4">
              <h4 className="text-white font-semibold mb-2">📋 Next Steps</h4>
              <ul className="text-slate-300 text-sm space-y-2 ml-4 list-disc">
                <li>Add additional users to your department</li>
                <li>Upload important documents and files</li>
                <li>Configure department-specific modules</li>
                <li>Set up schedules and rosters</li>
                <li>Create training materials and resources</li>
              </ul>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4">
              <h4 className="text-white font-semibold mb-2">🔒 Security Note</h4>
              <p className="text-slate-300 text-sm">
                Your password was securely hashed using Argon2id, and all sensitive configuration
                (API keys, secrets) is encrypted with AES-256. All data is stored securely on the server.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-white/10 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-slate-400 text-sm">
            © {new Date().getFullYear()} {departmentName}. All rights reserved.
          </p>
          <p className="text-center text-slate-500 text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </AppLayout>
  );
};

export default Dashboard;
