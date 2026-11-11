# Bundled fonts

Embedded in generated PDF documents so they print every Latin (including
Vietnamese), Greek and Cyrillic name, and so record documents can conform to
PDF/A, which requires every font to be embedded. Registered by
`app/utils/pdf_fonts.py`.

| File                      | Face                  |
| ------------------------- | --------------------- |
| `NotoSans-Regular.ttf`    | Noto Sans             |
| `NotoSans-Bold.ttf`       | Noto Sans Bold        |
| `NotoSans-Italic.ttf`     | Noto Sans Italic      |
| `NotoSans-BoldItalic.ttf` | Noto Sans Bold Italic |

- **Source:** the Noto project's static, hinted TrueType builds,
  `https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSans/hinted/ttf`,
  fetched 2026-11-10.
- **Licence:** SIL Open Font License 1.1, in `OFL.txt` beside these files. The
  licence permits bundling and embedding; it requires the licence to travel
  with the fonts, which is why `OFL.txt` is here.
- **Coverage:** Latin, Greek and Cyrillic. Not CJK, Arabic, Hebrew or emoji;
  those characters print as empty boxes.
- **Why static files:** ReportLab embeds TrueType outlines only. The variable
  Noto Sans build and the CFF-based Noto Sans CJK cannot be embedded by it.

SHA-256 of the files as fetched:

```
478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823  NotoSans-Regular.ttf
1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913  NotoSans-Bold.ttf
467e3f89eeca4108bb8710a2b9e0cf2281ac56d5b0609211a83776d0505eecb5  NotoSans-Italic.ttf
1b602a9d6353be42c91df097a4857b69fa2696f26703d7a33b54a15d87c2622c  NotoSans-BoldItalic.ttf
```
