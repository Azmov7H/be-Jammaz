# PDF Export Refactor Plan — centralized Arabic/RTL layer

Parent: `docs/pdf-export-audit.md` (read it first — this plan implements §9–§11).
Status: **PLAN ONLY — no code changed. Awaiting approval before implementation.**

Non-negotiables: no business-logic changes, no accounting changes, no schema
changes, no report redesigns (same visual design, correct text). Per-report
renderers keep data→string mapping only; all font/shaping/bidi/layout moves
into the shared layer.

---

## 1. Target architecture

New module `be-Jammaz/lib/pdf/` (name fixed by this plan):

```
lib/pdf/
  fonts.js    load Amiri-Regular/Bold once at boot; fail closed (throw if
              missing/unreadable — never fall back to Helvetica).
              Exports: FONTS, fontFor(logicalString) → 'ar' | 'ar-bold' | 'latin'.
  text.js     visual(logical, role='text') → { glyphs, dir }.
              Steps: (a) real UBA over logical string → ordered runs with
              levels; (b) shape Arabic-script runs with arabic-reshaper,
              exactly once; (c) mirror brackets per level; (d) uncovered-
              glyph guard (drop/log + substitute, never tofu).
              Roles: 'money' | 'id' | 'date' force ASCII digits + logical
              order; 'text' is general prose.
  layout.js   RTL primitives on pdfkit: table({columns, rows, header})
              drawing columns right→left with repeated header row after page
              breaks; headerBox(), totalsBox(), footer(); multi-page flow
              helper. All text via text.js.
  index.js    createPdf(meta) → { doc, finish() } wiring fonts + defaults.
```

Data flow per report: fetcher (unchanged) → renderer maps data to
logical-order strings with roles → `lib/pdf` draws. Renderer files lose ALL
`pdfkit.text` shaping/bidi/font logic.

## 2. Bidi decision (required before coding)

- **Default: adopt a real UBA library** (`bidi-js` or equivalent pure-JS
  UAX #9 implementation) + keep `arabic-reshaper` for shaping. Criteria:
  zero native deps (Alpine-safe), maintained, handles weak/neutral/mirroring
  rules; verify against the §4 corpus before committing to it.
- **Alternative (only if library fails verification): headless-Chromium
  HTML→PDF** (full text stack by construction). Rejected as default: new
  runtime (browser in prod image), heavier ops, larger blast radius.
- `pdfkit` is **retained** in both options for the default path — it is
  capable once fed embedded fonts + ordered shaped glyphs (proven by audit).

## 3. Implementation steps (in order, each independently committable)

1. **Scaffold `lib/pdf/` + unit tests** (`fonts`, `text.visual` corpus from
   audit §11 rows 1–8, uncovered-char guard, fail-closed font load).
   Verify library candidate here; stop if it fails the corpus.
2. **Migrate pipeline B** (`treasuryPdfExport.js` → layout.js table +
   text.js; replace `←` with `–`; turn `arabicPdf.js` into a deprecated
   alias, remove after step 4). Golden-file check: treasury PDF.
3. **Migrate pipeline A** one renderer at a time (sale → purchase →
   receipt → statement), each reusing layout.js primitives; extend
   `document/renderers/pdf.test.js` with `%PDF` + `pdftotext` assertions.
4. **Delete** `services/arabicPdf.js` (post-alias), dead `jspdf*` FE deps;
   update docs. No FE code changes (download glue already sound).
5. **Full matrix run** (§5) + printed spot-checks; commit per step, push at end.

## 4. Test corpus (must-pass before any renderer is declared done)

Logical inputs → expected visual/extracted outputs: `فاتورة مشتريات`;
`بمبلغ 500 جنيه`; `1,250.50 ج.م`; `فاتورة PO-100`; `انستا باي instapay`;
`2026-09-06` + `2026-09-01 – 2026-09-06`; `ملاحظات (عاجل)`; `خصم 10%`;
`تاريخ الاستخراج: 2026-09-06 • عدد الحركات: 2`; multi-line description
with ID + parens + `%`. Extraction asserts: digits/IDs/dates byte-exact,
Arabic real characters, zero `.notdef`.

## 5. Regression matrix execution

Run audit §12 rows 1–16 per migrated report: unit suite + golden
`pdftotext` diff + human checklist (RTL column order, header/footer,
breaks, totals). Row 16 (CSV/HTML/print untouched) re-verified every step.
Any red cell blocks that step's commit.

## 6. Risks & guards

- UBA library mis-verdict → step-1 gate stops work before renderers churn.
- Amiri missing rare glyphs → guard substitutes/logs; report stays readable.
- Double-shaping → single choke point (`text.js`) makes it impossible.
- Scope creep (redesigns, calculations) → forbidden by §1 non-negotiables;
  reviewers reject diffs touching fetchers/services math.

## 7. Approval gate

Do not start step 1 until: (a) UBA library choice confirmed, (b) corpus in
§4 agreed, (c) this plan approved. Estimated shape: scaffold + B migration
first commit batch, then one batch per A renderer, then cleanup.
