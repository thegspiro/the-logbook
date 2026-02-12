import React from 'react';
import { Bell, Mail, Settings, Zap } from 'lucide-react';

const NotificationsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-600 rounded-lg p-2">
              <Bell className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Email Notifications</h1>
              <p className="text-slate-400 text-sm">
                Automated email notifications for events, reminders, and important updates
              </p>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Mail className="w-8 h-8 text-orange-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Email Templates</h3>
            <p className="text-slate-300 text-sm">
              Customizable email templates for event reminders, announcements, and alerts.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Zap className="w-8 h-8 text-yellow-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Automated Triggers</h3>
            <p className="text-slate-300 text-sm">
              Set up automatic notifications for events, training deadlines, and more.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Settings className="w-8 h-8 text-slate-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Preferences</h3>
            <p className="text-slate-300 text-sm">
              Members can manage their own notification preferences and opt-in/out.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <Bell className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">Notifications Not Configured</h3>
          <p className="text-slate-300 mb-6">
            Set up email notifications to keep your members informed about important updates.
          </p>
          <button
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
            disabled
          >
            Configure Notifications (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default NotificationsPage;
