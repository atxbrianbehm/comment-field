import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pause, Play, RotateCcw } from "lucide-react";
import {
  evaluateExitComponents,
  type CardPopulationSettings,
  type CardStyle,
  type CommentRecord,
  type ExitPathMode,
  type Point2D,
} from "@comment-field/engine";
import { CardPreview } from "./CardPreview";
import { BezierOverlay, CurveEditor } from "./MotionEditors";
import { DEFAULT_ENTRANCE_VIEWPORT, editorPointToMotion, frameEntrancePath, motionPointToEditor } from "./motionViewport";
import { PanelSection, SelectField, Slider } from "./Controls";

const EXIT_DEPTH_MIN = -8;
const EXIT_DEPTH_MAX = 8;
const EXIT_DEPTH_PIXELS_PER_UNIT = 8;
const EXIT_ROTATION_MIN = -Math.PI;
const EXIT_ROTATION_MAX = Math.PI;
const EXIT_ROTATION_HANDLE_RADIUS = 104;

export function ExitWorkspace({
  comment,
  style,
  population,
  frameRate = 24,
  onPopulationChange,
  onBack,
  onReset,
}: {
  comment: CommentRecord;
  style: CardStyle;
  population: CardPopulationSettings;
  frameRate?: number;
  onPopulationChange: (population: CardPopulationSettings) => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const samplePath = evaluateExitComponents(population, comment.id, 0, 0).path;
  const [viewport, setViewport] = useState(() => frameEntrancePath(samplePath));
  const startedRef = useRef(0);
  const depthDragRef = useRef<null | { pointerId: number; x: number; y: number; depth: number; axisX: number; axisY: number }>(null);
  const rotationGizmoRef = useRef<HTMLDivElement>(null);
  const rotationDragRef = useRef<null | { pointerId: number; pointerAngle: number; rotation: number }>(null);
  const motion = population.exitMotion;

  useEffect(() => {
    if (!playing) return;
    startedRef.current = performance.now() - progress * population.exitDuration * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const next = (now - startedRef.current) / Math.max(1, population.exitDuration * 1000);
      if (next >= 1) {
        setProgress(1);
        setPlaying(false);
        return;
      }
      setProgress(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, population.exitDuration]);

  const sample = evaluateExitComponents(population, comment.id, 0, progress);
  const finalSample = evaluateExitComponents(population, comment.id, 0, 1);
  const path = sample.path;
  const settle = motionPointToEditor({ x: 0, y: 0 }, viewport);
  const destination = motionPointToEditor(path.start, viewport);
  const control1 = motionPointToEditor(path.control1, viewport);
  const control2 = motionPointToEditor(path.control2, viewport);
  const visualPoint = motionPointToEditor(sample.position, viewport);
  const projectDepth = (depth: number) => Math.min(3.5, Math.max(0.4, 5 / Math.max(1.4, 5 - depth)));
  const visualScale = sample.scale * projectDepth(sample.depth);
  const destinationScale = finalSample.scale * projectDepth(finalSample.depth);
  const isScatter = motion.pathMode === "scatter";

  function updatePath(point: "start" | "control1" | "control2" | "end", value: Point2D) {
    if (point === "end") return;
    const editablePath = isScatter ? path : motion.path;
    onPopulationChange({
      ...population,
      exitMotion: {
        ...motion,
        pathMode: "shared",
        path: { ...editablePath, [point]: editorPointToMotion(value, viewport) },
      },
    });
  }

  function setPathMode(pathMode: ExitPathMode) {
    const next = { ...population, exitMotion: { ...motion, pathMode } };
    onPopulationChange(next);
    setViewport(frameEntrancePath(evaluateExitComponents(next, comment.id, 0, 0).path));
  }

  function updateMotion(patch: Partial<typeof motion>) {
    onPopulationChange({ ...population, exitMotion: { ...motion, ...patch } });
  }

  function setScatterDistance(exitDistance: number) {
    const next = { ...population, exitDistance };
    onPopulationChange(next);
    setViewport(frameEntrancePath(evaluateExitComponents(next, comment.id, 0, 0).path));
  }

  const depthAxis = {
    x: destination.x > 0.65 ? -Math.SQRT1_2 : Math.SQRT1_2,
    y: destination.y < 0.35 ? Math.SQRT1_2 : -Math.SQRT1_2,
  };
  const depthAxisAngle = Math.atan2(depthAxis.y, depthAxis.x) * 180 / Math.PI;
  const depthHandleDistance = 82 + motion.depthOffset * EXIT_DEPTH_PIXELS_PER_UNIT;

  function setDepthOffset(value: number) {
    updateMotion({ depthOffset: Math.min(EXIT_DEPTH_MAX, Math.max(EXIT_DEPTH_MIN, value)) });
  }

  function beginDepthDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    depthDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, depth: motion.depthOffset, axisX: depthAxis.x, axisY: depthAxis.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDepthDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = depthDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const projectedPixels = (event.clientX - drag.x) * drag.axisX + (event.clientY - drag.y) * drag.axisY;
    setDepthOffset(drag.depth + projectedPixels / EXIT_DEPTH_PIXELS_PER_UNIT);
  }

  function endDepthDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (depthDragRef.current?.pointerId !== event.pointerId) return;
    depthDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function setRotationOffset(value: number) {
    updateMotion({ rotationOffset: Math.min(EXIT_ROTATION_MAX, Math.max(EXIT_ROTATION_MIN, value)) });
  }

  function pointerAngle(event: Pick<React.PointerEvent<HTMLButtonElement>, "clientX" | "clientY">) {
    const rect = rotationGizmoRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.atan2(event.clientY - rect.top, event.clientX - rect.left);
  }

  function beginRotationDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    rotationDragRef.current = { pointerId: event.pointerId, pointerAngle: pointerAngle(event), rotation: motion.rotationOffset };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveRotationDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = rotationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    let delta = pointerAngle(event) - drag.pointerAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    setRotationOffset(drag.rotation + delta);
  }

  function endRotationDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (rotationDragRef.current?.pointerId !== event.pointerId) return;
    rotationDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <section className="authoring-workspace animate-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div><span>Shared out template</span><strong>Shape how living posts leave the field.</strong></div>
        </div>
        <BezierOverlay
          start={destination}
          control1={control1}
          control2={control2}
          end={settle}
          editable={["start", "control1", "control2"]}
          onChange={updatePath}
        >
          <div className="motion-preview-card ghost-card" style={{
            left: `${settle.x * 100}%`, top: `${settle.y * 100}%`,
            transform: "translate(-50%, -50%)", opacity: 0.3,
          }}><CardPreview comment={comment} style={style} /></div>
          <div className="motion-preview-card active-card" style={{
            left: `${visualPoint.x * 100}%`, top: `${visualPoint.y * 100}%`,
            transform: `translate(-50%, -50%) scale(${visualScale}) rotate(${sample.rotation}rad)`,
            opacity: sample.opacity, filter: `blur(${sample.blur}px)`,
          }}><CardPreview comment={comment} style={style} /></div>
          <div className="motion-preview-card ghost-card exit-destination-preview" style={{
            left: `${destination.x * 100}%`, top: `${destination.y * 100}%`,
            transform: `translate(-50%, -50%) scale(${destinationScale}) rotate(${finalSample.rotation}rad)`,
            opacity: 0.2,
          }}><CardPreview comment={comment} style={style} /></div>
          <div className="exit-depth-gizmo" style={{ left: `${destination.x * 100}%`, top: `${destination.y * 100}%` }}>
            <span className="exit-depth-axis" style={{ rotate: `${depthAxisAngle}deg` }} />
            <span className="exit-depth-back" style={{ left: `${depthAxis.x * 18}px`, top: `${depthAxis.y * 18}px` }}>B</span>
            <span className="exit-depth-forward" style={{ left: `${depthAxis.x * 146}px`, top: `${depthAxis.y * 146}px` }}>F</span>
            <button
              type="button"
              role="slider"
              aria-label="Exit depth forward backward"
              aria-valuemin={EXIT_DEPTH_MIN}
              aria-valuemax={EXIT_DEPTH_MAX}
              aria-valuenow={motion.depthOffset}
              className="exit-depth-handle"
              style={{ left: `${depthAxis.x * depthHandleDistance}px`, top: `${depthAxis.y * depthHandleDistance}px` }}
              onPointerDown={beginDepthDrag}
              onPointerMove={moveDepthDrag}
              onPointerUp={endDepthDrag}
              onPointerCancel={endDepthDrag}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); setDepthOffset(motion.depthOffset + 0.05); }
                if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); setDepthOffset(motion.depthOffset - 0.05); }
              }}
            >
              <span className="exit-depth-cube">Z</span>
              <output>{motion.depthOffset >= 0 ? "+" : ""}{motion.depthOffset.toFixed(2)}</output>
            </button>
          </div>
          <div ref={rotationGizmoRef} className="exit-rotation-gizmo" style={{ left: `${destination.x * 100}%`, top: `${destination.y * 100}%` }}>
            <span className="exit-rotation-arm" style={{ rotate: `${motion.rotationOffset - Math.PI / 2}rad` }} />
            <button
              type="button"
              role="slider"
              aria-label="Exit card rotation"
              aria-valuemin={EXIT_ROTATION_MIN}
              aria-valuemax={EXIT_ROTATION_MAX}
              aria-valuenow={motion.rotationOffset}
              className="exit-rotation-handle"
              style={{
                left: `${Math.cos(motion.rotationOffset - Math.PI / 2) * EXIT_ROTATION_HANDLE_RADIUS}px`,
                top: `${Math.sin(motion.rotationOffset - Math.PI / 2) * EXIT_ROTATION_HANDLE_RADIUS}px`,
              }}
              onPointerDown={beginRotationDrag}
              onPointerMove={moveRotationDrag}
              onPointerUp={endRotationDrag}
              onPointerCancel={endRotationDrag}
              onKeyDown={(event) => {
                const step = Math.PI / 180;
                if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); setRotationOffset(motion.rotationOffset + step); }
                if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); setRotationOffset(motion.rotationOffset - step); }
                if (event.key === "Home") { event.preventDefault(); setRotationOffset(0); }
              }}
            >
              <span className="exit-rotation-knob"><RotateCcw size={15} /></span>
              <output>{(motion.rotationOffset * 180 / Math.PI).toFixed(1)}°</output>
            </button>
          </div>
        </BezierOverlay>
        <div className="motion-transport">
          <button className="play-button compact" onClick={() => { if (progress >= 0.999) setProgress(0); setPlaying(!playing); }}>
            {playing ? <Pause size={17} /> : <Play className="play-shift" size={17} />}
          </button>
          <input type="range" min={0} max={1} step={0.001} value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }} />
          <output>{Math.round(progress * population.exitDuration * frameRate)}f</output>
          <button className="secondary-button" onClick={() => { setPlaying(false); setProgress(0); }}><RotateCcw size={15} />Restart</button>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Path framing" meta="Editor view only">
          <Slider label="Horizontal range" min={0.4} max={3.2} step={0.05} value={viewport.spanX} display={viewport.spanX.toFixed(2)} onChange={(event) => setViewport({ ...viewport, spanX: Number(event.target.value) })} />
          <Slider label="Horizontal center" min={-1.5} max={1.5} step={0.025} value={viewport.centerX} display={viewport.centerX.toFixed(2)} onChange={(event) => setViewport({ ...viewport, centerX: Number(event.target.value) })} />
          <Slider label="Vertical range" min={0.35} max={2.4} step={0.05} value={viewport.spanY} display={viewport.spanY.toFixed(2)} onChange={(event) => setViewport({ ...viewport, spanY: Number(event.target.value) })} />
          <Slider label="View center" min={-1} max={1} step={0.025} value={viewport.centerY} display={viewport.centerY.toFixed(2)} onChange={(event) => setViewport({ ...viewport, centerY: Number(event.target.value) })} />
          <button className="secondary-button wide" onClick={() => setViewport(frameEntrancePath(path))}>Frame full path</button>
        </PanelSection>
        <PanelSection title="Departure mode" meta="Take-specific">
          <SelectField label="Out line" value={motion.pathMode} onChange={(event) => setPathMode(event.target.value as ExitPathMode)}>
            <option value="scatter">Scattered lines</option>
            <option value="shared">Shared line</option>
          </SelectField>
          {isScatter ? <>
            <Slider label="Travel distance" min={0.02} max={1.2} step={0.025} value={population.exitDistance} display={population.exitDistance.toFixed(2)} onChange={(event) => setScatterDistance(Number(event.target.value))} />
            <p className="panel-note">Each card gets a seeded line. Drag any spline point to promote this representative path into an editable shared line.</p>
          </> : <p className="panel-note">Drag the destination and curve points to author one shared out line for every card.</p>}
        </PanelSection>
        <PanelSection title="Exit transform" meta="Shared out motion">
          <Slider label="Duration" min={3} max={Math.round(3 * frameRate)} step={1} value={Math.round(population.exitDuration * frameRate)} display={`${Math.round(population.exitDuration * frameRate)}f`} onChange={(event) => onPopulationChange({ ...population, exitDuration: Number(event.target.value) / frameRate })} />
          <Slider label="Fade" min={0} max={1} step={0.01} value={motion.fade} display={`${Math.round(motion.fade * 100)}%`} onChange={(event) => updateMotion({ fade: Number(event.target.value) })} />
          <Slider label="Blur to" min={0} max={24} step={0.25} value={motion.blur} display={`${motion.blur.toFixed(1)}px`} onChange={(event) => updateMotion({ blur: Number(event.target.value) })} />
          <Slider label="Scale to" min={0.2} max={2} step={0.01} value={motion.scaleTo} onChange={(event) => updateMotion({ scaleTo: Number(event.target.value) })} />
          <Slider label="Rotation offset" min={EXIT_ROTATION_MIN} max={EXIT_ROTATION_MAX} step={0.01} value={motion.rotationOffset} display={`${(motion.rotationOffset * 180 / Math.PI).toFixed(1)}°`} onChange={(event) => setRotationOffset(Number(event.target.value))} />
          <Slider label="Depth offset" min={EXIT_DEPTH_MIN} max={EXIT_DEPTH_MAX} step={0.05} value={motion.depthOffset} onChange={(event) => updateMotion({ depthOffset: Number(event.target.value) })} />
        </PanelSection>
        <PanelSection title="Out curve" meta="Independent from In">
          <CurveEditor curve={motion.easing} onChange={(easing) => updateMotion({ easing })} />
          <div className="curve-presets">
            <button onClick={() => updateMotion({ easing: { x1: 0, y1: 0, x2: 1, y2: 1 } })}>Linear</button>
            <button onClick={() => updateMotion({ easing: { x1: 0.4, y1: 0, x2: 0.7, y2: 1 } })}>Ease in</button>
            <button onClick={() => updateMotion({ easing: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } })}>Ease in/out</button>
          </div>
        </PanelSection>
        <PanelSection title="Out opacity curve" meta="Opacity only">
          <CurveEditor curve={motion.opacityEasing ?? motion.easing} onChange={(opacityEasing) => updateMotion({ opacityEasing })} />
          <div className="curve-presets">
            <button onClick={() => updateMotion({ opacityEasing: { x1: 0, y1: 0, x2: 1, y2: 1 } })}>Linear</button>
            <button onClick={() => updateMotion({ opacityEasing: { x1: 0.42, y1: 0, x2: 1, y2: 1 } })}>Ease in</button>
            <button onClick={() => updateMotion({ opacityEasing: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } })}>Ease out</button>
          </div>
          <button className="secondary-button wide" onClick={() => { onReset(); setViewport(DEFAULT_ENTRANCE_VIEWPORT); setProgress(0); }}><RotateCcw size={15} />Reset out template</button>
        </PanelSection>
      </aside>
    </section>
  );
}
