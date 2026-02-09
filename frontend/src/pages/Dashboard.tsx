import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Users, FileText, Settings, GraduationCap, TrendingUp, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { AppLayout } from '../components/layout';
import { useNavigate } from 'react-router-dom';
import { trainingProgramService } from '../services/api';
import { getProgressBarColor } from '../utils/eventHelpers';
import type { ProgramEnrollment, MemberProgramProgress } from '../types/training';

/**
 * Main Dashboard Component
 *
 * This is the primary landing page after onboarding completion.
 * Users are automatically redirected here after creating their admin account.
 */
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [departmentName, setDepartmentName] = useState('Fire Department');
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [progressDetails, setProgressDetails] = useState<Map<string, MemberProgramProgress>>(new Map());
  const [loadingTraining, setLoadingTraining] = useState(true);

  useEffect(() => {
    // Load department name for display
    const savedDepartmentName = sessionStorage.getItem('departmentName');
    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    }

    // Load training progress
    loadTrainingProgress();
  }, []);

  const loadTrainingProgress = async () => {
    try {
      // Get active enrollments
      const data = await trainingProgramService.getMyEnrollments('active');
      setEnrollments(data);

      // Load detailed progress for each enrollment
      const details = new Map<string, MemberProgramProgress>();
      for (const enrollment of data.slice(0, 3)) { // Load details for top 3 programs
        try {
          const progress = await trainingProgramService.getEnrollmentProgress(enrollment.id);
          details.set(enrollment.id, progress);
        } catch (err) {
          console.error(`Failed to load progress for enrollment ${enrollment.id}:`, err);
          // Continue loading other enrollments even if one fails
        }
      }
      setProgressDetails(details);
    } catch (error) {
      console.error('Failed to load training progress:', error);
      toast.error('Failed to load training progress');
    } finally {
      setLoadingTraining(false);
    }
  };

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8" role="region" aria-label="Quick statistics">
          <button
            onClick={() => navigate('/members')}
            className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 cursor-pointer hover:bg-white/15 transition-colors text-left focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            aria-label="Total Members: 1. Click to manage members"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-300 text-sm font-medium">Total Members</p>
                <p className="text-white text-3xl font-bold mt-1">1</p>
              </div>
              <div className="bg-blue-600 rounded-full p-3" aria-hidden="true">
                <Users className="w-6 h-6 text-white" />
              </div>
            </div>
            <p className="text-slate-300 text-xs mt-2">Click to manage members →</p>
          </button>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-300 text-sm font-medium">Documents</p>
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
                <p className="text-slate-300 text-sm font-medium">Setup Status</p>
                <p className="text-white text-3xl font-bold mt-1">100%</p>
              </div>
              <div className="bg-purple-600 rounded-full p-3">
                <Settings className="w-6 h-6 text-white" />
              </div>
            </div>
            <p className="text-slate-300 text-xs mt-2">Configuration complete</p>
          </div>
        </div>

        {/* Training Progress Widget */}
        {!loadingTraining && enrollments.length > 0 && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <GraduationCap className="w-6 h-6 text-red-500" />
                <span>My Training Progress</span>
              </h3>
              <button
                onClick={() => navigate('/training/my-progress')}
                className="text-red-400 hover:text-red-300 text-sm flex items-center space-x-1 focus:outline-none focus:ring-2 focus:ring-red-500 focus:rounded-md"
              >
                <span>View All</span>
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              {enrollments.slice(0, 3).map((enrollment) => {
                const progress = progressDetails.get(enrollment.id);
                const nextSteps = progress?.requirement_progress
                  .filter(rp => rp.status === 'not_started' || rp.status === 'in_progress')
                  .slice(0, 2);
                const upcomingDeadline = progress?.time_remaining_days !== null &&
                                        progress?.time_remaining_days !== undefined &&
                                        progress.time_remaining_days < 30;

                return (
                  <button
                    key={enrollment.id}
                    onClick={() => navigate('/training/my-progress')}
                    className="w-full bg-slate-800/50 rounded-lg p-4 hover:bg-slate-800/70 cursor-pointer transition-colors text-left focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                    aria-label={`${enrollment.program?.name || 'Program'}: ${Math.round(enrollment.progress_percentage)}% complete. Click to view details`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-white font-semibold">{enrollment.program?.name || 'Program'}</h4>
                          {upcomingDeadline && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded flex items-center space-x-1">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Deadline Soon</span>
                            </span>
                          )}
                        </div>
                        {enrollment.program?.description && (
                          <p className="text-slate-300 text-sm">{enrollment.program.description}</p>
                        )}
                      </div>
                      <span className="text-2xl font-bold text-white ml-4">
                        {Math.round(enrollment.progress_percentage)}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-700 rounded-full h-2 mb-3">
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressBarColor(enrollment.progress_percentage)}`}
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>

                    {/* Next Steps or Completion */}
                    {progress && (
                      <div className="space-y-2">
                        {enrollment.status === 'completed' ? (
                          <div className="flex items-center space-x-2 text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Program Completed!</span>
                          </div>
                        ) : nextSteps && nextSteps.length > 0 ? (
                          <div>
                            <p className="text-slate-300 text-xs mb-1">Next Steps:</p>
                            <div className="space-y-1">
                              {nextSteps.map((rp) => (
                                <div key={rp.id} className="flex items-start space-x-2 text-sm">
                                  <TrendingUp className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
                                  <span className="text-slate-300">{rp.requirement?.name || 'Requirement'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-300 text-sm">All requirements in progress</div>
                        )}

                        {/* Deadline Info */}
                        {progress.time_remaining_days !== null && progress.time_remaining_days !== undefined && (
                          <div className={`text-xs ${
                            progress.time_remaining_days < 30 ? 'text-red-400' :
                            progress.time_remaining_days < 90 ? 'text-yellow-400' :
                            'text-slate-300'
                          }`}>
                            {progress.time_remaining_days} days remaining
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {enrollments.length > 3 && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => navigate('/training/my-progress')}
                  className="text-red-400 hover:text-red-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:rounded-md px-2 py-1"
                >
                  View {enrollments.length - 3} more program{enrollments.length - 3 !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}

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
      <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-white/10 mt-12" role="contentinfo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-slate-300 text-sm">
            © {new Date().getFullYear()} {departmentName}. All rights reserved.
          </p>
          <p className="text-center text-slate-400 text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </AppLayout>
  );
};

export default Dashboard;
