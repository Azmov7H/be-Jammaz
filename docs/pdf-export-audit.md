# PDF / Arabic-RTL Export Audit — Jammaz System

Status: **AUDIT ONLY — no code changed.** All findings below were verified
empirically (test PDFs generated from the real code paths and inspected with
`pdftotext`, plus font-coverage probes with `fontkit`). Probe script was
temporary and has been removed; nothing in business logic, accounting,
schemas, or report designs was touched.

---

## 1. Current PDF architecture

There are **two independent server-side PDF pipelines** (both Node, both
`pdfkit@0.20.2`), plus thin frontend download glue. No PDF is ever rendered
in the browser except via the OS print dialog (which is correct).

```
UI (Next.js)
 ├─ DocumentActions.jsx ──GET /api/documents/:type/:id/export?format=pdf──┐
 ├─ ExportButton.jsx ─────POST /api/export {type, format:'pdf'} ──────────┤
 └─ Print buttons ──────── browser print of HTML ── CORRECT (not in scope)│
                                                                          ▼
BACKEND (Express)                                                  pdfkit 0.20.2
 ├─ PIPELINE A — document engine                                   document/renderers/pdf.js
 │    route:  routes/documentRoutes.js → DocumentController.export (document/index.js)
 │    data:   document/fetchers/*.js  (per-type DocumentData, sound)
 │    font:   Helvetica / Helvetica-Bold (PDF base14, WinAnsi)
 │    shaping/bidi: NONE — raw logical-order Arabic strings
 │    layout: hand-drawn, LTR column order
 │
 └─ PIPELINE B — treasury / export                                 services/arabicPdf.js
      route:  routes/exportRoutes.js → ExportService.export (services/exportService.js)
      data:   MODULES.treasuryTransactions query+map (sound)
      font:   Amiri-Regular / Amiri-Bold, embedded from assets/fonts/*.ttf
      shaping: arabic-reshaper (presentation forms)
      bidi:   hand-rolled run-split + reverse (shapeArabic, ~20 lines)
      layout: hand-drawn, manual right-to-left columns (treasuryPdfExport.js)
```

Related paths that are **healthy** and out of scope: HTML preview and print
renderers (`document/renderers/html.js`, `print.js` — the browser owns
shaping/bidi and gets it right), CSV export on both sides (both emit UTF-8
BOM: `services/exportService.js:299`, FE `src/lib/exportCsv.js:17`).

Dead weight found: `jspdf` + `jspdf-autotable` are FE dependencies with
**zero** references anywhere in `src/` or `public/` — a second client-side
PDF stack that was never wired up. It must not become a third pipeline.

---

## 2. Exact root cause

**Single shared root cause: there is no centralized Unicode text pipeline.
`pdfkit` performs no Arabic shaping and no bidi reordering, so every report
must supply (a) an embedded Arabic-capable font and (b) correctly ordered,
shaped glyphs — and each of the two pipelines fails a different half:**

- **Pipeline A fails (a) completely.** WinAnsi-encoded base14 Helvetica has
  no Arabic codepoints at all. Every Arabic string is misencoded at the byte
  level (verified: `فاتورة مشتريات` → `d'b¦Hc) dV4b¦1d¦'b`-class output;
  `ج.م` → `bÂæE`). This is the source of the `bvDbÆEbv2 / bÂæE / bvDd…`
  corruption samples in the attached PDFs. No font embedding, no shaping,
  no bidi, LTR column order on top.

- **Pipeline B passes (a) but fails (b).** `shapeArabic` is not a bidi
  algorithm: it classifies neutrals (space, `( )`, `%`, `:`, `•`, `←`, `-`)
  as LTR and glues them to whichever run they touch, then reverses run
  order and reverses characters inside RTL runs. Verified defects:
  - `(عاجل)` → parens mirrored to the wrong sides (`)… (` — wrong even
    visually, not just on copy/paste);
  - trailing IDs/dates detach: `…أحمد PO-100` glues `PO-100` mid-string;
  - visual-order bytes are stored with no bidi isolates, so any
    standards-compliant reader (copy/paste, search, text extraction,
    some mobile viewers) re-applies bidi and produces `1,250.5` →
    `5.052,1` and `2026-09-01` → `60-90-6202`;
  - uncovered characters: `←` (U+2190, used in every treasury range
    header) has **no Amiri glyph** → `.notdef` tofu; `arabic-reshaper`
    emits presentation forms of which Amiri lacks 77 (Pres-A) + 4 (Pres-B)
    — rare letters, but any affected name renders tofu.

In short: **A never had a text stack; B hand-rolled a broken one.** Fixing
reports one by one would duplicate the same font/shaping/bidi/layout code
N times and leave the next report broken. The fix is one shared layer.

---

## 3. Affected files

| File | Role | Defect |
|---|---|---|
| `be-Jammaz/document/renderers/pdf.js` | Pipeline A: all document PDFs | Helvetica, no shaping, no bidi, LTR tables |
| `be-Jammaz/services/arabicPdf.js` | Pipeline B: font + `shapeArabic` + `createArabicDoc` | naive bidi; font registered but uncovered chars unhandled |
| `be-Jammaz/services/treasuryPdfExport.js` | Pipeline B: treasury table layout | feeds every string through broken `shapeArabic`; uses `←` separator |
| `be-Jammaz/services/exportService.js` | export entry (`format: csv/pdf`) | PDF branch reachable only via B; nothing wrong with data mapping |
| `be-Jammaz/document/index.js`, `routes/documentRoutes.js` | document export entry | wiring sound; serves whatever the renderer produces |
| `be-Jammaz/assets/fonts/Amiri-*.ttf` | vendored font | valid (see §5) but missing `←`; no fail-closed loading |
| `Jammaz-System/src/components/documents/DocumentActions.jsx` | UI → document PDF download | thin blob download; sound |
| `Jammaz-System/src/components/common/ExportButton.jsx` | UI → treasury PDF download | thin blob download; sound |
| `Jammaz-System/package.json` | declares `jspdf`, `jspdf-autotable` | dead deps, removal candidate |

Explicitly **not** affected: fetchers, `ExportService` queries/maps,
`treasuryService`, accounting/GL, CSV paths, HTML/print renderers.

---

## 4. Affected reports

| Report | Pipeline | Symptom |
|---|---|---|
| Sale invoice PDF (`SALE_INVOICE`) | A | full Arabic mojibake |
| Purchase invoice PDF (`PURCHASE_INVOICE`) | A | full Arabic mojibake |
| Customer collection receipt PDF | A | full Arabic mojibake |
| Customer account statement PDF | A | full Arabic mojibake |
| Any future document type via `renderPdf` | A | broken by construction |
| Treasury movement PDF (`POST /api/export` pdf) | B | approximately readable; wrong parens/IDs/dates; broken copy-paste; tofu `←` |
| Browser print / HTML preview (all) | — | correct, untouched |
| CSV exports (all) | — | correct (BOM), untouched |

---

## 5. Font analysis

- **Amiri (vendored, OFL naskh) is valid and sufficient — keep it.**
  `fontkit` coverage probe: Arabic block ~full (255/256), Arabic Supplement
  full, Arabic-Indic digits full, Latin full, parens/bullet full; critical
  ligatures verified present (`FEFB/FEFC` lam-alef, `FDF2` Allah, teh-marbuta
  and lam/meem initials). `pdfkit` subsets and embeds it as Identity-H with
  a ToUnicode CMap (proven: pipeline-B text extracts as real characters).
- **Gaps to handle centrally, not per report:** U+2190 `←` absent (replace
  with `–`/`إلى` or draw a vector rule); 77 Pres-A + 4 Pres-B forms absent
  (rare/regional letters — central layer must detect `.notdef` fallback and
  either substitute or log, never silently print tofu).
- **Helvetica/base14 must never receive non-Latin text again.** Central layer
  rule: any string matching the RTL regex is routed to Amiri; Latin-only
  strings (IDs, ISO dates, amounts) may stay on either font but must keep
  logical order.
- **Font loading is not the problem.** `COPY . .` ships `assets/` into the
  Alpine image; `path.join(__dirname,…)` resolves under `USER appuser`;
  no system fonts needed since the font is embedded per-PDF. The central
  layer should still load fonts once at boot and fail closed (throw, don't
  fall back to Helvetica).

---

## 6. Unicode/encoding analysis

- PDFs are binary-safe end to end (`Buffer` from `docToBuffer`, `res.send`
  with `application/pdf`; FE consumes `Blob`). No UTF-8/Latin-1 transcoding
  bug exists in transport — corruption happens at glyph-encoding time.
- Pipeline A encodes Arabic codepoints through WinAnsi: unrepresentable by
  design. Fix is the font (§5), not transport encoding.
- Pipeline B is UTF-8-clean but stores **visual order**; PDF text semantics
  assume logical order + ToUnicode, so extraction/search re-bidi into
  garbage. The central layer must either store logical order with explicit
  bidi isolates per run (preferred — keeps text extractable) or, if it
  stores visual order, accept permanently broken copy/paste. Recommendation:
  logical order + per-run directional placement (see plan).
- `arabic-reshaper` only substitutes presentation forms; it does not reorder
  and must run **once** per string on the Arabic runs only (double-shaping
  presentation forms is undefined behavior — centralize to prevent it).

---

## 7. RTL/Bidi analysis

`pdfkit` implements **zero** of UAX #9. All directionality must be computed
before drawing. The current `splitRuns().reverse()` implements none of the
required stages: no paragraph embedding levels, no weak-type resolution
(numbers stay LTR inside RTL text — W1–W7), no neutral resolution (spaces /
parens / `%` / `:` take surrounding levels — N1–N2), no bracket mirroring.
Consequences observed: mirrored parens, detached IDs, reversed digit runs
on extraction. The central layer needs a **real UBA implementation**
(decision in plan: adopt `bidi-js`-class library vs. headless Chromium;
default = library, pdfkit retained).

---

## 8. Arabic shaping analysis

Shaping (isolated/initial/medial/final + lam-alef ligatures) is mandatory
because PDF shows exactly the glyphs it is given. `arabic-reshaper@1.1.0`
does this correctly for the common ranges (verified output codepoints are
proper FE*/FB* presentation forms) and Amiri covers the forms that occur in
real data (critical ligatures verified). Keep reshaper; constrain it:
Arabic-script runs only, exactly once, inside the central text function.
(Alternative — rely on Amiri's OpenType GSUB — is unavailable: `pdfkit`/
`fontkit` do not process GSUB shaping, which is precisely why pre-shaping
is required.)

---

## 9. Recommended architecture

One centralized layer, e.g. `be-Jammaz/lib/pdf/` (naming TBD in plan),
owning **everything below the data mapping**:

```
report renderer (per type: sale/purchase/receipt/statement/treasury/…)
  │  passes LOGICAL-ORDER strings + semantic roles (title, cell, money, id…)
  ▼
lib/pdf/
  fonts.js   — load Amiri regular/bold once, fail closed; latin_ok() gate
  text.js    — visual(logical, role): UBA bidi → per-run shaping (reshaper,
               Arabic runs only) → bracket mirroring → uncovered-char guard
               roles: money/id/date keep ASCII digits + logical order
  layout.js  — RTL table (columns right→left), header/footer, totals box,
               page-break + repeated header rows, multi-page flow
```

Rules: no renderer touches `pdfkit` text directly; no renderer imports
`arabic-reshaper`; no hand-rolled reversals; Helvetica never sees RTL text;
report code keeps ONLY data→string mapping (same visual design, correct text).

---

## 10. Migration plan

Summary (full steps in `docs/pdf-export-refactor-plan.md`): (1) build
`lib/pdf/` with unit tests; (2) repoint pipeline B (`treasuryPdfExport`,
`arabicPdf` becomes a thin alias, then removed); (3) repoint pipeline A
renderers one type at a time behind the existing `pdf.test.js` pattern;
(4) remove dead `jspdf` FE deps; replace `←` separator; (5) golden-file
verification per §11 before each renderer is declared done. No business
logic, calculations, schemas, or report redesigns at any step.

---

## 11. Testing strategy

- **Unit (vitest):** `visual()` cases for every category in the task list —
  pure Arabic, Arabic+ASCII digits, decimals with separators, invoice IDs
  (`PO-100`, `RC-7`), EN/AR mixes (`انستا باي instapay`), dates, currency
  (`1,250.50 ج.م`), parens, `%`, multi-run descriptions; uncovered-char
  guard; font-load fail-closed; reshaper-applied-once (idempotence probe).
- **Integration:** each renderer returns `%PDF`; `pdftotext` extraction
  assertions on golden PDFs (numbers/IDs/dates must extract **exactly**,
  Arabic must extract as real Arabic, no tofu `.notdef`).
- **Contract:** unimplemented type/format → `AppError` 501 (already locked
  by `document/renderers/pdf.test.js`), never 500.
- **Human:** printed/visual spot-check checklist per report (column order,
  header/footer, page breaks on multi-page data, totals alignment).

---

## 12. Regression matrix

| # | Case | Pipeline | Today | After refactor |
|---|---|---|---|---|
| 1 | pure Arabic strings | A | mojibake | correct render + extract |
| 2 | Arabic + ASCII digits | A/B | mojibake / ok-ish | exact |
| 3 | decimals + separators (`1,250.50`) | B | extracts reversed | exact |
| 4 | invoice/receipt IDs (`PO-100`, `RC-7`) | A/B | mojibake / detached | exact, attached correctly |
| 5 | EN/AR mix (`انستا باي instapay`) | B | order fragile | exact |
| 6 | dates (`2026-09-06`, ranges) | A/B | mojibake / `60-90-6202` on extract | exact |
| 7 | currency (`ج.م`, amounts) | A | mojibake (`bÂæE`) | exact |
| 8 | parens / `%` / `:` / `•` | B | mirrored/misplaced | exact |
| 9 | tables: column order | A (LTR) | wrong direction | RTL, header-right |
| 10 | headers / footers | A/B | corrupt / ok | correct |
| 11 | page breaks + repeated headers | A/B | ad-hoc | uniform via layout.js |
| 12 | multi-page statements | A/B | ad-hoc | uniform, totals pinned |
| 13 | customer/supplier names | A | mojibake | correct |
| 14 | copy/paste + search in PDF | B | garbage | logical-order text |
| 15 | `←` separator / uncovered glyphs | B | tofu | replaced + guarded |
| 16 | CSV / HTML preview / print | — | correct | must stay correct (no-touch verification) |
