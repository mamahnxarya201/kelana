/**
 * Viewport state: the camera (pan/zoom), board size, and the space-bar pan
 * modifier. The camera itself is part of the persisted doc; the functions here
 * mutate it and mark it dirty.
 */
import type { Point } from './model';
import { doc, persist } from './doc.svelte';

export const viewport = $state({ width: 1000, height: 800, space: false });

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

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

/**
 * Scale the camera about a screen-space anchor so the board point under the
 * anchor stays put. Reads the current camera as the base, so a pan that lands
 * between two frames survives untouched.
 */
function zoomAbout(value: number, cx: number, cy: number) {
  const z = clampZoom(value);
  const old = doc.camera.zoom;
  if (z === old) return;
  doc.camera = {
    x: cx - ((cx - doc.camera.x) * z) / old,
    y: cy - ((cy - doc.camera.y) * z) / old,
    zoom: z,
  };
}

/** Immediate zoom about a point (zoom buttons). Wheel and pinch animate. */
export function zoom(value: number, cx = viewport.width / 2, cy = viewport.height / 2) {
  zoomTarget = clampZoom(value);
  zoomAbout(zoomTarget, cx, cy);
  persist();
}

/*
 * Wheel and trackpad-pinch zoom.
 *
 * Chromium encodes a trackpad pinch as ctrl+wheel whose deltaY is the gesture
 * scale in disguise — deltaY = -100·ln(scale), so exp(-deltaY / 100) is exactly
 * the finger scale (crbug.com/40332613). A mouse notch is a fixed pixel delta
 * instead (33–120 px depending on platform), where that same formula would jump
 * 1.4×–3.3× in one frame. Capping a single step at MAX_STEP gives both devices
 * the same predictable notch while keeping a pinch 1:1 with the fingers — no
 * device sniffing, and the step function stays continuous.
 *
 * Wheel events arrive as discrete jumps, so the camera eases toward the
 * accumulated target instead of snapping: that is what makes a mouse wheel feel
 * continuous rather than a staircase. The anchor is captured once per gesture so
 * a moving pointer cannot drag the board around mid-animation, and the camera is
 * persisted once the motion settles instead of on every event.
 */
const MAX_STEP = 1.2;
const MIN_STEP = 1 / MAX_STEP;
/** Silence that ends a gesture and lets the next event re-anchor. */
const GESTURE_IDLE_MS = 140;
/** Time constant of the ease; ~95% of a notch lands in 3× this. */
const SMOOTHING_MS = 70;

let zoomTarget = doc.camera.zoom;
let zoomAnchor: Point | null = null;
let zoomFrame = 0;
let zoomLastFrame = 0;
let zoomLastEvent = 0;

function animateZoom(now: number) {
  zoomFrame = 0;
  const elapsed = zoomLastFrame ? Math.min(64, now - zoomLastFrame) : 16;
  zoomLastFrame = now;
  const current = doc.camera.zoom;
  const eased = current + (zoomTarget - current) * (1 - Math.exp(-elapsed / SMOOTHING_MS));
  const settled = Math.abs(zoomTarget - eased) <= zoomTarget * 0.002;
  zoomAbout(settled ? zoomTarget : eased, zoomAnchor!.x, zoomAnchor!.y);
  if (settled) {
    persist();
    return;
  }
  zoomFrame = requestAnimationFrame(animateZoom);
}

export function zoomFromWheel(event: WheelEvent) {
  const board = document.querySelector<HTMLElement>('.board');
  if (!board) return;
  const rect = board.getBoundingClientRect();
  const now = performance.now();
  if (!zoomAnchor || now - zoomLastEvent > GESTURE_IDLE_MS) {
    zoomAnchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    // A settled animation already left the target on the current zoom; a running
    // one keeps its target so the new gesture continues the same motion.
    if (!zoomFrame) zoomTarget = doc.camera.zoom;
  }
  zoomLastEvent = now;
  // deltaMode: 0 = pixels, 1 = lines, 2 = pages (Firefox reports lines for mice).
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
  const step = Math.min(MAX_STEP, Math.max(MIN_STEP, Math.exp(-pixels / 100)));
  zoomTarget = clampZoom(zoomTarget * step);
  if (!zoomFrame) {
    zoomLastFrame = 0;
    zoomFrame = requestAnimationFrame(animateZoom);
  }
}

export function fit() {
  if (!doc.placements.length) {
    doc.camera = { x: 0, y: 0, zoom: 1 };
    zoomTarget = 1;
    return;
  }
  const minX = Math.min(...doc.placements.map((p) => p.x)),
    minY = Math.min(...doc.placements.map((p) => p.y));
  const maxX = Math.max(...doc.placements.map((p) => p.x + p.width)),
    maxY = Math.max(...doc.placements.map((p) => p.y + p.height));
  const z = clampZoom(
    Math.min(1.2, (viewport.width - 100) / (maxX - minX), (viewport.height - 100) / (maxY - minY)),
  );
  doc.camera = {
    zoom: z,
    x: (viewport.width - (maxX - minX) * z) / 2 - minX * z,
    y: (viewport.height - (maxY - minY) * z) / 2 - minY * z,
  };
  zoomTarget = z;
  persist();
}

/** Center the camera on a placement (used by "reveal on board"). */
export function centerOn(placement: { x: number; y: number; width: number; height: number }) {
  doc.camera.x = viewport.width / 2 - (placement.x + placement.width / 2) * doc.camera.zoom;
  doc.camera.y = viewport.height / 2 - (placement.y + placement.height / 2) * doc.camera.zoom;
  persist();
}
