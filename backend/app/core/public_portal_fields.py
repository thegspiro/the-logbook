"""The catalogue of fields the public portal can expose, and which carry PII.

``public_portal_data_whitelist`` stores one row per (category, field) an
administrator has decided about, and ``filter_data_by_whitelist`` keeps only
the enabled ones out of the dictionaries ``app/api/public/portal.py`` builds.
Nothing else described those fields, and three consequences followed from that:

* **The table was empty on every deployment.** Rows appeared only when somebody
  POSTed one by hand, so the Data Exposure Control screen listed nothing and
  the control it offers could not be exercised at all.
* **The screen's PII badge could never render.** It reads ``is_sensitive``,
  which no column held and no response carried, so every field looked
  equally safe to publish — including the ones that carry a person's contact
  details.
* **Nothing said what a field means.** The screen shows a description under
  each field name and searches on it; there was none to show.

So the catalogue lives here, in code, rather than as columns on that table.
Whether ``organization.email`` is personally identifying is a property of the
field, not of one department's configuration: it must not be per-org editable
(an administrator silencing the badge is exactly the outcome the badge exists
to prevent), and a field added by a future release has to arrive already
classified rather than waiting for a data migration to catch up.

**The sensitivity rule, which is the reviewable decision here:** a field is
marked sensitive when its value routinely belongs to a *person* rather than to
the organization. A volunteer department frequently has no premises and no
staffed office, so its published phone number is an officer's mobile, its
address is somebody's house, and its contact inbox is a personal one. The
aggregate statistics and the public-education event listings are institutional
by construction and are not marked.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PublicPortalField:
    """One field an administrator can expose through the public API."""

    category: str
    name: str
    description: str
    is_sensitive: bool


PUBLIC_PORTAL_FIELDS: tuple[PublicPortalField, ...] = (
    # ---- organization: GET /public/organization/info ----
    PublicPortalField(
        "organization",
        "name",
        "The department's name.",
        False,
    ),
    PublicPortalField(
        "organization",
        "organization_type",
        "The kind of organization, such as fire department or EMS agency.",
        False,
    ),
    PublicPortalField(
        "organization",
        "logo",
        "URL of the department's logo image.",
        False,
    ),
    PublicPortalField(
        "organization",
        "description",
        "The department's public description.",
        False,
    ),
    PublicPortalField(
        "organization",
        "phone",
        "Published contact number. Often an officer's personal mobile.",
        True,
    ),
    PublicPortalField(
        "organization",
        "email",
        "Published contact address. Often an individual's inbox.",
        True,
    ),
    PublicPortalField(
        "organization",
        "website",
        "The department's public website.",
        False,
    ),
    PublicPortalField(
        "organization",
        "mailing_address",
        "Full mailing address. Often a member's home for a department "
        "without premises.",
        True,
    ),
    PublicPortalField(
        "organization",
        "physical_address",
        "Full street address of the department's premises.",
        True,
    ),
    # ---- stats: GET /public/organization/stats ----
    PublicPortalField(
        "stats",
        "total_volunteer_hours",
        "Total volunteer hours recorded.",
        False,
    ),
    PublicPortalField(
        "stats",
        "total_calls_ytd",
        "Calls answered so far this year.",
        False,
    ),
    PublicPortalField(
        "stats",
        "total_members",
        "Number of active members. A count only; no member is named.",
        False,
    ),
    PublicPortalField(
        "stats",
        "stations",
        "Number of stations.",
        False,
    ),
    PublicPortalField(
        "stats",
        "apparatus",
        "Number of apparatus in the fleet.",
        False,
    ),
    PublicPortalField(
        "stats",
        "founded_year",
        "The year the department was founded.",
        False,
    ),
    # ---- events: GET /public/events/public ----
    PublicPortalField(
        "events",
        "title",
        "Event title.",
        False,
    ),
    PublicPortalField(
        "events",
        "description",
        "Event description.",
        False,
    ),
    PublicPortalField(
        "events",
        "start_datetime",
        "When the event starts.",
        False,
    ),
    PublicPortalField(
        "events",
        "end_datetime",
        "When the event ends.",
        False,
    ),
    PublicPortalField(
        "events",
        "location",
        "Where the event is held. Only public-education events are listed.",
        False,
    ),
    PublicPortalField(
        "events",
        "event_type",
        "The event's type.",
        False,
    ),
)


_BY_KEY: dict[tuple[str, str], PublicPortalField] = {
    (field.category, field.name): field for field in PUBLIC_PORTAL_FIELDS
}


def catalogue_entry(category: str, field_name: str) -> PublicPortalField | None:
    """The catalogue entry for a stored row, or None if it has none.

    A row can name a field the catalogue does not: the admin API accepts an
    arbitrary category and field name, and a release that stops publishing a
    field leaves its rows behind. Such a row is inert — ``portal.py`` never
    puts that key in a dictionary, so enabling it exposes nothing — and the
    caller describes it as such rather than guessing at a classification.
    """
    return _BY_KEY.get((category, field_name))
