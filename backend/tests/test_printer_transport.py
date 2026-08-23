"""
Tests for the raw-TCP printer transport (app/utils/printer_transport.py).

This module is the SSRF boundary for the direct-print feature: it takes a host
and port an administrator typed and writes bytes to them. These tests are
mostly about what it must *refuse*, because a guard that quietly stops working
looks exactly like one that works — every send succeeds either way until
somebody points a "printer" at an internal service.

No sockets are opened. The DNS resolver is stubbed so the address-class checks
can be exercised against addresses this container does not have.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils import printer_transport as pt
from app.utils.printer_transport import (
    ALLOWED_PRINTER_PORTS,
    MAX_PAYLOAD_BYTES,
    PrinterUnreachableError,
    resolve_printer_host,
    send_to_printer,
    validate_printer_port,
)


def _writer():
    """A StreamWriter double. `close()` is synchronous on the real class, so it
    is a MagicMock — an AsyncMock there returns an un-awaited coroutine."""
    writer = AsyncMock()
    writer.write = MagicMock()
    writer.close = MagicMock()
    return writer


def _addrinfo(*addresses):
    """Shape a getaddrinfo() result carrying the given addresses."""
    return [(2, 1, 6, "", (addr, 0)) for addr in addresses]


def _resolver(*addresses):
    """Patch the event loop's resolver to answer with fixed addresses."""
    return patch(
        "asyncio.get_running_loop",
        return_value=AsyncMock(
            getaddrinfo=AsyncMock(return_value=_addrinfo(*addresses))
        ),
    )


class TestPortAllowlist:
    """The port allowlist is the guard doing most of the SSRF work: it is what
    stops a 'printer' from being aimed at Redis, MySQL or an internal API."""

    @pytest.mark.parametrize("port", [9100, 9101, 9109, 6101])
    def test_raw_print_ports_are_accepted(self, port):
        validate_printer_port(port)

    @pytest.mark.parametrize(
        "port",
        [22, 25, 80, 443, 3306, 6379, 8080, 9099, 9110, 11211, 27017],
    )
    def test_non_printer_ports_are_rejected(self, port):
        with pytest.raises(ValueError, match="not a label-printer port"):
            validate_printer_port(port)

    def test_the_allowlist_holds_no_service_ports(self):
        for dangerous in (22, 80, 443, 3306, 5432, 6379, 8080, 25, 587):
            assert dangerous not in ALLOWED_PRINTER_PORTS

    async def test_send_rejects_a_bad_port_before_resolving(self):
        # Resolution is a side effect (and a DNS lookup); the port check must
        # come first so a rejected target is never even looked up.
        with patch.object(pt, "resolve_printer_host", AsyncMock()) as resolver:
            with pytest.raises(ValueError, match="not a label-printer port"):
                await send_to_printer("printer.local", 6379, "^XA^XZ")
        resolver.assert_not_called()


class TestBlockedAddressClasses:
    async def test_loopback_is_rejected(self):
        # Would aim the writes at the application host's own services.
        with _resolver("127.0.0.1"):
            with pytest.raises(ValueError, match="loopback"):
                await resolve_printer_host("localhost")

    async def test_ipv6_loopback_is_rejected(self):
        with _resolver("::1"):
            with pytest.raises(ValueError, match="loopback"):
                await resolve_printer_host("localhost")

    async def test_link_local_is_rejected(self):
        with _resolver("169.254.1.5"):
            with pytest.raises(ValueError, match="link-local"):
                await resolve_printer_host("printer.local")

    async def test_the_cloud_metadata_address_is_rejected(self):
        # 169.254.169.254 is the instance metadata service on every major
        # cloud; it is the single most valuable SSRF target.
        with _resolver("169.254.169.254"):
            with pytest.raises(ValueError, match="link-local"):
                await resolve_printer_host("metadata.internal")

    async def test_unspecified_address_is_rejected(self):
        with _resolver("0.0.0.0"):
            with pytest.raises(ValueError, match="reserved"):
                await resolve_printer_host("nowhere")

    async def test_multicast_is_rejected(self):
        with _resolver("224.0.0.1"):
            with pytest.raises(ValueError, match="reserved"):
                await resolve_printer_host("all-hosts")

    async def test_every_resolved_address_is_checked_not_just_the_first(self):
        # A name answering with a LAN address *and* a loopback address must be
        # refused outright — which address a connection lands on is not ours
        # to choose, so validating only the first would be a rebinding hole.
        with _resolver("192.168.1.50", "127.0.0.1"):
            with pytest.raises(ValueError, match="loopback"):
                await resolve_printer_host("sneaky.local")


class TestAllowedAddresses:
    """Private LAN addresses must keep working — that is where the printer is."""

    @pytest.mark.parametrize("address", ["192.168.1.50", "10.0.0.20", "172.16.4.9"])
    async def test_private_addresses_resolve(self, address):
        with _resolver(address):
            assert await resolve_printer_host("printer.local") == address

    async def test_returns_a_literal_address_not_the_hostname(self):
        # Connecting to the resolved literal is what closes the DNS-rebinding
        # window between validation and connection.
        with _resolver("192.168.1.50"):
            assert await resolve_printer_host("printer.local") == "192.168.1.50"


class TestHostValidation:
    async def test_empty_host_is_rejected(self):
        with pytest.raises(ValueError, match="host is required"):
            await resolve_printer_host("   ")

    async def test_overlong_host_is_rejected(self):
        with pytest.raises(ValueError, match="too long"):
            await resolve_printer_host("a" * 256)

    async def test_unresolvable_host_reports_unreachable(self):
        import socket

        loop = AsyncMock(getaddrinfo=AsyncMock(side_effect=socket.gaierror()))
        with patch("asyncio.get_running_loop", return_value=loop):
            with pytest.raises(PrinterUnreachableError, match="Could not resolve"):
                await resolve_printer_host("no-such-printer.local")

    async def test_empty_resolution_reports_unreachable(self):
        with _resolver():
            with pytest.raises(PrinterUnreachableError, match="Could not resolve"):
                await resolve_printer_host("printer.local")


class TestPayloadLimits:
    async def test_empty_payload_is_rejected(self):
        with pytest.raises(ValueError, match="Nothing to print"):
            await send_to_printer("192.168.1.50", 9100, "")

    async def test_oversized_payload_is_rejected(self):
        with pytest.raises(ValueError, match="too large"):
            await send_to_printer("192.168.1.50", 9100, "X" * (MAX_PAYLOAD_BYTES + 1))


class TestSending:
    async def test_writes_the_payload_and_reports_the_byte_count(self):
        writer = _writer()
        with _resolver("192.168.1.50"):
            with patch(
                "asyncio.open_connection",
                AsyncMock(return_value=(AsyncMock(), writer)),
            ):
                sent = await send_to_printer("printer.local", 9100, "^XA^XZ")
        assert sent == len("^XA^XZ")
        writer.write.assert_called_once_with(b"^XA^XZ")

    async def test_connects_to_the_resolved_address_not_the_name(self):
        writer = _writer()
        opener = AsyncMock(return_value=(AsyncMock(), writer))
        with _resolver("192.168.1.50"):
            with patch("asyncio.open_connection", opener):
                await send_to_printer("printer.local", 9100, "^XA^XZ")
        assert opener.await_args.args[0] == "192.168.1.50"

    async def test_a_refused_connection_reports_unreachable(self):
        # Not a 500: the application worked and a device did not, which is the
        # difference between "try again" and "call support".
        with _resolver("192.168.1.50"):
            with patch(
                "asyncio.open_connection",
                AsyncMock(side_effect=ConnectionRefusedError()),
            ):
                with pytest.raises(PrinterUnreachableError, match="Could not connect"):
                    await send_to_printer("printer.local", 9100, "^XA^XZ")

    async def test_a_timeout_reports_unreachable(self):
        import asyncio

        with _resolver("192.168.1.50"):
            with patch(
                "asyncio.open_connection",
                AsyncMock(side_effect=asyncio.TimeoutError()),
            ):
                with pytest.raises(PrinterUnreachableError, match="Timed out"):
                    await send_to_printer("printer.local", 9100, "^XA^XZ")
