/**
 * Viewport state: the camera (pan/zoom), board size, and the space-bar pan
 * modifier. The camera itself is part of the persisted doc; the functions here
 * mutate it and mark it dirty.
 */
import type { Point } from './model';
import { doc, persist } from './doc.svelte';

export const viewport = $state({ width: 1000, height: 800, space: false });

export function point(event: { clientX: number; clientY: number }): Point {
  const r = document.querySelector<HTMLDivElement>('.board')!.getBoundingClientRect();
  return {
    x: (event.clientX - r.left - doc.camera.x) / doc.camera.zoom,
    y: (event.clientY - r.top - doc.camera.y) / doc.camera.zoom,
  };
}

export function centerPoint(): Point {
  return {
    x: (viewport.width / 2 - doc.camera.x) / doc.camera.zoom - 145,
    y: (viewport.height / 2 - doc.camera.y) / doc.camera.zoom - 100,
  };
}

export function zoom(value: number, cx = viewport.width / 2, cy = viewport.height / 2) {
  const z = Math.max(0.15, Math.min(2.5, value));
  const old = doc.camera.zoom;
  doc.camera = {
    x: cx - ((cx - doc.camera.x) * z) / old,
    y: cy - ((cy - doc.camera.y) * z) / old,
    zoom: z,
  };
  persist();
}

export function fit() {
  if (!doc.placements.length) {
    doc.camera = { x: 0, y: 0, zoom: 1 };
    return;
  }
  const minX = Math.min(...doc.placements.map((p) => p.x)),
    minY = Math.min(...doc.placements.map((p) => p.y));
  const maxX = Math.max(...doc.placements.map((p) => p.x + p.width)),
    maxY = Math.max(...doc.placements.map((p) => p.y + p.height));
  const z = Math.min(
    1.2,
    (viewport.width - 100) / (maxX - minX),
    (viewport.height - 100) / (maxY - minY),
  );
  doc.camera = {
    zoom: Math.max(0.15, z),
    x: (viewport.width - (maxX - minX) * z) / 2 - minX * z,
    y: (viewport.height - (maxY - minY) * z) / 2 - minY * z,
  };
  persist();
}

/** Center the camera on a placement (used by "reveal on board"). */
export function centerOn(placement: { x: number; y: number; width: number; height: number }) {
  doc.camera.x = viewport.width / 2 - (placement.x + placement.width / 2) * doc.camera.zoom;
  doc.camera.y = viewport.height / 2 - (placement.y + placement.height / 2) * doc.camera.zoom;
  persist();
}
