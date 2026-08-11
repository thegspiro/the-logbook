/**
 * Start Skill Test Page
 *
 * Mobile-friendly page where an examiner selects a published template,
 * chooses between an official evaluation or practice run, then picks
 * a candidate via search to start a new skill evaluation session.
 *
 * Open to every member, not just training officers. A member may drill on their
 * own (practice, candidate defaulted to themselves) and may examine a colleague
 * officially — departments routinely use senior members as evaluators. What a
 * member cannot do is make the result count: an official test they run is
 * submitted for a training officer to validate, which the backend enforces.
 *
 * Entry points that already know which test the user picked (the member-facing
 * Skills Testing list, for example) pass `?template=<id>` so step 1 arrives
 * pre-filled instead of asking the same question twice. `?from=member` sends
 * the Back link to that list rather than the Training Admin hub.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { ArrowLeft, ClipboardCheck, Search, User, FileText, Play, Award, BookOpen, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { useAuthStore } from '../stores/authStore';
import { trainingProgramService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { useMemberSearch } from '../hooks/useMemberSearch';
import { MEMBER_SEARCH_MAX_RESULTS, MEMBER_SEARCH_MIN_CHARS } from '../constants/config';
import type { TrainingRequirementEnhanced } from '../types/training';

interface MemberOption {
  id: string;
  name: string;
}

export const StartSkillTestPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateParam = searchParams.get('template') ?? '';
  const backTo =
    searchParams.get('from') === 'member'
      ? '/training/skills-testing'
      : '/training/admin?page=skills-testing&tab=tests';
  const { templates, templatesLoading, loadTemplates, createTest } = useSkillsTestingStore();
  const { user, checkPermission } = useAuthStore();
  const isOfficer = checkPermission('training.manage');
  // Search results only — the roster is never held client-side, because the
  // endpoint behind it will not return one.
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // The candidates the user picked, kept separately from the search results so
  // they survive those being replaced or cleared.
  //
  // A list, because drill night is a batch: twelve people through one SCBA
  // evolution used to mean twelve trips back to this page, re-picking the same
  // sheet each time. One entry behaves exactly as it did before.
  const [candidates, setCandidates] = useState<MemberOption[]>([]);
  // The `?template=` hand-off applies exactly once, so hitting "Change" isn't
  // undone by the next render.
  const preselectApplied = useRef(false);
  // Same one-shot rule for defaulting a member's practice run to themselves —
  // otherwise re-picking a candidate would be overwritten on the next render.
  const selfCandidateApplied = useRef(false);

  // Set as soon as the user picks a mode themselves, so the member default
  // below never overrides a deliberate choice.
  const modeChosen = useRef(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [notes, setNotes] = useState('');
  const [isPractice, setIsPractice] = useState(false);
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [overrideRequirementId, setOverrideRequirementId] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    void (async () => {
      await loadTemplates({ status: 'published' });
      setTemplatesLoaded(true);
    })();
  }, [loadTemplates]);

  // Pre-select the template the user tapped on the previous screen. Waits for
  // the published list so a stale/unpublished id is caught rather than silently
  // selecting nothing.
  useEffect(() => {
    if (!templateParam || !templatesLoaded || preselectApplied.current) return;
    preselectApplied.current = true;
    if (templates.some((t) => t.id === templateParam)) {
      setSelectedTemplateId(templateParam);
    } else {
      toast.error('That test is no longer available — choose one below.');
    }
  }, [templateParam, templatesLoaded, templates]);

  // A member arriving here is most often drilling on their own, and practice is
  // the mode that needs no sign-off — so it is the safer default to land on.
  // Officers keep official, which is what they come here to run.
  useEffect(() => {
    if (modeChosen.current || isOfficer) return;
    setIsPractice(true);
  }, [isOfficer]);

  // "Practice on your own" should be one tap, not a search for your own name.
  // Officers are excluded: an officer running a practice drill is almost always
  // drilling someone else.
  //
  // Built from the signed-in user rather than looked up, so defaulting to
  // yourself costs no request — and works even though the endpoint will not
  // hand out a roster to pick your own name out of.
  useEffect(() => {
    if (selfCandidateApplied.current || isOfficer) return;
    if (!isPractice || !user?.id || candidates.length > 0) return;
    const ownName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    if (!ownName) return;
    selfCandidateApplied.current = true;
    setCandidates([{ id: user.id, name: ownName }]);
  }, [isOfficer, isPractice, user?.id, user?.first_name, user?.last_name, candidates.length]);

  // Server-side candidate search, debounced — shared with the viewers panel so
  // both pickers over this population behave identically. The endpoint requires
  // a fragment and caps its results, so this cannot be turned into a roster
  // fetch by clearing the box.
  const {
    results: members,
    loading: membersLoading,
    error: membersError,
    tooShort: searchTooShort,
  } = useMemberSearch(memberSearch);

  useEffect(() => {
    if (membersError) toast.error(membersError);
  }, [membersError]);

  // Load training requirements for the optional per-test override.
  useEffect(() => {
    void (async () => {
      try {
        setRequirements(await trainingProgramService.getRequirementsEnhanced());
      } catch {
        // Non-fatal — the requirement link is optional.
      }
    })();
  }, []);

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
      (t.category ?? '').toLowerCase().includes(templateSearch.toLowerCase())
  );

  // Already filtered and capped by the server; nothing left to narrow here.
  const filteredMembers = members;

  // The backend refuses an official test whose examiner and candidate are the
  // same person (separation of duties — a self-recorded pass would satisfy a
  // program requirement). Caught here so a member who defaulted into their own
  // name and then switched to Official is told why, rather than being handed a
  // 400 after filling the form in.
  const isSelfCandidate = !!user?.id && candidates.some((c) => c.id === user.id);
  const isBatch = candidates.length > 1;
  const selfOfficialBlocked = !isPractice && isSelfCandidate;
  const showRequirementStep = !isPractice && isOfficer;

  const handleStart = async () => {
    if (!selectedTemplateId) {
      toast.error('Please select a template');
      return;
    }
    if (candidates.length === 0) {
      toast.error('Please select a candidate');
      return;
    }
    if (selfOfficialBlocked) {
      toast.error('An official evaluation needs a different examiner and candidate');
      return;
    }

    setIsStarting(true);
    try {
      // Created one at a time rather than through a bulk endpoint: each is an
      // ordinary test creation, so every service-layer rule — separation of
      // duties, the attempt cap, the requirement link — applies per candidate
      // with nothing new to keep in step.
      //
      // Sequential rather than Promise.all, deliberately: the attempt cap is
      // checked against tests already recorded, so firing a squad's worth
      // together could let a candidate past a cap that two racing requests both
      // read as not yet reached.
      const created = [];
      const failed: string[] = [];
      for (const candidate of candidates) {
        try {
          created.push(
            await createTest({
              template_id: selectedTemplateId,
              candidate_id: candidate.id,
              ...(notes.trim() ? { notes: notes.trim() } : {}),
              // Only a real (non-practice) test with an explicit override needs to send
              // a requirement; otherwise the backend inherits the template's default.
              ...(!isPractice && overrideRequirementId ? { requirement_id: overrideRequirementId } : {}),
              is_practice: isPractice,
            })
          );
        } catch (err: unknown) {
          // One refusal must not discard the rest of the squad — a candidate
          // out of attempts is a fact about them, not about the drill.
          failed.push(`${candidate.name}: ${getErrorMessage(err, 'could not be started')}`);
        }
      }

      const first = created[0];
      if (!first) {
        toast.error(failed[0] ?? 'Failed to start test');
        return;
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} could not be started — ${failed[0]}`);
      }

      toast.success(
        isBatch
          ? `${created.length} test${created.length === 1 ? '' : 's'} queued — starting with ${candidates[0]?.name ?? 'the first'}`
          : isPractice
            ? 'Practice session started'
            : isOfficer
              ? 'Test session started'
              : 'Test session started — a training officer will validate the result'
      );
      // Straight into the first. The rest wait in the records list, which is
      // what "queued" means here: the examiner works down them as the squad
      // comes up instead of returning to this page for each one.
      void navigate(`/training/skills-testing/test/${first.id}/active`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to start test'));
    } finally {
      setIsStarting(false);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            to={backTo}
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center transition-colors"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            Back
          </Link>
          <h1 className="text-theme-text-primary flex items-center space-x-3 text-2xl font-bold sm:text-3xl">
            <ClipboardCheck className="h-7 w-7 text-red-700 sm:h-8 sm:w-8" />
            <span>Start Skill Test</span>
          </h1>
        </div>

        {/* Step 1: Select Template */}
        <div className="bg-theme-surface border-theme-surface-border mb-4 rounded-lg border p-4 sm:p-6">
          <h2 className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-5 w-5 text-red-600" />
            1. Select Template
          </h2>

          {selectedTemplate ? (
            <div className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-100 p-3 dark:bg-green-900/30">
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">{selectedTemplate.name}</p>
                {selectedTemplate.category && (
                  <p className="text-sm text-green-700 dark:text-green-300">{selectedTemplate.category}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedTemplateId('')}
                aria-label="Change template"
                className="text-sm text-green-700 underline dark:text-green-300"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  type="text"
                  aria-label="Search templates..."
                  placeholder="Search templates..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring/50 w-full rounded-lg border py-3 pr-4 pl-10 focus:ring-2 focus:outline-hidden"
                />
              </div>
              {templatesLoading ? (
                <div className="flex justify-center py-4" role="status" aria-live="polite">
                  <div className="h-6 w-6 animate-spin rounded-full border-t-2 border-b-2 border-red-500" />
                </div>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {filteredTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplateId(t.id)}
                      className="border-theme-surface-border w-full rounded-lg border p-3 text-left transition-colors hover:border-red-500/50"
                    >
                      <p className="text-theme-text-primary font-medium">{t.name}</p>
                      <p className="text-theme-text-muted text-xs">
                        {t.category ?? 'No category'} &middot; {t.section_count} sections &middot; {t.criteria_count}{' '}
                        criteria
                      </p>
                    </button>
                  ))}
                  {filteredTemplates.length === 0 && (
                    <p className="text-theme-text-muted py-4 text-center text-sm">No published templates found</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Step 2: Test Mode */}
        <div className="bg-theme-surface border-theme-surface-border mb-4 rounded-lg border p-4 sm:p-6">
          <h2 className="text-theme-text-primary mb-3 text-lg font-semibold">2. Test Mode</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              onClick={() => {
                modeChosen.current = true;
                setIsPractice(false);
              }}
              className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                !isPractice
                  ? 'border-red-600 bg-red-50 shadow-md dark:bg-red-900/20'
                  : 'border-theme-surface-border hover:border-theme-text-muted'
              }`}
            >
              <Award className={`h-8 w-8 ${!isPractice ? 'text-red-600' : 'text-theme-text-muted'}`} />
              <span
                className={`text-sm font-bold ${!isPractice ? 'text-red-700 dark:text-red-300' : 'text-theme-text-primary'}`}
              >
                Official Evaluation
              </span>
              <span className="text-theme-text-muted text-center text-xs leading-tight">
                {isOfficer
                  ? 'Results are recorded and count toward certifications'
                  : 'Recorded, then sent to a training officer to validate'}
              </span>
              {!isPractice && <div className="absolute top-2 right-2 h-3 w-3 rounded-full bg-red-600" />}
            </button>
            <button
              onClick={() => {
                modeChosen.current = true;
                setIsPractice(true);
              }}
              className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                isPractice
                  ? 'border-blue-600 bg-blue-50 shadow-md dark:bg-blue-900/20'
                  : 'border-theme-surface-border hover:border-theme-text-muted'
              }`}
            >
              <BookOpen className={`h-8 w-8 ${isPractice ? 'text-blue-600' : 'text-theme-text-muted'}`} />
              <span
                className={`text-sm font-bold ${isPractice ? 'text-blue-700 dark:text-blue-300' : 'text-theme-text-primary'}`}
              >
                Practice Run
              </span>
              <span className="text-theme-text-muted text-center text-xs leading-tight">
                Not recorded — review results or discard when done
              </span>
              {isPractice && <div className="absolute top-2 right-2 h-3 w-3 rounded-full bg-blue-600" />}
            </button>
          </div>

          {!isOfficer && !isPractice && (
            <div className="alert-info mt-3 flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="text-sm">
                You can run this evaluation, but it doesn&apos;t count until a training officer reviews and validates
                it. Until then it won&apos;t credit a program requirement or use up one of the candidate&apos;s
                attempts.
              </p>
            </div>
          )}
        </div>

        {/* Step 3: Select Candidate (search-only) */}
        <div className="bg-theme-surface border-theme-surface-border mb-4 rounded-lg border p-4 sm:p-6">
          <h2 className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold">
            <User className="h-5 w-5 text-red-600" />
            3. Select Candidates
          </h2>

          {candidates.length > 0 && (
            <div className="mb-3 space-y-2">
              {candidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-100 p-3 dark:bg-green-900/30"
                >
                  <p className="font-medium text-green-800 dark:text-green-200">
                    {candidate.name}
                    {candidate.id === user?.id && <span className="ml-2 text-sm font-normal">(you)</span>}
                  </p>
                  <button
                    onClick={() => setCandidates((current) => current.filter((c) => c.id !== candidate.id))}
                    aria-label={`Remove ${candidate.name}`}
                    className="text-sm text-green-700 underline dark:text-green-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {isBatch && (
                <p className="text-theme-text-muted text-xs">
                  {candidates.length} tests will be created against this sheet. You start with {candidates[0]?.name};
                  the rest wait in the records list until you get to them.
                </p>
              )}
            </div>
          )}

          {/* The search stays open after a pick, so adding the next person is
              one more tap rather than a trip back through this page. */}
          {
            <>
              <div className="relative mb-3">
                <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  type="text"
                  placeholder="Type a name to search..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring/50 w-full rounded-lg border py-3 pr-4 pl-10 focus:ring-2 focus:outline-hidden"
                />
              </div>
              {membersLoading ? (
                <div className="flex justify-center py-4" role="status" aria-live="polite">
                  <div className="h-6 w-6 animate-spin rounded-full border-t-2 border-b-2 border-red-500" />
                </div>
              ) : searchTooShort ? (
                <p className="text-theme-text-muted py-4 text-center text-sm">
                  Type at least {MEMBER_SEARCH_MIN_CHARS} characters of a name to search
                </p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {filteredMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setCandidates((current) => (current.some((c) => c.id === m.id) ? current : [...current, m]));
                        setMemberSearch('');
                      }}
                      className="border-theme-surface-border w-full rounded-lg border p-3 text-left transition-colors hover:border-red-500/50"
                    >
                      <p className="text-theme-text-primary font-medium">
                        {m.name}
                        {m.id === user?.id && <span className="text-theme-text-muted ml-2 text-xs">(you)</span>}
                      </p>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && (
                    <p className="text-theme-text-muted py-4 text-center text-sm">No members found</p>
                  )}
                  {filteredMembers.length === MEMBER_SEARCH_MAX_RESULTS && (
                    <p className="text-theme-text-muted py-1 text-center text-xs">
                      Showing the first {MEMBER_SEARCH_MAX_RESULTS} matches — type more of the name
                    </p>
                  )}
                </div>
              )}
            </>
          }

          {selfOfficialBlocked && (
            <div className="alert-warning mt-3 flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="text-sm">
                You can&apos;t examine yourself on an official evaluation — someone else has to hold the clipboard.
                Switch to Practice Run, or pick a different candidate.
              </p>
            </div>
          )}
        </div>

        {/* Step 4: Pipeline requirement — official tests, officers only. Which
            requirement a result credits is the officer's call, and they make it
            when they validate; showing the picker to a member invites them to
            re-point a test whose credit they cannot grant anyway. */}
        {showRequirementStep && (
          <div className="bg-theme-surface border-theme-surface-border mb-4 rounded-lg border p-4 sm:p-6">
            <h2 className="text-theme-text-primary mb-3 text-lg font-semibold">
              4. Counts Toward Requirement (optional)
            </h2>
            {(() => {
              const defaultReq = requirements.find((r) => r.id === selectedTemplate?.requirement_id);
              return (
                <>
                  <p className="text-theme-text-muted mb-2 text-sm">
                    {defaultReq
                      ? `Passing this test completes "${defaultReq.name}" for the candidate (from the template). Override below if needed.`
                      : 'This template has no linked requirement. Optionally point this test at one.'}
                  </p>
                  <select
                    value={overrideRequirementId}
                    onChange={(e) => setOverrideRequirementId(e.target.value)}
                    className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full rounded-lg border px-3 py-3 focus:ring-2 focus:outline-hidden"
                  >
                    <option value="">{defaultReq ? `Use template default (${defaultReq.name})` : 'Not linked'}</option>
                    {requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </>
              );
            })()}
          </div>
        )}

        {/* Notes (optional) — numbered off the requirement step, which is hidden
            for practice runs and for members. */}
        <div className="bg-theme-surface border-theme-surface-border mb-6 rounded-lg border p-4 sm:p-6">
          <h2 className="text-theme-text-primary mb-3 text-lg font-semibold">
            {showRequirementStep ? '5' : '4'}. Notes (optional)
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any notes for this test session..."
            className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder:text-theme-text-muted focus:ring-theme-focus-ring/50 w-full resize-none rounded-lg border px-3 py-3 focus:ring-2 focus:outline-hidden"
          />
        </div>

        {/* Start Button */}
        <button
          onClick={() => void handleStart()}
          disabled={!selectedTemplateId || candidates.length === 0 || selfOfficialBlocked || isStarting}
          className={`flex w-full items-center justify-center gap-3 rounded-xl py-4 text-lg font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isPractice ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          <Play className="h-6 w-6" />
          {isStarting
            ? 'Starting...'
            : isBatch
              ? `Start ${candidates.length} Evaluations`
              : isPractice
                ? 'Begin Practice'
                : 'Begin Evaluation'}
        </button>
      </main>
    </div>
  );
};

export default StartSkillTestPage;
