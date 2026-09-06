# Agreed interaction revision

This document extends `product-spec.md` with the decisions made after reviewing the user's Heptabase screenshots and shared-view recording. It describes Kelana's implementation, not claims about undocumented Heptabase behavior.

1. The workbench may dominate the viewport when the user's focus shifts right. The board becomes a spatial cue. Changing panel width never rearranges cards or auto-fits the camera.
2. Board controls stop at the board boundary. Workbench controls belong to its document headers. There is no global Workbench title/count strip.
3. Two columns are available for all content combinations, including note + note. Open always targets primary. Move beside is explicit and disabled for a lone item.
4. Remember single width, double width, and split ratio separately. Start balanced, do not infer sizing from document type. The inner and outer dividers track the pointer directly.
5. Each column owns its vertical reading scroll. PDF pages share that flow. Headers stick while their item is traversed. Manual fold preserves the underlying item and view state; close removes its workbench placement only.
6. Collapse empty secondary space. Promote a surviving secondary stack if primary becomes empty. This avoids an empty visual column without deleting or duplicating content.
7. Hover-open controls are small panel glyphs in a permanently reserved strip above card content. Their hit area never overlays the title. Hover does not cause content movement.
8. Double-click content to edit on the board. New cards start editing on the board. Workbench editing is optional, not a prerequisite.
9. Active-line Markdown syntax is visible; inactive syntax is concealed through editor decorations. Multi-line selections reveal every selected line. Static and edited list content has faint indentation guides.
10. Inactive cards only render a preview. Only an actively edited representation owns a CodeMirror editor. Both representations reference the same entity; changes update the other view.
11. Animate explicit changes of place or layout, not typing. Respect reduced motion. Keep card dragging, connection previews, and divider movement immediate.
12. Connections use SVG cubic curves with continuous edge intersections and smoothly blended tangent normals. Only incident paths update while a card is dragged; final coordinates are persisted on release.

Validation: type/Svelte checks, production build, and nine model/editor/geometry regression tests. Browser interaction, visual, and offline-reload testing remains unperformed in this environment. In particular, PDF reading-anchor restoration through large mixed-page documents and simultaneous column transitions still needs hands-on evaluation.
