import type { CubicBezierCurve, Point2D, SpatialBezierPath } from "../models/types";
import { clamp, lerp } from "../utils/math";

export function cubicPoint(start: Point2D, control1: Point2D, control2: Point2D, end: Point2D, t: number): Point2D {
  const n = clamp(t);
  const inverse = 1 - n;
  const a = inverse ** 3;
  const b = 3 * inverse ** 2 * n;
  const c = 3 * inverse * n ** 2;
  const d = n ** 3;
  return {
    x: start.x * a + control1.x * b + control2.x * c + end.x * d,
    y: start.y * a + control1.y * b + control2.y * c + end.y * d,
  };
}

export function evaluateSpatialPath(path: SpatialBezierPath, progress: number): Point2D {
  return cubicPoint(path.start, path.control1, path.control2, { x: 0, y: 0 }, progress);
}

function sampleCurveX(curve: CubicBezierCurve, t: number) {
  return cubicPoint({ x: 0, y: 0 }, { x: curve.x1, y: curve.y1 }, { x: curve.x2, y: curve.y2 }, { x: 1, y: 1 }, t).x;
}

export function evaluateBezierCurve(curve: CubicBezierCurve, progress: number): number {
  const target = clamp(progress);
  if (target <= 0) return 0;
  if (target >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 14; index += 1) {
    const midpoint = (low + high) / 2;
    if (sampleCurveX(curve, midpoint) < target) low = midpoint;
    else high = midpoint;
  }
  const t = (low + high) / 2;
  return cubicPoint({ x: 0, y: 0 }, { x: curve.x1, y: curve.y1 }, { x: curve.x2, y: curve.y2 }, { x: 1, y: 1 }, t).y;
}

/**
 * Inverse of {@link evaluateBezierCurve}: given a y value, solve for the x that produces it.
 * Used when a curve is authored as cumulative progress over time (e.g. arrival density),
 * so a unit sample maps to the time when that fraction of events should have fired.
 */
export function invertBezierCurve(curve: CubicBezierCurve, value: number): number {
  const target = clamp(value);
  if (target <= 0) return 0;
  if (target >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const midpoint = (low + high) / 2;
    if (evaluateBezierCurve(curve, midpoint) < target) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

export function relativePathBetween(path: SpatialBezierPath, from: Point2D, to: Point2D, progress: number): Point2D {
  const offset = evaluateSpatialPath(path, progress);
  return {
    x: lerp(from.x, to.x, progress) + offset.x,
    y: lerp(from.y, to.y, progress) + offset.y,
  };
}
