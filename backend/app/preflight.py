"""Check the configuration this deployment would boot with, without booting.

Run before restarting, so a configuration that cannot start is discovered
while the current container is still serving rather than after it has been
replaced:

    docker compose run --rm backend python -m app.preflight

Every blocking check is gated on ENVIRONMENT being production or staging, so
a run in development reports nothing no matter how broken the production
configuration is. Pass --as to evaluate the same values under another
environment and get an answer that means something before the deploy:

    docker compose run --rm backend python -m app.preflight --as production

Exit status is the answer: 0 means this configuration starts, 1 means it does
not, 2 means the settings could not even be constructed (a malformed value,
which otherwise surfaces as a pydantic traceback during startup).
"""

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.preflight",
        description="Report whether this configuration can start, without starting it.",
    )
    parser.add_argument(
        "--compose",
        metavar="PATH",
        help=(
            "Also check a compose file for settings it cannot pass through. "
            "A compose `environment:` block is a whitelist, so a name missing "
            "from it cannot be set from .env at all. Path is read from inside "
            "this container — bind-mount a host file to check it."
        ),
    )
    parser.add_argument(
        "--as",
        dest="as_environment",
        metavar="ENVIRONMENT",
        # Constrained deliberately: a typo like --as produciton would run no
        # blocking checks and still print "starts" with exit 0, certifying an
        # unchecked production configuration. argparse rejects it instead.
        choices=("development", "staging", "production"),
        help=(
            "Evaluate as this environment instead of the configured one. "
            "Blocking checks only run for production and staging, so use "
            "--as production to test a production configuration from elsewhere."
        ),
    )
    args = parser.parse_args(argv)

    try:
        from app.core.config import Settings

        overrides = {"ENVIRONMENT": args.as_environment} if args.as_environment else {}
        settings = Settings(**overrides)
    except Exception as exc:  # noqa: BLE001 - report, never re-raise as a crash
        print("CONFIGURATION ERROR — settings could not be loaded.")
        print(f"  {type(exc).__name__}: {exc}")
        print("")
        print("The application cannot start with this configuration. A value is")
        print("malformed — an empty string for a boolean is the usual cause.")
        return 2

    from app.core.startup_diagnostics import env_presence_report, would_block_startup

    warnings = settings.validate_security_config() + settings.validate_cors_config()
    criticals = [w for w in warnings if "CRITICAL" in w]
    advisories = [w for w in warnings if "CRITICAL" not in w]

    if args.as_environment:
        print(f"Environment: {settings.ENVIRONMENT}  (forced via --as)")
    else:
        print(f"Environment: {settings.ENVIRONMENT}")
    print("")

    if criticals:
        print(f"BLOCKING ({len(criticals)}):")
        for item in criticals:
            print(f"  - {item}")
        print("")

    if advisories:
        print(f"Advisory, does not prevent startup ({len(advisories)}):")
        for item in advisories:
            print(f"  - {item}")
        print("")

    if criticals:
        for line in env_presence_report(criticals, settings):
            print(line)
        print("")

    compose_gaps: list[str] = []
    if args.compose:
        compose_gaps = _report_compose(args.compose, settings)
        if compose_gaps is None:
            return 2

    unreadable_ca = _unreadable_ca_paths(settings)
    if unreadable_ca:
        print("TLS CERTIFICATE PATHS — unreadable inside this container:")
        for name, path, reason in unreadable_ca:
            print(f"  {name} = {path}")
            print(f"    {reason}")
        print("")
        print(
            "  These are opened during startup by ssl.create_default_context, "
            "which raises FileNotFoundError and aborts the boot. The path is "
            "resolved INSIDE the container: a host path reaches nothing here. "
            "Put the PEM in ./infrastructure/certs (mounted at "
            "/etc/ssl/logbook) and name the container path."
        )
        print("")

    if would_block_startup(criticals, settings) or unreadable_ca:
        print("RESULT: this configuration will NOT start. Fix the blocking items.")
        return 1

    if criticals:
        # Criticals exist but this environment does not gate on them. Say so
        # rather than printing a bare OK, or the same config reads as healthy
        # here and refuses to boot the moment it reaches staging/production.
        print(
            "RESULT: starts in this environment, but the blocking items above "
            f"WOULD stop it in production or staging (currently "
            f"{settings.ENVIRONMENT})."
        )
        return 0

    if compose_gaps:
        print(
            "RESULT: this configuration starts, but the compose file cannot "
            "pass through every setting that could block a future upgrade."
        )
        return 0

    print("RESULT: this configuration starts.")
    if settings.ENVIRONMENT not in ("production", "staging"):
        # Silence here is not evidence: every blocking check is gated on the
        # environment, so a clean development run says nothing at all about
        # what production will do with the same values.
        print("")
        print(
            f"NOTE: no blocking checks run for '{settings.ENVIRONMENT}' — they "
            "apply only to production and staging. To test a production "
            "configuration, re-run with: --as production"
        )
    return 0


def _report_compose(path: str, settings) -> "list[str] | None":
    """Report settings a compose file cannot pass through. None on read error."""
    from app.core.startup_diagnostics import (
        boot_blocking_setting_names,
        missing_from_compose,
    )

    try:
        text = open(path, encoding="utf-8").read()
    except OSError as exc:
        print(f"COMPOSE FILE UNREADABLE: {path}")
        print(f"  {type(exc).__name__}: {exc}")
        print("")
        print("The path is read from inside this container. To check a file on")
        print("the host, bind-mount it:")
        print("  docker run --rm -v /host/compose.yaml:/tmp/compose.yaml:ro \\")
        print("    <image> python -m app.preflight --compose /tmp/compose.yaml")
        return None

    names = boot_blocking_setting_names(settings)
    missing = missing_from_compose(text, names)

    print(f"COMPOSE PASSTHROUGH CHECK — {path}")
    if not missing:
        print(f"  All {len(names)} settings that can block a boot are present.")
        print("")
        return []

    print(
        f"  {len(missing)} of {len(names)} settings that can block a boot are "
        "absent from this file:"
    )
    for name in missing:
        print(f"    {name}")
    print("")
    print(
        "  These cannot be set from .env while absent — a compose "
        "`environment:` block is a whitelist. They are not a problem today; "
        "they become one the moment an upgrade starts gating on one of them, "
        "and the failure then looks like an unexplained crash loop."
    )
    print(
        "  Add them to the backend service's `environment:` block as "
        "NAME: ${NAME:-<default>}, keeping the application's own default."
    )
    print(
        "  Note: this checks the whole file, so a name attached to the wrong "
        "service still counts as present."
    )
    print("")
    return missing


def _unreadable_ca_paths(settings) -> list[tuple[str, str, str]]:
    """CA files a TLS-enabled configuration names but cannot open.

    These produce no critical, so without this check preflight exits 0 for a
    configuration whose startup dies in ssl.create_default_context — the
    documented "starts" would certify the failure.
    """
    problems: list[tuple[str, str, str]] = []
    for enabled_attr, path_attr in (
        ("DB_SSL", "DB_SSL_CA"),
        ("REDIS_SSL", "REDIS_SSL_CA"),
    ):
        if not getattr(settings, enabled_attr, False):
            continue
        path = getattr(settings, path_attr, "") or ""
        if not path:
            # Handled as its own critical (encrypted but unverified peer).
            continue
        try:
            with open(path, "rb"):
                pass
        except OSError as exc:
            problems.append((path_attr, path, f"{type(exc).__name__}: {exc}"))
    return problems


if __name__ == "__main__":
    sys.exit(main())
