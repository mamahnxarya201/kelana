/**
 * Live state for dragging an entity out of the workbench and onto the board.
 * `x`/`y` are board-local pixels, so the board can draw a drop preview under
 * the pointer that matches where the card will actually land.
 */
export const entityDrag = $state({
  active: false,
  entityId: '',
  x: 0,
  y: 0,
  over: false,
});

export function beginEntityDrag(entityId: string) {
  entityDrag.active = true;
  entityDrag.entityId = entityId;
  entityDrag.x = 0;
  entityDrag.y = 0;
  entityDrag.over = false;
}

export function moveEntityDrag(x: number, y: number, over: boolean) {
  if (!entityDrag.active) return;
  entityDrag.x = x;
  entityDrag.y = y;
  entityDrag.over = over;
}

export function endEntityDrag() {
  entityDrag.active = false;
  entityDrag.over = false;
  entityDrag.entityId = '';
}
