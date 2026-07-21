import type { PointerEvent as ReactPointerEvent } from "react";
import type { GestureSample } from "@comment-field/engine";
import type { RuntimeSelectionOverlay } from "@comment-field/webgpu-runtime";

export function GesturePathOverlay({
  samples, selectedIndex, time, width, height, onBegin,
}: {
  samples: GestureSample[];
  selectedIndex?: number | null;
  time: number;
  width: number;
  height: number;
  onBegin: (index: number, event: ReactPointerEvent<SVGGElement>) => void;
}) {
  return <svg className="gesture-path-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    <polyline points={samples.map((sample) => `${sample.x * width},${sample.y * height}`).join(" ")} />
    {samples.map((sample, index) => <g
      key={`${index}-${sample.time}`}
      role="button"
      tabIndex={0}
      aria-label={`Build path point ${index + 1} at ${sample.time.toFixed(2)} seconds`}
      className={`gesture-path-point ${selectedIndex === index ? "is-selected" : ""} ${sample.time <= time ? "is-past" : ""}`}
      transform={`translate(${sample.x * width} ${sample.y * height})`}
      onPointerDown={(event) => onBegin(index, event)}
    ><circle className="gesture-path-hit" r="24" /><circle className="gesture-path-dot" r="5" /><text y="-10">{index + 1}</text></g>)}
  </svg>;
}

export function TransformOverlay({
  overlay, width, height, onBegin,
}: {
  overlay: RuntimeSelectionOverlay;
  width: number;
  height: number;
  onBegin: (kind: "scale" | "rotate", event: ReactPointerEvent<SVGGElement>) => void;
}) {
  const multi = (overlay.extras?.length ?? 0) > 0;
  return <svg className={`transform-overlay ${overlay.locked ? "is-locked" : ""} ${multi ? "is-multi" : ""}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    {overlay.extras?.map((extra, index) => (
      <polygon key={`extra-${index}`} className="selection-extra" points={extra.points.map((point) => `${point.x},${point.y}`).join(" ")} />
    ))}
    <polygon points={overlay.points.map((point) => `${point.x},${point.y}`).join(" ")} />
    {!multi && <line x1={overlay.center.x} y1={overlay.center.y} x2={overlay.rotationHandle.x} y2={overlay.rotationHandle.y} />}
    {!multi && overlay.points.map((point, index) => <g key={index} className="transform-handle scale-handle" transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => onBegin("scale", event)}><circle className="transform-hit" r="24" /><rect x="-6" y="-6" width="12" height="12" rx="3" /></g>)}
    {!multi && <g className="transform-handle rotate-handle" transform={`translate(${overlay.rotationHandle.x} ${overlay.rotationHandle.y})`} onPointerDown={(event) => onBegin("rotate", event)}><circle className="transform-hit" r="24" /><circle r="7" /></g>}
    {overlay.locked && <text x={overlay.center.x} y={overlay.center.y}>Locked</text>}
  </svg>;
}
