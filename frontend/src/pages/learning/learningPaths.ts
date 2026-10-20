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
  /**
   * A picture of the screen, served from `public/lesson-images/`.
   *
   * Deliberately outside the service worker's precache (it holds css, html and
   * js only), so offline the picture is absent and `how` still teaches the task.
   * Nothing in a step may depend on the image being visible.
   */
  screenshot?: LearningScreenshot;
}

export interface LearningScreenshot {
  /** File name under `public/lesson-images/`. */
  file: string;
  /** Describes what the screen shows, for a member who cannot see it. */
  alt: string;
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
          'If a Needs you card is at the top, deal with it first: a certification that is expiring or expired (Start Renewal), a department message waiting for your Acknowledge, or applicants waiting on your sign-off. The card is absent when nothing needs you.',
          'Read the Next 30 Days list — your shifts, drills, events, and any open shifts you could pick up all appear together there.',
          'Read My Updates for anything addressed to you personally.',
          'The My Training and My Issued Gear panels are summaries and appear only once there is something to show — a training enrollment, or gear issued or on loan to you. The full screens live behind them.',
          'Log Training and Clock In (administrative hours) sit above the list. Take a Shift appears only if you are able to hold a seat on a shift.',
        ],
        success:
          'Nothing is left under Needs you, and you can name your next commitment or confirm you have none this week.',
      },
      {
        id: 'account',
        label: 'Fix your contact details and turn on two-factor',
        path: '/account?tab=account',
        why: 'The department reaches you at whatever is on this screen — a stale number here means a missed callout. Two-factor matters because your account can see other members’ personal information, not just your own.',
        how: [
          'On the Account tab, confirm the Phone and Mobile numbers are ones you actually answer. Urgent text messages, if you switch them on, need a number here.',
          'Open the Security tab and enable two-factor authentication with an authenticator app.',
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
          'Read anything already waiting under My Notifications — it carries the same notices, inside the app.',
          'Open Account → Notifications. Email Notifications is the switch for every email listed under Emails you can turn off; the ones under Always emailed to you arrive whatever you choose.',
          'Leave Email Notifications on unless you are certain: it is the switch that silences reminder emails, and the in-app entry is then the only copy you get.',
          'Press Save Preferences. The email switches do nothing until you do. Urgent Text Messages is the exception — it saves the moment you flip it.',
        ],
        success:
          'Your inbox is clear, your preferences are saved, and you can say which notices reach you by email even with reminders switched off.',
      },
      {
        id: 'directory',
        label: 'Look up who is who',
        path: '/members',
        why: 'You will be told to "check with the training officer" long before you know who that is. The directory is how you put a name and a number to a role.',
        how: [
          'Open the Member Directory and search for someone you have already met.',
          'Open their profile and see what is shown — this is also what other members see of you.',
          'Choose what of yours is shared under Account → Privacy → Profile visibility. Leadership can always see everything, and your date of birth and emergency contacts are never shown to other members.',
          'Find the officer for the area you are joining.',
        ],
        success:
          'You can reach an officer without having to ask someone else for their number, and you know which of your details other members can see.',
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
        why: 'Station basements and rural response areas drop signal. Seven kinds of work wait on your device and send themselves later — equipment checks, shift reports, training submissions, event RSVPs, skills-test evaluations, and NFC put-aways and shelf audits. Everything else needs a live connection, so knowing which is which saves you doing the work twice.',
        how: [
          'Check the App tab for your installed version, and use Check for updates to see whether a newer one is waiting.',
          'Open any form you might need while you still have signal. Once it is open you can fill it in and send it with none; a form you try to open with no signal shows an error instead.',
          'Look for the pill that reads Offline · N pending. On a phone it is in the menu; on a wide screen it is in the top bar.',
          'Back online it reads N pending sync — tap it to send now. Equipment checks and shift reports send from their own pages: open the equipment check, or the Shift Reports tab in Scheduling, with a connection.',
          'Treat a queued action as unfinished until the pill clears.',
        ],
        success: 'You know where to look to tell whether your last action actually reached the server.',
      },
      {
        id: 'push',
        label: 'Turn on the alerts you will actually see',
        path: '/account?tab=notifications',
        why: 'A notice you read three days late is the same as one you never got. Push puts notices on your lock screen as they arrive, on top of the email.',
        how: [
          'On your phone, turn on Push Notifications on This Device and accept the browser prompt. The switch only appears if your browser supports push and your department has set it up.',
          'Under Emails you can turn off, choose which emails you want, then press Save Preferences. Turning one off stops the email; the notice still appears in your bell.',
          'Optionally switch on Urgent Text Messages, which adds a text when an officer marks a department message urgent. It needs a mobile number on the Account tab, and you are emailed either way.',
        ],
        success: 'Push is on for your phone, and you know which emails you can turn off and which always arrive.',
      },
    ],
  },
  {
    id: 'events',
    module: 'events',
    title: 'Events: RSVP and Check In',
    audience: 'Every member',
    duration: '12 minutes',
    outcome:
      'Say whether you are coming, get your attendance on the record when you arrive, and fix it if your check-in never happened.',
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
          'Events waiting on your answer are gathered in the Needs You band at the top of the list. Answer from the event card with Going or Not Going.',
          'A full event offers Join Waitlist instead. You are moved to Going automatically if a seat opens.',
          'For anything more — a guest count, a note, or Maybe where the organizer allows it — open the event and press RSVP Now (Update RSVP once you have answered), choose under Your Response, then Submit RSVP.',
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
          'At the event, find the posted QR code and scan it with your phone camera. Sign in if you are asked to.',
          'On the Event Check-In page, tap Check In to This Event. The confirmation reads You’re Checked In. If you never answered the RSVP, you are recorded as Going.',
          'When you leave, scan the code again and tap Check Out of This Event.',
          'If there is no code, ask whoever is running the event to check you in.',
          'Confirm the event shows you as attended afterwards. On a training event the hours reach your training record when the organizer finalizes attendance, not at the moment you check in.',
        ],
        success: 'The event lists you as checked in, not merely as having RSVPed.',
      },
      {
        id: 'missed-checkin',
        label: 'Ask to be marked present if your check-in never happened',
        path: '/events',
        why: 'A dead phone or a QR code nobody put up should not cost you the credit. Once check-in closes you have 30 days to ask the organizer to vouch for you — and they are notified each time you ask, so get the request right rather than sending it repeatedly.',
        how: [
          'Open the event after its check-in has closed and press I was there.',
          'Say why there is no check-in and, if you can, when you arrived and left, then send it.',
          'Sent it with the wrong times? Press Withdraw request while it is still waiting and send a corrected one. You can do this twice per event; after that the request stays as it is until the organizer answers.',
        ],
        success:
          'The event shows your request as waiting, then as confirmed or declined — and you know a decided request is final.',
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
          'Open My Training. The Required Training tile gives your overall standing, and Upcoming Expirations & Due Dates lists what falls due in the next six months, skills tests included.',
          'Under Training Requirements, pick one and note what it needs — hours, a course, or a specific certification.',
          'Check its deadline. A requirement counted in rolling months has no due date; it shows which months it is counting instead.',
          'Your full record is under Recent Training. A History tab appears too if your department lets members see it.',
        ],
        success: 'You can name one requirement you still owe and what closes it out.',
      },
      {
        id: 'submit',
        label: 'Submit a real or designated practice activity',
        path: '/training/submit',
        why: 'Outside training only counts once it is recorded here. Members routinely lose credit for classes they genuinely attended because nobody entered them.',
        how: [
          'Press Submit Training on My Training (or Log Training on the dashboard) to open Submit External Training.',
          'Fill in The Class, When, and Details — what you did, when, and how long it took.',
          'Attach the certificate or roster sheet if you have one — it is what the reviewer checks.',
          'Not ready? Save Draft keeps it in your list until you submit it. Otherwise press Submit Training, and expect it to sit in Pending Review rather than crediting instantly.',
        ],
        success: 'Your submission appears under Recent Submissions with a Pending Review status.',
      },
      {
        id: 'verify',
        label: 'Verify the credited result, not just the submission',
        path: '/training/submit',
        why: 'A submission is a request. Until an officer approves it, the hours are not yours, and a rejected record needs re-filing rather than waiting.',
        how: [
          'Return to Submit Training and find the record under Recent Submissions, or open Self-Reported Training on My Training if your department shows it there.',
          'Read its status badge: Pending Review, Approved, Rejected, or Needs Edits.',
          'If it says Needs Edits, a notice on the Submit Training page explains what was missing. Fix it there and send it back.',
          'Once approved, the training is added to your record on My Training.',
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
          'Check its status. If it still shows Assigned, use Confirm so the officers know you will be there.',
        ],
        success: 'You know when you are next on, and you have confirmed it.',
      },
      {
        id: 'open-shifts',
        label: 'Find an open shift you are eligible for',
        path: '/scheduling?tab=open-shifts',
        why: 'Open shifts are unfilled seats, and eligibility is real — a seat can require a certification or qualification you do not hold yet. Seeing which ones you can take shows you what is worth training toward.',
        how: [
          'Open the Open Shifts tab and read what each shift still needs.',
          'Tap Sign Up on a shift (the button reads Join on a phone) to see which positions you can fill. If you are not eligible, or every seat you are cleared for is taken, the dialog says so.',
          'Pick a Position, then press Confirm Sign Up. Your own sign-up is saved as confirmed — there is no second Confirm to press.',
          'Or just note a shift to aim for.',
        ],
        success: 'You can tell an open shift you can take from one you are not yet qualified for.',
      },
      {
        id: 'requests',
        label: 'Track a request through to the answer',
        path: '/scheduling?tab=requests',
        why: 'Swaps and time-off are requests, not decisions. The shift stays yours until someone approves the change, and this tab is the only place that says so.',
        how: [
          'Start a request from My Shifts: Request Time Off at the top, or Swap on a shift you cannot work.',
          'Open the Requests tab. Swap Requests and Time Off are separate lists; the list opens on Pending, so an answered request drops out of view until you choose All Statuses, Approved or Denied in the filter.',
          'Confirm that a pending request has not yet released you from the shift.',
          'Swap Requests also shows open swaps from other members. Pick up takes one on, if you are eligible.',
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
          'Open My Issued Gear. The tiles count what is Issued to me, your Temporary loans (with any that are overdue), and your Pending requests.',
          'Read the list below them and check each item is one you actually have.',
          'Tell your quartermaster about anything listed that you never received, or anything you hold that is not listed.',
        ],
        success: 'The list matches what is physically in your locker and on the truck.',
      },
      {
        id: 'sizes',
        label: 'Record your sizes',
        path: '/inventory/my-equipment',
        why: 'Turnout gear and uniforms get ordered in bulk on a schedule. Sizes recorded after the order goes out mean waiting for the next cycle.',
        how: [
          'Open My Sizes, enter your sizes, and press Save Sizes.',
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
          'Tap Request Equipment and ask for what you need.',
          'Say what you need and why in the request itself.',
          'Press My Requests (it reads Hide Requests while open) to see its status, and any return requests, rather than asking again in person.',
        ],
        success: 'Your request is listed with a status you can check without chasing anyone.',
      },
    ],
  },
];

export const findLearningPath = (pathId: string | undefined): LearningPath | undefined =>
  learningPaths.find((path) => path.id === pathId);

export const stepKey = (pathId: string, stepId: string): string => `${pathId}.${stepId}`;
