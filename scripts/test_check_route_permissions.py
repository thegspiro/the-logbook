import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_route_permissions


class CollectRoutesTests(unittest.TestCase):
    def test_wildcard_redirect_delimits_preceding_absolute_route(self) -> None:
        source = """
            <Route path="/finance/approvals/:token" element={<FinanceApprovalPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        """
        with tempfile.TemporaryDirectory() as directory:
            route_file = Path(directory) / "routes.tsx"
            route_file.write_text(source)
            with (
                patch.object(check_route_permissions, "REPO_ROOT", Path(directory)),
                patch.object(check_route_permissions, "ROUTE_FILES", ["routes.tsx"]),
            ):
                routes, redirects = check_route_permissions.collect_routes()

        assert "/finance/approvals/:x" in routes
        assert "/finance/approvals/:x" not in redirects


class SpreadPermissionListTests(unittest.TestCase):
    """A spread of a named list must resolve, never score as empty.

    An empty gate reads as "authenticated only", so the checker would report a
    gated page as open and then demand APPLICATION_PAGES.md agree -- the exact
    error it exists to catch.
    """

    # The const sits at column 0 because CONST_ARRAY_RE anchors there, which is
    # where a module-level declaration lives in a real route file.
    SOURCE = """
export const ENTRY = ['facilities.view', 'facilities.manage'] as const;
<Route
  path="/facilities"
  element={
    <ProtectedRoute requiredAnyPermission={[...ENTRY]}>
      <FacilitiesDashboard />
    </ProtectedRoute>
  }
/>
"""

    def _collect(self, source: str):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "routes.tsx").write_text(source)
            with (
                patch.object(check_route_permissions, "REPO_ROOT", Path(directory)),
                patch.object(check_route_permissions, "ROUTE_FILES", ["routes.tsx"]),
            ):
                return check_route_permissions.collect_routes()

    def test_a_spread_constant_resolves_to_its_permissions(self) -> None:
        routes, _ = self._collect(self.SOURCE)
        assert routes["/facilities"][0] == {"facilities.view", "facilities.manage"}

    def test_a_spread_of_an_unknown_name_is_refused(self) -> None:
        source = self.SOURCE.replace("[...ENTRY]", "[...SOMEWHERE_ELSE]")
        try:
            self._collect(source)
        except SystemExit:
            return
        raise AssertionError("an unresolvable spread must not score as empty")

    def test_inline_tokens_beside_a_spread_are_both_kept(self) -> None:
        source = self.SOURCE.replace("[...ENTRY]", "[...ENTRY, 'locations.manage']")
        routes, _ = self._collect(source)
        assert routes["/facilities"][0] == {
            "facilities.view",
            "facilities.manage",
            "locations.manage",
        }


if __name__ == "__main__":
    unittest.main()
