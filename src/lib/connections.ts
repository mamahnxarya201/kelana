import type { Placement, Point } from './model';
type Box = Pick<Placement, 'x' | 'y' | 'width' | 'height'>;
/** Ray intersections move continuously around card edges. Smooth normals prevent corner snapping. */
function anchor(box: Box, target: Point) {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    dx = target.x - center.x,
    dy = target.y - center.y;
  if (!box.width && !box.height) return { ...center, nx: 0, ny: 0 };
  const halfW = Math.max(1, box.width / 2),
    halfH = Math.max(1, box.height / 2);
  const t = Math.min(halfW / Math.max(0.001, Math.abs(dx)), halfH / Math.max(0.001, Math.abs(dy)));
  const rx = Math.abs(dx) / halfW,
    ry = Math.abs(dy) / halfH,
    scale = Math.max(rx, ry, 0.001);
  const nx = Math.sign(dx) * Math.pow(rx / scale, 8),
    ny = Math.sign(dy) * Math.pow(ry / scale, 8),
    length = Math.hypot(nx, ny) || 1;
  return { x: center.x + dx * t, y: center.y + dy * t, nx: nx / length, ny: ny / length };
}
export function connectionPath(a: Box, b: Box): string {
  const source = anchor(a, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const target = anchor(b, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
  const bend = Math.max(
    30,
    Math.min(180, Math.hypot(target.x - source.x, target.y - source.y) * 0.4),
  );
  return `M${source.x} ${source.y} C${source.x + source.nx * bend} ${source.y + source.ny * bend},${target.x + target.nx * bend} ${target.y + target.ny * bend},${target.x} ${target.y}`;
}
export function previewPath(a: Box, point: Point) {
  return connectionPath(a, { ...point, width: 0, height: 0 });
}
