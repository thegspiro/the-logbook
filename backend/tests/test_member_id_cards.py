"""CR80 member ID cards: the renderer, the department layout, and the endpoints.

The card is a credential that scans as its member, so the tests pin three
things beyond "a PDF comes out": the page is exactly card-sized for any card
printer driver, nobody outside members.manage / members.manage_id_cards can
reach the endpoints, and a request naming another organization's member
prints nothing for them.
"""

import base64
import uuid
from datetime import date
from io import BytesIO
from types import SimpleNamespace

import pytest
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints import member_id_cards as endpoints
from app.models.operational_rank import OperationalRank
from app.models.training import (
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.member_id_card_service import (
    DEFAULT_LAYOUT,
    SETTINGS_KEY,
    MemberIdCardService,
    _card_certifications,
    _CardCertificate,
    _read_layout,
    _return_lines,
    _valid_through,
)
from app.utils.id_card_renderer import (
    IdCardCertification,
    IdCardDepartment,
    IdCardSpec,
    render_id_cards,
)

POINTS_PER_INCH = 72


def _png_data_uri(size=(60, 80), mode="RGB") -> str:
    from PIL import Image

    buf = BytesIO()
    Image.new(mode, size, (120, 140, 160) if mode == "RGB" else (0, 0, 0, 0)).save(
        buf, "PNG"
    )
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _card(**overrides) -> IdCardSpec:
    values = {
        "name": "Jordan Reyes",
        "barcode_value": "M-042",
        "title": "Captain",
        "station": "Station 2",
        "member_number": "M-042",
        "member_since": "2015",
        "photo": _png_data_uri(),
    }
    values.update(overrides)
    return IdCardSpec(**values)


DEPARTMENT = IdCardDepartment(
    name="Springfield Volunteer Fire Department",
    logo=_png_data_uri((40, 40), "RGBA"),
    return_lines=["If found, please return to:", "Springfield VFD", "1 Main St"],
)


def _pages(pdf: BytesIO):
    return PdfReader(pdf).pages


def _inches(page) -> tuple:
    box = page.mediabox
    return (
        round(float(box.width) / POINTS_PER_INCH, 3),
        round(float(box.height) / POINTS_PER_INCH, 3),
    )


@pytest.mark.unit
class TestRenderer:
    @pytest.mark.parametrize(
        ("orientation", "size"),
        [("landscape", (3.375, 2.125)), ("portrait", (2.125, 3.375))],
    )
    def test_every_page_is_exactly_cr80(self, orientation, size):
        pdf = render_id_cards([_card(), _card()], DEPARTMENT, orientation, "both")
        pages = _pages(pdf)
        assert all(_inches(p) == size for p in pages)

    @pytest.mark.parametrize("symbology", ["code128", "qr"])
    @pytest.mark.parametrize("orientation", ["landscape", "portrait"])
    def test_front_only_is_one_page_per_card(self, orientation, symbology):
        pdf = render_id_cards(
            [_card(), _card(name="Sam Lee")],
            DEPARTMENT,
            orientation,
            "front",
            symbology,
        )
        assert len(_pages(pdf)) == 2

    @pytest.mark.parametrize("symbology", ["code128", "qr"])
    @pytest.mark.parametrize("orientation", ["landscape", "portrait"])
    def test_both_sides_alternate_front_and_back(self, orientation, symbology):
        """Front, back, front, back: the order a duplex card printer feeds,
        and the order someone flipping cards by hand needs."""
        pdf = render_id_cards(
            [_card(name="Jordan Reyes"), _card(name="Sam Lee")],
            DEPARTMENT,
            orientation,
            "both",
            symbology,
        )
        pages = _pages(pdf)
        assert len(pages) == 4
        texts = [p.extract_text() for p in pages]
        assert "Jordan Reyes" in texts[0]
        assert "Sam Lee" in texts[2]
        assert "If found, please return" in texts[1]
        assert "If found, please return" in texts[3]

    def test_front_only_carries_the_code_and_back_carries_it_when_printed(self):
        front_only = _pages(render_id_cards([_card()], DEPARTMENT, sides="front"))
        assert "M-042" in front_only[0].extract_text()
        both = _pages(
            render_id_cards([_card(member_number=None)], DEPARTMENT, sides="both")
        )
        assert "M-042" not in both[0].extract_text()
        assert "M-042" in both[1].extract_text()

    def test_an_image_that_will_not_decode_leaves_the_card_printable(self):
        broken = "data:image/png;base64,bm90IGFuIGltYWdl"
        department = IdCardDepartment(
            name="VFD", logo="data:image/svg+xml;base64,PHN2Zy8+"
        )
        pdf = render_id_cards([_card(photo=broken)], department)
        assert len(_pages(pdf)) == 1

    def test_a_card_with_no_optional_fields_prints(self):
        bare = IdCardSpec(name="Pat Doe", barcode_value="ABC123")
        for orientation in ("landscape", "portrait"):
            for sides in ("front", "both"):
                assert _pages(
                    render_id_cards(
                        [bare], IdCardDepartment(name="VFD"), orientation, sides
                    )
                )

    def test_a_code_that_cannot_be_encoded_names_the_member(self):
        with pytest.raises(ValueError, match="Pat Doe"):
            render_id_cards(
                [_card(name="Pat Doe", barcode_value="Ünïcode")], DEPARTMENT
            )

    def test_a_code_too_long_for_the_card_names_the_member(self):
        with pytest.raises(ValueError, match="Pat Doe"):
            render_id_cards([_card(name="Pat Doe", barcode_value="X" * 80)], DEPARTMENT)

    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            ({"orientation": "square"}, "orientation"),
            ({"sides": "three"}, "sides"),
            ({"symbology": "pdf417"}, "symbology"),
        ],
    )
    def test_unknown_options_are_refused(self, kwargs, message):
        with pytest.raises(ValueError, match=message):
            render_id_cards([_card()], DEPARTMENT, **kwargs)

    def test_an_empty_batch_is_refused(self):
        with pytest.raises(ValueError, match="No members"):
            render_id_cards([], DEPARTMENT)


@pytest.mark.unit
class TestDepartmentLayout:
    def test_nothing_saved_reads_as_the_default(self):
        assert _read_layout({}) == DEFAULT_LAYOUT
        assert _read_layout(None) == DEFAULT_LAYOUT

    def test_a_saved_layout_is_returned(self):
        saved = {"orientation": "portrait", "sides": "both", "symbology": "qr"}
        # Saved before certifications existed: they stay off.
        assert _read_layout({SETTINGS_KEY: saved}) == {
            **saved,
            "certifications": False,
        }

    def test_a_bad_stored_value_degrades_per_field(self):
        """Free-form JSON: one stale value must not stop the department
        printing, and must not discard the values that are still good."""
        layout = _read_layout(
            {SETTINGS_KEY: {"orientation": "portrait", "sides": 3, "symbology": "x"}}
        )
        assert layout == {**DEFAULT_LAYOUT, "orientation": "portrait"}

    def test_a_non_dict_stored_layout_is_the_default(self):
        assert _read_layout({SETTINGS_KEY: ["portrait"]}) == DEFAULT_LAYOUT


@pytest.mark.unit
class TestReturnLines:
    @staticmethod
    def _org(**fields):
        base = {
            "name": "Springfield VFD",
            "phone": "555-0100",
            "mailing_address_line1": None,
            "mailing_address_line2": None,
            "mailing_city": None,
            "mailing_state": None,
            "mailing_zip": None,
            "physical_address_line1": None,
            "physical_address_line2": None,
            "physical_city": None,
            "physical_state": None,
            "physical_zip": None,
        }
        base.update(fields)
        return SimpleNamespace(**base)

    def test_prefers_the_mailing_address(self):
        org = self._org(
            mailing_address_line1="PO Box 9",
            mailing_city="Springfield",
            mailing_state="IL",
            mailing_zip="62701",
            physical_address_line1="1 Main St",
        )
        assert _return_lines(org) == [
            "If found, please return to:",
            "Springfield VFD",
            "PO Box 9",
            "Springfield, IL 62701",
            "555-0100",
        ]

    def test_falls_back_to_the_physical_address(self):
        org = self._org(physical_address_line1="1 Main St", physical_city="Springfield")
        assert "1 Main St" in _return_lines(org)
        assert "Springfield" in _return_lines(org)

    def test_no_address_still_names_the_department(self):
        org = self._org(phone=None)
        assert _return_lines(org) == ["If found, please return to:", "Springfield VFD"]


@pytest.mark.unit
class TestEndpointGate:
    def test_every_route_requires_manage_or_the_id_card_grant(self):
        """Printing a colleague's card is the same act as opening it on
        screen, so it takes the same grants — never members.view."""
        assert len(endpoints.router.routes) == 3
        for route in endpoints.router.routes:
            checkers = [
                d.call
                for d in route.dependant.dependencies
                if isinstance(d.call, PermissionChecker)
            ]
            assert len(checkers) == 1, route.path
            assert set(checkers[0].required_permissions) == {
                "members.manage",
                "members.manage_id_cards",
            }, route.path


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _org(db: AsyncSession, **fields) -> Organization:
    org = Organization(name="Card Test VFD", slug=f"cards-{_hex()}", **fields)
    db.add(org)
    await db.flush()
    return org


async def _member(db: AsyncSession, org: Organization, **fields) -> User:
    user = User(
        organization_id=org.id,
        username=f"member-{_hex()}",
        email=f"member-{_hex()}@example.org",
        first_name=fields.pop("first_name", "Alex"),
        last_name=fields.pop("last_name", "Reyes"),
        status=UserStatus.ACTIVE,
        **fields,
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.integration
class TestMemberIdCardService:
    async def test_prints_only_the_callers_organization(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        member = await _member(
            db_session, mine, first_name="Mine", membership_number="A1"
        )
        outsider = await _member(
            db_session, theirs, first_name="Theirs", membership_number="B2"
        )

        pdf, count = await MemberIdCardService(db_session).generate(
            mine.id, [member.id, outsider.id]
        )

        assert count == 1
        text = " ".join(p.extract_text() for p in _pages(pdf))
        assert "Mine" in text
        assert "Theirs" not in text

    async def test_another_organizations_members_alone_print_nothing(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        outsider = await _member(db_session, theirs)
        with pytest.raises(ValueError, match="No members found"):
            await MemberIdCardService(db_session).generate(mine.id, [outsider.id])

    async def test_uses_the_rank_display_name_and_the_badge_value(self, db_session):
        org = await _org(db_session)
        db_session.add(
            OperationalRank(
                organization_id=org.id,
                rank_code="lieutenant_2",
                display_name="Second Lieutenant",
                sort_order=1,
            )
        )
        member = await _member(
            db_session, org, rank="lieutenant_2", membership_number="L-7"
        )
        pdf, _ = await MemberIdCardService(db_session).generate(org.id, [member.id])
        text = _pages(pdf)[0].extract_text()
        assert "Second Lieutenant" in text
        assert "L-7" in text

    async def test_saved_layout_drives_the_next_print(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, membership_number="P-1")
        service = MemberIdCardService(db_session)

        assert await service.get_layout(org.id) == DEFAULT_LAYOUT
        await service.save_layout(org.id, "portrait", "both", "qr")
        assert await service.get_layout(org.id) == {
            "orientation": "portrait",
            "sides": "both",
            "symbology": "qr",
            "certifications": False,
        }

        pdf, _ = await service.generate(org.id, [member.id])
        pages = _pages(pdf)
        assert len(pages) == 2
        assert _inches(pages[0]) == (2.125, 3.375)

        # A per-print choice overrides the saved layout without changing it.
        pdf, _ = await service.generate(
            org.id, [member.id], orientation="landscape", sides="front"
        )
        assert _inches(_pages(pdf)[0]) == (3.375, 2.125)
        assert (await service.get_layout(org.id))["orientation"] == "portrait"

    async def test_saving_the_layout_keeps_other_settings(self, db_session):
        org = await _org(db_session, settings={"label_setups": {"inventory": []}})
        await MemberIdCardService(db_session).save_layout(
            org.id, "portrait", "front", "code128"
        )
        await db_session.refresh(org)
        assert org.settings["label_setups"] == {"inventory": []}

    async def test_an_invalid_layout_is_refused(self, db_session):
        org = await _org(db_session)
        with pytest.raises(ValueError, match="orientation"):
            await MemberIdCardService(db_session).save_layout(
                org.id, "diagonal", "front", "qr"
            )


# ---------------------------------------------------------------------------
# Certifications on the printed card (owner decisions, 2026-11-24): "Valid
# through" on the front, the list on the back when the card is two-sided,
# printed whoever prints it, and off until the department switches it on.
# ---------------------------------------------------------------------------

LAYOUTS = [
    (orientation, symbology)
    for orientation in ("landscape", "portrait")
    for symbology in ("code128", "qr")
]


def _certified_card(count: int = 2, **overrides) -> IdCardSpec:
    certs = [
        IdCardCertification("CPR/BLS Provider", "Exp Mar 14, 2027"),
        IdCardCertification("EMT-B", "Expired Mar 14, 2026"),
        IdCardCertification("Hazmat Operations", "Not recorded"),
        IdCardCertification("Pump Operator", "Exp Jan 2, 2028"),
        IdCardCertification("Rope Rescue Technician", "Exp Jul 4, 2027"),
        IdCardCertification("Driver Training", "On file"),
        IdCardCertification("Ice Rescue", "Exp Feb 1, 2027"),
        IdCardCertification("Vehicle Extrication", "Exp Apr 9, 2027"),
        IdCardCertification("Confined Space", "Exp May 5, 2027"),
        IdCardCertification("Incident Command 300", "On file"),
    ]
    return _card(
        valid_through="Mar 14, 2027", certifications=certs[:count], **overrides
    )


@pytest.mark.unit
class TestCertificationsOnTheCard:
    @pytest.mark.parametrize(("orientation", "symbology"), LAYOUTS)
    def test_valid_through_prints_on_the_front_of_every_layout(
        self, orientation, symbology
    ):
        pdf = render_id_cards(
            [_certified_card()], DEPARTMENT, orientation, "front", symbology
        )
        [front] = _pages(pdf)
        text = front.extract_text()
        assert "Valid through Mar 14, 2027" in text
        # A single-sided card has no room for the list; it keeps its code.
        assert "Certifications" not in text
        assert "M-042" in text

    @pytest.mark.parametrize(("orientation", "symbology"), LAYOUTS)
    def test_the_list_prints_on_the_back_and_the_code_survives(
        self, orientation, symbology
    ):
        pdf = render_id_cards(
            [_certified_card()], DEPARTMENT, orientation, "both", symbology
        )
        back = _pages(pdf)[1].extract_text()
        assert "Certifications" in back
        assert "CPR/BLS Provider" in back
        assert "Exp Mar 14, 2027" in back
        assert "Expired Mar 14, 2026" in back
        if symbology == "code128":
            assert "M-042" in back

    @pytest.mark.parametrize(("orientation", "symbology"), LAYOUTS)
    def test_more_than_fits_says_how_many_more(self, orientation, symbology):
        many = [
            IdCardCertification(f"Certification {i}", "Exp Mar 14, 2027")
            for i in range(30)
        ]
        card = _card(valid_through="Mar 14, 2027", certifications=many)
        pdf = render_id_cards([card], DEPARTMENT, orientation, "both", symbology)
        back = _pages(pdf)[1].extract_text()
        assert "more on the digital ID card" in back
        assert "Certification 0" in back
        if symbology == "code128":
            assert "M-042" in back

    @pytest.mark.parametrize("orientation", ["landscape", "portrait"])
    def test_the_front_line_costs_the_scannable_code_nothing(
        self, orientation, monkeypatch
    ):
        """A smaller code scans worse; the date must not be paid for in it."""
        import app.utils.id_card_renderer as renderer

        def code_sizes(symbology, valid_through):
            sizes = []
            draw_qr, fit_code128 = renderer.draw_qr, renderer.fit_code128

            def record_qr(c, value, x, y, size):
                sizes.append(size)
                return draw_qr(c, value, x, y, size)

            def record_bar(module, value, bar_width, width, bar_height):
                sizes.append(bar_height)
                return fit_code128(module, value, bar_width, width, bar_height)

            monkeypatch.setattr(renderer, "draw_qr", record_qr)
            monkeypatch.setattr(renderer, "fit_code128", record_bar)
            render_id_cards(
                [_card(valid_through=valid_through)],
                DEPARTMENT,
                orientation,
                "front",
                symbology,
            )
            monkeypatch.setattr(renderer, "draw_qr", draw_qr)
            monkeypatch.setattr(renderer, "fit_code128", fit_code128)
            return sizes

        for symbology in ("qr", "code128"):
            assert code_sizes(symbology, "Mar 14, 2027") == code_sizes(
                symbology, None
            ), symbology

    def test_a_card_without_certifications_is_unchanged(self):
        pdf = render_id_cards([_card()], DEPARTMENT, "landscape", "both", "code128")
        front, back = (p.extract_text() for p in _pages(pdf))
        assert "Valid through" not in front
        assert "Certifications" not in back


@pytest.mark.unit
class TestCertificationLines:
    def test_valid_through_is_the_soonest_held_expiry(self):
        certs = [
            _CardCertificate("CPR", "on_file", date(2027, 3, 14)),
            _CardCertificate("EMT", "on_file", date(2026, 12, 1)),
            _CardCertificate("Hazmat", "expired", date(2026, 3, 14)),
            _CardCertificate("Driver", "on_file", None),
            _CardCertificate("Pump", "missing", None),
        ]
        assert _valid_through(certs) == date(2026, 12, 1)

    def test_no_held_expiry_means_no_date(self):
        assert _valid_through([_CardCertificate("CPR", "on_file", None)]) is None
        assert _valid_through([]) is None

    def test_lines_use_the_digital_cards_words(self):
        lines = _card_certifications(
            [
                _CardCertificate("CPR", "on_file", date(2027, 3, 14)),
                _CardCertificate("Driver", "on_file", None),
                _CardCertificate("Hazmat", "expired", date(2026, 3, 14)),
                _CardCertificate("Pump", "missing", None),
            ]
        )
        assert [(c.name, c.status) for c in lines] == [
            ("CPR", "Exp Mar 14, 2027"),
            ("Driver", "On file"),
            ("Hazmat", "Expired Mar 14, 2026"),
            ("Pump", "Not recorded"),
        ]

    def test_only_a_stored_true_switches_them_on(self):
        assert _read_layout({SETTINGS_KEY: {"certifications": True}})["certifications"]
        for value in (False, "yes", 1, None):
            assert not _read_layout({SETTINGS_KEY: {"certifications": value}})[
                "certifications"
            ]


async def _certification_requirement(db, org, name):
    requirement = TrainingRequirement(
        organization_id=org.id,
        name=name,
        requirement_type="certification",
        training_type=TrainingType.CERTIFICATION,
        frequency="biannual",
        registry_code=None,
    )
    db.add(requirement)
    await db.flush()
    return requirement


async def _certificate(db, org, member, course_name, expires):
    db.add(
        TrainingRecord(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            user_id=member.id,
            course_name=course_name,
            training_type=TrainingType.CERTIFICATION,
            completion_date=date(2025, 3, 14),
            expiration_date=expires,
            hours_completed=4,
            status=TrainingStatus.COMPLETED,
        )
    )
    await db.flush()


@pytest.mark.integration
class TestCertificationsFromTheGrading:
    async def _department(self, db_session, **member_fields):
        org = await _org(db_session)
        member = await _member(
            db_session, org, membership_number="C-1", **member_fields
        )
        await _certification_requirement(db_session, org, "CPR/BLS Certification")
        await _certificate(
            db_session, org, member, "CPR/BLS Certification", date(2099, 3, 14)
        )
        return org, member

    async def test_switched_on_the_card_carries_the_dates(self, db_session):
        org, member = await self._department(db_session)

        pdf, _ = await MemberIdCardService(db_session).generate(
            org.id, [member.id], sides="both", certifications=True
        )

        front, back = (p.extract_text() for p in _pages(pdf))
        assert "Valid through Mar 14, 2099" in front
        assert "CPR/BLS Certification" in back
        assert "Exp Mar 14, 2099" in back

    async def test_off_by_default_the_card_is_unchanged(self, db_session):
        org, member = await self._department(db_session)

        pdf, _ = await MemberIdCardService(db_session).generate(
            org.id, [member.id], sides="both"
        )

        front, back = (p.extract_text() for p in _pages(pdf))
        assert "Valid through" not in front
        assert "Certifications" not in back

    async def test_the_saved_layout_switches_them_on(self, db_session):
        org, member = await self._department(db_session)
        service = MemberIdCardService(db_session)
        await service.save_layout(org.id, "landscape", "both", "code128", True)

        assert (await service.get_layout(org.id))["certifications"] is True
        pdf, _ = await service.generate(org.id, [member.id])
        assert "Valid through Mar 14, 2099" in _pages(pdf)[0].extract_text()

    async def test_a_member_exempt_from_compliance_gets_none(self, db_session):
        org, member = await self._department(db_session, compliance_exempt=True)

        pdf, _ = await MemberIdCardService(db_session).generate(
            org.id, [member.id], sides="both", certifications=True
        )

        front, back = (p.extract_text() for p in _pages(pdf))
        assert "Valid through" not in front
        assert "Certifications" not in back

    async def test_the_print_is_audited_with_whether_it_carried_them(
        self, db_session, monkeypatch
    ):
        org, member = await self._department(db_session)
        await MemberIdCardService(db_session).save_layout(
            org.id, "landscape", "both", "code128", True
        )
        events = []

        async def record(**kwargs):
            events.append(kwargs)

        monkeypatch.setattr(endpoints, "log_audit_event", record)
        caller = SimpleNamespace(
            id=member.id, organization_id=org.id, username=member.username
        )

        await endpoints.print_id_cards(
            endpoints.IdCardPrintBody(user_ids=[member.id]),
            db=db_session,
            current_user=caller,
        )

        [event] = events
        assert event["event_type"] == "id_cards_printed"
        assert event["event_data"] == {"count": 1, "certifications": True}
