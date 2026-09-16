# Recent changes: September 12 – 15, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09-12_TO_09-15.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09-12_TO_09-15.md).
Predecessor: [September 6 – 12](Recent-Changes-2026-09-06-to-09-12).

**The headline:** **nothing moved address, and nothing new was added to move
to.** No screen was created and none retired, so there is no bookmark to
repair and nothing new to learn the way to.

This is a **correction window**. Twelve of its seventeen changes enforce a rule
that was written down somewhere and enforced nowhere, or enforced on one path
out of two. Four of them change what somebody sees without anyone asking: the
**Open Shifts board lists only shifts with a seat the member can take**, **a
click outside a dialog stops discarding the form in it**, **only an inspection
moves an item's inspection clock**, and an **email configuration that cannot
send is refused when you save it**.

## Read this first

**If you administer a department:**

- **⚠️ Check your gear's inspection dates.** Marking _any_ maintenance record
  complete used to write the item's last inspection date and recalculate the
  next one due. A coat inspected in April and repaired in August had its annual
  NFPA 1851 inspection silently rescheduled from the following April to the
  following August, and the department read as compliant four months longer
  than it was. Only an inspection moves that clock now — **but the fix does not
  go backward.** Gear whose date already slid keeps it, because the application
  cannot tell a date that slid from one a quartermaster entered deliberately.
  If you track gear on an inspection interval and have been completing repairs
  against it, check those dates against your paper records.
  _(The September 6–12 window stated this rule for records created as complete.
  This window covers the commoner path — work scheduled first and marked
  complete later — which is where a quartermaster actually works.)_

- **Check your email configuration if mail has been unreliable.** Settings →
  Email would save an **enabled** section green that had no chance of sending:
  **Cloudflare** with no account ID or token, or **Other**, which stores nothing
  at all. Both are refused on save now. **The reason this matters more than a
  validation message:** an enabled section short-circuits the deployment's own
  SMTP settings, so a half-filled section did not merely fail on its own — it
  stopped whatever server-level mail configuration the installation had from
  being used. A department that had been sending perfectly well, then started
  filling in an email section and stopped, has been in this state. **Either
  complete the section or turn it off**; a disabled section hands sending back
  to the deployment's own configuration.

- **Check your meeting stages.** A membership-pipeline meeting stage with
  **auto-advance** ticked and **Auto-Link Event Type** set to _None_ used to
  accept attendance at any event in the department. Guest check-in is
  department-wide and departments enable it on open houses and fundraisers, so
  a stage reading "Meeting with the Fire Chief" advanced an applicant who signed
  in at a pancake breakfast. Such a stage now advances on nothing until you name
  the event type, and the stage builder refuses to save the combination. Cal.com
  stages are unaffected.

**If you run scheduling:**

- **Tell your members the Open Shifts board will be shorter.** This is the
  change most likely to be reported as something being broken. See below.

## Members: the Open Shifts board

A member picking their position off the board could be refused with **"Position
was filled after this request was submitted"** — a message about somebody
beating them to it, for a seat that had been taken for days.

Two questions were being asked and never compared: "does this shift still need
somebody?" and "is this member cleared for a seat that is actually free?" A
shift with an empty driver's seat and a full firefighter seat answered yes to
both for a firefighter, whose signup was then declined.

**A member's board now lists a shift only when one of its unclaimed seats is a
position they are cleared for.** Someone who used to see eight open shifts may
now see three — and the five that went are the five the system would have
refused. The position picker offers only seats the server will grant, and
**"every seat you are cleared for on this shift has been filled"** is now
distinguished from **"you are not eligible"**; the first means come back later,
the second means talk to an officer, and both used to read as the second.

**Officers holding `scheduling.manage` see no change** — that tab is also how a
scheduling admin finds staffing gaps, so it keeps the department-wide view. If
an officer and a member compare boards and see different lists, that is why.

## Everyone: dialogs stopped closing when you click beside them

Clicking in the margin around an open dialog used to close it, and where the
dialog held a form, that discarded the form — no draft, no confirmation, no
undo. The reported case was adding a uniform to Inventory: a name, category,
room, storage area and a set of sizes and garment style axes, all chosen before
anything is saved, thrown away by one click in the gutter.

**Escape and the X in the dialog's header still close everything.** Five
surfaces deliberately keep click-away because none holds anything you could
lose — the command palette, the two equipment-check jump sheets, the checklist
picker and the "before publishing" sheet. Menus and dropdowns are unaffected.

**Nothing looks different in a screenshot**, which is worth saying to whoever
runs training: it shows up the first time somebody demonstrates closing a
dialog on video.

## Membership pipeline: four stages that now enforce what they describe

- **A membership vote is binding on both buttons.** The applicant's election
  package has always recorded the vote, and nothing read it when moving an
  applicant — so an applicant the department had voted _down_ advanced on a
  click, next to a panel saying they were not elected. **Advance** was gated on
  September 13 and **Convert** — the button shown on the last stage, and the way
  a coordinator is told to finish a pipeline — on September 14, because the two
  go through different code. A department that holds its vote at a meeting and
  records the result by hand is unaffected: a stage with no package, or one
  still _Draft_ or _Ready_, advances as before.
- **A meeting stage that names no event advances on nothing** — see **Read this
  first** above.
- **A form submission moves only the applicant it belongs to, and only off the
  stage they are on.** It used to find the stage by matching the _form_ and
  complete it wherever the applicant had got to, which pulled people backward —
  from the membership vote back to the welcome email.
- **"Auto-advance when form is submitted" now decides something.** The box was
  inert in both directions. Un-tick it and the applicant stays put with their
  answers recorded for you to review; a stage where nobody touched the box keeps
  advancing exactly as it does today.
- **Election Vote and Manual Approval can be created from the stage picker.**
  Neither could be unless you used a quick-add preset: both demanded a list of
  roles that has no input anywhere in the modal, and Manual Approval — the
  modal's default — failed in silence because its error was never rendered.

## Email: twelve SMTP presets

Yahoo, iCloud, Zoho, Fastmail, AOL, GMX, SendGrid, Amazon SES, Mailgun,
Postmark, Brevo and Mailjet each fill in the host, port and encryption the
provider documents, plus what its Username and password fields expect — **most
need an app password** generated in the provider's own settings once two-factor
sign-in is on, which is the commonest reason a correct host and port still fails
to authenticate.

This is a labelling fix rather than a new capability: all twelve are ordinary
SMTP, which the platform already sent perfectly well. What departments did not
have was any way to know that. A chief running on Yahoo read "Self-Hosted SMTP
— your own mail server", reasonably concluded it was not supported, and picked
**Other**, which cannot send at all.

Also: departments on **Cloudflare can send ballot email** for the first time,
and a deployment-wide Cloudflare account no longer overrides a department that
has configured its own transport.

## Smaller fixes worth knowing

- **Fourteen screens stopped refusing people holding the `manage` permission.**
  A permission named `manage` does not automatically include `view`. One of
  these reaches a department that changed nothing: president, secretary, vice
  president and membership coordinator all ship with
  `prospective_members.manage` and not `.view`, so they could link an event to
  an applicant and not read the links back — and the drawer said **"no linked
  events"** rather than showing an error, so the links appeared to vanish. Four
  more are worth knowing if you have hand-built an officer position: the
  **time-off and swap queues** are reviewed by whoever holds
  `scheduling.manage`, and a position holding only that could reach neither
  queue nor a request it had been sent a link to.
- **First-run setup can no longer be bricked by concurrent requests.** Two
  setup records could be created at once, after which every status check failed
  and setup had no way forward. The upgrade removes any duplicates.
- **The inventory items list stopped double-requesting** when a "Load More"
  retry failed, and its guards now reset when you change the search, sort or
  status filter rather than carrying over from the previous result set.

## Security and accessibility

Ninety-three security-review commits. **Pass 5 completed its lap** — features
00 through 22 ran here, the rest having run in the previous window — and the
rotation reset; **pass 6 has reached Feature 06 (Elections & ballots)**. One
pass produced a behaviour change worth naming: **MP-30**, which is what carried
the membership vote gate onto the **Convert** button.

## Not yet available — do not teach these

Carried forward unchanged from the last three windows:

- The crew **Sweep** for equipment checks — built, visible only in the template
  builder's preview.
- The equipment-check **lap** — built, not wired.
- **Qualification entry** — still only through a course's _Certifies_ field,
  never entered directly.
