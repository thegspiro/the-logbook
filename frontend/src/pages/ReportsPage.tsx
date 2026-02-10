/**
 * Reports Page
 *
 * Central hub for viewing and generating various reports.
 */

import React, { useState } from 'react';
import {
  FileText,
  Calendar,
  Users,
  TrendingUp,
  Download,
  Filter,
  AlertCircle,
} from 'lucide-react';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  category: 'member' | 'training' | 'event' | 'compliance';
  available: boolean;
}

export const ReportsPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const reports: ReportCard[] = [
    {
      id: 'member-roster',
      title: 'Member Roster',
      description: 'Complete list of all active members with contact information',
      icon: Users,
      category: 'member',
      available: true,
    },
    {
      id: 'training-summary',
      title: 'Training Summary',
      description: 'Overview of training hours and certifications by member',
      icon: TrendingUp,
      category: 'training',
      available: true,
    },
    {
      id: 'event-attendance',
      title: 'Event Attendance',
      description: 'Attendance records for all events and training sessions',
      icon: Calendar,
      category: 'event',
      available: true,
    },
    {
      id: 'compliance-status',
      title: 'Compliance Status',
      description: 'Current compliance status for certifications and requirements',
      icon: AlertCircle,
      category: 'compliance',
      available: false,
    },
  ];

  const categories = [
    { id: 'all', label: 'All Reports' },
    { id: 'member', label: 'Member Reports' },
    { id: 'training', label: 'Training Reports' },
    { id: 'event', label: 'Event Reports' },
    { id: 'compliance', label: 'Compliance Reports' },
  ];

  const filteredReports =
    selectedCategory === 'all'
      ? reports
      : reports.filter((r) => r.category === selectedCategory);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Reports</h1>
        <p className="text-slate-300">
          Generate and download reports for members, training, events, and compliance
        </p>
      </div>

      {/* Category Filter */}
      <div className="mb-6 flex items-center space-x-2">
        <Filter className="w-5 h-5 text-slate-400" aria-hidden="true" />
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                selectedCategory === category.id
                  ? 'bg-red-600 text-white'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredReports.map((report) => {
          const Icon = report.icon;
          return (
            <div
              key={report.id}
              className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-6 transition-all ${
                report.available
                  ? 'hover:bg-white/10 hover:border-white/20 cursor-pointer'
                  : 'opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-red-600/20 rounded-lg flex items-center justify-center">
                  <Icon className="w-6 h-6 text-red-500" aria-hidden="true" />
                </div>
                {!report.available && (
                  <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 text-xs font-medium rounded">
                    Coming Soon
                  </span>
                )}
              </div>

              <h3 className="text-lg font-semibold text-white mb-2">
                {report.title}
              </h3>
              <p className="text-sm text-slate-300 mb-4">{report.description}</p>

              {report.available && (
                <button
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                  onClick={() => {
                    // Placeholder for report generation
                    alert(`Generating ${report.title}...`);
                  }}
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  <span>Generate Report</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredReports.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-xl font-semibold text-white mb-2">
            No reports found
          </h3>
          <p className="text-slate-400">
            Try selecting a different category or check back later for new reports
          </p>
        </div>
      )}

      {/* Info Banner */}
      <div className="mt-8 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-medium text-blue-300 mb-1">
              Report Generation
            </h4>
            <p className="text-sm text-blue-200">
              Reports are generated in real-time based on current data. Some reports may
              take a few moments to compile depending on the amount of data. Reports with
              "Coming Soon" badges are currently in development and will be available in
              future updates.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
