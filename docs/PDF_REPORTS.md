# Generated PDFs and Reports

How The Logbook produces PDFs, the rules a new one must follow, and what is
still open. Written 2026-11-09, after a review of every server-rendered PDF
against current guidance on accessible (PDF/UA), archival (PDF/A) and
PHI-bearing documents.

## What produces a PDF

Everything is rendered on the server with **ReportLab** (`reportlab==5.1.0`),
with **pypdf** for appending attachments to minutes. Nothing converts HTML to
PDF, and the frontend has no PDF library: a browser "Print / PDF" button opens
the system print dialog.

| Document                                        | Renderer                                                   | Layout                            |
| ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| Ballot, certified results, pre-meeting package  | `app/utils/election_*_pdf.py`, `certified_*`               | `app/utils/election_pdf_style.py` |
| Member performance evaluation                   | `app/utils/evaluation_pdf.py`                              | `election_pdf_style.py`           |
| Meeting minutes (+ embedded attachments)        | `app/utils/minutes_pdf.py`                                 | its own                           |
| Training compliance, individual, member bundle  | `ReportExportService` in `training_enhancement_service.py` | **`app/utils/pdf_report_kit.py`** |
| Equipment-check compliance, failures, one check | `app/services/equipment_check_pdf.py`                      | **`pdf_report_kit.py`**           |
| Inventory impact plan                           | `app/utils/impact_plan_pdf.py`                             | its own                           |
| Labels, member ID cards                         | `label_renderer.py`, `id_card_renderer.py`                 | canvas, fixed stock sizes         |

## Rules for a PDF

These come from the review's findings. The first three are the ones that
broke production documents.

1. **A `Paragraph` parses markup; a bare table cell does not.** User text going
   into a `Paragraph` must be escaped, or a `<` crashes the build and an
   `<img src>` reaches the file system. Text going into a _bare string_ cell
   must **not** be escaped, or "O'Brien" prints as `O&#x27;Brien` — which is
   what the evaluation PDF did to finalized records until 2026-11-09. On the
   report kit, `cell()` and `num()` settle this: always an escaped
   `Paragraph`, and the kit's tables take nothing else.
2. **Never cut text to fit.** A column too narrow for a note or a course name
   wraps. The equipment reports cut notes at 40 or 60 characters, and the
   training reports cut course names at 25 characters and requirement names
   at 10.
3. **Never drop a column that does not fit.** A matrix wider than the page is
   printed in column bands (`column_bands()`), each repeating the identifying
   columns. Until 2026-11-09 the training compliance report silently left off
   every requirement past the right margin.
4. **Audit every export of member data.** `log_audit_event` with the report
   type, format, parameters and subject id, never the content, written after
   the file is generated so a rejected request records nothing. Caching is
   already handled: `SecurityHeadersMiddleware` sends `Cache-Control: no-store`
   on every `/api/` response.
5. **Times are the department's.** Format `generated_at` and every row date in
   the organization's time zone, with the zone named. The server clock is UTC.
6. **Render off the event loop.** Layout is CPU-bound. Load the data with the
   session, reduce it to plain values, then `asyncio.to_thread` the render. An
   ORM object must not lazy-load inside the thread.
7. **Name the file with `Content-Disposition: attachment`.** Quote static
   names, and RFC 5987-encode (`filename*=utf-8''…`) any name built from
   record text, as the minutes endpoint does.

## The report layout

`pdf_report_kit.render_report(meta, body)` gives every tabular report the same
frame. Laid out top to bottom:

1. **Letterhead**: department logo and name, report title.
2. **Parameter strip**: period, filters and scope, so a page read weeks later
   still says what it covers.
3. **Summary strip** (`kpi_strip`): three to five headline figures. Take these
   from the same computation the detail uses, never a second definition of
   the rule (CLAUDE.md Pitfall #29).
4. **Exceptions first**: rows needing action (deficient apparatus, failed
   items, unmet requirements) sort to the top or carry a pale band
   (`emphasis_rows`) and bold text, never colour alone, so they survive a
   black-and-white copier.
5. **Detail tables** (`data_table`): the header row repeats on every page,
   figures are right-aligned, and only light horizontal rules are drawn. Use
   `zebra=True` for long lists, where it helps a reader track a row.
6. **Footer on every page**: department and report, "Page X of Y",
   "Generated: <time and zone> by <member>", and a confidentiality notice. The
   document is laid out twice so the total is known.

The kit also sets the title, author, subject and language, tells viewers to
show the title rather than the file name, and turns `bookmark()` markers into
outline entries. The training bundle uses one per member.

## Not yet met

Recorded in `docs/KNOWN_LIMITATIONS.md` under "PDF Reports".

- **Tagged PDF / PDF/UA.** Open-source ReportLab does not produce a structure
  tree; automatic tagging is a commercial ReportLab feature. The kit sets
  what the open-source library can (title, language, outline, reading order
  follows the story), but a screen reader still gets untagged text.
- **Fonts and PDF/A.** Every PDF uses the built-in Helvetica family, which is
  not embedded and covers Latin-1 only, so a name in Cyrillic, Greek or CJK
  script does not render, and no PDF can conform to PDF/A.
- **Older layouts.** Minutes, the impact plan and the election documents keep
  their own layouts, and their page numbers are "Page N" rather than "of Y"
  (the ballot excepted).
- **Browser-printed reports.** The Reports page's "Print / PDF" prints an HTML
  table with no page numbers, no repeated header and no audit row.

## Roadmap (owner decisions of 2026-11-09)

- **Phase 3, fonts and archival records.** Bundle **Noto Sans** (SIL Open
  Font License) and register it in the kit. This gives full Unicode and
  embedded fonts. Then add XMP metadata and an ICC output intent so minutes,
  certified results and evaluations can conform to PDF/A, verified with
  veraPDF.
- **Phase 4, Reports page.** Replace the browser print with a **server-side
  PDF** built on the kit and audited on the server, so every report has the
  same footer, numbering and trail on every browser.
