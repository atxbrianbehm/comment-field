import type { Point2D, SpatialBezierPath } from "../models/types";

export interface EntranceEditorViewport {
  centerY: number;
  spanY: number;
}

export const DEFAULT_ENTRANCE_VIEWPORT: EntranceEditorViewport = {
  centerY: 0,
  spanY: 0.6,
};

const HORIZONTAL_SPAN = 0.4;
const MIN_VERTICAL_SPAN = 0.35;
const MAX_VERTICAL_SPAN = 2.4;

export function motionPointToEditor(point: Point2D, viewport: EntranceEditorViewport): Point2D {
  return {
    x: 0.5 + point.x / HORIZONTAL_SPAN,
    y: 0.5 + (point.y - viewport.centerY) / viewport.spanY,
  };
}

export function editorPointToMotion(point: Point2D, viewport: EntranceEditorViewport): Point2D {
  return {
    x: (point.x - 0.5) * HORIZONTAL_SPAN,
    y: viewport.centerY + (point.y - 0.5) * viewport.spanY,
  };
}

export function frameEntrancePath(path: SpatialBezierPath): EntranceEditorViewport {
  const yValues = [0, path.start.y, path.control1.y, path.control2.y];
  const minimum = Math.min(...yValues);
  const maximum = Math.max(...yValues);
  const pathSpan = Math.max(MIN_VERTICAL_SPAN, (maximum - minimum) * 1.35);
  return {
    centerY: (minimum + maximum) / 2,
    spanY: Math.min(MAX_VERTICAL_SPAN, pathSpan),
  };
}
