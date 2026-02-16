/**
 * Training Dashboard Page
 *
 * Dashboard for training officers to manage all training-related activities.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { trainingService } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { formatDate } from '../utils/dateFormatting';
import { getExpirationStatus } from '../utils/eventHelpers';
import type {
  TrainingCourse,
  TrainingRecord,
  TrainingRequirement,
  RequirementProgress as _RequirementProgress,
} from '../types/training';

export default function TrainingDashboardPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [expiringCerts, setExpiringCerts] = useState<TrainingRecord[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'courses' | 'requirements' | 'certifications'>('courses');
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [coursesData, expiringData, requirementsData] = await Promise.all([
        trainingService.getCourses(true),
        trainingService.getExpiringCertifications(90),
        trainingService.getRequirements({ year: currentYear, active_only: true }),
      ]);
      setCourses(coursesData);
      setExpiringCerts(expiringData);
      setRequirements(requirementsData);
    } catch (error) {
      toast.error('Failed to load training dashboard data');
    } finally {
      setLoading(false);
    }
  };


  if (loading) {
    return <LoadingSpinner message="Loading training dashboard..." />;
  }

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">Training Dashboard</h1>
        <p className="text-theme-text-secondary mt-2">
          Manage training courses, requirements, and certifications
        </p>
      </div>

      {/* Alert for Expiring Certifications */}
      {expiringCerts.length > 0 && (
        <div className="mb-6 bg-yellow-500/10 border-l-4 border-yellow-500 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-700 dark:text-yellow-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                <span className="font-medium">{expiringCerts.length} certifications</span> expiring within 90 days
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow p-6">
          <div className="text-sm font-medium text-theme-text-secondary">Active Courses</div>
          <div className="mt-2 text-3xl font-semibold text-theme-text-primary">{courses.length}</div>
        </div>
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow p-6">
          <div className="text-sm font-medium text-theme-text-secondary">Requirements ({currentYear})</div>
          <div className="mt-2 text-3xl font-semibold text-theme-text-primary">{requirements.length}</div>
        </div>
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow p-6">
          <div className="text-sm font-medium text-theme-text-secondary">Expiring Soon</div>
          <div className="mt-2 text-3xl font-semibold text-yellow-600">{expiringCerts.length}</div>
        </div>
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow p-6">
          <div className="text-sm font-medium text-theme-text-secondary">Quick Actions</div>
          <div className="mt-2 space-y-2">
            <button onClick={() => navigate('/training/my-training')} className="text-sm text-blue-600 hover:text-blue-800 block">
              My Training
            </button>
            <button onClick={() => navigate('/training/submit')} className="text-sm text-blue-600 hover:text-blue-800 block">
              Submit External Training
            </button>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow">
        <div className="border-b border-theme-surface-border">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('courses')}
              className={`${
                activeTab === 'courses'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-theme-text-muted hover:text-slate-200 hover:border-white/30'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Training Courses
            </button>
            <button
              onClick={() => setActiveTab('requirements')}
              className={`${
                activeTab === 'requirements'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-theme-text-muted hover:text-slate-200 hover:border-white/30'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Requirements
            </button>
            <button
              onClick={() => setActiveTab('certifications')}
              className={`${
                activeTab === 'certifications'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-theme-text-muted hover:text-slate-200 hover:border-white/30'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Expiring Certifications
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Training Courses Tab */}
          {activeTab === 'courses' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-theme-text-primary">Active Training Courses</h2>
                <button
                  onClick={() => navigate('/training/courses')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Add New Course
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10">
                  <thead className="bg-theme-input-bg">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Course Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Code
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Duration
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Instructor
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {courses.map((course) => (
                      <tr key={course.id} className="hover:bg-theme-surface-secondary">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-theme-text-primary">{course.name}</div>
                          {course.description && (
                            <div className="text-sm text-theme-text-muted">{course.description}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                          {course.code || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                            {course.training_type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                          {course.duration_hours ? `${course.duration_hours}h` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                          {course.instructor || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button className="text-blue-600 hover:text-blue-900 mr-3">Edit</button>
                          <button className="text-theme-text-secondary hover:text-theme-text-primary">View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {courses.length === 0 && (
                  <div className="text-center py-8 text-theme-text-muted">
                    No active courses. Add a new course to get started.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Requirements Tab */}
          {activeTab === 'requirements' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-theme-text-primary">
                  Training Requirements for {currentYear}
                </h2>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Add New Requirement
                </button>
              </div>
              <div className="space-y-4">
                {requirements.map((req) => (
                  <div key={req.id} className="border border-theme-surface-border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-theme-text-primary">{req.name}</h3>
                        {req.description && (
                          <p className="mt-1 text-sm text-theme-text-secondary">{req.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-4">
                          {req.required_hours && (
                            <div className="text-sm text-theme-text-secondary">
                              <span className="font-medium">Required Hours:</span> {req.required_hours}
                            </div>
                          )}
                          {req.frequency && (
                            <div className="text-sm text-theme-text-secondary">
                              <span className="font-medium">Frequency:</span>{' '}
                              {req.frequency.replace('_', ' ')}
                            </div>
                          )}
                          {req.due_date && (
                            <div className="text-sm text-theme-text-secondary">
                              <span className="font-medium">Due Date:</span> {formatDate(req.due_date)}
                            </div>
                          )}
                        </div>
                        <div className="mt-2">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              req.applies_to_all
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {req.applies_to_all ? 'Applies to All' : 'Specific Roles'}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <button className="text-sm text-blue-600 hover:text-blue-900 mr-3">
                          Edit
                        </button>
                        <button className="text-sm text-theme-text-secondary hover:text-theme-text-primary">
                          View Progress
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {requirements.length === 0 && (
                  <div className="text-center py-8 text-theme-text-muted">
                    No requirements set for {currentYear}. Add a new requirement to get started.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expiring Certifications Tab */}
          {activeTab === 'certifications' && (
            <div>
              <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
                Certifications Expiring Within 90 Days
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10">
                  <thead className="bg-theme-input-bg">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Member
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Course
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Cert Number
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Expiration Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Days Remaining
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {expiringCerts.map((cert) => {
                      const expStatus = cert.expiration_date
                        ? getExpirationStatus(cert.expiration_date)
                        : null;
                      return (
                        <tr key={cert.id} className="hover:bg-theme-surface-secondary">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-primary">
                            <Link
                              to={`/members/${cert.user_id}`}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              View Member
                            </Link>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-theme-text-primary">{cert.course_name}</div>
                            {cert.course_code && (
                              <div className="text-sm text-theme-text-muted">{cert.course_code}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                            {cert.certification_number || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                            {formatDate(cert.expiration_date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {expStatus && (
                              <span
                                className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${expStatus.color}`}
                              >
                                {expStatus.status}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button className="text-blue-600 hover:text-blue-900">
                              Schedule Renewal
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {expiringCerts.length === 0 && (
                  <div className="text-center py-8 text-theme-text-muted">
                    No certifications expiring in the next 90 days.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
