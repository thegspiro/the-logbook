"""The one confinement rule for attachment entries (no database).

``confined_attachment_path`` decides which JSON attachment entries name a file
the organization may serve or delete, so every refusal here is one an erasure
could otherwise turn into an arbitrary unlink.
"""

import os
import uuid
from unittest.mock import AsyncMock

import pytest

from app.services import file_storage_service, member_files
from app.services.file_storage_service import StorageArea
from app.services.member_files import (
    MemberFiles,
    confined_attachment_path,
    confined_attachment_paths,
)

pytestmark = pytest.mark.unit

ORG = str(uuid.uuid4())
SELF = StorageArea.SELF_REPORTS


@pytest.fixture
def root(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
    return uploads


def _file(directory):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(b"%PDF-1.4")
    return path


def _entry(path):
    return {"file_name": "cert.pdf", "file_path": str(path)}


class TestConfinedAttachmentPath:
    def test_accepts_the_current_layout(self, root):
        path = _file(root / ORG / "self-reports" / "sub")
        assert confined_attachment_path(_entry(path), ORG, SELF) == str(path)

    def test_accepts_the_legacy_layout(self, root):
        legacy = root / "training_attachments" / "self_reported_submissions" / ORG
        path = _file(legacy)
        assert confined_attachment_path(_entry(path), ORG, SELF) == str(path)

    def test_accepts_only_the_areas_asked_for(self, root):
        path = _file(root / ORG / "training-records" / "rec")
        assert confined_attachment_path(_entry(path), ORG, SELF) is None
        assert confined_attachment_path(
            _entry(path), ORG, SELF, StorageArea.TRAINING_RECORDS
        ) == str(path)

    @pytest.mark.parametrize(
        "attachment", [None, "cert.pdf", 42, ["x"], {"file_name": "no path"}]
    )
    def test_refuses_anything_but_a_dict_with_a_path(self, root, attachment):
        assert confined_attachment_path(attachment, ORG, SELF) is None

    def test_refuses_a_bare_string_naming_a_real_file(self, root):
        path = _file(root / ORG / "self-reports" / "sub")
        assert confined_attachment_path(str(path), ORG, SELF) is None

    def test_refuses_traversal(self, root):
        _file(root / "secret")
        dotted = os.path.join(str(root), ORG, "self-reports", "..", "..", "secret")
        assert confined_attachment_path({"file_path": dotted}, ORG, SELF) is None
        assert confined_attachment_path({"file_path": ".."}, ORG, SELF) is None

    def test_refuses_another_organizations_directory(self, root):
        path = _file(root / str(uuid.uuid4()) / "self-reports" / "sub")
        assert confined_attachment_path(_entry(path), ORG, SELF) is None

    def test_refuses_a_symlink_out_of_the_area(self, root, tmp_path):
        target = _file(tmp_path / "elsewhere")
        link_dir = root / ORG / "self-reports" / "sub"
        link_dir.mkdir(parents=True)
        link = link_dir / "link.pdf"
        link.symlink_to(target)
        assert confined_attachment_path(_entry(link), ORG, SELF) is None

    def test_refuses_a_path_outside_the_uploads_root(self, root, tmp_path):
        path = _file(tmp_path / "outside")
        assert confined_attachment_path(_entry(path), ORG, SELF) is None

    def test_refuses_a_missing_organization(self, root):
        path = _file(root / ORG / "self-reports" / "sub")
        assert confined_attachment_path(_entry(path), None, SELF) is None


class TestConfinedAttachmentPaths:
    def test_keeps_only_the_confined_entries(self, root, tmp_path):
        own = _file(root / ORG / "self-reports" / "sub")
        foreign = _file(root / str(uuid.uuid4()) / "self-reports" / "sub")
        attachments = [_entry(own), "legacy", None, _entry(foreign)]
        assert confined_attachment_paths(attachments, ORG, SELF) == [str(own)]

    @pytest.mark.parametrize("attachments", [None, {}, "x", 7])
    def test_a_column_that_is_not_a_list_names_nothing(self, attachments):
        assert confined_attachment_paths(attachments, ORG, SELF) == []


class TestMemberFiles:
    def test_a_file_named_twice_counts_once(self):
        files = MemberFiles(
            submission_ids=["s1"],
            record_ids=["r1"],
            submission_paths={"/a"},
            record_self_report_paths={"/a"},
            record_own_paths={"/b"},
            waiver_paths={"/c"},
        )
        assert files.self_report_paths == {"/a"}
        assert files.all_paths == {"/a", "/b", "/c"}
        assert files.own_rows == {
            ("training_submissions", "s1"),
            ("training_records", "r1"),
        }


class TestRemoveUnreferencedFiles:
    """The one post-commit removal: delete what nothing else names, and
    nothing at all when that cannot be answered."""

    async def test_deletes_only_what_no_other_row_names(self, root, monkeypatch):
        alone = _file(root / ORG / "self-reports" / "a")
        shared = _file(root / ORG / "self-reports" / "b")
        monkeypatch.setattr(
            member_files, "referenced_elsewhere", AsyncMock(return_value={str(shared)})
        )

        result = await member_files.remove_unreferenced_files(
            None, ORG, {str(alone), str(shared)}, subject_id="sub-1"
        )

        assert not alone.exists()
        assert shared.exists()
        assert result == member_files.FileRemoval(
            deleted=1, not_deleted=0, shared_kept=1
        )

    async def test_an_unanswerable_check_deletes_nothing(self, root, monkeypatch):
        first = _file(root / ORG / "self-reports" / "a")
        second = _file(root / ORG / "self-reports" / "b")
        monkeypatch.setattr(
            member_files,
            "referenced_elsewhere",
            AsyncMock(side_effect=RuntimeError("database went away")),
        )

        result = await member_files.remove_unreferenced_files(
            None, ORG, {str(first), str(second)}, subject_id="sub-1"
        )

        assert first.exists()
        assert second.exists()
        assert result == member_files.FileRemoval(not_deleted=2)

    async def test_no_paths_asks_nothing(self, monkeypatch):
        check = AsyncMock()
        monkeypatch.setattr(member_files, "referenced_elsewhere", check)

        result = await member_files.remove_unreferenced_files(
            None, ORG, set(), subject_id="sub-1"
        )

        assert result == member_files.FileRemoval()
        check.assert_not_awaited()
