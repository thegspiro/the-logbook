/**
 * Training Dashboard Page
 *
 * Dashboard for training officers to manage all training-related activities.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trainingService } from '../services/api';
import type {
  TrainingCourse,
  TrainingRecord,
  TrainingRequirement,
  RequirementProgress,
} from '../types/training';

export default function TrainingDashboardPage() {
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
      console.error('Error loading training data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getExpirationStatus = (expirationDate: string) => {
    const today = new Date();
    const expDate = new Date(expirationDate);
    const daysUntilExpiry = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) return { status: 'Expired', color: 'text-red-600 bg-red-50' };
    if (daysUntilExpiry <= 30) return { status: `${daysUntilExpiry} days`, color: 'text-red-600 bg-red-50' };
    if (daysUntilExpiry <= 60) return { status: `${daysUntilExpiry} days`, color: 'text-yellow-600 bg-yellow-50' };
    return { status: `${daysUntilExpiry} days`, color: 'text-green-600 bg-green-50' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading training dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Training Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Manage training courses, requirements, and certifications
        </p>
      </div>

      {/* Alert for Expiring Certifications */}
      {expiringCerts.length > 0 && (
        <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
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
              <p className="text-sm text-yellow-700">
                <span className="font-medium">{expiringCerts.length} certifications</span> expiring within 90 days
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-600">Active Courses</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{courses.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-600">Requirements ({currentYear})</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{requirements.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-600">Expiring Soon</div>
          <div className="mt-2 text-3xl font-semibold text-yellow-600">{expiringCerts.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-600">Quick Actions</div>
          <div className="mt-2 space-y-2">
            <button className="text-sm text-blue-600 hover:text-blue-800 block">
              New Record
            </button>
            <button className="text-sm text-blue-600 hover:text-blue-800 block">
              Generate Report
            </button>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('courses')}
              className={`${
                activeTab === 'courses'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Training Courses
            </button>
            <button
              onClick={() => setActiveTab('requirements')}
              className={`${
                activeTab === 'requirements'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Requirements
            </button>
            <button
              onClick={() => setActiveTab('certifications')}
              className={`${
                activeTab === 'certifications'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
                <h2 className="text-lg font-semibold text-gray-900">Active Training Courses</h2>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Add New Course
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Course Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Code
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Duration
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Instructor
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {courses.map((course) => (
                      <tr key={course.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{course.name}</div>
                          {course.description && (
                            <div className="text-sm text-gray-500">{course.description}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {course.code || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                            {course.training_type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {course.duration_hours ? `${course.duration_hours}h` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {course.instructor || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button className="text-blue-600 hover:text-blue-900 mr-3">Edit</button>
                          <button className="text-gray-600 hover:text-gray-900">View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {courses.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
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
                <h2 className="text-lg font-semibold text-gray-900">
                  Training Requirements for {currentYear}
                </h2>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Add New Requirement
                </button>
              </div>
              <div className="space-y-4">
                {requirements.map((req) => (
                  <div key={req.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900">{req.name}</h3>
                        {req.description && (
                          <p className="mt-1 text-sm text-gray-600">{req.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-4">
                          {req.required_hours && (
                            <div className="text-sm text-gray-600">
                              <span className="font-medium">Required Hours:</span> {req.required_hours}
                            </div>
                          )}
                          {req.frequency && (
                            <div className="text-sm text-gray-600">
                              <span className="font-medium">Frequency:</span>{' '}
                              {req.frequency.replace('_', ' ')}
                            </div>
                          )}
                          {req.due_date && (
                            <div className="text-sm text-gray-600">
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
                        <button className="text-sm text-gray-600 hover:text-gray-900">
                          View Progress
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {requirements.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No requirements set for {currentYear}. Add a new requirement to get started.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expiring Certifications Tab */}
          {activeTab === 'certifications' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Certifications Expiring Within 90 Days
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Member
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Course
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Cert Number
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Expiration Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Days Remaining
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {expiringCerts.map((cert) => {
                      const expStatus = cert.expiration_date
                        ? getExpirationStatus(cert.expiration_date)
                        : null;
                      return (
                        <tr key={cert.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <Link
                              to={`/members/${cert.user_id}`}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              View Member
                            </Link>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{cert.course_name}</div>
                            {cert.course_code && (
                              <div className="text-sm text-gray-500">{cert.course_code}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {cert.certification_number || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
                  <div className="text-center py-8 text-gray-500">
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
