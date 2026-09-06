# Kelana — Product, Interaction, UI, and Technical Intent

> Status: working product/design specification  
> Scope: whiteboard + right-side workbench, local-first, performance-first  
> Primary principle: **whiteboard = spatial memory; workbench = focused manipulation**

---

# 1. Product Intent

Kelana is a local-first thinking workspace built around a spatial whiteboard.

It is not primarily a note-taking app, not a PDF reader, not a document editor, and not a dashboard. The core experience is:

1. collect material on a whiteboard,
2. arrange it spatially,
3. open selected objects into a focused right-side workbench,
4. read or edit them there without removing them from the board,
5. create annotations or new thoughts,
6. drag those thoughts back onto the whiteboard,
7. continue reorganizing the spatial mess.

The whiteboard is intentionally allowed to become messy. That is not a failure state. The product should preserve the user's spatial memory and thinking process rather than constantly trying to auto-organize it.

The workbench exists because some interactions are poor when performed directly inside a freeform canvas. Reading a long PDF, scrolling, annotating, or writing a longer card is easier in a stable vertical surface.

The same entity may therefore have multiple simultaneous representations.

Example:

- a PDF exists as an object on the whiteboard,
- the same PDF is also open in the workbench,
- editing/open-state changes do not duplicate the underlying data,
- closing the workbench representation does not delete the whiteboard object,
- deleting the underlying object is a separate action.

The core model is therefore **multi-view, single-entity**.

---

# 2. Product Mental Model

## 2.1 Whiteboard

The whiteboard is the main spatial surface.

It contains:

- markdown cards,
- PDF objects,
- annotations extracted from PDFs,
- images,
- links between objects,
- future object types.

The whiteboard should feel like a desk or wall where material is placed and arranged.

Its job is not to make everything tidy.

Its job is to preserve:

- position,
- proximity,
- rough grouping,
- visual relationships,
- spatial memory,
- evolving thought structure.

## 2.2 Workbench

The right-side panel is a **workbench**, not a generic sidebar.

It is a focused reading and writing area.

The workbench can contain:

- PDFs,
- markdown cards,
- images,
- other future content surfaces.

The workbench is organized into up to **two vertical columns**.

Each column contains items stacked vertically.

The default experience is one column.

The second column appears only when the user explicitly needs side-by-side work.

Examples:

- PDF on the left, synthesis card on the right,
- two PDFs side by side,
- source material on the left, notes on the right.

The workbench must not expose internal implementation language such as:

- "Column 1"
- "Column 2"
- "Object"
- "Link"

unless that language has genuine user-facing meaning.

The user should think:

- open,
- read,
- write,
- move beside,
- close.

Not:

- choose layout slot,
- assign grid cell,
- manage panes.

---

# 3. Core Workflow

A representative workflow:

1. The user sees a markdown card on the whiteboard.
2. The user remembers that a related detail may exist in a PDF.
3. The user hovers the PDF object on the whiteboard.
4. A contextual "open in workbench" icon appears inside the object.
5. The icon is positioned in the **top-left inside the object**, with a small inset.
6. The user clicks it.
7. The PDF remains on the whiteboard.
8. A second representation of the same PDF opens in the primary workbench column.
9. The user scrolls and reads the PDF.
10. The user annotates/highlights a passage.
11. The user drags the annotation from the PDF into the whiteboard.
12. The annotation becomes a new whiteboard object linked to its source.
13. The user decides they need a new card for synthesis.
14. The user creates or selects a card on the whiteboard.
15. The user opens the card into the workbench.
16. By default it enters the primary workbench column.
17. The user may right-click the card in the workbench and choose **Move beside**.
18. The second workbench column appears.
19. The user now reads the PDF in one column and writes markdown in the other.
20. Both the PDF and the card still exist as objects on the whiteboard.

This loop should feel natural:

**find -> open -> inspect -> read/write -> annotate -> externalize -> arrange -> continue**

---

# 4. Whiteboard Interaction

## 4.1 Object appearance

Whiteboard objects should be visually quiet.

Do not permanently show:

- ellipsis buttons,
- toolbars,
- formatting controls,
- labels that merely restate the object type,
- status metadata that is not currently useful.

The object should primarily look like its content.

## 4.2 Hover affordance

When the user hovers or keyboard-focuses an object that can be opened in the workbench:

- show a small workbench/open icon,
- place it **inside the object**,
- anchor it to the **top-left**,
- use an inset of approximately `8px–12px`,
- avoid pushing or reflowing content,
- fade it in rather than making it permanently visible.

This button performs one primary action:

**Open in workbench**

There is no menu asking the user where to put the item.

## 4.3 Context menu

Secondary actions belong in the context menu.

Examples:

- duplicate,
- delete,
- change color,
- bring forward,
- send backward,
- open source,
- copy link,
- other object-specific actions.

Do not duplicate these actions as permanent card chrome.

## 4.4 Selection

Selection should remain visually distinct from hover.

Suggested states:

- idle: no extra chrome,
- hover: subtle outline or elevation + open-in-workbench control,
- selected: stronger outline and transform handles only if needed,
- editing: text editing affordance without unnecessary editor chrome.

---

# 5. Workbench Layout

## 5.1 Global layout

The workbench occupies the right side of the application.

It should feel like a secondary working surface rather than an embedded card.

Recommended desktop proportions:

- top application bar: `36px–44px`,
- workbench width: approximately `520px–760px` depending on viewport,
- default workbench: one column,
- expanded workbench: two columns,
- workbench full height below the top bar.

The workbench should be horizontally resizable.

Suggested constraints:

- minimum width, one column: `360px`,
- comfortable width, one column: `440px–560px`,
- comfortable width, two columns: `680px–900px`,
- maximum width: roughly `50vw` unless the user manually expands it.

Avoid making the workbench look like a conventional narrow sidebar.

## 5.2 One-column default

When the user first opens an item from the whiteboard:

- open the workbench if closed,
- create/use the primary column,
- append or focus the item there,
- do not display an empty second column,
- do not display a two-column layout placeholder.

The unused second column should not exist visually.

## 5.3 Two-column creation

The second column is created only by an explicit user action.

Primary action:

**Move beside**

This action may be accessible from the item header or the workbench item's context menu.

When invoked:

- if the second column does not exist, create it,
- move the selected item into the second column,
- preserve its scroll/editor state,
- keep the primary column intact.

The user does not choose "column 1" or "column 2".

The interaction is spatial:

**Move beside**

## 5.4 Workbench stacking

Each column is vertically stacked.

Items may have different heights.

The workbench should support:

- multiple PDFs,
- multiple cards,
- mixed content types,
- vertical scrolling through the stack.

The workbench itself should have one coherent scrolling model.

Avoid accidentally creating a "scrollbar cinematic universe" where:

- the whole panel scrolls,
- each column scrolls,
- each tile scrolls,
- and the PDF also scrolls.

Use nested scroll only when the content type genuinely requires it.

PDF pages are naturally scrollable content, so the PDF surface may own its own reading scroll region when focused.

## 5.5 Moving between columns

For an item in the primary column:

- header action: **Move beside**
- icon: a simple spatial "pane + arrow" metaphor

For an item already in the secondary column:

- the equivalent action may become **Move to primary**
- icon direction should reverse.

Do not label these actions with numeric column identifiers.

---

# 6. Workbench Item Chrome

Workbench item chrome must be minimal.

Every piece of chrome must justify the space it steals from thinking.

Recommended generic item header:

```text
[ type icon ] Title / filename                        [ move beside ] [ close ]
```

Possible optional contextual menu:

```text
[ type icon ] Title / filename                 [ move ] [ close ]
```

Avoid permanent ellipsis buttons unless the item truly has actions not available elsewhere.

## 6.1 Close vs delete

The close/remove action removes the **representation from the workbench**.

It must not delete the underlying entity.

Therefore:

- use a close `×` or equivalent,
- tooltip: `Remove from workbench`,
- do not use a trash can unless the action truly deletes the underlying object.

This distinction must remain semantically consistent.

---

# 7. PDF Workbench Surface

The PDF workbench is a **reading surface**, not a miniature Acrobat.

The application owns the interaction. PDF.js or another renderer is an implementation detail.

## 7.1 PDF header

Allowed controls:

- filename,
- search,
- zoom percentage,
- move beside / move to primary,
- remove from workbench.

Potentially hide search and zoom until hover/focus if the header becomes visually heavy.

## 7.2 Zoom

The user does not need design-tool precision.

A simple zoom percentage control is enough.

Suggested values:

- 75%
- 100%
- 125%
- 150%
- Fit width

No permanent `+` and `-` controls are required.

## 7.3 Page navigation

Use **continuous vertical scrolling**.

Do not show:

- page thumbnail sidebar,
- large page navigator,
- permanent previous/next page controls,
- a strip of page thumbnails,
- fake book-style page chrome.

A small page indicator may exist if it becomes useful, but it should not dominate the interface.

## 7.4 PDF toolbar

Do not reproduce the full PDF.js viewer toolbar.

Specifically avoid default PDF-viewer baggage such as:

- sidebar toggle,
- thumbnail browser,
- download,
- print,
- presentation mode,
- rotate,
- attachment pane,
- document outline pane,

unless a later real use case proves one of them necessary.

## 7.5 Annotation

Annotation is a first-class workflow.

The user should be able to:

- select/highlight PDF text,
- annotate a passage,
- create a linked annotation object,
- drag the annotation into the whiteboard.

The resulting annotation should preserve source identity:

- PDF entity ID,
- page number,
- text range or anchor,
- annotation text,
- creation timestamp,
- optional bounding box / normalized coordinates.

The annotation object on the whiteboard is a new entity linked back to the source PDF.

---

# 8. Markdown Card Workbench Surface

Markdown editing is inline.

The target user is assumed to understand markdown.

Do not show:

- rich-text toolbar,
- B/I/U buttons,
- paragraph style dropdown,
- "Normal text",
- formatting ribbon,
- permanent "Markdown" label,
- "Last edited just now" metadata unless explicitly useful.

The card surface should feel like writing directly into the document.

Suggested behavior:

- click text -> edit,
- markdown syntax remains supported,
- render/preview may be hybrid or immediate,
- keyboard shortcuts are allowed,
- formatting UI appears only contextually if ever added.

Card workbench content should be visually close to the whiteboard card representation, but optimized for vertical reading and editing.

---

# 9. Floating Whiteboard Toolbar

The whiteboard creation/manipulation toolbar is floating.

It must not attach itself to the left edge or become a permanent sidebar.

Properties:

- floats over the canvas,
- has a small offset from the viewport edge,
- subtle border,
- very light shadow,
- compact vertical or horizontal arrangement depending on final design,
- selected tool has a clear but restrained state.

The toolbar should not visually divide the canvas into layout regions.

---

# 10. Visual Design Direction

## 10.1 Overall personality

Kelana should feel:

- calm,
- utilitarian,
- spatial,
- modern,
- tactile enough to feel like a workspace,
- not decorative,
- not enterprise-dashboard-like,
- not "AI SaaS",
- not overloaded with rounded rectangles,
- not excessively glassy,
- not playful to the point of becoming toy-like.

The interface should recede behind the user's material.

## 10.2 Colors

Use a warm-neutral application background rather than pure white everywhere.

Suggested base palette:

```css
--bg-app:        #F6F5F2;
--bg-canvas:     #F7F6F3;
--bg-surface:    #FFFFFF;
--bg-hover:      #F0EFEC;
--bg-selected:   #ECEBE7;

--text-primary:  #242422;
--text-secondary:#696965;
--text-muted:    #8A8984;

--border-subtle: #DFDED9;
--border-strong: #CAC9C3;

--accent:        #4D6FFF;
--accent-soft:   #E9EDFF;

--danger:        #C94A4A;
```

These values are starting points, not sacred constants.

The key requirement is low visual noise and clear hierarchy.

Avoid:

- excessive blue,
- giant high-saturation accent blocks,
- gradient backgrounds,
- pure black everywhere,
- cold gray enterprise palettes.

Colored cards may use muted tones:

```css
--card-yellow: #FFF2B8;
--card-blue:   #DDEAFF;
--card-green:  #DFF2D8;
--card-pink:   #F3DDE7;
--card-purple: #E9DDF5;
```

Card colors should remain readable and should not become neon sticky notes.

## 10.3 Typography

Do **not** use monospace as the primary UI font.

Primary recommendation:

**Inter Variable**

Fallback stack:

```css
font-family:
  Inter,
  "Segoe UI",
  Roboto,
  Helvetica,
  Arial,
  sans-serif;
```

Alternative if a slightly more editorial/product feel is preferred:

- Geist Sans,
- IBM Plex Sans,
- Source Sans 3.

Do not mix many families.

Recommended weights:

- 400 body,
- 500 controls / subtle labels,
- 600 headings,
- 700 only where genuinely necessary.

Suggested sizes:

```css
--text-xs:  11px;
--text-sm:  12px;
--text-md:  14px;
--text-lg:  16px;
--text-xl:  20px;
--text-2xl: 24px;
```

Use comfortable line-height.

For cards and document content:

- `1.45–1.6` line-height.

For compact UI controls:

- `1.2–1.35`.

## 10.4 Radius

Avoid making every container a pill.

Suggested radius system:

```css
--radius-sm:  4px;
--radius-md:  8px;
--radius-lg:  12px;
--radius-pill:999px;
```

Use:

- cards: `8px–12px`,
- workbench surfaces: `6px–10px`,
- small buttons: `6px–8px`,
- floating toolbar shell: `10px–14px`.

Do not stack multiple rounded containers inside each other without reason.

## 10.5 Borders and shadows

Prefer borders over strong shadows.

Suggested:

```css
--shadow-float:
  0 4px 16px rgba(20, 20, 20, 0.08);

--shadow-card:
  0 1px 4px rgba(20, 20, 20, 0.05);
```

Most surfaces should use either:

- subtle border,
- very light shadow,
- or both at restrained values.

No floating-card carnival.

---

# 11. Layout Geometry

Suggested desktop structure:

```text
┌───────────────────────────────────────────────────────────────┐
│ Top application bar                                           │
├──────────────────────────────────────┬────────────────────────┤
│                                      │                        │
│                                      │       Workbench        │
│            Whiteboard                │                        │
│                                      │   primary | secondary  │
│   floating tools                     │                        │
│                                      │                        │
└──────────────────────────────────────┴────────────────────────┘
```

Top application bar:

- single global bar,
- compact,
- avoid redundant local bars.

Whiteboard:

- consumes most available space,
- pan and zoom,
- infinite or effectively infinite surface.

Workbench:

- right side,
- full height under app bar,
- resizable,
- no visual empty second column.

---

# 12. Whiteboard Rendering Architecture

Performance is a product feature.

The whiteboard should support rendering strategy changes without forcing the data model to change.

## 12.1 Separate model from renderer

Object data must not depend on DOM/SVG/WebGL implementation details.

Example logical object:

```ts
type BoardObject = {
  id: string;
  type: "markdown" | "pdf" | "annotation" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  contentId: string;
};
```

The renderer consumes this model.

This allows renderer swapping.

## 12.2 Hybrid renderer

Recommended architecture:

- DOM for editable text and interactive card content,
- SVG for connectors, selection outlines, and lightweight vector overlays,
- Canvas/WebGL only when object count or connector density requires it.

Do not default to WebGL merely because it sounds fast.

DOM remains excellent for:

- text,
- accessibility,
- selection,
- input,
- browser-native editing.

SVG remains excellent for:

- connectors,
- arrows,
- paths,
- handles.

Canvas/WebGL becomes useful for:

- very large numbers of static objects,
- large connector graphs,
- zoomed-out overview modes,
- background previews,
- high-density visualization.

## 12.3 Renderer swapping

Renderer switching may be based on zoom level or scene complexity.

Example:

```text
zoom >= 0.60
    -> normal DOM cards + SVG connectors

0.25 <= zoom < 0.60
    -> reduced DOM detail + simplified text + SVG/Canvas connectors

zoom < 0.25
    -> thumbnail/atlas rendering on Canvas/WebGL
```

The exact thresholds should be measured, not guessed.

The important part is architectural permission to swap renderers.

---

# 13. Local-Only Technical Stack

Kelana should operate fully offline.

No network connection should be required for normal use.

No server should be required for:

- creating cards,
- reading PDFs,
- storing annotations,
- loading the whiteboard,
- searching local content,
- saving assets,
- reopening the application.

## 13.1 Recommended frontend stack

Recommended current stack:

- **Svelte 5**
- **TypeScript**
- **Vite**
- **Bits UI** only where its primitives help
- custom components for core Kelana surfaces

Do not let the component library define the visual language.

Use primitives, not pre-baked appearance.

## 13.2 State

Keep transient interaction state separate from persisted document state.

Examples of transient state:

- hovered object,
- selected object,
- active tool,
- open context menu,
- current drag,
- current workbench focus.

Examples of persisted state:

- board object positions,
- card markdown,
- workbench open items if session restoration is desired,
- PDF annotations,
- asset metadata,
- relationships.

Svelte stores or a small custom reactive state layer are enough.

Avoid introducing Redux-style ceremony unless the application genuinely reaches that complexity.

## 13.3 Persistence

Use:

### IndexedDB

For structured records:

- board objects,
- card content,
- annotation records,
- workbench state,
- settings,
- indexes,
- metadata.

### OPFS

For large binary assets:

- PDF bytes,
- images,
- thumbnails,
- generated previews,
- future binary attachments.

Do not duplicate PDF bytes in:

- snapshots,
- cards,
- annotations,
- undo records.

Structured records reference assets by stable asset ID.

Example:

```ts
type AssetRecord = {
  id: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  createdAt: number;
};
```

## 13.4 Stable IDs

Use stable generated IDs.

Examples:

```text
asset:...
card:...
pdf:...
annotation:...
board-object:...
```

The same entity ID should be reused across representations.

The workbench stores references, not copies.

---

# 14. Suggested Persistence Model

Example:

```ts
type Entity =
  | MarkdownEntity
  | PdfEntity
  | AnnotationEntity
  | ImageEntity;

type BoardPlacement = {
  id: string;
  entityId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

type WorkbenchPlacement = {
  id: string;
  entityId: string;
  column: "primary" | "secondary";
  order: number;
  viewState?: unknown;
};
```

This distinction is intentional.

The entity does not "live in" the whiteboard or workbench.

The entity exists once.

The whiteboard and workbench contain **placements / representations** of the entity.

This cleanly models:

- same card on board and workbench,
- same PDF on board and workbench,
- closing a workbench placement without deleting the entity,
- moving an item between workbench columns,
- preserving board position.

---

# 15. PDF Technical Implementation

Use **PDF.js** as the renderer unless profiling proves a better option is necessary.

Do not embed the default PDF.js viewer UI.

Use the rendering engine only.

Build Kelana's own minimal surface around it.

## 15.1 PDF rendering

Recommended:

- lazy render visible pages,
- unload or reuse canvases for distant pages,
- retain lightweight page metadata,
- use IntersectionObserver or equivalent viewport tracking,
- pre-render one page ahead and behind,
- avoid rendering every page at full resolution.

## 15.2 Zoom

When zoom changes:

- debounce expensive re-rendering,
- preserve scroll anchor,
- avoid rerendering all pages immediately,
- prioritize visible pages.

## 15.3 Text layer

Render a PDF.js text layer only where necessary for:

- text selection,
- search,
- annotation anchors.

Do not keep unnecessary full-detail layers alive for distant pages.

## 15.4 Annotation anchors

Prefer robust anchors:

- page number,
- text quote,
- text position,
- normalized bounding rectangle.

Do not rely on fragile absolute browser pixel coordinates.

---

# 16. Performance Strategy

Kelana should be optimized aggressively, but optimization must be evidence-driven.

## 16.1 Whiteboard viewport culling

Do not mount every whiteboard object if thousands exist.

Maintain a spatial index.

Options:

- R-tree,
- quadtree,
- grid buckets.

Only render:

- objects intersecting the viewport,
- plus a small overscan margin.

## 16.2 Level of detail

At low zoom:

- hide full markdown body,
- simplify cards,
- render title / color / shape only,
- reduce connector detail.

At high zoom:

- restore full content.

## 16.3 Object movement

During drag:

- avoid triggering expensive document layout,
- update visual transform directly,
- persist final coordinates after drag,
- batch persistence.

## 16.4 Connectors

Connectors should not trigger full board rerenders.

Recommended:

- separate connector layer,
- update only affected paths,
- simplify paths at low zoom.

## 16.5 Workers

Use Web Workers for CPU-heavy tasks:

- PDF indexing,
- full-text search indexing,
- checksum generation,
- thumbnail generation,
- large graph calculations,
- import/export transforms.

The main thread should prioritize interaction.

## 16.6 Scheduling

Use:

- `requestAnimationFrame` for visual updates,
- `requestIdleCallback` or a fallback scheduler for low-priority work,
- debounced persistence for continuous interactions,
- chunked background indexing.

Avoid giant synchronous transactions.

---

# 17. Search

Search should work entirely locally.

Possible implementation:

- custom inverted index in IndexedDB,
- MiniSearch/FlexSearch if acceptable,
- worker-based indexing.

Search sources:

- markdown content,
- PDF extracted text,
- annotation text,
- object titles,
- metadata.

Search indexing should be incremental.

Do not reindex the full workspace on every change.

---

# 18. Undo / History

Undo should operate on structured mutations.

Avoid giant state snapshots containing binary assets.

Undo records should reference:

- entity IDs,
- previous property values,
- placement changes,
- annotation mutations.

Example:

```ts
type UndoOperation =
  | { type: "move"; placementId: string; from: Point; to: Point }
  | { type: "edit-card"; entityId: string; before: string; after: string }
  | { type: "open-workbench"; placementId: string }
  | { type: "close-workbench"; placement: WorkbenchPlacement };
```

For large markdown edits, consider patch/diff strategies if profiling shows full strings are costly.

---

# 19. Accessibility and Input

Even though Kelana is visually spatial, basic accessibility must remain possible.

Support:

- keyboard focus,
- keyboard object navigation where practical,
- context menu via keyboard,
- visible focus states,
- readable contrast,
- screen-reader labels for controls,
- no icon-only action without tooltip/accessibility label.

Primary input modes:

- mouse,
- trackpad,
- keyboard.

Touch may be supported later without forcing desktop interactions to become oversized.

---

# 20. Interaction Rules That Must Stay Predictable

1. **Opening from whiteboard always targets the primary workbench column.**
2. The second column is created only by explicit user action.
3. **Move beside** is the action that creates/uses the second column.
4. Closing an item in the workbench does not delete the underlying entity.
5. The whiteboard representation remains when the item is opened in the workbench.
6. The same entity may exist visually in both surfaces.
7. Whiteboard hover controls must remain contextual, not permanent.
8. Secondary object actions belong in context menus.
9. PDF reading uses continuous scrolling.
10. Markdown editing is inline.
11. No unnecessary PDF-reader or rich-text-editor chrome.
12. No "smart" placement that unpredictably sends objects to whichever column was active.
13. Predictability is more important than cleverness.

---

# 21. Things Kelana Explicitly Should Not Become

Avoid turning Kelana into:

- Notion with a canvas,
- Miro with a PDF plugin,
- Acrobat inside a sidebar,
- a dashboard made of cards,
- a two-pane IDE clone,
- a generic "second brain" template manager,
- a toolbar-heavy design tool,
- an enterprise knowledge graph UI,
- a component-library showcase.

Avoid generic UI habits unless they solve a real problem:

- ellipsis on every card,
- toolbars everywhere,
- nested cards inside cards,
- permanent sidebars,
- decorative tabs,
- meaningless metadata,
- overly clever auto-layout,
- empty-state UI that occupies space before it is needed.

---

# 22. Design Heuristic

Whenever adding a control, ask:

> Does the user need this control during the core thinking loop?

If not, either:

- move it to context menu,
- make it contextual,
- hide it until focus/hover,
- or remove it.

Whenever adding layout:

> Does the user currently need this layout?

If not, do not render it.

Whenever adding automation:

> Is predictable behavior better than smart behavior here?

For Kelana, the answer will often be yes.

---

# 23. Product Signature

The intended signature is not a particular shade of gray or corner radius.

It is the interaction model:

**Objects are not trapped on the whiteboard.**

A user can retain spatial context while simultaneously opening a focused representation of the same material.

This creates a workflow where:

- the board preserves memory and relationships,
- the workbench provides concentration,
- annotations travel back into the board,
- source material and synthesis can coexist,
- mess remains useful instead of being automatically erased.

That is the core identity.

---

# 24. Short Version

If the entire product had to be explained in five rules:

1. **Whiteboard is the spatial brain.**
2. **Workbench is the focused hand.**
3. **Opening an object creates another view, not another copy.**
4. **The second workbench column only appears when the user asks to work beside something.**
5. **UI chrome must never compete with the material the user is thinking about.**

---

# 25. Implementation Priority

Recommended order:

## Phase 1 — interaction skeleton

- whiteboard object model,
- hover "open in workbench" affordance,
- primary workbench column,
- open same entity in board + workbench,
- close from workbench,
- markdown card surface,
- PDF continuous-scroll surface.

## Phase 2 — workbench composition

- stacked items,
- Move beside,
- second column,
- column movement,
- preserved per-item view state,
- workbench resizing.

## Phase 3 — annotation loop

- PDF selection,
- annotation creation,
- drag annotation to board,
- source backlink,
- jump from annotation back to PDF.

## Phase 4 — scale

- viewport culling,
- spatial index,
- renderer LOD,
- worker indexing,
- virtualized PDF pages,
- local full-text search.

## Phase 5 — renderer experimentation

Only after profiling:

- Canvas connector layer,
- Canvas/WebGL overview renderer,
- low-zoom card atlases,
- render swapping based on zoom / scene complexity.

Do not prematurely build a custom GPU engine if the DOM/SVG implementation already meets performance targets.

---

# 26. Final Constraint

Kelana must remain usable with networking completely disabled.

A user's whiteboard, cards, PDFs, annotations, search index, and workbench state must remain available locally.

Network-backed features, if ever introduced, must be optional extensions rather than requirements for the core product.

**Local-first is not a deployment detail. It is part of the product identity.**
