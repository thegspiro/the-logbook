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


if __name__ == "__main__":
    unittest.main()
