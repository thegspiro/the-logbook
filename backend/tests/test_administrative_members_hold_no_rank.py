"""An administrative member holds no operational rank.

A rank is a place in the emergency-response chain of command, and the platform
treats it as one: ``_collect_user_permissions`` unions each rank's default
permissions into the member's effective ones, and ``ShiftEligibilityService``
reads the rank to decide which seats a member may sign up for.  A rank left on
an administrative member therefore grants real permissions and real shift
eligibility to somebody the department has said does not respond — silently,
because nothing in the roster reads as wrong.

The rule is enforced in three places and these assertions cover why it takes
three: the schema refuses the pair when one payload carries both, the endpoint
refuses a rank against a class already on the row, and the flush-time listener
on ``User`` is the backstop under every writer that reaches neither.
"""

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.user import AdminUserCreate, UserUpdate
from app.utils.membership import MemberClass, MemberStatus, may_hold_rank


class TestMayHoldRank:
    def test_an_administrative_member_may_not(self):
        assert may_hold_rank(MemberClass.ADMINISTRATIVE) is False

    @pytest.mark.parametrize(
        "member_class", [MemberClass.OPERATIONAL, MemberClass.SOCIAL]
    )
    def test_every_other_class_may(self, member_class):
        assert may_hold_rank(member_class) is True

    def test_case_and_whitespace_are_tolerated(self):
        # The column is a plain string and the endpoints normalise late, so the
        # predicate has to answer for a value that has not been through a
        # validator yet.
        assert may_hold_rank("  Administrative ") is False

    @pytest.mark.parametrize("unset", [None, "", "   "])
    def test_an_unset_class_may_hold_a_rank(self, unset):
        """The opposite of what ``is_operational`` does with None, on purpose.

        An unset class means ``membership_type`` holds a custom membership tier
        this module does not recognise — not that the member is
        administrative.  ``is_operational`` declines to guess by keeping people
        out of a body; this declines to guess by leaving a rank alone.  Guess
        the other way here and every member on an org-configured tier loses
        their rank the next time their row is written.
        """
        assert may_hold_rank(unset) is True


class TestTheListenerIsTheBackstop:
    """``_reconcile_membership`` runs before every insert and update of User.

    Tested through the ORM event rather than by calling the helper, because
    what is being pinned is that it fires — the rank and the class are written
    from the member create and profile-update endpoints, the tier change, the
    prospect conversion, the seeders and the shell, and a rule enforced only in
    the endpoints leaves the other four able to store the pair.
    """

    def _flush(self, user: User) -> User:
        from app.models.user import _reconcile_membership

        _reconcile_membership(None, None, user)
        return user

    def test_moving_a_member_to_administrative_clears_the_rank(self):
        user = User(rank="captain", membership_type="active")
        self._flush(user)
        assert user.rank == "captain"

        user.member_class = MemberClass.ADMINISTRATIVE
        self._flush(user)

        assert user.rank is None
        assert user.membership_type == "administrative"

    def test_the_legacy_field_reaches_the_rule_too(self):
        """~160 call sites still write ``membership_type`` and nothing else."""
        user = User(rank="captain", membership_type="administrative")
        self._flush(user)

        assert user.rank is None
        assert user.member_class == MemberClass.ADMINISTRATIVE

    def test_an_operational_member_keeps_their_rank(self):
        user = User(rank="captain", membership_type="active")
        self._flush(user)
        assert user.rank == "captain"

    @pytest.mark.parametrize(
        "member_status",
        [MemberStatus.PROBATIONARY, MemberStatus.LIFE, MemberStatus.RETIRED],
    )
    def test_rank_survives_every_operational_rung(self, member_status):
        # Class and status are independent questions. A life member is still
        # operational, and demoting the rank of everybody who is not a plain
        # "active" would be the fusion bug this split exists to undo.
        user = User(
            rank="captain",
            member_class=MemberClass.OPERATIONAL,
            member_status=member_status,
        )
        self._flush(user)

        assert user.rank == "captain"

    def test_a_social_member_keeps_their_rank(self):
        # Only the administrative class is barred. Widening the rule to social
        # would take ranks from honorary members, which nobody asked for.
        user = User(
            rank="captain",
            member_class=MemberClass.SOCIAL,
            member_status=MemberStatus.HONORARY,
        )
        self._flush(user)

        assert user.rank == "captain"

    def test_a_custom_tier_keeps_their_rank(self):
        """An unrecognised ``membership_type`` is a tier, not a class.

        ``split_membership_type`` returns ``(None, None)`` for it rather than
        guessing, and the rank rule has to inherit that restraint: a
        "senior" member is not an administrative one.
        """
        user = User(rank="captain", membership_type="senior")
        self._flush(user)

        assert user.member_class is None
        assert user.rank == "captain"

    def test_clearing_a_rank_that_is_already_empty_changes_nothing(self):
        user = User(rank=None, membership_type="administrative")
        self._flush(user)

        assert user.rank is None


class TestThroughARealSession:
    """The listener as SQLAlchemy actually invokes it, not called by hand.

    The class above pins the rule; this pins that it is *wired* — registered
    against both ``before_insert`` and ``before_update``, and reached by an
    ordinary session flush. A rule that stopped firing would leave every
    assertion above passing.
    """

    @pytest.fixture
    def session(self):
        engine = sa.create_engine("sqlite://")
        User.__table__.create(engine)
        with Session(engine) as session:
            yield session

    def _member(self, **overrides):
        fields = {
            "id": "00000000-0000-0000-0000-000000000001",
            "organization_id": "00000000-0000-0000-0000-0000000000ff",
            "username": "atreasurer",
            "email": "treasurer@example.org",
            "password_hash": "x",
            "first_name": "Ada",
            "last_name": "Treasurer",
        }
        fields.update(overrides)
        return User(**fields)

    def test_an_insert_cannot_introduce_the_pair(self, session):
        session.add(
            self._member(rank="captain", member_class=MemberClass.ADMINISTRATIVE)
        )
        session.commit()

        assert session.execute(sa.text("SELECT rank FROM users")).scalar_one() is None

    def test_a_row_that_predates_the_rule_is_corrected_by_any_write(self, session):
        # Written straight to the table so the pair exists on disk the way an
        # upgraded database has it — the migration clears these, but a row
        # missed by it must not stay wrong forever.
        session.add(self._member(rank="captain"))
        session.commit()
        session.execute(
            sa.text(
                "UPDATE users SET rank = 'captain', member_class = 'administrative'"
            )
        )
        session.commit()
        session.expire_all()

        member = session.query(User).one()
        member.phone = "555-0100"  # An edit about something else entirely.
        session.commit()

        assert member.rank is None

    def test_an_unrelated_edit_leaves_an_operational_rank_alone(self, session):
        session.add(self._member(rank="captain", membership_type="active"))
        session.commit()

        member = session.query(User).one()
        member.phone = "555-0100"
        session.commit()

        assert member.rank == "captain"


class TestTheSchemaRefusesThePair:
    """Rejected up front, rather than accepted and quietly emptied.

    The listener would clear the rank either way, so the row ends up correct
    without this. What it buys is the operator being told: a 200 with the field
    blank reads as the form having lost what they typed.
    """

    def _create_payload(self, **overrides):
        payload = {
            "username": "atreasurer",
            "email": "treasurer@example.org",
            "first_name": "Ada",
            "last_name": "Treasurer",
        }
        payload.update(overrides)
        return payload

    def test_create_rejects_a_rank_on_an_administrative_member(self):
        with pytest.raises(ValidationError, match="cannot hold an operational rank"):
            AdminUserCreate(
                **self._create_payload(
                    member_class=MemberClass.ADMINISTRATIVE, rank="captain"
                )
            )

    def test_update_rejects_a_rank_on_an_administrative_member(self):
        with pytest.raises(ValidationError, match="cannot hold an operational rank"):
            UserUpdate(member_class=MemberClass.ADMINISTRATIVE, rank="captain")

    def test_clearing_the_rank_of_an_administrative_member_is_allowed(self):
        # This is the shape the member edit screen sends when it moves somebody
        # off the line, and it is what the rule wants — refusing it would make
        # the class unreachable from the form.
        for blank in (None, "", "   "):
            update = UserUpdate(member_class=MemberClass.ADMINISTRATIVE, rank=blank)
            assert not (update.rank or "").strip()

    def test_a_rank_with_no_class_named_is_left_to_the_endpoint(self):
        # The payload carries nothing to compare the rank against; the stored
        # class is the endpoint's to check.
        assert UserUpdate(rank="captain").rank == "captain"

    @pytest.mark.parametrize(
        "member_class", [MemberClass.OPERATIONAL, MemberClass.SOCIAL]
    )
    def test_a_rank_on_a_class_that_rides_is_accepted(self, member_class):
        assert UserUpdate(member_class=member_class, rank="captain").rank == "captain"

    def test_promoting_off_administrative_and_ranking_in_one_payload_is_allowed(self):
        # The pair is judged on the class being *set*, not the one stored, so
        # putting somebody back on the line and giving them a rank is one edit.
        update = UserUpdate(member_class=MemberClass.OPERATIONAL, rank="captain")
        assert update.member_class == MemberClass.OPERATIONAL
        assert update.rank == "captain"
