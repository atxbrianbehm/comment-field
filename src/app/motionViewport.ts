import type { Point2D, SpatialBezierPath } from "@comment-field/engine";

export interface EntranceEditorViewport {
  centerX: number;
  spanX: number;
  centerY: number;
  spanY: number;
}

export const DEFAULT_ENTRANCE_VIEWPORT: EntranceEditorViewport = {
  centerX: 0,
  spanX: 0.4,
  centerY: 0,
  spanY: 0.6,
};

const MIN_HORIZONTAL_SPAN = 0.4;
const MAX_HORIZONTAL_SPAN = 3.2;
const MIN_VERTICAL_SPAN = 0.35;
const MAX_VERTICAL_SPAN = 2.4;
const PATH_PADDING = 1.5;

export function motionPointToEditor(point: Point2D, viewport: EntranceEditorViewport): Point2D {
  return {
    x: 0.5 + (point.x - viewport.centerX) / viewport.spanX,
    y: 0.5 + (point.y - viewport.centerY) / viewport.spanY,
  };
}

export function editorPointToMotion(point: Point2D, viewport: EntranceEditorViewport): Point2D {
  return {
    x: viewport.centerX + (point.x - 0.5) * viewport.spanX,
    y: viewport.centerY + (point.y - 0.5) * viewport.spanY,
  };
}

export function frameEntrancePath(path: SpatialBezierPath): EntranceEditorViewport {
  const xValues = [0, path.start.x, path.control1.x, path.control2.x];
  const yValues = [0, path.start.y, path.control1.y, path.control2.y];
  const minimumX = Math.min(...xValues);
  const maximumX = Math.max(...xValues);
  const minimum = Math.min(...yValues);
  const maximum = Math.max(...yValues);
  const horizontalSpan = Math.max(MIN_HORIZONTAL_SPAN, (maximumX - minimumX) * PATH_PADDING);
  const pathSpan = Math.max(MIN_VERTICAL_SPAN, (maximum - minimum) * PATH_PADDING);
  return {
    centerX: (minimumX + maximumX) / 2,
    spanX: Math.min(MAX_HORIZONTAL_SPAN, horizontalSpan),
    centerY: (minimum + maximum) / 2,
    spanY: Math.min(MAX_VERTICAL_SPAN, pathSpan),
  };
}
