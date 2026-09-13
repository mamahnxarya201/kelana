# `.kelana` file format — implementation plan & agent handoff

Status: **planned, not started.** This document is the source of truth for the format
and the phased implementation. Read it fully before writing code. All file/line
references were verified against the tree on 2026-09-13.

## Goal

Kelana boards become single, shareable files. A `.kelana` file is a SQLite database
containing the board (doc JSON), its binary assets (PDFs, images) as immutable
SHA-256-addressed blobs, and an optional derived-text cache. A friend who receives
a file opens it in Kelana and sees the board with annotations and notes — because
annotations are overlay data in the doc JSON, never modifications to the PDF bytes.

## Invariants (non-negotiable)

1. **Web-first.** The web app must remain fully functional with no desktop wrapper.
   No code path may require IPC, native modules, or a specific browser. Optional
   APIs (`showSaveFilePicker`, OPFS) must be feature-detected with fallbacks.
2. **Assets are immutable and content-addressed.** Original bytes are never
   modified, in storage or in the file. SHA-256 dedup must hold on export and import.
3. **Annotations stay overlays.** Nothing is ever written into PDF bytes. `Anchor`
   data (page, quote, char offsets, fractional rects) renders highlights; the PDF
   inside a `.kelana` is byte-identical to what was imported (verifiable by checksum).
4. **No binary in the doc JSON.** No base64, no data URLs. Entities reference
   `assetId` only.
5. **One write pipeline.** Regular edits keep flowing exactly as today: in-memory
   `doc` → `persist()` 250 ms debounce → `flush()` → serialized promise chain →
   `saveDoc` (src/lib/doc.svelte.ts:54-76). Phases 1–2 add file import/export only —
   no second autosave path.
6. **Undo/redo is session state.** Never written to the file; reset when a file is opened.
7. **Derived data is optional.** A file missing `pdf_text` rows must open with full
   functionality (text is re-extracted on demand by the existing indexer).
8. **Graceful versioning.** Unknown newer container version or `Doc.version` →
   readable error, no data loss, no partial board adoption.
9. **Every phase ships green:** `npm run check`, `npm test`, `npm run test:browser`
   pass, and app behavior is unchanged except for the added feature.

## Decisions already made — do not relitigate

- **File = document.** One `.kelana` = one board. Opening replaces the current
  board (after confirmation). Board-merge is out of scope.
- **Container = SQLite**, not zip, not append-log. Rationale: crash-safe in-place
  updates, single artifact, dedup via primary key, works on web (wasm) and desktop
  (native) alike.
- **`doc` is one JSON row**, not normalized tables. SQLite is a container here, not
  a query engine for the board. `Doc.version` (currently literal `1`, model.ts:62)
  drives doc-shape migrations.
- **Annotations/PDF: overlay model as-is** (see "How annotation works today").
- **Export includes only assets referenced by live entities** — export doubles as
  compaction. Orphaned annotation entities (their PDF card was deleted) are kept.
- **`Asset.backend` is environment state** (model.ts:86): strip when writing a
  file; the importer re-derives it by reusing the existing storage path.
- **File menu (hamburger)** replaces the header brand. Items exactly: Open,
  Save, Save As — no "New" item (decided against). On the web, Save without a
  writable file handle silently behaves as Save As; it never claims to have
  updated the original file. The status chip reports working-copy state plus a
  dirty indicator against the last file write. On desktop (Phase 4), Save becomes
  a debounced autosave into the live database file.

## Current code map (facts to build on)

| Area | Where | Notes |
|---|---|---|
| Types | src/lib/model.ts | `Anchor` :2-10, `Entity` :11-19, `Doc` :61-78, `Asset` :79-87 |
| Storage | src/lib/storage.ts | DB `kelana-local` v2, stores `documents/assets/blobs/search` :7-10; `loadDoc`/`saveDoc` (`documents/main`) :60-61; `saveAsset` SHA-256 dedup + OPFS with IDB fallback :64-97; `loadAsset` :98-108; `loadPdfText`/`savePdfText` :62-63 |
| Save pipeline | src/lib/doc.svelte.ts | `persist`/`flush` :54-76, `commit`/`record`/`undo`/`redo` :78-115, `loadDoc` hydration :132-145, `stabilizeConnectionSides` :117-130 |
| Import entry | src/App.svelte:193-255 | `importFiles`: pdf/image → `saveAsset`, text → inline body |
| Annotation create | src/App.svelte:455-467 | `annotate(anchor)` — plain entity commit, body = note text |
| Annotation anchor | src/PdfPage.svelte:83-111 | page, quote, char offsets, **fractional rects** (fractions of page box → resolution-independent) |
| Annotation render | src/PdfPage.svelte:134-141 | percentage-positioned highlight spans filtered by `anchor.page` |
| Orphan handling | src/App.svelte:468-473 | `source()` toasts when the PDF entity is gone |
| PDF loading | src/lib/pdf.ts | refcounted `acquirePdf`/`releasePdf` cache over `loadAsset` |
| PDF text index | src/App.svelte:257-288 | `indexPdf` — checks `loadPdfText` cache **first** :264, else extracts via pdf.js, saves cache |
| Search | src/lib/search.svelte.ts + search.worker.ts | naive substring worker; not persisted |
| Editor images | src/LiveEditor.svelte:99-103 | tiptap Image with `allowBase64: false` — bodies cannot smuggle base64 |
| Export today | **does not exist** | no download/save code anywhere in `src/` |
| Wrapper today | **does not exist** | PWA + local static server (start.mjs) only |

`storage.ts` should need **zero changes** across phases 1–2: its exported functions
(`saveAsset`, `loadAsset`, `loadPdfText`, `savePdfText`) are all callable from a
Worker (async IDB and OPFS APIs are worker-available), and `saveAsset` accepts any
`File` — a worker can construct one with `new File([bytes], name, { type })`.
Preserve that property.

## How annotation works today (must not change)

Selecting text in the pdf.js text layer builds an anchor (PdfPage.svelte:95-110):
`pdfId` (the PDF *entity* id), page number, quote string, char offsets into the
page text, and rects stored as fractions of the page box. `annotate()` wraps it in
a `type: 'annotation'` entity committed into `doc.entities`; the note body is
ordinary entity text. Highlights render as overlay spans (PdfPage.svelte:134-141).
The PDF file itself is never touched.

## Format spec

### Identification

- The file is a standard SQLite 3 database (header magic `SQLite format 3\0` —
  sniff the first 16 bytes on import).
- `PRAGMA application_id = 0x4B4C4E41;` (`KLNA`)
- `PRAGMA user_version = 1;` — the **container version**, bumped only when the
  schema/layout below changes.

### Schema (DDL)

```sql
CREATE TABLE meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- required keys: format='kelana', formatVersion='1',
-- generator (app name + version), createdAt (ISO), title

CREATE TABLE doc(
  id INTEGER PRIMARY KEY CHECK(id = 1),
  json TEXT NOT NULL,            -- the Doc object, exact current shape
  updated_at INTEGER NOT NULL
);

CREATE TABLE assets(
  checksum TEXT PRIMARY KEY,     -- lowercase hex SHA-256
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE blobs(
  checksum TEXT PRIMARY KEY REFERENCES assets(checksum),
  data BLOB NOT NULL
);

CREATE TABLE pdf_text(           -- derived cache; rows optional
  asset_id TEXT PRIMARY KEY,
  text TEXT NOT NULL
);
```

Rules:

- One `assets` row ⟺ exactly one `blobs` row; `byte_size == length(data)`; and
  `checksum == sha256(data)` (verify on import — filename and content must agree).
- Every `assetId` referenced by an entity in `doc.json` must exist in `assets`.
  The exporter validates before writing; the importer rejects with a readable
  error listing missing ids. Entities without `assetId` (text/markdown/annotation)
  are always valid.
- Writer sets `application_id`, `user_version`, `meta`, and all content in one
  transaction.

### What goes in / stays out

**In:** the full `Doc` snapshot (view state like camera/panes included — harmless,
resumes the reader), referenced asset bytes, cached `pdf_text` for referenced PDFs
when available.

**Out:** undo/redo stacks, the in-memory search index, unreferenced assets,
`Asset.backend`, any absolute paths or environment-specific fields.

## Implementation plan

### Phase 1 — container module + Export (pure addition)

New files under `src/lib/kelana/`:

- **`schema.ts`** — DDL string, constants (application id, versions, meta keys),
  `isKelanaFile(bytes: Uint8Array): boolean` magic sniff, `slugify(title)`
  filename helper. Pure; unit-testable in node without sqlite.
- **`sqlite.ts`** — lazy `import('@sqlite.org/sqlite-wasm')` initialization.
  Worker-only; the main bundle must never import it.
- **`container.worker.ts`** — owns sqlite and all byte handling. postMessage protocol:
  - Request `{ type: 'export', doc }` (plain snapshot, worker derives the asset
    list from entities): for each referenced asset `loadAsset` → bytes, plus
    `loadPdfText` cache when present; build an in-memory DB; serialize to bytes;
    respond `{ type: 'exported', bytes: ArrayBuffer, filename }` (transfer the buffer).
  - Request `{ type: 'import', bytes }`: sniff, open in-memory, read `user_version`
    + meta → guard; parse `doc.json` → validate `Doc.version` and asset references;
    for each asset row recompute SHA-256 and compare; ingest via `new File([bytes], …)`
    + `saveAsset` (dedup for free) and `savePdfText` for cached text; respond
    `{ type: 'imported', doc, stats }`.
    Errors: `{ type: 'error', code: 'version' | 'corrupt' | 'missing-asset', message }`.
    Asset ingestion is additive and deduped, so a mid-import failure leaves only
    harmless deduped blobs behind — the board is never adopted on failure.
- **`fileAccess.ts`** — the only module that talks about file delivery:
  `downloadKelana(bytes, filename)` (anchor-blob), `saveKelanaWithPicker(bytes, filename)`
  (feature-detected `showSaveFilePicker`, falls back to download). **This is the
  seam the future desktop wrapper replaces/extends. No other module may mention
  file pickers or downloads.**

Library choice: `@sqlite.org/sqlite-wasm` (official, actively maintained). Load
lazily inside the worker. Build the DB in memory and serialize via the build's
export API (verify the exact call against the installed version — `sqlite3_js_db_export`
/ `db.export()`, or `VACUUM INTO` an OPFS temp file and read it back). Keep
`journal_mode=MEMORY` while building — WAL is meaningless for an in-memory build
and belongs to the future desktop live-file path.

Vite/PWA: ensure the sqlite3 wasm binary is emitted as an asset and precached —
the workbox glob already includes `wasm` with an 8 MB budget (vite.config.ts);
sqlite3.wasm is ≈1 MB, but verify the precache list after building. App startup
must not load the worker or the wasm.

App wiring: the file menu's **Save As** → `$state.snapshot(doc)` → worker →
`fileAccess` save. Feedback via the existing `notify()` toast. Suggested filename:
`slugify(doc.title) + '.kelana'`. The hamburger menu itself ships in this phase
with Save + Save As working; Open ships disabled until Phase 2 (see
"File menu UI").

**Definition of done (Phase 1):**
- Export a board with ≥1 annotated PDF + 1 image + 1 free-text card; the file
  opens in the `sqlite3` CLI; `PRAGMA application_id`/`user_version` are correct;
  `doc.json` parses; extracted blobs are byte-identical to their sources
  (verify with `sha256sum`).
- Cross-implementation test reads the exported file with better-sqlite3 and
  asserts schema + row counts (see Testing).
- `npm run check`, `npm test`, `npm run test:browser` green; startup payload
  unchanged (worker + wasm load on first export only).

### Phase 2 — Open / Import

Entry points (reuse all three existing surfaces; no new UI):
- `importFiles()` (App.svelte:193) gains a pre-step: a file named `*.kelana` or
  sniffed as SQLite routes to `openKelanaFile(file)`. A `.kelana` must arrive
  alone — if mixed with other files or multiple `.kelana` files, toast an error
  ("A board file opens by itself") and abort the batch.
- Add `.kelana` to the hidden input's `accept` attribute (App.svelte:624-634).
  Drag-drop and paste already funnel through `importFiles`.

Flow:
1. **Confirm replacement.** Single-doc app (`documents/main`): show a bits-ui
   dialog (pattern from SettingsDialog) — "Replace current board *{title}*?"
   with Cancel / Open. Suggest exporting first in the copy. On cancel, nothing happens.
2. Post `{ type: 'import', bytes }` to the worker (validation + ingestion as above).
3. Main thread calls a new **`adoptImportedDoc(next: Doc)`** in doc.svelte.ts:
   clear undo/redo stacks, `Object.assign(doc, stabilizeConnectionSides(next))`,
   update `docStatus`, then `flush()` immediately so the replacement is durable.
   (A pending debounce from the old board is harmless — `flush` snapshots current
   state.)
4. Reindexing happens automatically: `onDocChange` → `updateSearch` (App.svelte:81-97),
   and `indexPdf` finds the imported `pdf_text` cache through its existing
   `loadPdfText`-first check (App.svelte:264) — no re-extraction.
5. Toast stats ("Opened *{title}* — 12 cards, 3 PDFs").
6. Record file identity: name from the opened file; a write handle only when it
   came from the platform picker. Stored beside the working copy in IDB — never
   inside `doc.json`. Enable the menu's Open item.

`adoptImportedDoc` is the only state-layer addition; `storage.ts` stays untouched.

**Definition of done (Phase 2):** browser round-trip test — build a board, export,
open it in a fresh context (clean IDB/OPFS), assert identical entities/placements/
edges, annotation highlights render, and search hits PDF text immediately (proving
the cache carried over). Version-guard test: a fixture with bumped `user_version`
is refused with a readable toast and the current board is untouched.

### File menu UI (ships across Phases 1–2)

The header brand (`<div class="brand">…`, App.svelte:651) is replaced by a
hamburger button opening a bits-ui `DropdownMenu`. Exactly three items — no
"New" item (decided against):

- **Save As…** (Phase 1) — the export flow: picker when the browser offers one,
  download fallback. The saved name becomes the board's file identity.
- **Save** (Phase 1) — with a writable handle (file originally opened via the
  Chromium picker): write back in place. Without one: **silently run the Save As
  flow** (decided); optionally a first-time toast: "Saved a new copy — the
  browser can't overwrite the original." Never report success against a file it
  did not touch.
- **Open…** (Phase 2) — `.kelana` picker → confirm-replace flow above; ships
  disabled until Phase 2 lands.

Supporting state and UI:

- `currentFile: { name, handle? } | null` lives in IDB next to the working copy
  (environment state; never inside `doc.json` — same reasoning as
  `Asset.backend`). Default filename derives from `slugify(doc.title)`.
- The save-state chip (App.svelte:678-683) keeps reporting working-copy status
  ("Saved on this device" / "Saving…" / "Could not save") and additionally shows
  the file name with a dirty dot while `doc` changed since the last file write —
  piggyback on the existing `savingRevision` counter (doc.svelte.ts:64).
- Keyboard: intercept Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, Ctrl/Cmd+O with
  `preventDefault` at the existing loaded-guard keydown handler (App.svelte:566).
- The canvas Upload button (Board.svelte:875) is untouched — it imports assets
  *into* the board; Open is a different concept and keeps different wording.
- Desktop (Phase 4) swaps Save semantics for debounced autosave into the live
  file; menu items and shortcuts stay identical.

### Phase 3 (deferred) — Chromium save-back

Out of scope for this handoff beyond the seam: `fileAccess.saveKelanaWithPicker`
gains a keep-handle mode; write-back happens on explicit save and lifecycle events
(close, visibility hidden) — **never** on the 250 ms debounce (rewriting a 200 MB
file per keystroke is unacceptable). The desktop wrapper supersedes this tier.

### Phase 4 (deferred) — desktop host

When the wrapper (Tauri/Electron) lands, native sqlite opens the `.kelana` as the
live database (WAL, checkpoint-on-close for a clean single file), replacing the
IDB/OPFS working store on desktop. **Save becomes a debounced autosave into the
live file** (decided) — page-level transactions make even a 250 ms cadence viable;
tune the interval here, and checkpoint on close/idle keeps the artifact a clean
single file. The app talks to exactly three seams — the
`storage.ts` functions, `fileAccess.ts`, and the container worker protocol.
Nothing outside those may learn about platforms.

## Testing plan

- `src/lib/kelana/schema.test.ts` — node:test, no sqlite: DDL/constants, magic
  sniffing, slugify. Runs in the existing `npm test` (keep that run
  native-dependency-free).
- `tests/kelana-file.browser.mjs` — pattern copied from tests/free-text.browser.mjs
  (boots vite, drives Chromium via playwright): export → fresh context → import →
  assert parity + version guard. Use `setInputFiles` for import; capture the
  download event for export. Drive the file menu and its shortcuts (Ctrl+S must
  route to Save As on the web) so the UI path is covered, not just storage.
- Cross-implementation round-trip — devDependency `better-sqlite3` + script
  `test:container`: wasm-written file read by node sqlite (and/or a committed
  fixture) asserting schema, row counts, checksum agreement. Keep separate from
  `npm test`.
- Manual: file opens in `sqlite3` / DB browser; embedded PDF byte-identical.

## Known caveats (documented behavior, not phase work)

- Stored rects mirror the text layer of the **bundled** pdfjs-dist; a future major
  pdfjs bump may shift layout slightly. `quote`/`start`/`end` are the re-anchoring
  data (currently unused for re-derivation) — a later hardening pass can rebuild
  rects on open when they mismatch.
- Deleting a PDF card leaves orphan annotation entities (source() toasts,
  App.svelte:468-473). **Decided:** orphan annotations ship as remnant quote
  text with no source — a deleted PDF is never resurrected into exports. Anchors
  keep storing only `pdfId`; do **not** add `assetId` to the anchor. No special
  exporter handling is wanted or needed: unreferenced assets are already
  excluded, and an orphan's source is unreachable by design.
- `anchor.pdfId` binds to the entity instance, not the content checksum — correct
  for file = document; only matters if board-merge ever exists.
- No asset GC exists; export is the compaction path.

## Out of scope

Zip interchange export, multi-board/library UI, FTS5 ranking (`pdf_text` mirrors
today's substring search semantics), flatten-to-annotated-PDF export, autosave
back to the file, encryption.
