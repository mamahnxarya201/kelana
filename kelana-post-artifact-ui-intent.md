# Kelana — Post-Artifact UI Refinement Intent

You are modifying the current Kelana implementation. Treat the existing app and its last delivered artifact as the baseline. This task only covers the UI problems described below. Do not redesign unrelated areas, change the product model, or expand the feature set.

## Product feel

Kelana should feel like paper and documents floating over a spatial workspace. Persistent borders and partition lines currently make it feel like an old corporate dashboard. Controls should be visually placed over the workspace instead of appearing trapped inside toolbar boxes.

Use the supplied Heptabase screenshots as the visual reference for restraint, card shape, spacing, and control placement. Copy the underlying visual behavior, not Heptabase branding.

## 1. Remove the permanent structural lines

The current top bar has a visible horizontal bottom border. The workbench and PDF area also expose permanent vertical and horizontal separator lines. Together these lines create a rigid table/grid appearance.

Required behavior:

- Remove the board header's permanent bottom border and any separate bar-like background that makes it look boxed in.
- Let the board header visually blend into the warm canvas.
- Remove the document header's permanent bottom border and outline. Let it blend into the white reading surface.
- Make the outer board/workbench resize boundary invisible while idle.
- Make the divider between two workbench columns invisible while idle.
- Keep the resize hit areas comfortably wide. Do not make resizing harder just because the visible line disappears.
- Reveal a thin, low-contrast divider only while its resize handle is hovered, actively dragged, or keyboard-focused.
- Keep sticky document headers opaque enough to cover content scrolling underneath them, but do not use a border or conspicuous glass-blur effect.
- Individual controls may gain a subtle background on hover or focus. Do not turn the whole header into pills, cards, or shadowed containers.

Spacing and alignment must communicate grouping after the borders are removed. Preserve enough breathing room between the logo, title, status, search, and document controls. Do not compensate for missing borders by adding heavy shadows.

## 2. Double-click editing must not resize or jump the card

Currently, double-clicking a card to enter inline Markdown editing changes its dimensions. This moves text at the exact moment the user is trying to place the cursor and makes the interaction feel unstable.

Required behavior:

- On double-click, enter edit mode while preserving the card's exact width, rendered height, and board position for that frame.
- Preview mode and edit mode must use matching font metrics, line height, padding, heading spacing, list indentation, and box sizing.
- Markdown syntax may appear on the active line, but entering edit mode itself must not change the card boundary.
- Place the caret from the double-click without causing a layout jump.
- The card may grow after the user actually inserts content that needs more space.
- Content-driven growth should follow typing directly; do not animate the card's height while typing.
- Leaving edit mode should also avoid a visible size snap when the rendered Markdown content is semantically unchanged.

Fix the underlying preview/editor metric mismatch. Do not hide the problem with a delayed resize animation or a temporary transform.

## 3. Reduce the card corner radius

The current cards are too rounded and feel like generic UI panels. They should read more like sheets of paper without becoming sharp rectangles.

Required appearance:

- Use a restrained radius around `5px` to `6px` for normal cards.
- Keep the corner treatment consistent in preview, edit, selected, focused, and dragged states.
- Use a very subtle outline and shadow so cards remain distinguishable from the canvas.
- Avoid elevated SaaS-card styling, thick outlines, large shadows, or capsule-like corners.

## Interaction and animation constraints

- Preserve all existing board, workbench, PDF, two-column, fold, move, close, Markdown, and connection behavior.
- Keep the existing restrained panel, transfer, fold, and Bézier connection animations.
- Pointer dragging and resize tracking must remain immediate.
- Do not add animation to typing-driven card height changes.
- Honor reduced-motion behavior already present in the app.

## Implementation scope

Inspect the current CSS and editor/preview layout before changing code. Prefer small targeted changes, especially in the existing refinement stylesheet and the shared card/editor geometry. Avoid duplicating rules across preview and editor when one shared token or rule can keep their metrics equal.

Do not change storage, document models, keyboard shortcuts, dependencies, or application architecture for this task.

## Acceptance checks

The task is complete when all of these are true:

1. At rest, the board header, workbench boundary, internal column boundary, and document header do not form a visible grid of structural lines.
2. Resize boundaries still have usable hit areas and provide a subtle visual cue on hover, focus, and drag.
3. Double-clicking an unchanged Markdown card causes no visible width, height, position, padding, or text-baseline jump.
4. Typing additional lines can grow the card without a height transition.
5. Exiting edit mode does not snap the card when its semantic content has not changed.
6. Card corners visually match a lightly softened sheet of paper at approximately `5px`–`6px` radius.
7. Existing type checks, tests, and production build still pass.

Keep the change set focused. If a proposed change does not directly support one of these checks, leave it out.
