# Export Audit Report — PDF RTL + Excel (XLSX/CSV)

Date: 2026-09-07. Scope: full pipeline DB/API → export → PDF/XLSX.
Method: code inspection + empirical byte-level verification, including
REAL production PDFs generated from the live database via the real
authenticated routes (Producer `Jammaz ERP`, Amiri embedded/subset).
No code was changed for this audit (one temp owner account was created
for authenticated probing and deleted afterwards; production data untouched).

Related: `docs/pdf-export-audit.md`, `docs/pdf-export-refactor-plan.md`.

---

## 1. PDF root cause

### 1a. Original defects (fixed, verified gone)

- Pipeline A (document engine) fed raw logical Arabic to WinAnsi Helvetica:
  unencodable by design → `bvDbÆEbv2`-class mojibake. Fixed by routing all
  text through `lib/pdf` with embedded Amiri.
- Pipeline B (treasury) used a hand-rolled run-split+reverse instead of a
  bidi algorithm → mirrored parens, detached IDs, digit runs reversed on
  extraction. Replaced by real UBA (`bidi-js`, UAX #9 v13).

### 1b. Current implementation — verified correct at every checkable layer

| Layer | Check | Result |
|---|---|---|
| Storage | DB/API/fetchers | Canonical Unicode, no HTML (`<br>` appears nowhere in data or data builders; only `document/renderers/html.js:1411` presentation markup) |
| Pre-render text | `visual()` output codepoints, 12-case user matrix + 16-case corpus | All correct (RTL-read returns source; numbers/IDs/dates verbatim) |
| Bidi algorithm | `bidi-js` vs reference `python-bidi` | 16/16 identical |
| Shaping | `arabic-reshaper`, once, Arabic runs only | Presentation forms valid; Amiri Regular+Bold cover all 53 corpus chars, zero tofu |
| Font embedding | `pdffonts` on real PDFs | Amiri Regular+Bold CID TrueType Identity-H, emb+sub+uni = yes |
| Glyph outlines | fontTools subset-vs-full comparison, ~94 Arabic mappings | 0 emptied; 3 rare-glyph bbox diffs (FEDF/FEE0 bold, U+2014 regular) — isolated, not systemic |
| Fragment positions | content-stream Tm coordinates | RTL column order, header-right, totals/footer placed |
| Code path | real route PDFs | Producer `Jammaz ERP` = new layer; process serves pushed HEAD (tree clean, identical hashes) |

### 1c. Verdict on hypotheses A–I

- A (stored incorrectly): NO. B (reversal before render): visual order is
  REQUIRED by pdfkit (it implements zero bidi/shaping) — proven necessary,
  single choke point, no global ad-hoc `reverse()`. C (wrong Bidi algo): NO,
  real UBA, cross-validated. D (library can't do Arabic): pdfkit is capable
  once fed embedded font + ordered shaped glyphs (proven by embedding +
  outline checks). E (incompatible font): NO, Amiri valid. F (double RTL):
  NO — isolate-leak test, single shaping pass. G (no shaping): NO. H (bad
  HTML conversion): NO HTML conversion anywhere in PDF path. I: remaining
  gap is downstream of the bytes (see §5).

## 2. Excel root cause

There is NO xlsx generator and NO splitting logic anywhere in the repo:

- `grep` for excel/xlsx/sheetjs/exceljs/workbook: zero implementation hits
  (only `OUTPUT_FORMATS.XLSX` enum values that return 501, plus tests).
- `.split()` in export code: only `ExportButton.jsx:88` (CSV empty-line
  detection) and `lib/pdf/text.js:70` (paragraph split). No `split("|")`,
  no regex column extraction, no Markdown/HTML table parsing.
- CSV (the format Excel actually receives — UI toast even calls it Excel):
  BE `TO_CSV` + FE `escapeCsvCell` both quote `,"`\n\r correctly, both emit
  UTF-8 BOM. Verified sound.
- `<br>` as data: impossible from current code — no builder emits it.

Conclusion: the described Excel symptoms (split columns, literal `<br>`)
match NO existing code path. Plausible external causes, in order: (1) CSV
opened with mismatched locale/delimiter settings, (2) HTML-table
copy/paste into Excel (cells split per `<td>`, `html.js:1411 <br/>`
becomes in-cell breaks), (3) a flow outside this repo. A sample file is
required to close this (see §11). There is no Excel bug to fix in code
today; §7 proposes the real `.xlsx` exporter if wanted.

## 3. Exact files / functions responsible

PDF path: `Jammaz-System/.../DocumentActions.jsx` → `documentService.exportDocument`
→ `routes/documentRoutes.js` → `DocumentController.export` (`document/index.js`)
→ fetchers (`document/fetchers/*.js`) → `renderPdf` (`document/renderers/pdf.js`)
→ `lib/pdf/{fonts,text,layout}.js` (BE `7deb17f`+`9c8a243`).
Treasury PDF: `ExportButton.jsx` → `POST /api/export` (`routes/exportRoutes.js`)
→ `ExportService.export` (`services/exportService.js`) → `buildTreasuryPdf`
(`services/treasuryPdfExport.js`) → `lib/pdf`.
CSV: same entry points, `TO_CSV` / `buildCsv`+`escapeCsvCell`, BOM both sides.
Data builders (descriptions): `services/treasuryService.js:83,117,136,153,223,252`
— plain template strings (`#`, `(العميل: …)`, `-`), no HTML.

## 4. Current data flow

```
DB (canonical Unicode, e.g. customer "ahmed seera", product "اهرام")
→ fetcher/service map (1 record → 1 field set; verified live:
  PO-000002 date "06 سبتمبر 2026", supplier "goold")
→ PDF: lib/pdf visual() [UBA + shape once + isolate money/id/date
  + guard uncovered] → Amiri pdfkit (visual order, embedded subset)
→ CSV: TO_CSV/escapeCsvCell quoting + BOM → Excel opens natively
→ XLSX: DOES NOT EXIST (501)
```

Domain values are never mutated for presentation; PDF transforms live only
in `lib/pdf/text.js`.

## 5. Why the previous fix still appears broken (ranked, falsifiable)

- H1 — bidi-applying consumer: visual-order PDFs are correct in compliant
  viewers, but any consumer that re-applies bidi (copy/paste into chat apps,
  some terminal/extraction tooling — DEMONSTRATED: this shell, pdftotext
  and pypdf-display all "re-reverse" the text) shows reversed Arabic.
  Falsify: open the PDF in Acrobat/Chrome/Foxit and read on-screen.
- H2 — stale file: pre-fix downloads render old bytes. Falsify: check
  Producer is exactly `Jammaz ERP` (old document engine wrote
  `Jammaz ERP — Document Engine`) and CreationDate is current.
- H3 — unseen viewer quirk: needs the failing file + viewer name (§11).

Deliberately NOT done: another reversal/shaping workaround — Part 1
forbids unproven transformations, and every checkable layer passes.

## 6. Recommended architecture (unchanged, to preserve)

1. Domain data (canonical Unicode, untouched). 2. Export normalization
(existing `map` functions + `fmt*` formatters). 3. PDF presentation
(`lib/pdf` only; renderers map data→logical strings+roles). 4. XLSX
presentation (new, §7). One PDF system only — no second pipeline.

## 7. Required changes

- PDF rendering: NONE until H1–H3 is closed with a failing file (§11).
  Proven-correct bytes must not be re-patched blind.
- Non-PDF, safe now: `infoGrid` label/value order is LTR (reads
  value-before-label); swap to label-right/value-left for RTL convention.
- Excel: implement a REAL `.xlsx` exporter ONLY if confirmed wanted —
  canonical schema below (Part 3), one row per record (Part 6), numbers as
  numbers, ISO dates as dates, RTL sheet where supported, Arabic never
  reversed (Part 5); HTML markup normalized to line-break/empty (Part 4).
  No new heavy dep required (zip+cached-string XML writer suffices).
- Canonical treasury schema (from `exportService.js` MODULES — the actual
  model, not the example): التاريخ(date) النوع(type) الطريقة(method)
  المبلغ(amount, numeric) الوصف(description, ONE cell — today's value e.g.
  "تحصيل دفعة من الرصيد الإجمالي للعميل: ahmed seera" stays whole)
  رقم الإيصال(receiptNumber) رقم التحويل(sourceNumber, privileged roles
  only). Same 1:1 discipline for customers/suppliers/products/invoices/
  purchaseOrders column sets in `MODULES`.

## 8. Risks

- "Fixing" PDF bytes without viewer evidence re-breaks compliant viewers.
- The 3 subset bbox diffs (FEDF/FEE0/U+2014) deserve one follow-up look but
  affect rare glyphs only.
- Building xlsx adds a new format to maintain; keep it a thin projection
  of `MODULES` maps, never a second data model.

## 9. Regression risks

- Any change to `lib/pdf/text.js` must re-run `lib/pdf/text.test.js`
  (16 cross-validated cases + ID-verbatim + isolate-leak + newline locks),
  `document/renderers/pdf.test.js` (incl. stream-verbatim `INV-2041`,
  `PO-100`, `RC-7`), treasury coherence + sprint8-export suites.
- CSV quoting/BOM and role-gated `sourceNumber` must stay intact.

## 10. Test plan / matrix results

All 12 user matrix cases verified at codepoint level through `visual()`:
مبيعات / العميل: ahmed seera / العميل: 12345 / Invoice فاتورة /
#INV-000010 / REC-1014 / 126400 جنيه / 2026-09-06 /
(العميل: ahmed seera) / long description / فاتورة بيع #INV-000010 /
المبلغ: 126400 جنيه — every case RTL-reads back to source with IDs,
numbers, dates, parens, `%`, `#` intact. Live-route PDFs additionally
verified: `PO-000002`, `INV-000011`, `REC-1012/1013/1014`, `1,305,000`,
`126,400`, `2026-09-06` all byte-verbatim in stream. XLSX matrix is
pending (no exporter); CSV equivalence holds by quoting+BOM tests.

## 11. Evidence required to proceed

1. One CURRENT failing PDF (check Producer/CreationDate first per §5).
2. Viewer/app name + whether the breakage is on-screen vs copy/paste.
3. Excel: source button + file extension + sample file (to distinguish
   locale-CSV vs paste-flow vs unknown).
