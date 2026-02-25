/**
 * Start Skill Test Page
 *
 * Mobile-friendly page where an examiner selects a published template
 * and a candidate, then starts a new skill evaluation session.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ClipboardCheck,
  Search,
  User,
  FileText,
  Play,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { userService } from '../services/api';

interface MemberOption {
  id: string;
  name: string;
  email: string;
}

export const StartSkillTestPage: React.FC = () => {
  const navigate = useNavigate();
  const { templates, templatesLoading, loadTemplates, createTest } = useSkillsTestingStore();
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [notes, setNotes] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    void loadTemplates({ status: 'published' });
    void loadMembers();
  }, [loadTemplates]);

  const loadMembers = async () => {
    try {
      const users = await userService.getUsers();
      setMembers(
        users.map((u) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`.trim(),
          email: u.email ?? '',
        }))
      );
    } catch {
      toast.error('Failed to load members');
    } finally {
      setMembersLoading(false);
    }
  };

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(templateSearch.toLowerCase())
  );

  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const handleStart = async () => {
    if (!selectedTemplateId) {
      toast.error('Please select a template');
      return;
    }
    if (!selectedCandidateId) {
      toast.error('Please select a candidate');
      return;
    }

    setIsStarting(true);
    try {
      const test = await createTest({
        template_id: selectedTemplateId,
        candidate_id: selectedCandidateId,
        notes: notes.trim() || undefined,
      });
      toast.success('Test session started');
      navigate(`/training/skills-testing/test/${test.id}/active`);
    } catch {
      toast.error('Failed to start test');
    } finally {
      setIsStarting(false);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedCandidate = members.find((m) => m.id === selectedCandidateId);

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/training/skills-testing?tab=tests"
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
            <ClipboardCheck className="w-7 h-7 sm:w-8 sm:h-8 text-red-700" />
            <span>Start Skill Test</span>
          </h1>
        </div>

        {/* Step 1: Select Template */}
        <div className="bg-theme-surface rounded-lg p-4 sm:p-6 border border-theme-surface-border mb-4">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5 text-red-600" />
            1. Select Template
          </h2>

          {selectedTemplate ? (
            <div className="flex items-center justify-between p-3 bg-green-100 dark:bg-green-900/30 border border-green-500/30 rounded-lg">
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">{selectedTemplate.name}</p>
                {selectedTemplate.category && (
                  <p className="text-sm text-green-700 dark:text-green-300">{selectedTemplate.category}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedTemplateId('')}
                className="text-sm text-green-700 dark:text-green-300 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                <input
                  type="text"
                  placeholder="Search templates..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50"
                />
              </div>
              {templatesLoading ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-red-500" />
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {filteredTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplateId(t.id)}
                      className="w-full text-left p-3 rounded-lg border border-theme-surface-border hover:border-red-500/50 transition-colors"
                    >
                      <p className="font-medium text-theme-text-primary">{t.name}</p>
                      <p className="text-xs text-theme-text-muted">
                        {t.category ?? 'No category'} &middot; {t.section_count} sections &middot; {t.criteria_count} criteria
                      </p>
                    </button>
                  ))}
                  {filteredTemplates.length === 0 && (
                    <p className="text-center text-theme-text-muted py-4 text-sm">No published templates found</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Step 2: Select Candidate */}
        <div className="bg-theme-surface rounded-lg p-4 sm:p-6 border border-theme-surface-border mb-4">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
            <User className="w-5 h-5 text-red-600" />
            2. Select Candidate
          </h2>

          {selectedCandidate ? (
            <div className="flex items-center justify-between p-3 bg-green-100 dark:bg-green-900/30 border border-green-500/30 rounded-lg">
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">{selectedCandidate.name}</p>
                <p className="text-sm text-green-700 dark:text-green-300">{selectedCandidate.email}</p>
              </div>
              <button
                onClick={() => setSelectedCandidateId('')}
                className="text-sm text-green-700 dark:text-green-300 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
                <input
                  type="text"
                  placeholder="Search members..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50"
                />
              </div>
              {membersLoading ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-red-500" />
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {filteredMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedCandidateId(m.id)}
                      className="w-full text-left p-3 rounded-lg border border-theme-surface-border hover:border-red-500/50 transition-colors"
                    >
                      <p className="font-medium text-theme-text-primary">{m.name}</p>
                      <p className="text-xs text-theme-text-muted">{m.email}</p>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && (
                    <p className="text-center text-theme-text-muted py-4 text-sm">No members found</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Step 3: Notes (optional) */}
        <div className="bg-theme-surface rounded-lg p-4 sm:p-6 border border-theme-surface-border mb-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-3">
            3. Notes (optional)
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any notes for this test session..."
            className="w-full px-3 py-3 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
          />
        </div>

        {/* Start Button */}
        <button
          onClick={() => void handleStart()}
          disabled={!selectedTemplateId || !selectedCandidateId || isStarting}
          className="w-full flex items-center justify-center gap-3 py-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-xl text-lg font-bold transition-colors"
        >
          <Play className="w-6 h-6" />
          {isStarting ? 'Starting...' : 'Begin Evaluation'}
        </button>
      </main>
    </div>
  );
};

export default StartSkillTestPage;
