"""
Raw-TCP transport for network label printers.

Nearly every network label printer accepts its command language as a plain TCP
stream on port 9100 (HP's "JetDirect" convention, adopted by Zebra, Rollo,
Brother and others): open a socket, write the ZPL, close. There is no protocol
negotiation and no meaningful response to read.

That simplicity is also the risk. An endpoint that takes a host and a port from
an admin and writes attacker-chosen bytes to it is a server-side request
forgery primitive, so this module is where the target is constrained, and every
send goes through :func:`send_to_printer` rather than opening its own socket.

The guards, and why each is drawn where it is:

* **Port allowlist.** Restricting to the raw-print ports means a "printer" can
  never be aimed at Redis, MySQL, an internal HTTP API, or the SMTP relay.
  This is the guard doing most of the work.
* **Blocked address classes.** Loopback keeps the target off the application
  host itself; link-local blocks the cloud metadata service at 169.254.169.254;
  multicast, reserved and unspecified addresses have no printer behind them.
* **Operator-approved destinations only.** The resolved address must belong to
  ``LABEL_PRINTER_ALLOWED_NETWORKS``. Tenant administrators can select a
  printer, but cannot extend this platform-level network boundary.
* **Resolve once, connect to the resolved IP.** Validating a hostname and then
  handing the *name* to the socket layer would re-resolve it, letting a DNS
  entry that answered with a LAN address during validation answer with
  something else microseconds later (DNS rebinding).
* **Reading back is deliberately narrow.** :func:`send_to_printer` reads
  nothing at all. :func:`query_printer` does read, because a print job that
  merely reached a socket tells nobody whether a label came out — but it goes
  through the same address and port checks, caps what it will read, and its
  output is parsed into known fields by the caller rather than handed to a
  client. A blind write to a printer port cannot be turned into a banner grab.
"""

import asyncio
import ipaddress
import socket
import time
from typing import List, Sequence, Union

from loguru import logger

from app.core.config import settings

# Raw-print ports. 9100-9109 is the JetDirect range (multi-port print servers
# expose 9101/9102 for their second and third ports); 6101 is used by some
# older Zebra network cards.
ALLOWED_PRINTER_PORTS = frozenset(list(range(9100, 9110)) + [6101])

CONNECT_TIMEOUT_SECONDS = 5.0
SEND_TIMEOUT_SECONDS = 15.0

# Status queries answer in milliseconds on a healthy LAN printer. The budget is
# short on purpose: a status check is never worth making somebody wait.
STATUS_TIMEOUT_SECONDS = 3.0

# A ~HI + ~HQES reply is a few hundred bytes. The cap is what keeps a
# misconfigured target from streaming into the response.
MAX_STATUS_BYTES = 4096

# ~HI asks the printer to identify itself (model, firmware, resolution); ~HQES
# asks for its error and warning bitmasks. Together they answer the two
# questions a socket connection cannot: is this actually a ZPL printer, and can
# it print right now.
HOST_QUERY = "~HI~HQES"

# ESC/POS real-time status requests (DLE EOT n). Unlike ZPL's text queries
# these are answered one byte at a time, so they are sent as separate
# exchanges rather than back to back.
#
# n=2 (offline) reports why printing is halted, n=4 (paper roll sensor) reports
# the roll, and n=3 (error cause) is what separates a cutter jam from the
# unhelpful "something is wrong" that n=2's error bit would otherwise be.
ESCPOS_OFFLINE_QUERY = b"\x10\x04\x02"
ESCPOS_ERROR_QUERY = b"\x10\x04\x03"
ESCPOS_PAPER_QUERY = b"\x10\x04\x04"

_ETX = b"\x03"

# A label job is a few hundred bytes each; a megabyte is already ~2000 labels
# and well past anything a person queues from a print page.
MAX_PAYLOAD_BYTES = 1_048_576


class PrinterUnreachableError(Exception):
    """The printer could not be reached, or rejected the connection."""


def validate_printer_port(port: int) -> None:
    """Raise ValueError unless *port* is a raw-print port."""
    if port not in ALLOWED_PRINTER_PORTS:
        raise ValueError(
            f"Port {port} is not a label-printer port. Use 9100 (the standard "
            "raw-print port), 9101-9109, or 6101."
        )


def _check_address(ip: ipaddress._BaseAddress, host: str) -> None:
    if ip.is_loopback:
        raise ValueError(
            f"{host} resolves to a loopback address. A label printer must be a "
            "separate device on the network."
        )
    if ip.is_link_local:
        raise ValueError(
            f"{host} resolves to a link-local address, which is not routable to a printer."
        )
    if ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        raise ValueError(
            f"{host} resolves to a reserved address that cannot host a printer."
        )

    allowed_networks = []
    for entry in settings.LABEL_PRINTER_ALLOWED_NETWORKS.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            allowed_networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # A typo in a security boundary must fail closed. Logging the
            # entry gives operators enough information to correct it.
            logger.warning(f"Ignoring invalid label-printer network: {entry!r}")

    if not any(
        ip.version == network.version and ip in network for network in allowed_networks
    ):
        raise ValueError(
            f"{host} does not resolve to an operator-approved label-printer network."
        )


async def resolve_printer_host(host: str) -> str:
    """Resolve *host* and return one validated, connectable IP literal.

    Every address the name resolves to is checked, not just the one that gets
    used: a name answering with both a LAN address and a loopback address must
    be rejected outright, since which one a connection lands on is not ours to
    choose.
    """
    hostname = (host or "").strip()
    if not hostname:
        raise ValueError("Printer host is required")
    if len(hostname) > 255:
        raise ValueError("Printer host is too long")

    loop = asyncio.get_running_loop()
    try:
        infos = await asyncio.wait_for(
            loop.getaddrinfo(hostname, None, type=socket.SOCK_STREAM),
            timeout=CONNECT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise PrinterUnreachableError(f"Timed out looking up {hostname}")
    except socket.gaierror:
        raise PrinterUnreachableError(f"Could not resolve printer host {hostname}")

    addresses: List[str] = []
    for info in infos:
        sockaddr = info[4]
        candidate = sockaddr[0]
        if candidate not in addresses:
            addresses.append(candidate)
    if not addresses:
        raise PrinterUnreachableError(f"Could not resolve printer host {hostname}")

    for candidate in addresses:
        _check_address(ipaddress.ip_address(candidate), hostname)

    return addresses[0]


async def send_to_printer(host: str, port: int, payload: Union[str, bytes]) -> int:
    """Send *payload* to the printer at *host*:*port*. Returns bytes written.

    Accepts ``bytes`` as well as ``str`` because ESC/POS is a binary language:
    a length prefix or a QR module size can be any byte value, and encoding
    those as UTF-8 would turn every byte above 0x7F into two and corrupt the
    job. ZPL is printable ASCII and keeps passing through as text.

    Raises ValueError for a rejected target and
    :class:`PrinterUnreachableError` when the printer cannot be reached.
    """
    validate_printer_port(port)

    data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
    if not data:
        raise ValueError("Nothing to print")
    if len(data) > MAX_PAYLOAD_BYTES:
        raise ValueError("Print job is too large. Print fewer labels at a time.")

    address = await resolve_printer_host(host)

    writer = None
    try:
        reader_writer = await asyncio.wait_for(
            asyncio.open_connection(address, port), timeout=CONNECT_TIMEOUT_SECONDS
        )
        _, writer = reader_writer
        writer.write(data)
        await asyncio.wait_for(writer.drain(), timeout=SEND_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise PrinterUnreachableError(
            f"Timed out sending to the printer at {host}:{port}. Check that it "
            "is powered on and on the network."
        )
    except OSError as exc:
        logger.warning(f"Label printer send failed for {host}:{port}: {exc}")
        raise PrinterUnreachableError(
            f"Could not connect to the printer at {host}:{port}."
        )
    finally:
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(
                    writer.wait_closed(), timeout=SEND_TIMEOUT_SECONDS
                )
            except (asyncio.TimeoutError, OSError):
                # The job is already on the wire; a printer that drops the
                # socket without a clean FIN has still printed it.
                pass

    return len(data)


async def query_printer(
    host: str, port: int, timeout: float = STATUS_TIMEOUT_SECONDS
) -> str:
    """Ask the printer to identify itself and report its status.

    Returns the raw reply, bounded by :data:`MAX_STATUS_BYTES`. An empty string
    means the printer accepted the connection but never answered — which is
    itself worth knowing, since it is what a non-ZPL device on port 9100 looks
    like.

    Raises ValueError for a rejected target and
    :class:`PrinterUnreachableError` when the printer cannot be reached.
    """
    validate_printer_port(port)
    address = await resolve_printer_host(host)

    writer = None
    buffer = b""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(address, port), timeout=CONNECT_TIMEOUT_SECONDS
        )
        writer.write(HOST_QUERY.encode("ascii"))
        await asyncio.wait_for(writer.drain(), timeout=timeout)

        # Read until both replies have terminated, the cap is hit, the printer
        # goes quiet, or the overall deadline passes. A quiet printer is not an
        # error here: whatever arrived is what gets parsed.
        #
        # The deadline spans the whole loop rather than each read. Per-read
        # timeouts let a target that dribbles one byte just before each expiry
        # hold the request open indefinitely — status is queried after every
        # print, so that would tie up printing too.
        deadline = time.monotonic() + timeout
        while len(buffer) < MAX_STATUS_BYTES:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                chunk = await asyncio.wait_for(reader.read(1024), timeout=remaining)
            except asyncio.TimeoutError:
                break
            if not chunk:
                break
            buffer += chunk
            if buffer.count(_ETX) >= 2:
                break
    except asyncio.TimeoutError:
        raise PrinterUnreachableError(
            f"Timed out querying the printer at {host}:{port}."
        )
    except OSError as exc:
        logger.warning(f"Label printer query failed for {host}:{port}: {exc}")
        raise PrinterUnreachableError(
            f"Could not connect to the printer at {host}:{port}."
        )
    finally:
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(
                    writer.wait_closed(), timeout=STATUS_TIMEOUT_SECONDS
                )
            except (asyncio.TimeoutError, OSError):
                pass

    return buffer[:MAX_STATUS_BYTES].decode("ascii", errors="replace")


async def query_printer_raw(
    host: str,
    port: int,
    exchanges: Sequence[bytes],
    read_bytes: int = 1,
    timeout: float = STATUS_TIMEOUT_SECONDS,
) -> List[bytes]:
    """Send each payload in turn and read a reply after each one.

    ESC/POS real-time status is a request/response protocol answered one byte
    at a time, with nothing in the reply saying which question it answers — so
    the exchanges have to be sequential for the answers to be attributable.
    A question that goes unanswered yields an empty ``bytes`` in its slot
    rather than shifting every later answer up by one.

    Same guards as every other path: a rejected port or address never opens a
    socket, and replies are bounded.
    """
    validate_printer_port(port)
    address = await resolve_printer_host(host)

    replies: List[bytes] = []
    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(address, port), timeout=CONNECT_TIMEOUT_SECONDS
        )
        # One deadline for the whole exchange, for the same reason as above: a
        # per-read budget multiplies by the number of questions asked.
        #
        # Each read is then capped at an equal share of what is left. Without
        # that cap a printer that implements some real-time queries and ignores
        # others spends the entire budget waiting on the first silent one, and
        # every later question comes back empty — so adding a query nothing
        # answers would silently disable the ones that worked before it.
        deadline = time.monotonic() + timeout
        for index, payload in enumerate(exchanges):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                replies.append(b"")
                continue
            writer.write(payload)
            await asyncio.wait_for(writer.drain(), timeout=remaining)
            share = (deadline - time.monotonic()) / (len(exchanges) - index)
            try:
                chunk = await asyncio.wait_for(
                    reader.read(min(read_bytes, MAX_STATUS_BYTES)),
                    timeout=max(0.001, share),
                )
            except asyncio.TimeoutError:
                chunk = b""
            replies.append(chunk)
    except asyncio.TimeoutError:
        raise PrinterUnreachableError(
            f"Timed out querying the printer at {host}:{port}."
        )
    except OSError as exc:
        logger.warning(f"Label printer query failed for {host}:{port}: {exc}")
        raise PrinterUnreachableError(
            f"Could not connect to the printer at {host}:{port}."
        )
    finally:
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(
                    writer.wait_closed(), timeout=STATUS_TIMEOUT_SECONDS
                )
            except (asyncio.TimeoutError, OSError):
                pass

    return replies
