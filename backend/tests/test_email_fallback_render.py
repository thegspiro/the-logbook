"""
MAIL-1 (pass 2): the code-default fallback render path (_render_with_fallback,
reached when no DB template is loaded) must NOT HTML-escape the subject line or
the text/plain body — only the HTML body — matching the primary render() path.
Otherwise "O'Brien" mails as "O&#x27;Brien" and "Fire & Rescue" as
"Fire &amp; Rescue" in the Subject header and text alternative. DB-free.
"""

import pytest

from app.models.email_template import EmailTemplateType
from app.services.email_service import EmailService


class TestFallbackRenderEscaping:
    async def test_subject_and_text_not_escaped_html_is(self):
        svc = EmailService()  # no org / no db -> fallback path
        subject, html, text = await svc._render_with_fallback(
            list(EmailTemplateType)[0],
            {"member_name": "O'Brien", "dept": "Fire & Rescue"},
            default_subject="Notice for {{member_name}} - {{dept}}",
            default_html="<p>{{member_name}} - {{dept}}</p>",
            default_text="{{member_name}} at {{dept}}",
        )

        # Subject + text/plain: raw, not HTML-escaped.
        assert "O'Brien" in subject
        assert "Fire & Rescue" in subject
        assert "O'Brien" in text
        assert "Fire & Rescue" in text
        assert "&#x27;" not in subject
        assert "&amp;" not in subject

        # HTML body: still escaped (the XSS boundary is untouched).
        assert "O'Brien" not in html
        assert "&#x27;" in html or "&#39;" in html
        assert "Fire &amp; Rescue" in html


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
