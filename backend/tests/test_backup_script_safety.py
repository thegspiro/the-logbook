"""Static regression checks for backup restore safety invariants."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_restore_verifies_checksum_from_archive_directory() -> None:
    script = (ROOT / "scripts" / "backup.sh").read_text(encoding="utf-8")

    assert 'cd "$(dirname "$backup_file")"' in script
    assert 'sha256sum -c "$(basename "$backup_file").sha256"' in script


def test_restore_requires_one_top_level_archive_directory() -> None:
    script = (ROOT / "scripts" / "backup.sh").read_text(encoding="utf-8")

    assert '"${#extracted_dirs[@]}" -ne 1' in script
    assert 'BACKUP_EXTRACT_DIR="${extracted_dirs[0]}"' in script


def test_database_password_is_not_passed_on_command_line() -> None:
    script = (ROOT / "scripts" / "backup.sh").read_text(encoding="utf-8")

    assert '-p"${DB_PASSWORD}"' not in script
    assert 'MYSQL_PWD="${DB_PASSWORD}" mysqldump' in script
    assert 'MYSQL_PWD="${DB_PASSWORD}" mysql' in script


def test_environment_file_is_loaded_without_xargs_reparsing() -> None:
    script = (ROOT / "scripts" / "backup.sh").read_text(encoding="utf-8")

    assert "export $(grep" not in script
    assert 'source "$(dirname "$0")/../.env"' in script
