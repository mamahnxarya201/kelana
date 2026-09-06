# Kelana

A local-only Svelte 5 thinking workspace, implemented from the supplied Kelana product and interaction specification.

## Run the included build

Requires Node.js 20.19+ (22.12+ recommended). No package installation or internet connection is needed for the included build.

```sh
node start.mjs
```

Open `http://localhost:4173` in a current Chromium or Firefox browser. Keep the same URL, port, and browser profile: browser storage belongs to that origin. The launcher serves static files on loopback only. It has no application API, account, database, telemetry, or uploads.

When upgrading an existing installation, stop the old launcher, extract this build into its own directory, and run the new launcher at the same address. Open the app once so its offline cache can update, then close all Kelana tabs and reopen it if the old interface is still visible. Do not clear site storage: your existing workspace is reused automatically.

The production service worker caches the application, font files, PDF worker, and PDF support assets on the first completed visit. The app can subsequently reopen offline in a browser that supports service workers. Directly double-clicking `dist/index.html` is not supported because browser module, worker, and storage APIs require an HTTP origin. All normal app operations execute in the browser.

## Develop

```sh
npm ci
npm run dev
```

`npm run check` checks Svelte and TypeScript. `npm test` exercises model invariants. `npm run build` regenerates the production app and offline cache.

## Working loop

- Double-click the board or press **N** to create a card and write directly on it. Double-click an existing card's content to edit in place; click its text in the workbench to edit there. Escape or blur finishes editing. Card dimensions remain fixed; long content scrolls inside the active card.
- Editing uses CodeMirror live Markdown preview: syntax stays visible on the cursor/selection's lines and is hidden on inactive lines. The stored document is always plain Markdown. Multi-line selections expose all touched lines. Formatting does not replace the document or move the selection through a new HTML tree.
- Drag cards to arrange them. Scroll to pan; Ctrl/Command + wheel zooms around the pointer. Hold Space to drag-pan. Press **0** to fit the board.
- Hover or focus a card for its top-left **Open in workbench** control. Enter also opens a focused card.
- Opening always targets the primary workbench column, including when reopening an item currently beside another. It never duplicates the underlying entity.
- Use **Move beside** in a workbench header or context menu to create/use the secondary column. Every content type can move; PDF presence is irrelevant. The action is disabled when only one item is open. The reversed action returns the item to primary. Closing a workbench item only closes that view.
- Each workbench column scrolls independently. PDF pages flow through the column instead of owning a nested vertical scrollbar. Fold an item's contents using its chevron to reach the next document. Fold, caret, PDF reading position, and zoom are retained in view state.
- Resize the whole workbench at its outer boundary or adjust the internal divider. Single-column width, double-column width, and split ratio are remembered separately. The initial two-column width is 900 px, constrained by the viewport. The board camera never auto-fits when panel widths change.
- If the primary stack becomes empty, surviving secondary items are promoted to primary so there is no blank left column. When secondary becomes empty the divider disappears and the single-column width returns.
- Import PDF, image, `.md`, or `.txt` files using the floating toolbar or drop them onto the board. Pasted image files are supported.
- Select text within one PDF page and choose **Keep highlight** beside the selection. Drag the kept passage onto the board or use **Place on board**. All retained passages are also collected below the PDF. Open the source through its page backlink.
- Press **C** to connect cards by selecting two cards, or drag a card's connection handle onto another card. A preview curve follows the pointer. Existing connections update during card dragging and smoothly change attachment positions around card corners.
- Open local search with Ctrl/Command + K. PDF extraction is queued and its text cached locally by asset ID. Scanned PDFs need an existing text layer; OCR is not included.
- Right-click a card or press Shift+F10 for duplicate, color, stacking, connection, and deletion actions. Undo/redo covers structured changes and committed editor sessions. Assets are referenced by ID, never copied into history.

## Implementation

`src/lib/model.ts` separates entities, board placements, workbench placements, and relationships. Board rendering uses DOM cards plus SVG connectors; a grid spatial index culls offscreen cards and low zoom reduces content to titles. Dragging updates a transform through requestAnimationFrame and commits coordinates on release.

`src/lib/storage.ts` uses IndexedDB for document records, asset metadata, and extracted PDF search text. Binary assets use OPFS when available, with an IndexedDB Blob fallback. Content hashes deduplicate imports. Saving is debounced and serialized; a storage failure leaves input open and reports the error instead of claiming success.

`src/PdfReader.svelte` and `src/PdfPage.svelte` use PDF.js directly, without its viewer UI. IntersectionObserver renders nearby pages and releases distant canvases/text layers. Text selection captures PDF identity, page, quote, text offsets, normalized rectangles, and timestamp. Reader position and zoom are stored in the workbench view state.

`src/lib/search.worker.ts` runs local substring search off the main thread. Markdown updates are incremental; PDF extraction uses the PDF.js worker and a sequential import queue. Search is intentionally small and replaceable rather than a full ranked search engine.

Bits UI provides context-menu and dialog behavior. Fonts, PDF resources, and application assets are bundled locally. Colors and typography follow the supplied specification.

`src/Workbench.svelte` owns the two reading stacks, sticky headers, folding, and movement transitions. Board and workbench have separate top surfaces. Hover-open glyphs occupy a reserved 24 px hit area above card text, without a boxed floating-button treatment. Static lists and live-editor list lines have subtle indentation guides.

`src/LiveEditor.svelte` mounts CodeMirror only for an actively edited representation. `src/lib/live-markdown.ts` decorates the existing text model, preserving native editor history, selection, keyboard input, and composition handling. Headings, emphasis, links, lists, blockquotes, and code receive live styling. Advanced Markdown such as tables remains source text while editing and is rendered by the normal preview outside editing.

Panel boundaries animate for 210 ms, item transfers for 180 ms, and folding for 160 ms. Pointer-driven card and divider movement has no easing delay. PDF previews scale during resize and visible pages are rerendered after a 120 ms pause. Reduced-motion preferences disable transitions. Typing does not trigger height animation.

## Validation and current limits

- Svelte/TypeScript checks and model regression tests are provided. Browser interaction, visual, and offline-reload QA have not been performed in this environment.
- This is an initial functional implementation, not a benchmarked large-board release. No performance claim is made for thousands of cards or huge PDFs. SVG connectors still scan the relationship collection; advanced connector indexing and Canvas/GPU renderer swaps remain future profiling work.
- PDF highlights currently span one page per selection. Password prompts, OCR, PDF export, and cross-page selections are not implemented.
- PDF search opens the matching document; it does not yet highlight every search occurrence or jump directly to a search hit.
- Undo history lasts for the current app session. Document content, placements, assets, highlights, reading state, and extracted PDF text persist across reloads. Deleted assets are retained locally for undo; there is no garbage-collection or backup/export interface yet.
- At narrow screen widths, the workbench overlays the board; two columns remain side by side and become cramped. Desktop is the primary input target. Comfortable simultaneous reading needs an adequately wide viewport.
- Browser storage can be cleared by the browser or user. This app has no cloud backup.

No deployment was created: the supplied specification explicitly requires a local-only product.
