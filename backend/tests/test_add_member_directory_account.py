"""Add Member and the roster import reach the connected directory.

A member added by Add Member can be given a directory account the way a
converted applicant is: at a generated department address, which becomes
their Logbook email, with the typed address kept as their personal one for
the passwords. Every other create -- each roster-import row included -- links
the member to an account already at their address, so leaving suspends it.
"""

import html
import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.users import create_member
from app.models.directory_account import (
    DirectoryAccountProvision,
    DirectoryAccountStatus,
)
from app.models.user import User, UserStatus
from app.schemas.user import AdminUserCreate
from app.services.email_service import EmailService
from app.services.integration_services.google_workspace_service import (
    GoogleWorkspaceError,
)
from tests.test_google_workspace_provisioning import (
    DOMAIN,
    SERVICE,
    FakeDirectory,
    _connect,
    _org,
)

USERS = "app.api.v1.endpoints.users"


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _officer(db_session, org) -> User:
    handle = _hex()
    officer = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"officer-{handle}@example.org",
        first_name="Olive",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(officer)
    await db_session.flush()
    return officer


async def _add(db_session, org, officer, fake, *, tasks=None, **fields):
    handle = _hex()
    data = dict(
        username=f"new-{handle}",
        email=f"jordan-{handle}@gmail.com",
        first_name="Jordan",
        last_name=f"Hale{handle}",
        send_welcome_email=False,
        password="Corr3ct-Horse-Battery!",
    )
    data.update(fields)
    with (
        patch(f"{SERVICE}.directory_for", return_value=fake),
        patch(f"{USERS}.welcome_email_can_send", AsyncMock(return_value=True)),
    ):
        created = await create_member(
            user_data=AdminUserCreate(**data),
            background_tasks=tasks or BackgroundTasks(),
            request=MagicMock(),
            db=db_session,
            current_user=officer,
        )
    member = await db_session.get(User, str(created.id))
    await db_session.refresh(member)
    return created, member


async def _record(db_session, user_id):
    return (
        await db_session.execute(
            select(DirectoryAccountProvision).where(
                DirectoryAccountProvision.user_id == str(user_id)
            )
        )
    ).scalar_one_or_none()


async def _department(db_session, *, connect=True, department_email=True):
    org = await _org(db_session, department_email=department_email)
    if connect:
        await _connect(db_session, org)
    officer = await _officer(db_session, org)
    await db_session.commit()
    return org, officer


@pytest.mark.integration
class TestCreatingAnAccount:
    async def test_the_account_is_made_at_a_generated_department_address(
        self, db_session
    ):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        created, member = await _add(
            db_session, org, officer, fake, create_directory_account=True
        )

        local = f"jordan.{member.last_name.lower()}"
        assert member.email == f"{local}@{DOMAIN}"
        assert member.personal_email.endswith("@gmail.com")
        assert fake.created[0][0] == member.email
        row = await _record(db_session, member.id)
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert created.directory_account.status == "created"
        assert created.directory_account.provider_name == "Google Workspace"
        assert created.directory_account.email == member.email

    async def test_without_a_welcome_the_password_goes_to_the_personal_address(
        self, db_session
    ):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        send = AsyncMock(return_value=(1, 0))
        with patch.object(EmailService, "send_email", send):
            created, member = await _add(
                db_session, org, officer, fake, create_directory_account=True
            )
        assert send.await_args.kwargs["to_emails"] == [member.personal_email]
        assert fake.created[0][3] in send.await_args.kwargs["text_body"]
        assert created.directory_account.credentials_sent is True

    async def test_the_welcome_goes_to_the_personal_address_with_the_password(
        self, db_session
    ):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        tasks = BackgroundTasks()
        created, member = await _add(
            db_session,
            org,
            officer,
            fake,
            tasks=tasks,
            create_directory_account=True,
            send_welcome_email=True,
            password=None,
        )

        @asynccontextmanager
        async def _same_session():
            yield db_session

        async def _sessions():
            async with _same_session() as session:
                yield session

        welcome = AsyncMock(return_value=True)
        with (
            patch(f"{USERS}.database_manager.get_session", _sessions),
            patch.object(EmailService, "send_welcome_email", welcome),
        ):
            for task in tasks.tasks:
                await task()

        kwargs = welcome.await_args.kwargs
        assert kwargs["to_email"] == member.personal_email
        # The card escapes the password, so a generated one containing & < > or
        # a quote appears in its escaped form.
        assert html.escape(fake.created[0][3]) in kwargs["appended_html"]
        assert member.email in kwargs["appended_text"]
        row = await _record(db_session, member.id)
        await db_session.refresh(row)
        assert row.credentials_sent is True

    async def test_a_directory_failure_never_undoes_the_member(self, db_session):
        org, officer = await _department(db_session)
        fake = FakeDirectory(create_error=GoogleWorkspaceError("No licenses left."))
        created, member = await _add(
            db_session, org, officer, fake, create_directory_account=True
        )
        assert member.status == UserStatus.ACTIVE
        row = await _record(db_session, member.id)
        assert row.status == DirectoryAccountStatus.FAILED.value
        assert created.directory_account.last_error == "No licenses left."

    async def test_refused_while_no_directory_is_connected(self, db_session):
        org, officer = await _department(db_session, connect=False)
        with pytest.raises(HTTPException) as refused:
            await _add(
                db_session,
                org,
                officer,
                FakeDirectory(),
                create_directory_account=True,
                username="never-written",
            )
        assert refused.value.status_code == 400
        assert "Microsoft 365" in refused.value.detail
        written = await db_session.execute(
            select(User).where(User.username == "never-written")
        )
        assert written.scalar_one_or_none() is None

    async def test_refused_without_department_addresses(self, db_session):
        org, officer = await _department(db_session, department_email=False)
        with pytest.raises(HTTPException) as refused:
            await _add(
                db_session,
                org,
                officer,
                FakeDirectory(),
                create_directory_account=True,
            )
        assert refused.value.status_code == 400
        assert "Department Email" in refused.value.detail

    async def test_refused_when_the_typed_address_is_on_the_department_domain(
        self, db_session
    ):
        # It would become the personal address the passwords go to: a
        # mailbox on the department domain that may not exist yet.
        org, officer = await _department(db_session)
        with pytest.raises(HTTPException) as refused:
            await _add(
                db_session,
                org,
                officer,
                FakeDirectory(),
                create_directory_account=True,
                email=f"jordan-{_hex()}@{DOMAIN}",
            )
        assert refused.value.status_code == 400
        assert "personal email" in refused.value.detail

    async def test_unticked_keeps_the_typed_address_and_creates_nothing(
        self, db_session
    ):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        fake.lookup_error = None
        typed = f"pat-{_hex()}@gmail.com"
        created, member = await _add(db_session, org, officer, fake, email=typed)
        assert member.email == typed
        assert member.personal_email is None
        assert fake.created == []
        assert await _record(db_session, member.id) is None
        assert created.directory_account is None


@pytest.mark.integration
class TestLinkingANewMember:
    """Every create without the box -- each roster-import row included."""

    async def test_an_address_that_is_already_an_account_is_linked(self, db_session):
        org, officer = await _department(db_session)
        address = f"pat-{_hex()}@{DOMAIN}"
        fake = FakeDirectory()
        fake.existing = {"id": "g-pat", "primaryEmail": address}
        created, member = await _add(db_session, org, officer, fake, email=address)

        row = await _record(db_session, member.id)
        assert row.status == DirectoryAccountStatus.LINKED_EXISTING.value
        assert row.external_user_id == "g-pat"
        assert row.created_by == officer.id
        assert fake.created == []
        assert created.directory_account.status == "linked_existing"

    async def test_an_alias_on_someone_elses_account_is_not_linked(self, db_session):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        fake.existing = {"id": "g-chief", "primaryEmail": f"chief@{DOMAIN}"}
        _, member = await _add(
            db_session, org, officer, fake, email=f"alias-{_hex()}@{DOMAIN}"
        )
        assert await _record(db_session, member.id) is None

    async def test_an_account_another_record_holds_is_not_linked_again(
        self, db_session
    ):
        org, officer = await _department(db_session)
        former = await _officer(db_session, org)
        db_session.add(
            DirectoryAccountProvision(
                organization_id=org.id,
                user_id=former.id,
                provider="google",
                primary_email=f"reused@{DOMAIN}",
                status=DirectoryAccountStatus.CREATED.value,
                external_user_id="g-reused",
            )
        )
        await db_session.commit()
        address = f"reused-{_hex()}@{DOMAIN}"
        fake = FakeDirectory()
        fake.existing = {"id": "g-reused", "primaryEmail": address}
        _, member = await _add(db_session, org, officer, fake, email=address)
        assert await _record(db_session, member.id) is None

    async def test_an_address_off_the_domain_is_not_looked_up(self, db_session):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        _, member = await _add(db_session, org, officer, fake)
        assert fake.keys == []
        assert await _record(db_session, member.id) is None

    async def test_no_account_at_the_address_links_nothing(self, db_session):
        from app.services.integration_services.google_workspace_service import (
            GoogleAccountNotFoundError,
        )

        org, officer = await _department(db_session)
        fake = FakeDirectory()
        fake.lookup_error = GoogleAccountNotFoundError("gone")
        _, member = await _add(
            db_session, org, officer, fake, email=f"new-{_hex()}@{DOMAIN}"
        )
        assert await _record(db_session, member.id) is None

    async def test_a_directory_outage_still_creates_the_member(self, db_session):
        org, officer = await _department(db_session)
        fake = FakeDirectory()
        fake.lookup_error = GoogleWorkspaceError("Google is busy.")
        created, member = await _add(
            db_session, org, officer, fake, email=f"busy-{_hex()}@{DOMAIN}"
        )
        assert member.status == UserStatus.ACTIVE
        assert await _record(db_session, member.id) is None
        assert created.directory_account is None

    async def test_nothing_is_looked_up_without_a_directory(self, db_session):
        org, officer = await _department(db_session, connect=False)
        fake = FakeDirectory()
        _, member = await _add(
            db_session, org, officer, fake, email=f"any-{_hex()}@{DOMAIN}"
        )
        assert fake.keys == []
        assert await _record(db_session, member.id) is None
