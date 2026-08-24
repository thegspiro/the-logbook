/**
 * Learning Center content.
 *
 * The step guidance is data here rather than markdown rendered from
 * `docs/training/*.md`, and that is a deliberate constraint, not a shortcut.
 * The frontend image copies only `frontend/` (see `frontend/Dockerfile`), so
 * the guide library is not in the build context at all. The 19 guides also run
 * to ~25,000 lines with 97MB of screenshots, which the service worker would
 * have to precache for the help to survive the one situation where it matters
 * most — a member in a station basement with no signal.
 *
 * So each step carries a short lesson written against the screens as they
 * exist in THIS build, and `guideUrl` points at the full reference for anyone
 * who wants the depth. A member never has to leave the app to learn the task;
 * the manual stays available for the people who want the manual.
 *
 * Every `path` below must resolve against a declared route. `routeIntegrity`
 * cannot see them — it matches `to=` attributes, and these reach a `<Link>` as
 * a variable — so `learningPaths.test.ts` checks them against the router
 * directly. A dead one here would silently drop the member on the dashboard.
 */

const GUIDE_BASE = 'https://github.com/thegspiro/the-logbook/blob/main/docs/training';

export interface LearningStep {
  id: string;
  /** Imperative one-liner. Doubles as the completion checkbox label. */
  label: string;
  /** In-app destination for the step's "Open" button. */
  path: string;
  /** Why a new member should care — the part a reference manual leaves out. */
  why: string;
  /** Concrete moves, naming controls exactly as they appear on screen. */
  how: string[];
  /** What proves the step is done, so marking it complete means something. */
  success: string;
}

export interface LearningPath {
  id: string;
  title: string;
  audience: string;
  duration: string;
  outcome: string;
  steps: LearningStep[];
  /** Full reference guide, deep-linked to the matching section. */
  guideUrl: string;
  /** Enabled-module key. Omitted for paths every department has. */
  module?: string;
}

export const learningPaths: LearningPath[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    audience: 'Every member',
    duration: '15 minutes',
    outcome:
      'Find what you owe the department this week, secure your account, and know who to ask when something is missing.',
    guideUrl: `${GUIDE_BASE}/00-getting-started.md`,
    steps: [
      {
        id: 'dashboard',
        label: 'Read your dashboard top to bottom',
        path: '/dashboard',
        why: 'The dashboard is the one screen that answers "what do I need to do next" without you going looking for it. On a normal day most members need nothing else.',
        how: [
          'Read the Next 7 days list — your shifts, open slots you could pick up, and events all appear together there.',
          'Open My Updates in the right-hand column to see anything addressed to you personally.',
          'Note the training progress and issued gear panels. They are summaries; the full screens live behind them.',
        ],
        success: 'You can name your next commitment, or confirm you have none this week.',
      },
      {
        id: 'account',
        label: 'Fix your contact details and turn on two-factor',
        path: '/account?tab=account',
        why: 'The department reaches you at whatever is on this screen — a stale number here means a missed callout. Two-factor matters because your account can see other members’ personal information, not just your own.',
        how: [
          'On the Account tab, confirm the Phone and Mobile numbers are ones you actually answer.',
          'Open the Security tab and enable two-factor authentication.',
          'Open Emergency Contacts and add at least one person the department can call for you.',
        ],
        success: 'Your phone numbers are correct, two-factor is on, and one emergency contact is saved.',
      },
      {
        id: 'notifications',
        label: 'Learn where department messages land',
        path: '/notifications?tab=inbox',
        why: 'Department announcements are the channel of record: they are emailed to you whether or not you switch email off, because you cannot opt out of being told. Reminders are different — event, training, and certification reminders follow your Email Notifications preference, so turning it off really does stop them.',
        how: [
          'Read anything already waiting in your Inbox — it carries the same notices, inside the app.',
          'Open Account → Notifications and set how you want to be reached.',
          'Leave Email Notifications on unless you are certain: it is the switch that silences reminder emails, and the in-app entry is then the only copy you get.',
        ],
        success:
          'Your inbox is clear, and you can say which notices reach you by email even with reminders switched off.',
      },
      {
        id: 'directory',
        label: 'Look up who is who',
        path: '/members',
        why: 'You will be told to "check with the training officer" long before you know who that is. The directory is how you put a name and a number to a role.',
        how: [
          'Search the directory for someone you have already met.',
          'Open their profile and see what is shown — this is also what other members see of you.',
          'Find the officer for the area you are joining.',
        ],
        success: 'You can reach an officer without having to ask someone else for their number.',
      },
    ],
  },
  {
    id: 'mobile',
    title: 'Put The Logbook on Your Phone',
    audience: 'Every member',
    duration: '10 minutes',
    outcome: 'Install the app, know what still works without signal, and get alerts on the device you actually carry.',
    guideUrl: `${GUIDE_BASE}/10-mobile-pwa.md`,
    steps: [
      {
        id: 'install',
        label: 'Install the app on your phone',
        path: '/dashboard',
        why: 'Almost everything you do here — checking a shift, RSVPing, scanning in — happens in the bay or on the apparatus floor, not at a desk. Installed, it opens like any other app instead of a browser tab you have to find again.',
        how: [
          'On the dashboard, look for the "Install The Logbook" banner and tap Install.',
          'On an iPhone there is no install prompt: tap Share in Safari, then choose "Add to Home Screen".',
          'Open it from your home screen and sign in once.',
        ],
        success: 'The Logbook icon is on your home screen and you are signed in from it.',
      },
      {
        id: 'offline',
        label: 'Find out what works with no signal',
        path: '/account?tab=app',
        why: 'Station basements and rural response areas drop signal. Some actions queue and sync later, others need a live connection — knowing which is which saves you doing the work twice.',
        how: [
          'Check the App tab for your installed version and update status.',
          'Watch the top bar for the offline / pending-sync pill. It counts training submissions and RSVPs still waiting to send.',
          'Treat a queued action as unfinished until that pill clears.',
        ],
        success: 'You know where to look to tell whether your last action actually reached the server.',
      },
      {
        id: 'push',
        label: 'Turn on the alerts you will actually see',
        path: '/account?tab=notifications',
        why: 'A notice you read three days late is the same as one you never got. Push puts the urgent ones on your lock screen while leaving the routine ones in email where they belong.',
        how: [
          'Enable push notifications and accept the browser prompt when it appears.',
          'Review which categories you want; turning one off mutes the alert, not the email.',
          'Send yourself a test if your department has enabled one.',
        ],
        success: 'A push notification reaches your phone, and you know which notices stay email-only.',
      },
    ],
  },
  {
    id: 'events',
    module: 'events',
    title: 'Events: RSVP and Check In',
    audience: 'Every member',
    duration: '10 minutes',
    outcome: 'Say whether you are coming, and get your attendance on the record when you arrive.',
    guideUrl: `${GUIDE_BASE}/04-events-meetings.md#viewing-and-rsvping-to-events`,
    steps: [
      {
        id: 'browse',
        label: 'Find the next event you are expected at',
        path: '/events',
        why: 'Drills, meetings, and public events all live here. Some carry attendance requirements you are graded on, and the event itself is where that is stated.',
        how: [
          'Open the events list and find the next one in your calendar.',
          'Open it and read the description, time, and location.',
          'Check whether attendance is required or optional.',
        ],
        success: 'You know the date, time, place, and whether your attendance is expected.',
      },
      {
        id: 'rsvp',
        label: 'RSVP so the officers can plan',
        path: '/events',
        why: 'An RSVP is not a formality — it drives head counts, food, apparatus, and instructor ratios. A late "no" costs the department more than an early one.',
        how: [
          'On the event, choose your RSVP response.',
          'Change it if your plans change; the officers see the current answer, not the first one.',
        ],
        success: 'Your response shows on the event and you know you can change it later.',
      },
      {
        id: 'checkin',
        label: 'Check in when you get there',
        path: '/events',
        why: 'RSVP says you meant to come; check-in proves you did. Attendance credit and any requirement tied to the event come from the check-in, not the RSVP.',
        how: [
          'At the event, find the posted QR code and scan it with your phone.',
          'If there is no code, ask whoever is running the event to check you in.',
          'Confirm the event shows you as attended afterwards.',
        ],
        success: 'The event lists you as checked in, not merely as having RSVPed.',
      },
    ],
  },
  {
    id: 'training',
    module: 'training',
    title: 'Training: Submission to Credit',
    audience: 'Members and training officers',
    duration: '15–30 minutes',
    outcome: 'Submit a record, follow it through review, and confirm the credit actually landed.',
    guideUrl: `${GUIDE_BASE}/02-training.md#my-training-dashboard`,
    steps: [
      {
        id: 'history',
        label: 'Review My Training and one active requirement',
        path: '/training/my-training',
        why: 'This screen is what your officers see when they ask whether you are current. Reading it now tells you what you are short on while there is still time to fix it.',
        how: [
          'Open My Training and read your current requirements.',
          'Pick one and note what it needs — hours, a course, or a specific certification.',
          'Check its deadline.',
        ],
        success: 'You can name one requirement you still owe and what closes it out.',
      },
      {
        id: 'submit',
        label: 'Submit a real or designated practice activity',
        path: '/training/submit',
        why: 'Outside training only counts once it is recorded here. Members routinely lose credit for classes they genuinely attended because nobody entered them.',
        how: [
          'Fill in what you did, when, and how long it took.',
          'Attach the certificate or roster sheet if you have one — it is what the reviewer checks.',
          'Submit, and expect it to sit in Pending Review rather than crediting instantly.',
        ],
        success: 'Your submission appears with a Pending Review status.',
      },
      {
        id: 'verify',
        label: 'Verify the credited result, not just the submission',
        path: '/training/my-training',
        why: 'A submission is a request. Until an officer approves it, the hours are not yours, and a rejected record needs re-filing rather than waiting.',
        how: [
          'Return to My Training and find the record you submitted.',
          'Confirm whether it is still pending, approved, or returned to you.',
          'If it was returned, read the reason and resubmit with what was missing.',
        ],
        success: 'You can tell the difference between a submitted record and a credited one.',
      },
    ],
  },
  {
    id: 'scheduling',
    module: 'scheduling',
    title: 'Scheduling: Cover a Vacancy',
    audience: 'Members and scheduling officers',
    duration: '15–30 minutes',
    outcome: 'Read your assignments, pick up an open shift, and confirm the coverage actually stuck.',
    guideUrl: `${GUIDE_BASE}/03-scheduling.md#my-shifts`,
    steps: [
      {
        id: 'my-shifts',
        label: 'Check your next assignment and its status',
        path: '/scheduling?tab=my-shifts',
        why: 'A shift on the board is a commitment the department is counting on. Knowing where to read it is how you avoid being the no-show.',
        how: [
          'Open the My Shifts tab and find your next assignment.',
          'Note the date, times, station, and seat you are filling.',
          'Check whether it is confirmed or still tentative.',
        ],
        success: 'You know when you are next on, and whether it is locked in.',
      },
      {
        id: 'open-shifts',
        label: 'Find an open shift you are eligible for',
        path: '/scheduling?tab=open-shifts',
        why: 'Open shifts are unfilled seats, and eligibility is real — a seat can require a certification or qualification you do not hold yet. Seeing which ones you can take shows you what is worth training toward.',
        how: [
          'Open the Open Shifts tab and read what each shift still needs.',
          'Notice that a shift you cannot claim will say why.',
          'Claim one if it genuinely works for you, or note one to aim for.',
        ],
        success: 'You can tell an open shift you can take from one you are not yet qualified for.',
      },
      {
        id: 'requests',
        label: 'Track a request through to the answer',
        path: '/scheduling?tab=requests',
        why: 'Swaps and time-off are requests, not decisions. The shift stays yours until someone approves the change, and this tab is the only place that says so.',
        how: [
          'Open the Requests tab and read anything outstanding.',
          'Check the status of a swap or time-off request.',
          'Confirm that a pending request has not yet released you from the shift.',
        ],
        success: 'You can tell whether a request has been granted or is still waiting.',
      },
    ],
  },
  {
    id: 'gear',
    module: 'inventory',
    title: 'Your Issued Gear',
    audience: 'Every member',
    duration: '10 minutes',
    outcome: 'Know what the department has signed out to you and how to ask for what you are missing.',
    guideUrl: `${GUIDE_BASE}/05-inventory.md#item-assignments`,
    steps: [
      {
        id: 'issued',
        label: 'Review what is signed out to you',
        path: '/inventory/my-equipment',
        why: 'You are accountable for every item on this list, and it is what gets reconciled if you ever leave. Finding an error now is far easier than explaining it later.',
        how: [
          'Open My Issued Gear and read the list.',
          'Check each item is one you actually have.',
          'Flag anything listed that you never received, or that you hold but do not see.',
        ],
        success: 'The list matches what is physically in your locker and on the truck.',
      },
      {
        id: 'sizes',
        label: 'Record your sizes',
        path: '/inventory/my-equipment',
        why: 'Turnout gear and uniforms get ordered in bulk on a schedule. Sizes recorded after the order goes out mean waiting for the next cycle.',
        how: [
          'Enter your sizes where the screen asks for them.',
          'Be accurate rather than optimistic — gear that does not fit is a safety problem, not a comfort one.',
        ],
        success: 'Your sizes are saved so the next order can include you.',
      },
      {
        id: 'request',
        label: 'Ask for something you are missing',
        path: '/inventory/my-equipment',
        why: 'A verbal ask in the bay gets forgotten. A request here is tracked, and you can see where it got to.',
        how: [
          'Open My Requests and submit a request for anything you need.',
          'Say what you need and why in the request itself.',
          'Check back for the status rather than asking again in person.',
        ],
        success: 'Your request is listed with a status you can check without chasing anyone.',
      },
    ],
  },
];

export const findLearningPath = (pathId: string | undefined): LearningPath | undefined =>
  learningPaths.find((path) => path.id === pathId);

export const stepKey = (pathId: string, stepId: string): string => `${pathId}.${stepId}`;
