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
8. **Keep ink inside the print-safe area.** See "Printing" below; a test
   enforces it for every document.

## Printing

Departments print on whatever laser, copier or inkjet the station has,
usually from a browser or Acrobat print dialog, and file the result in
binders. `app/utils/print_geometry.py` holds the numbers. They were set on
2026-11-09 (owner decisions: three-hole-punch margin on every document, US
Letter only, no duplex hint).

| Edge                              | Ink may start          | Why                                                                                           |
| --------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| Left (binding) of a portrait page | 0.75" (`BINDING_EDGE`) | three-hole-punch holes reach about 0.65" in from the edge                                     |
| Top of a landscape page           | 0.75"                  | a landscape page goes into a portrait binder with its top at the rings                        |
| Every other edge                  | 0.5" (`SAFE_EDGE`)     | lasers leave about 0.17–0.2" unprinted, many inkjets 0.25" or more, and A4 crops 0.12" a side |

- **Margins are measured to the ink, not to the frame.** A platypus frame
  adds 6pt of padding inside the document margin, so a margin is set 6pt
  short of the edge it protects. Anything drawn straight onto the canvas —
  every page footer — is placed against the edge itself.
- **Footers sit just above the safe edge.** The lowest baseline is
  `SAFE_EDGE` plus a few points, so descenders clear it, and the bottom
  margin leaves room for the footer's lines above it. Until 2026-11-09 the
  report kit's footer printed about 0.25" from the bottom and the election
  documents' about 0.3", inside many printers' unprintable band.
- **A footer line is clipped by measured width, never by character count.**
  The minutes footer cut its notice at 160 characters, which at 7pt is about
  8" and runs off the page.
- **A table is never wider than its frame.** The impact plan's member table
  was 7.5" wide with every column shown, in a 7.33" frame. Its columns now
  shrink together to fit.
- **Documents leave scaling to the viewer.** A page shrunk to 97% by "Fit"
  is still readable.
- **Label sheets and ID cards ask to print at actual size**
  (`print_at_actual_size`, `/PrintScaling /None`). A sheet shrunk to 97% puts
  every label off its die-cut position. Acrobat honours the hint, but browser
  PDF viewers mostly do not, so the label pages also tell the user to set
  Scale to 100%. `/PickTrayByPDFSize` is not set, because ReportLab's
  checked viewer-preference dictionary rejects that key.
- **Avery 5160 is laid out on Avery's published template**: 2.625" × 1"
  labels, a 2.75" column pitch (0.125" gutter), 0.1875" side margins and
  0.5" top margin. The server PDF (`SHEET_*` in `label_renderer.py`) and the
  browser print pages (`AVERY_5160_*` in `components/labels/labelPresets.ts`)
  share those numbers. Until 2026-11-09 the PDF laid the columns edge to edge
  and the browser pages used equal flexible columns with a 2px gap, so the
  outer columns printed up to 1/8" off their labels, and the browser's row gap
  accumulated to about 0.19" by the last row.

`tests/test_pdf_print_safety.py` renders every document generator and checks
that each text run's measured extent stays inside these edges. It also checks
that labels and cards carry the actual-size hint and that every 5160 label's
text lands inside its own label. A new generator belongs in its `DOCUMENTS`
table.

## Fonts

Documents print in **Noto Sans**, embedded. Before 2026-11-10 they used
ReportLab's built-in Helvetica, which is never embedded and covers Latin-1
only, so a member named Łukasz, Nguyễn or Ольга printed as empty boxes.

- The four faces (regular, bold, italic, bold italic) are in
  `backend/app/assets/fonts/`, with the SIL Open Font License and a README
  giving their source and checksums. They are the Noto project's static
  TrueType builds; ReportLab embeds only the glyphs a document uses.
- They cover Latin (including Vietnamese), Greek and Cyrillic.
- `app/utils/pdf_fonts.py` registers them as `LogbookSans` (with a family, so
  `<b>` and `<i>` in a Paragraph resolve) and fails at import, naming the
  file, if one is missing.
- **ReportLab falls back to Helvetica in three places a document never names
  a font:** the sample stylesheet, plain-string table cells, and the canvas's
  initial font. Use `document_stylesheet()` instead of
  `getSampleStyleSheet()`, `body_table_style(...)` instead of
  `TableStyle(...)`, and pass `initialFontName=BODY_FONT` to every doc
  template. `tests/test_pdf_fonts.py` fails on any unembedded font in any
  document generator.
- Label sheets and ID cards stay on Helvetica (owner decision, 2026-11-09):
  their text is fitted to die-cut stock and thermal printer dots.

## Archival records (PDF/A)

Certified election results, finalized evaluations and meeting minutes are
written as **PDF/A-2b** (ISO 19005-2, level B), the archival profile:
`app/utils/pdfa.to_pdfa()` rewrites the rendered file with pypdf to add what
PDF/A requires beyond embedded fonts:

- an **sRGB output intent**, from a profile Pillow's littleCMS generates, so
  no ICC file is committed;
- **XMP metadata**, uncompressed, declaring part 2 / conformance B and
  agreeing with the information dictionary's title, author, producer and
  dates;
- the **Print flag on every annotation** (ReportLab writes the links in
  rich-text minutes without one).

A minutes PDF that **appends attachment PDFs** is left as it was, with no
PDF/A claim: pages from outside cannot be vouched for (owner decision,
2026-11-09). Minutes whose attachments are images, or listed by name only,
are PDF/A. Evaluations already stored keep the file they were frozen with;
each new revision is PDF/A.

**Verification.** veraPDF 1.28 passed the certified results (with a
transparent logo), an evaluation, and minutes with a link and an embedded
image on 2026-11-10. CI does not run veraPDF; `tests/test_pdfa.py` asserts the
structure it checked. To run it locally, resolve the
`org.verapdf.apps:greenfield-apps` jars from Maven Central and run
`java -cp "lib/*" org.verapdf.apps.GreenfieldCliWrapper --flavour 2b FILE.pdf`.

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
- **Scripts Noto Sans does not cover.** CJK, Arabic, Hebrew and emoji
  print as empty boxes. Noto Sans CJK is CFF-based, and ReportLab embeds only
  TrueType outlines.
- **Label sheets and ID cards stay on Helvetica** (Latin-1 only, not
  embedded), by owner decision: their text is fitted to physical stock.
- **Minutes that append attachment PDFs are not PDF/A.** Pages from outside
  cannot be vouched for, so that file makes no claim.
- **Older layouts.** Minutes, the impact plan and the election documents keep
  their own layouts, and their page numbers are "Page N" rather than "of Y"
  (the ballot excepted).
- **Browser-printed reports.** The Reports page's "Print / PDF" prints an HTML
  table with no page numbers, no repeated header and no audit row.

## Roadmap (owner decisions of 2026-11-09)

- **Phase 3, fonts and archival records** — **done 2026-11-10**; see
  "Fonts" and "Archival records (PDF/A)" above.
- **Phase 4, Reports page.** Replace the browser print with a **server-side
  PDF** built on the kit and audited on the server, so every report has the
  same footer, numbering and trail on every browser.
