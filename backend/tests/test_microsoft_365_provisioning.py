"""Microsoft 365 accounts for members converted from applicants.

Covers the config schema, the Graph connector (driven through an
``httpx.MockTransport``, so Microsoft is never called and the token request is
replaced), and the directory-account engine with Microsoft 365 connected:
licensing, on-premises accounts, linking by sign-in name or mail, and the rule
that only one directory is connected at a time.
"""

import json
from types import SimpleNamespace
from typing import Any, Callable, Optional
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.directory_account import (
    GOOGLE_WORKSPACE_INTEGRATION,
    MICROSOFT_365_INTEGRATION,
    DirectoryAccountStatus,
)
from app.models.integration import Integration
from app.models.user import Organization, User, UserStatus
from app.schemas.integration import Microsoft365Config
from app.services.directory_account_service import (
    DirectoryAccountService,
    credentials_html,
)
from app.services.integration_services.directory_common import (
    DirectoryAccountExistsError,
    DirectoryAccountNotFoundError,
)
from app.services.integration_services.microsoft_365_service import (
    GRAPH_BASE,
    MICROSOFT_365_PROVIDER,
    TAG_ATTRIBUTE,
    TAG_PREFIX,
    Microsoft365AccountExistsError,
    Microsoft365Directory,
    Microsoft365Error,
    Microsoft365ManagedOnPremisesError,
    to_directory_account,
)
from app.utils.microsoft_oauth import MICROSOFT_GRAPH_SCOPE, MicrosoftOAuthError
from tests.test_google_workspace_provisioning import (
    DOMAIN,
    _change_status,
    _hex,
    _member,
    _org,
    _prospect,
    _row,
    _settle,
)

SERVICE = "app.services.directory_account_service"
CONNECTOR = "app.services.integration_services.microsoft_365_service"
TENANT = "11111111-2222-3333-4444-555555555555"
CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SKU = "c42b9cae-ea4f-4ab7-9717-81576235ccac"
GROUP_ID = "99999999-8888-7777-6666-555555555555"

Handler = Callable[[httpx.Request], httpx.Response]


def _error(status: int, message: str, code: str = "Request_BadRequest"):
    return httpx.Response(status, json={"error": {"code": code, "message": message}})


class Graph:
    """A scripted Graph: each request is recorded and answered by *handler*."""

    def __init__(self, handler: Handler):
        self.handler = handler
        self.requests: list[httpx.Request] = []

    def _answer(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def client(self, **kwargs: Any) -> Microsoft365Directory:
        return Microsoft365Directory(
            TENANT,
            CLIENT,
            "secret",
            client_factory=lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(self._answer)
            ),
            **kwargs,
        )

    def calls(self) -> list[tuple[str, str]]:
        return [(r.method, r.url.path) for r in self.requests]


@pytest.fixture(autouse=True)
def token_request():
    """Every connector test runs with a fixed token; msal is never reached."""
    with patch(f"{CONNECTOR}.acquire_access_token", return_value="tok") as token:
        yield token


def _user(**fields: Any) -> dict[str, Any]:
    return {
        "id": "ms-1",
        "userPrincipalName": "pat@firedept.org",
        "mail": "pat@firedept.org",
        "accountEnabled": True,
        "onPremisesSyncEnabled": None,
        "onPremisesExtensionAttributes": {},
        **fields,
    }


# ---------------------------------------------------------------------------
# Unit: no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestConfigSchema:
    def test_a_valid_config_is_normalized(self):
        config = Microsoft365Config(
            tenant_id=f" {TENANT} ",
            client_id=CLIENT,
            client_secret="s3cret",
            domain="FireDept.org",
            usage_location="us",
            license_sku_id=SKU.upper(),
            groups=[GROUP_ID.upper(), "Members@FireDept.org", "members@firedept.org"],
        )
        assert config.tenant_id == TENANT
        assert config.domain == "firedept.org"
        assert config.usage_location == "US"
        assert config.license_sku_id == SKU
        assert config.groups == [GROUP_ID, "members@firedept.org"]

    def test_the_usage_location_defaults_to_us(self):
        config = Microsoft365Config(tenant_id=TENANT, client_id=CLIENT, domain=DOMAIN)
        assert config.usage_location == "US"
        assert config.license_sku_id == ""

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("tenant_id", "evil.example/../x"),
            ("client_id", "not-a-guid"),
            ("usage_location", "USA"),
            ("license_sku_id", "E3"),
            ("domain", "firedept"),
        ],
    )
    def test_a_bad_value_is_refused(self, field, value):
        values = {"tenant_id": TENANT, "client_id": CLIENT, "domain": DOMAIN}
        values[field] = value
        with pytest.raises(ValidationError):
            Microsoft365Config(**values)

    def test_a_group_is_an_id_or_an_address(self):
        with pytest.raises(ValidationError):
            Microsoft365Config(
                tenant_id=TENANT, client_id=CLIENT, domain=DOMAIN, groups=["Members"]
            )

    def test_the_group_list_is_capped(self):
        with pytest.raises(ValidationError):
            Microsoft365Config(
                tenant_id=TENANT,
                client_id=CLIENT,
                domain=DOMAIN,
                groups=[f"g{i}@firedept.org" for i in range(21)],
            )


@pytest.mark.unit
class TestUserResource:
    def test_a_tagged_cloud_account(self):
        account = to_directory_account(
            _user(
                userPrincipalName="Pat@FireDept.org",
                mail="Pat.Member@FireDept.org",
                accountEnabled=False,
                onPremisesExtensionAttributes={TAG_ATTRIBUTE: TAG_PREFIX + "m-9"},
            )
        )
        assert account.primary_email == "pat@firedept.org"
        assert account.other_addresses == ("pat.member@firedept.org",)
        assert account.suspended is True
        assert account.member_id == "m-9"
        assert account.managed_elsewhere is False

    def test_an_attribute_without_the_prefix_is_not_a_tag(self):
        account = to_directory_account(
            _user(onPremisesExtensionAttributes={TAG_ATTRIBUTE: "m-9"})
        )
        assert account.member_id is None
        assert account.other_addresses == ()

    def test_a_synced_account_is_managed_elsewhere(self):
        assert to_directory_account(_user(onPremisesSyncEnabled=True)).managed_elsewhere


@pytest.mark.unit
class TestGraphConnector:
    async def test_the_token_is_asked_for_graph(self, token_request):
        graph = Graph(lambda r: httpx.Response(200, json=_user()))
        await graph.client().get_user("ms-1")
        assert token_request.call_args.args[3] == MICROSOFT_GRAPH_SCOPE
        assert graph.requests[0].headers["Authorization"] == "Bearer tok"

    async def test_a_token_failure_is_reported_in_its_own_words(self, token_request):
        token_request.side_effect = MicrosoftOAuthError(
            "The client secret has expired. Create a new secret in Entra ID."
        )
        with pytest.raises(Microsoft365Error, match="secret has expired"):
            await Graph(lambda r: httpx.Response(200)).client().get_user("ms-1")

    async def test_creation_tags_the_account_in_the_same_request(self):
        graph = Graph(lambda r: httpx.Response(201, json={"id": "ms-new"}))
        created = await graph.client(usage_location="CA").create_user(
            "pat.o'neil@firedept.org", "Pat", "O'Neil", "Temp-pw-1", member_id="m-9"
        )
        assert created == "ms-new"
        assert graph.calls() == [("POST", "/v1.0/users")]
        body = json.loads(graph.requests[0].content)
        assert body["userPrincipalName"] == "pat.o'neil@firedept.org"
        assert body["mailNickname"] == "pat.oneil"
        assert body["usageLocation"] == "CA"
        assert body["passwordProfile"] == {
            "password": "Temp-pw-1",
            "forceChangePasswordNextSignIn": True,
        }
        assert body["onPremisesExtensionAttributes"] == {
            TAG_ATTRIBUTE: TAG_PREFIX + "m-9"
        }

    async def test_an_address_in_use_is_reported_as_existing_without_echoing(
        self,
    ):
        graph = Graph(
            lambda r: _error(
                400,
                "Another object with the same value for property "
                "userPrincipalName already exists. pat@firedept.org",
            )
        )
        with pytest.raises(Microsoft365AccountExistsError) as exc:
            await graph.client().create_user("pat@firedept.org", "P", "M", "x", "m")
        assert isinstance(exc.value, DirectoryAccountExistsError)
        assert "pat@firedept.org" not in str(exc.value)

    async def test_a_lookup_by_address_filters_and_prefers_the_sign_in_name(self):
        holder = _user(id="by-mail", userPrincipalName="x@firedept.org")
        owner = _user(id="by-upn", userPrincipalName="o'hara@firedept.org")
        graph = Graph(lambda r: httpx.Response(200, json={"value": [holder, owner]}))
        account = await graph.client().get_user("O'Hara@firedept.org")
        assert account.id == "by-upn"
        assert graph.requests[0].url.params["$filter"] == (
            "userPrincipalName eq 'o''hara@firedept.org' or mail eq "
            "'o''hara@firedept.org'"
        )

    async def test_no_user_at_an_address_is_not_found(self):
        graph = Graph(lambda r: httpx.Response(200, json={"value": []}))
        with pytest.raises(DirectoryAccountNotFoundError):
            await graph.client().get_user("nobody@firedept.org")

    async def test_a_deleted_account_is_not_found(self):
        graph = Graph(
            lambda r: _error(404, "Resource not found", "Request_ResourceNotFound")
        )
        with pytest.raises(DirectoryAccountNotFoundError):
            await graph.client().is_suspended("ms-1")

    async def test_suspending_blocks_sign_in_and_ends_sessions(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json=_user())
            return httpx.Response(204)

        graph = Graph(answer)
        await graph.client().set_suspended("ms-1", True)
        assert graph.calls() == [
            ("GET", "/v1.0/users/ms-1"),
            ("PATCH", "/v1.0/users/ms-1"),
            ("POST", "/v1.0/users/ms-1/revokeSignInSessions"),
        ]
        assert json.loads(graph.requests[1].content) == {"accountEnabled": False}

    async def test_a_failed_session_revocation_does_not_undo_the_block(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json=_user())
            if request.url.path.endswith("revokeSignInSessions"):
                return _error(
                    403, "Insufficient privileges", "Authorization_RequestDenied"
                )
            return httpx.Response(204)

        await Graph(answer).client().set_suspended("ms-1", True)

    async def test_unsuspending_unblocks_without_touching_sessions(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json=_user(accountEnabled=False))
            return httpx.Response(204)

        graph = Graph(answer)
        await graph.client().set_suspended("ms-1", False)
        assert graph.calls()[-1] == ("PATCH", "/v1.0/users/ms-1")
        assert json.loads(graph.requests[-1].content) == {"accountEnabled": True}

    async def test_a_synced_account_is_never_changed(self):
        graph = Graph(
            lambda r: httpx.Response(200, json=_user(onPremisesSyncEnabled=True))
        )
        with pytest.raises(
            Microsoft365ManagedOnPremisesError, match="Active Directory"
        ):
            await graph.client().set_suspended("ms-1", True)
        with pytest.raises(Microsoft365ManagedOnPremisesError):
            await graph.client().reset_password("ms-1", "x")
        assert {method for method, _ in graph.calls()} == {"GET"}

    async def test_graph_refusing_an_on_premises_object_says_so(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json=_user())
            return _error(
                400,
                "Unable to update the specified properties for on-premises "
                "mastered Directory Sync objects",
            )

        with pytest.raises(Microsoft365ManagedOnPremisesError):
            await Graph(answer).client().set_suspended("ms-1", True)

    async def test_no_license_configured_means_no_license_calls(self):
        graph = Graph(lambda r: httpx.Response(500))
        await graph.client().ensure_licensed("ms-1")
        assert graph.requests == []

    async def test_a_held_license_is_not_assigned_again(self):
        graph = Graph(
            lambda r: httpx.Response(
                200, json={"id": "ms-1", "assignedLicenses": [{"skuId": SKU.upper()}]}
            )
        )
        await graph.client(license_sku_id=SKU).ensure_licensed("ms-1")
        assert graph.calls() == [("GET", "/v1.0/users/ms-1")]

    async def test_a_missing_license_is_assigned(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json={"id": "ms-1", "assignedLicenses": []})
            return httpx.Response(200, json={"id": "ms-1"})

        graph = Graph(answer)
        await graph.client(license_sku_id=SKU).ensure_licensed("ms-1")
        assert graph.calls()[-1] == ("POST", "/v1.0/users/ms-1/assignLicense")
        assert json.loads(graph.requests[-1].content) == {
            "addLicenses": [{"skuId": SKU, "disabledPlans": []}],
            "removeLicenses": [],
        }

    async def test_a_refused_license_names_the_likely_causes(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(200, json={"id": "ms-1", "assignedLicenses": []})
            return _error(400, "License assignment failed because ...")

        with pytest.raises(Microsoft365Error, match="licenses available"):
            await Graph(answer).client(license_sku_id=SKU).ensure_licensed("ms-1")

    async def test_joining_a_group_by_address(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/v1.0/groups":
                return httpx.Response(200, json={"value": [{"id": GROUP_ID}]})
            if request.url.path == "/v1.0/users":
                return httpx.Response(200, json={"value": [_user()]})
            return httpx.Response(204)

        graph = Graph(answer)
        await graph.client().add_to_group("members@firedept.org", "pat@firedept.org")
        assert graph.calls()[-1] == ("POST", f"/v1.0/groups/{GROUP_ID}/members/$ref")
        assert json.loads(graph.requests[-1].content) == {
            "@odata.id": f"{GRAPH_BASE}/directoryObjects/ms-1"
        }

    async def test_already_a_member_is_success(self):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.method == "GET" and "groups" in request.url.path:
                return httpx.Response(200, json={"id": GROUP_ID})
            if request.method == "GET":
                return httpx.Response(200, json={"value": [_user()]})
            return _error(
                400, "One or more added object references already exist for ..."
            )

        await Graph(answer).client().add_to_group(GROUP_ID, "pat@firedept.org")

    async def test_the_listing_follows_graphs_own_next_link_and_keeps_the_domain(
        self,
    ):
        pages = [
            {
                "value": [
                    _user(id="a", userPrincipalName="a@firedept.org", mail=None),
                    _user(id="b", userPrincipalName="b@other.org", mail="b@other.org"),
                ],
                "@odata.nextLink": f"{GRAPH_BASE}/users?$skiptoken=p2",
            },
            {
                "value": [
                    _user(
                        id="c",
                        userPrincipalName="c@tenant.onmicrosoft.com",
                        mail="c@firedept.org",
                    )
                ],
                "@odata.nextLink": "https://elsewhere.example/steal",
            },
        ]
        graph = Graph(
            lambda r: httpx.Response(200, json=pages[len(graph.requests) - 1])
        )
        users = await graph.client().list_users(DOMAIN)
        assert [u.id for u in users] == ["a", "c"]
        assert len(graph.requests) == 2
        assert graph.requests[1].url.params["$skiptoken"] == "p2"

    @pytest.mark.parametrize(
        ("group", "accepted"),
        [
            ({"securityEnabled": True, "mailEnabled": False, "groupTypes": []}, True),
            (
                {
                    "securityEnabled": False,
                    "mailEnabled": True,
                    "groupTypes": ["Unified"],
                },
                True,
            ),
            ({"securityEnabled": False, "mailEnabled": True, "groupTypes": []}, False),
            ({"securityEnabled": True, "mailEnabled": True, "groupTypes": []}, False),
            (
                {
                    "securityEnabled": True,
                    "mailEnabled": False,
                    "groupTypes": ["DynamicMembership"],
                },
                False,
            ),
        ],
        ids=["security", "microsoft-365", "distribution", "mail-security", "dynamic"],
    )
    async def test_test_accepts_only_groups_graph_can_change(self, group, accepted):
        def answer(request: httpx.Request) -> httpx.Response:
            if request.url.path.startswith("/v1.0/groups"):
                return httpx.Response(
                    200, json={"id": GROUP_ID, "displayName": "Members", **group}
                )
            return httpx.Response(200, json={"value": []})

        client = Graph(answer).client()
        if accepted:
            message = await client.test_connection(DOMAIN, [GROUP_ID], None)
            assert "1 group(s)" in message
        else:
            with pytest.raises(Microsoft365Error, match="The group Members"):
                await client.test_connection(DOMAIN, [GROUP_ID], None)

    async def test_test_reports_the_license_and_refuses_one_the_tenant_lacks(self):
        skus = {
            "value": [
                {
                    "skuId": SKU,
                    "skuPartNumber": "O365_BUSINESS_ESSENTIALS",
                    "prepaidUnits": {"enabled": 300},
                    "consumedUnits": 120,
                }
            ]
        }

        def answer(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("subscribedSkus"):
                return httpx.Response(200, json=skus)
            return httpx.Response(200, json={"value": []})

        client = Graph(answer).client()
        message = await client.test_connection(DOMAIN, [], SKU)
        assert "O365_BUSINESS_ESSENTIALS (180 available)" in message
        with pytest.raises(Microsoft365Error, match="not one of this tenant"):
            await client.test_connection(DOMAIN, [], GROUP_ID)

    async def test_permission_failures_point_at_consent_and_the_role(self):
        graph = Graph(
            lambda r: _error(
                403, "Insufficient privileges", "Authorization_RequestDenied"
            )
        )
        with pytest.raises(Microsoft365Error, match="User Administrator"):
            await graph.client().test_connection(DOMAIN, [], None)

    async def test_an_unreachable_graph_is_reported_plainly(self):
        def answer(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("dns", request=request)

        with pytest.raises(Microsoft365Error, match="could not be reached"):
            await Graph(answer).client().get_user("ms-1")


@pytest.mark.unit
class TestWording:
    def test_the_credentials_card_names_microsoft(self):
        card = credentials_html(MICROSOFT_365_PROVIDER, "pat@firedept.org", "<pw>")
        assert "Your Microsoft 365 account" in card
        assert "https://www.office.com/" in card
        assert "Microsoft will ask you" in card
        assert "&lt;pw&gt;" in card


# ---------------------------------------------------------------------------
# Integration: database
# ---------------------------------------------------------------------------


class FakeGraph:
    """Stands in for Microsoft365Directory; records what it was asked."""

    def __init__(self, *, license_error: Optional[Exception] = None):
        self.license_error = license_error
        self.created: list[tuple[str, str]] = []
        self.licensed: list[str] = []
        self.groups: list[tuple[str, str]] = []
        self.suspend_calls: list[bool] = []
        self.accounts: dict[str, dict[str, Any]] = {}
        self.create_error: Optional[Exception] = None
        self.managed_elsewhere = False
        self.left: list[tuple[str, str]] = []
        self.licensing_groups: set[str] = set()

    async def create_user(self, email, given, family, password, member_id):
        if self.create_error:
            raise self.create_error
        self.created.append((email, password))
        return "ms-new"

    async def ensure_licensed(self, key):
        if self.license_error:
            raise self.license_error
        self.licensed.append(key)

    async def add_to_group(self, group, email):
        self.groups.append((group, email))

    async def remove_from_group(self, group, key):
        if group in self.licensing_groups:
            return False
        self.left.append((group, key))
        return True

    async def reset_password(self, key, password):
        return None

    async def list_users(self, domain):
        return [to_directory_account(u) for u in self.accounts.values()]

    async def get_user(self, key):
        for raw in self.accounts.values():
            account = to_directory_account(raw)
            if key == account.id or key in account.addresses:
                return account
        raise Microsoft365Error("not found")

    async def is_suspended(self, key):
        return False

    async def set_suspended(self, key, suspended):
        if self.managed_elsewhere:
            raise Microsoft365ManagedOnPremisesError("disable it in Active Directory")
        self.suspend_calls.append(suspended)


async def _connect_microsoft(
    db: AsyncSession, org: Organization, **config: Any
) -> Integration:
    integration = Integration(
        organization_id=org.id,
        integration_type=MICROSOFT_365_INTEGRATION,
        name="Microsoft 365",
        category="Access Control",
        status="connected",
        enabled=True,
        config={
            "tenant_id": TENANT,
            "client_id": CLIENT,
            "domain": DOMAIN,
            "usage_location": "US",
            "license_sku_id": SKU,
            "groups": [GROUP_ID],
            **config,
        },
    )
    integration.set_secret("client_secret", "s3cret")
    db.add(integration)
    await db.flush()
    return integration


async def _converted(db_session, fake: FakeGraph):
    org = await _org(db_session)
    await _connect_microsoft(db_session, org)
    svc, prospect = await _prospect(db_session, org)
    with patch.object(
        svc, "_send_transfer_welcome_email", AsyncMock(return_value=True)
    ):
        result = await svc._do_transfer(prospect, None, send_welcome_email=True)
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await result["_send_welcome_email"]()
    return org, result


@pytest.mark.integration
class TestMicrosoftConversion:
    async def test_the_account_is_created_licensed_and_grouped(self, db_session):
        fake = FakeGraph()
        org, result = await _converted(db_session, fake)
        row = await _row(db_session, result["user_id"])
        assert row.provider == "microsoft"
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert row.external_user_id == "ms-new"
        assert fake.licensed == ["ms-new"]
        assert fake.groups == [(GROUP_ID, result["email"])]
        assert row.license_pending is False
        assert row.pending_groups is None
        assert result["google_account"]["provider_name"] == "Microsoft 365"

    async def test_a_refused_license_is_kept_for_retry(self, db_session):
        fake = FakeGraph(license_error=Microsoft365Error("No licenses left."))
        org, result = await _converted(db_session, fake)
        row = await _row(db_session, result["user_id"])
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert row.license_pending is True
        assert "license could not be assigned (No licenses left.)" in row.last_error
        # The groups still went through.
        assert row.pending_groups is None

        fake.license_error = None
        row.last_attempt_at = None
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            row = await DirectoryAccountService(db_session).retry(
                str(result["user_id"]), str(org.id)
            )
        assert row.license_pending is False
        assert fake.licensed == ["ms-new"]

    async def test_an_address_another_account_holds_as_mail_is_linked(self, db_session):
        fake = FakeGraph()
        fake.create_error = Microsoft365AccountExistsError("exists")
        org = await _org(db_session)
        await _connect_microsoft(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        with patch.object(
            svc, "_send_transfer_welcome_email", AsyncMock(return_value=True)
        ):
            result = await svc._do_transfer(prospect, None, send_welcome_email=True)
            await db_session.commit()
            fake.accounts["x"] = _user(
                id="ms-old",
                userPrincipalName="j.hale@tenant.onmicrosoft.com",
                mail=result["email"],
            )
            with patch(f"{SERVICE}.directory_for", return_value=fake):
                await result["_send_welcome_email"]()
        row = await _row(db_session, result["user_id"])
        assert row.status == DirectoryAccountStatus.LINKED_EXISTING.value
        assert row.external_user_id == "ms-old"
        assert "Microsoft 365 admin center" in row.last_error


@pytest.mark.integration
class TestOnPremisesAccounts:
    async def test_a_departure_flags_the_account_and_the_sweep_leaves_it(
        self, db_session
    ):
        fake = FakeGraph()
        org, result = await _converted(db_session, fake)
        user_id = str(result["user_id"])
        officer = User(
            organization_id=org.id,
            username=f"officer-{_hex()}",
            email=f"officer-{_hex()}@example.org",
        )
        db_session.add(officer)
        await db_session.commit()
        caller = SimpleNamespace(
            id=officer.id,
            organization_id=org.id,
            username="o",
            rank=None,
            positions=[SimpleNamespace(permissions=["*"])],
        )
        fake.managed_elsewhere = True
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
            row = await _row(db_session, user_id)
            assert row.managed_on_premises is True
            assert row.suspension_settled is False
            assert "Active Directory" in row.suspension_error

            row.suspension_error = None  # what would let the sweep retry at once
            await db_session.commit()
            attempted = await DirectoryAccountService(
                db_session
            ).sync_pending_suspensions()
        # Not retried: no call here can ever change the account.
        assert attempted == 0
        assert fake.suspend_calls == []

        items = await DirectoryAccountService(db_session).attention_items(str(org.id))
        assert [i.issue for i in items] == ["not_suspended"]

    async def test_a_return_is_still_settled_by_the_sweep(self, db_session):
        fake = FakeGraph()
        org, result = await _converted(db_session, fake)
        user_id = str(result["user_id"])
        member = await db_session.get(User, user_id)
        fake.managed_elsewhere = True
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            member.status = UserStatus.DROPPED_VOLUNTARY
            await db_session.commit()
            await _settle(db_session)
            assert (await _row(db_session, user_id)).managed_on_premises is True

            # The member returns, and the after-commit run never happens.
            member.status = UserStatus.ACTIVE
            await db_session.commit()
            attempted = await DirectoryAccountService(
                db_session
            ).sync_pending_suspensions()
        assert attempted == 1
        row = await _row(db_session, user_id)
        assert row.suspension_settled is True
        assert row.suspension_wanted is False
        # Nothing to unblock: The Logbook never blocked it.
        assert fake.suspend_calls == []

    async def test_retry_looks_again_and_clears_the_flag(self, db_session):
        fake = FakeGraph()
        org, result = await _converted(db_session, fake)
        user_id = str(result["user_id"])
        member = await db_session.get(User, user_id)
        fake.managed_elsewhere = True
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            member.status = UserStatus.DROPPED_VOLUNTARY
            await db_session.commit()
            await _settle(db_session)
            row = await _row(db_session, user_id)
            assert row.managed_on_premises is True

            fake.managed_elsewhere = False  # converted to cloud-only
            row.last_attempt_at = None
            await db_session.commit()
            row = await DirectoryAccountService(db_session).retry(user_id, str(org.id))
        assert row.managed_on_premises is False
        assert row.suspended_by_logbook is True
        assert fake.suspend_calls == [True]


@pytest.mark.integration
class TestLinkExistingMicrosoft:
    async def test_sign_in_name_or_mail_links_and_a_shared_account_links_nobody(
        self, db_session
    ):
        org = await _org(db_session)
        await _connect_microsoft(db_session, org)
        tag = _hex()
        by_upn = await _member(db_session, org, f"upn-{tag}@{DOMAIN}")
        by_mail = await _member(db_session, org, f"mail-{tag}@{DOMAIN}")
        shared_a = await _member(db_session, org, f"shared-{tag}@{DOMAIN}")
        shared_b = await _member(db_session, org, f"shared.alt-{tag}@{DOMAIN}")
        synced = await _member(db_session, org, f"synced-{tag}@{DOMAIN}")
        fake = FakeGraph()
        fake.accounts = {
            "upn": _user(id="g-upn", userPrincipalName=by_upn.email, mail=None),
            "mail": _user(
                id="g-mail",
                userPrincipalName=f"m{tag}@tenant.onmicrosoft.com",
                mail=by_mail.email,
            ),
            "shared": _user(
                id="g-shared",
                userPrincipalName=shared_a.email,
                mail=shared_b.email,
            ),
            "synced": _user(
                id="g-synced",
                userPrincipalName=synced.email,
                onPremisesSyncEnabled=True,
            ),
        }
        await db_session.commit()

        service = DirectoryAccountService(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            counts = await service.link_existing_members(
                str(org.id), MICROSOFT_365_PROVIDER, apply=True, actor_id=None
            )
        assert counts["linked"] == 3
        assert counts["account_in_use"] == 2
        for member, external_id in (
            (by_upn, "g-upn"),
            (by_mail, "g-mail"),
            (synced, "g-synced"),
        ):
            row = await _row(db_session, member.id)
            assert row.provider == "microsoft"
            assert row.external_user_id == external_id
        assert (await _row(db_session, synced.id)).managed_on_premises is True
        assert await service.get_for_user(str(shared_a.id), str(org.id)) is None
        assert await service.get_for_user(str(shared_b.id), str(org.id)) is None


@pytest.mark.integration
class TestOneDirectoryAtATime:
    async def test_microsoft_is_refused_while_google_is_connected(self, db_session):
        from app.api.v1.endpoints.integrations import _check_directory_ready

        org = await _org(db_session)
        google = Integration(
            organization_id=org.id,
            integration_type=GOOGLE_WORKSPACE_INTEGRATION,
            name="Google Workspace",
            category="Access Control",
            status="connected",
            enabled=True,
            config={},
        )
        microsoft = Integration(
            organization_id=org.id,
            integration_type=MICROSOFT_365_INTEGRATION,
            name="Microsoft 365",
            category="Access Control",
            status="available",
            enabled=False,
            config={},
        )
        db_session.add_all([google, microsoft])
        await db_session.flush()
        config = {"domain": DOMAIN, "client_secret": "s3cret"}

        with pytest.raises(HTTPException) as exc:
            await _check_directory_ready(db_session, microsoft, config)
        assert exc.value.status_code == 409
        assert "Google Workspace is connected" in exc.value.detail

        google.status = "available"
        google.enabled = False
        await db_session.flush()
        await _check_directory_ready(db_session, microsoft, config)

    async def test_a_first_connection_needs_the_client_secret(self, db_session):
        from app.api.v1.endpoints.integrations import _check_directory_ready

        org = await _org(db_session)
        microsoft = Integration(
            organization_id=org.id,
            integration_type=MICROSOFT_365_INTEGRATION,
            name="Microsoft 365",
            category="Access Control",
            status="available",
            enabled=False,
            config={},
        )
        db_session.add(microsoft)
        await db_session.flush()
        with pytest.raises(HTTPException, match="client secret"):
            await _check_directory_ready(db_session, microsoft, {"domain": DOMAIN})

    def test_changing_it_needs_an_administrator(self):
        from unittest.mock import MagicMock

        from app.api.v1.endpoints.integrations import _require_directory_admin

        integration = Integration(integration_type=MICROSOFT_365_INTEGRATION)
        with patch(
            "app.api.v1.endpoints.integrations.user_has_permission", return_value=False
        ):
            with pytest.raises(HTTPException) as exc:
                _require_directory_admin(integration, MagicMock())
        assert exc.value.status_code == 403
        assert exc.value.detail.endswith("change Microsoft 365")
