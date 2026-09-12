# Recent changes: September 6 – 12, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-09-06_TO_09-12.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-09-06_TO_09-12.md).
Predecessor: [August 31 – September 6](Recent-Changes-2026-08-31-to-09-06).

**The headline:** **nothing moved address and no bookmark breaks** — the
opposite of last window, which retired fourteen. This window is additive.
**First-run setup was rebuilt**: it now tells you what it will ask for before
it starts asking, it asks in an order a department can actually answer, and it
collects three things you previously could only set after setup was over — your
**rank ladder**, your **membership tier ladder**, and **how you number
members**. Five scattered member settings were collected into a new **Members
Administration → Settings** screen. The **inventory items list** can now be
pinned and grouped by a quartermaster. And three changes alter what an existing
department may do or see without anyone asking: the **Treasurer gains approval
permissions**, **property-return reports stop being readable by the whole
department**, and **everyone's menu may move to the left side** on the first
load after upgrading.

## Read this first

**If you administer a department:**

- **⚠️ Your navigation layout resets to the left sidebar.** Setup has always
  asked whether you want the menu across the top or down the side, but the
  answer only ever reached _the browser that gave it_ — it was saved in local
  storage, and the copy sent to the server was read by nothing. So the officer
  who ran setup saw their choice and every other member saw the default. The
  answer is now stored on the department and applies to everyone, which is the
  fix — but an existing installation has no stored value, so **everyone gets
  the left sidebar on their next page load**, including the officer whose
  browser held the top bar. There was nothing to migrate, because the old
  value was never reachable from the server.
  **If you want the top bar, set it once at Settings → Organization → Profile →
  Navigation Layout.** It applies to every member from their next page load.
  Departments already on the default need do nothing.

- **Your Treasurer can now approve purchase requests.** Two permissions —
  `finance.approve` and `finance.configure_approvals` — were defined and gated
  real endpoints, but **no seeded position held either**. Only the IT
  administrator could reach them, through a wildcard. What that cost you: build
  an approval chain without also granting approve, and every submitted request
  lands in _Pending Approval_ with nobody able to action it. The upgrade grants
  both to the Treasurer.
  **It is a careful grant, not a blanket one.** It applies only where the
  Treasurer position holds exactly `finance.view` + `finance.manage` — the
  combination the system seeds. If you have deliberately curated that position,
  it is left alone. **If you deliberately gave your Treasurer view and manage
  and nothing else, meaning "no approval powers", check that position after
  upgrading** — nothing in the stored row distinguishes that decision from the
  untouched default.
  This does **not** let a treasurer approve their own spending. Self-approval
  is refused whoever holds the permission.

- **Property-return reports were readable by your whole department.** When a
  member leaves and a property-return report is generated, it was filed into
  the **Reports** folder, which everyone with document access can read — while
  naming the departed member, quoting the reason for the separation
  (**including involuntary ones**) and printing their home address so the
  letter could be posted. They now file into a **leadership-only
  member-separations folder**, and the upgrade moves the reports already
  written. No action needed; this is listed so you know what was exposed and
  for how long.

- **If you publish a public event-request form, nothing changes — and that is
  the point.** There is a setting called "accept public event requests". It
  worked on the API path and was **never read by the Forms path** — the one
  your own "Generate Event Request Form" button produces. Now both paths read
  it. Left alone, that would have silently switched off community requests at
  every department with a published form, with the toggle already showing off
  and no error anywhere. So the upgrade sets the flag on for every department
  whose published form was actually feeding the pipeline. Departments without
  such a form keep the default of off.

**If you are a member or an officer:** the menu may move to the left side
(above). Otherwise nothing you use moved, and nothing you had bookmarked
broke.

## First-run setup was rebuilt

This only affects **new installations** — an existing department has already
been through it. It matters here because it is what a trainer demonstrates and
what the installation video walks through.

### It now says what it will ask for, before it asks

A new **Setup Prerequisites** screen (`/onboarding/prepare`) opens the flow. It
collects nothing and saves nothing. It exists because the health screen told an
operator the database was up, and then nothing told them the wizard was going
to want SMTP credentials, an OAuth client secret and a storage key — so they
started, met a step they could not answer, and left to go and find it. **Walking
away is what used to end the install.**

Its two lists — what is required, what is optional — are derived from the step
list itself, so they cannot drift out of agreement with the wizard.

### The order changed, and only two steps are required

| #   | Step                  | Required?    |
| --- | --------------------- | ------------ |
| 1   | Organization Setup    | **Required** |
| 2   | Administrator Account | **Required** |
| 3   | Modules               | Optional     |
| 4   | Ranks & Positions     | Optional     |
| 5   | Stations              | Optional     |
| 6   | Apparatus             | Optional     |
| 7   | IT & Backup Contacts  | Optional     |
| 8   | Email                 | Optional     |
| 9   | File Storage          | Optional     |
| 10  | Sign-In Method        | Optional     |
| 11  | Navigation Layout     | Optional     |

The principle: **identity comes second**, so everything after it belongs to a
real account; **what the department uses** (modules, ranks, stations,
apparatus) comes before the **external integrations** (email, storage,
sign-in), which are the steps that send someone off to hunt for credentials —
and every one of those is skippable.

Two buttons that named a step they no longer went to have been corrected, and
an in-progress setup now stays resumable **after its session lapses**, which
previously meant starting over.

### Three things you can now answer during setup

- **How you number members**, in step 1. This has to come first: the counter
  only numbers members created _after_ it is switched on, and the wizard
  creates your administrator account in step 2 and your IT team in step 7. A
  department that set this on a members screen afterwards ended up with its
  first few accounts holding no number and the roster import starting at the
  number those accounts should have had — an off-by-a-few nobody notices until
  a badge is printed.
- **Your rank ladder**, in step 4. A rank can now confer a seat your department
  invented, rather than only the seats that ship.
- **Your membership tier ladder.** It has a screen in setup _and_ in Settings,
  and they are the same editor.

Also in step 4: the permission checkboxes now **show rows only for the modules
you enabled** in step 3, they grant permissions that actually exist, unticking
a seeded position removes it, and pressing Continue without editing anything no
longer deletes most of the roster.

## New: Members Administration → Settings

Five settings that lived in different places are now one screen at
**Members → Administration → Settings**, each section its own address so an
officer can be linked straight to it.

| Section                | What it sets                            | Who can change it                         |
| ---------------------- | --------------------------------------- | ----------------------------------------- |
| **Contact Visibility** | What members see of each other          | A settings grant — _not_ `members.manage` |
| **Membership IDs**     | Numbering and prefixes                  | A settings grant                          |
| **Operational Ranks**  | The ladder, and who may fill which seat | `members.manage` or a settings grant      |
| **Membership Tiers**   | The ladder, and what each tier confers  | `members.manage`                          |
| **EVOC Levels**        | Driver certification ladder             | `apparatus.manage`                        |

**The grants differ per section on purpose.** Reaching the hub takes
`members.manage`, but Contact Visibility and Membership IDs save through
endpoints that do not accept it — gating them on the hub's grant would put a
members officer on a page where every toggle fails. Operational Ranks _does_
now accept `members.manage`, because the ladder moved here and its gate moved
with it. **EVOC deliberately does not**: it belongs to the apparatus API, and
widening that was a separate decision from moving the page.

Contact Visibility and Membership IDs moved here on 2026-09-06 and **their old
addresses redirect**, so existing links still arrive.

## Inventory: shape the items list

For a quartermaster, a handful of items — the Class B polos, the duty boots —
carry nearly all the traffic while sitting scattered through an alphabetical
list.

- **Pin** an item and it moves to a **Pinned** section at the top. Pins are
  **yours**, not the department's: two quartermasters running different supply
  lines front different gear, and curating your list never reorders anybody
  else's page. Reorder pinned rows by dragging, or with the up/down arrows on a
  phone where dragging does not work. **Up to 25 items.**
- **Group by** — beside the filters — reorganises the list by Category, Item
  Type, colour, or any other attribute. Whatever you group by **drops out of
  the rows**, since repeating it on every row inside its own group is noise;
  the **Size** column is shown instead.
- **A product's size variants fold into one expandable row**, so a coat in six
  sizes is one line until you open it.

Two related corrections underneath: a garment can now record **every style
attribute it has** rather than one. Sleeve, fit, neckline and closure are four
independent descriptors, and a men's long-sleeve polo could not be recorded at
all — variant generation resolved the conflict by creating three separate
items. And a member's **fit preference is now read**: it previously saved, and
changed nothing about what they were offered.

## Scheduling

- **A close-out queue** at Administration → Scheduling → Close-out: the shifts
  that have ended and were never closed out, oldest first.
- **The Calls log on the shift panel is now hidden unless your department
  records calls in a mode that has one.** Three call-entry paths that were
  ungated are gated the same way. A department not tracking calls was being
  offered a log it could not meaningfully fill.

## Membership pipeline

- **A coordinator can place an applicant directly on a stage**, rather than
  only advancing them one at a time.
- **Applicants with no stage no longer disappear** from the board, and
  applicants belonging to other pipelines no longer appear in _Unassigned_.
- **Switching a pipeline drops the old pipeline's applicants** rather than
  carrying them across into stages that do not correspond.
- Underneath: two stages could share a position in the order, which made both
  the column order **and where "advance" sent an applicant** depend on how the
  sort happened to break the tie — differently from one page load to the next.
  Stage positions are now unique and the upgrade renumbers existing ones.

## Smaller fixes worth knowing

- A facility emergency contact can be saved with **a contact name and no
  company** — the form always allowed it and the database always rejected it.
- A membership pipeline stage that advances **on a meeting now requires real
  attendance**.
- The **token-refresh lookup is indexed**, which is the busiest query the
  session table takes.
- **Equipment-check drafts survive leaving the page**, and a failed draft
  recovery no longer puts a toast over the next page you open.
- **Only an inspection may move an item's inspection clock.**
- The items-list **export now matches the list you are actually looking at**,
  filters and grouping included.
- Storefront order placement is **serialized per organization**, closing a race
  where two orders placed together could both pass the same stock check.

## Security and accessibility

Ninety security-review commits across thirty-four feature areas; the rotation
reached **Feature 23 (Medical supplies)**. Mobile accessibility gained two
automated passes — `mobile-accessibility.spec.ts` and `mobile-dialogs.spec.ts`
— which hold AA contrast at **zero findings** across the checked routes and
ratchet the AAA-only findings per route so they cannot grow.

## Not yet available — do not teach these

Carried forward unchanged from the last two windows:

- The crew **Sweep** for equipment checks — built, visible only in the template
  builder's preview.
- The equipment-check **lap** — built, not wired.
- **Qualification entry** — still only through a course's _Certifies_ field,
  never entered directly.
