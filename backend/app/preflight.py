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
        "--as",
        dest="as_environment",
        metavar="ENVIRONMENT",
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

    if would_block_startup(criticals, settings):
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


if __name__ == "__main__":
    sys.exit(main())
