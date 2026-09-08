import type { ConnectionSide, Placement, Point } from './model';

type Box = Pick<Placement, 'x' | 'y' | 'width' | 'height'>;

export type BezierConfig = {
  curvature: number;
  minControlDistance: number;
  maxControlDistance: number;
  sourcePull: number;
  targetPull: number;
};

export const defaultBezierConfig: BezierConfig = {
  curvature: 0.35,
  minControlDistance: 40,
  maxControlDistance: 150,
  sourcePull: 1.35,
  targetPull: 1.65,
};

const normals: Record<ConnectionSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function connectionPoint(box: Box, side: ConnectionSide): Point {
  if (side === 'top') return { x: box.x + box.width / 2, y: box.y };
  if (side === 'right') return { x: box.x + box.width, y: box.y + box.height / 2 };
  if (side === 'bottom') return { x: box.x + box.width / 2, y: box.y + box.height };
  return { x: box.x, y: box.y + box.height / 2 };
}

export function nearestConnectionSide(box: Box, point: Point): ConnectionSide {
  const sides: ConnectionSide[] = ['top', 'right', 'bottom', 'left'];
  return sides.reduce((nearest, side) => {
    const current = connectionPoint(box, side);
    const best = connectionPoint(box, nearest);
    return Math.hypot(point.x - current.x, point.y - current.y) <
      Math.hypot(point.x - best.x, point.y - best.y)
      ? side
      : nearest;
  });
}

export function facingConnectionSides(a: Box, b: Box): [ConnectionSide, ConnectionSide] {
  const bCenter = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const aCenter = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  return [nearestConnectionSide(a, bCenter), nearestConnectionSide(b, aCenter)];
}

function curveGeometry(
  a: Box,
  b: Box,
  sourceSide?: ConnectionSide,
  targetSide?: ConnectionSide,
  config: BezierConfig = defaultBezierConfig,
) {
  const fallback = facingConnectionSides(a, b);
  const fromSide = sourceSide ?? fallback[0];
  const toSide = targetSide ?? fallback[1];
  const source = connectionPoint(a, fromSide);
  const target = connectionPoint(b, toSide);
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const bend = Math.max(
    config.minControlDistance,
    Math.min(config.maxControlDistance, distance * config.curvature),
  );
  const fromNormal = normals[fromSide];
  const toNormal = normals[toSide];
  return {
    source,
    target,
    sourceControl: {
      x: source.x + fromNormal.x * bend * config.sourcePull,
      y: source.y + fromNormal.y * bend * config.sourcePull,
    },
    targetControl: {
      x: target.x + toNormal.x * bend * config.targetPull,
      y: target.y + toNormal.y * bend * config.targetPull,
    },
  };
}

export function connectionPath(
  a: Box,
  b: Box,
  sourceSide?: ConnectionSide,
  targetSide?: ConnectionSide,
  config: BezierConfig = defaultBezierConfig,
): string {
  const { source, target, sourceControl, targetControl } = curveGeometry(
    a,
    b,
    sourceSide,
    targetSide,
    config,
  );
  return `M${source.x} ${source.y} C${sourceControl.x} ${sourceControl.y},${targetControl.x} ${targetControl.y},${target.x} ${target.y}`;
}

export function previewPath(
  a: Box,
  side: ConnectionSide,
  point: Point,
  config: BezierConfig = defaultBezierConfig,
) {
  const source = connectionPoint(a, side);
  const distance = Math.hypot(point.x - source.x, point.y - source.y);
  const bend = Math.max(
    config.minControlDistance,
    Math.min(config.maxControlDistance, distance * config.curvature),
  );
  const normal = normals[side];
  const sourceBend = bend * config.sourcePull;
  return `M${source.x} ${source.y} C${source.x + normal.x * sourceBend} ${source.y + normal.y * sourceBend},${point.x} ${point.y},${point.x} ${point.y}`;
}
