import { useRef } from "react";
import type { CubicBezierCurve, Point2D } from "@comment-field/engine";

type PathPointName = "start" | "control1" | "control2" | "end";

function toStagePoint(element: Element, clientX: number, clientY: number): Point2D {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export function BezierOverlay({
  start,
  control1,
  control2,
  end,
  editable = ["start", "control1", "control2"],
  onChange,
  children,
  className = "",
  style,
}: {
  start: Point2D;
  control1: Point2D;
  control2: Point2D;
  end: Point2D;
  editable?: PathPointName[];
  onChange: (point: PathPointName, value: Point2D) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<PathPointName | null>(null);
  const path = `M ${start.x * 1000} ${start.y * 600} C ${control1.x * 1000} ${control1.y * 600}, ${control2.x * 1000} ${control2.y * 600}, ${end.x * 1000} ${end.y * 600}`;
  const points: Array<[PathPointName, Point2D]> = [["start", start], ["control1", control1], ["control2", control2], ["end", end]];

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeRef.current || !stageRef.current) return;
    onChange(activeRef.current, toStagePoint(stageRef.current, event.clientX, event.clientY));
  }

  return (
    <div
      ref={stageRef}
      className={`bezier-stage ${className}`}
      style={style}
      onPointerMove={move}
      onPointerUp={() => { activeRef.current = null; }}
      onPointerCancel={() => { activeRef.current = null; }}
    >
      {children}
      <svg
        className="bezier-overlay"
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
      >
        <path className="motion-path-shadow" d={path} />
        <path className="motion-path" d={path} />
        <line className="motion-tangent" x1={start.x * 1000} y1={start.y * 600} x2={control1.x * 1000} y2={control1.y * 600} />
        <line className="motion-tangent" x1={end.x * 1000} y1={end.y * 600} x2={control2.x * 1000} y2={control2.y * 600} />
      </svg>
      {points.map(([name, point]) => {
        const isEditable = editable.includes(name);
        return (
          <button
            key={name}
            type="button"
            aria-label={`${name.replace(/(\d)/, " $1")} path point`}
            className={`motion-point motion-point-${name} ${isEditable ? "is-editable" : ""}`}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            disabled={!isEditable}
            onPointerDown={(event) => {
              if (!isEditable) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              activeRef.current = name;
            }}
          >
            <span className="motion-point-dot" />
          </button>
        );
      })}
    </div>
  );
}

export function CurveEditor({ curve, onChange }: { curve: CubicBezierCurve; onChange: (curve: CubicBezierCurve) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<"one" | "two" | null>(null);

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeRef.current || !stageRef.current) return;
    const point = toStagePoint(stageRef.current, event.clientX, event.clientY);
    const value = { x: point.x, y: 1 - point.y };
    onChange(activeRef.current === "one"
      ? { ...curve, x1: value.x, y1: value.y }
      : { ...curve, x2: value.x, y2: value.y });
  }

  const p1 = { x: curve.x1, y: 1 - curve.y1 };
  const p2 = { x: curve.x2, y: 1 - curve.y2 };
  const path = `M 0 100 C ${p1.x * 100} ${p1.y * 100}, ${p2.x * 100} ${p2.y * 100}, 100 0`;
  return (
    <div className="curve-editor">
      <div
        ref={stageRef}
        className="curve-editor-stage"
        onPointerMove={move}
        onPointerUp={() => { activeRef.current = null; }}
        onPointerCancel={() => { activeRef.current = null; }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path className="curve-grid" d="M0 100 L100 0 M0 50 H100 M50 0 V100" />
          <line className="curve-tangent" x1="0" y1="100" x2={p1.x * 100} y2={p1.y * 100} />
          <line className="curve-tangent" x1="100" y1="0" x2={p2.x * 100} y2={p2.y * 100} />
          <path className="curve-path" d={path} />
        </svg>
        {([["one", p1], ["two", p2]] as const).map(([name, point]) => (
          <button
            key={name}
            type="button"
            aria-label={`Timing control ${name}`}
            className="curve-point"
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              activeRef.current = name;
            }}
          >
            <span className="curve-dot" />
          </button>
        ))}
      </div>
      <div className="curve-values">cubic-bezier({curve.x1.toFixed(2)}, {curve.y1.toFixed(2)}, {curve.x2.toFixed(2)}, {curve.y2.toFixed(2)})</div>
    </div>
  );
}
