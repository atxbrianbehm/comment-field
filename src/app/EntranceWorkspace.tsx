import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Copy, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, Trash2 } from "lucide-react";
import {
  cameraFrameInField,
  compositionWorldDimensions,
  DEFAULT_CAMERA_EASING,
  evaluateCamera,
  evaluateEntranceComponents,
  fieldPointToWorld,
  findKeyframeAt,
  heroStartTime,
  projectWorldPoint,
  snapTime,
  sortedHeroKeyframes,
  sortKeyframes,
  upsertCameraKeyframe,
  upsertKeyframe,
  type CameraKeyframe,
  type CameraPose,
  type CardStyle,
  type CommentRecord,
  type Composition,
  type EntranceMotionTemplate,
  type HeroKeyframe,
  type HeroPerformance,
  type Point2D,
  type Take,
} from "@comment-field/engine";
import { CommentScene, type CacheStatus, type CommentSceneHandle, type TransformPatch } from "../renderer/CommentScene";
import { CardPreview } from "./CardPreview";
import { BezierOverlay, CurveEditor } from "./MotionEditors";
import { DEFAULT_ENTRANCE_VIEWPORT, editorPointToMotion, frameEntrancePath, motionPointToEditor } from "./motionViewport";
import { Field, PanelSection, SelectField, Slider } from "./Controls";

export function EntranceWorkspace({
  comment,
  style,
  motion,
  onMotionChange,
  onBack,
  onReset,
}: {
  comment: CommentRecord;
  style: CardStyle;
  motion: EntranceMotionTemplate;
  onMotionChange: (motion: EntranceMotionTemplate) => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [viewport, setViewport] = useState(DEFAULT_ENTRANCE_VIEWPORT);
  const startedRef = useRef(0);
  const previewDuration = motion.duration + 4;

  useEffect(() => {
    if (!playing) return;
    startedRef.current = performance.now() - progress * previewDuration * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const next = (now - startedRef.current) / Math.max(1, previewDuration * 1000);
      if (next >= 1) {
        startedRef.current = now;
        setProgress(0);
      } else setProgress(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, previewDuration]);

  const previewTime = progress * previewDuration;
  const motionSample = evaluateEntranceComponents(motion, previewTime / motion.duration, previewTime, "entrance-preview", comment.id);
  const visualPoint = motionPointToEditor(motionSample.position, viewport);
  const startPoint = motionPointToEditor(motion.path.start, viewport);
  const visual = {
    scale: motionSample.scale,
    rotation: motionSample.rotation,
    opacity: motionSample.opacity,
    blur: motionSample.blur,
  };
  const startVisual = {
    scale: motion.scaleFrom,
    rotation: motion.rotationOffset,
    blur: motion.blur,
  };
  const end = motionPointToEditor({ x: 0, y: 0 }, viewport);
  const start = startPoint;
  const control1 = motionPointToEditor(motion.path.control1, viewport);
  const control2 = motionPointToEditor(motion.path.control2, viewport);

  function updatePath(point: "start" | "control1" | "control2" | "end", value: Point2D) {
    if (point === "end") return;
    onMotionChange({ ...motion, path: { ...motion.path, [point]: editorPointToMotion(value, viewport) } });
  }

  return (
    <section className="authoring-workspace animate-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div><span>Shared entrance template</span><strong>Shape how every ordinary post arrives.</strong></div>
        </div>
        <BezierOverlay start={start} control1={control1} control2={control2} end={end} onChange={updatePath}>
          <div className="motion-preview-card ghost-card" style={{
            left: `${startPoint.x * 100}%`,
            top: `${startPoint.y * 100}%`,
            transform: `translate(-50%, -50%) scale(${startVisual.scale}) rotate(${startVisual.rotation}rad)`,
            filter: `blur(${Math.min(3, startVisual.blur)}px) grayscale(1)`,
          }}><CardPreview comment={comment} style={style} /></div>
          <div className="motion-preview-card active-card" style={{
            left: `${visualPoint.x * 100}%`,
            top: `${visualPoint.y * 100}%`,
            transform: `translate(-50%, -50%) scale(${visual.scale}) rotate(${visual.rotation}rad)`,
            opacity: visual.opacity,
            filter: `blur(${visual.blur}px)`,
          }}><CardPreview comment={comment} style={style} /></div>
        </BezierOverlay>
        <div className="motion-transport">
          <button className="play-button compact" onClick={() => { if (progress >= 0.999) setProgress(0); setPlaying(!playing); }}>
            {playing ? <Pause size={17} /> : <Play className="play-shift" size={17} />}
          </button>
          <input type="range" min={0} max={1} step={0.001} value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }} />
          <output>{previewTime.toFixed(2)}s</output>
          <button className="secondary-button" onClick={() => { setPlaying(false); setProgress(0); }}><RotateCcw size={15} />Restart</button>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Path framing" meta="Editor view only">
          <Slider label="Vertical range" min={0.35} max={2.4} step={0.05} value={viewport.spanY} display={viewport.spanY.toFixed(2)} onChange={(event) => setViewport({ ...viewport, spanY: Number(event.target.value) })} />
          <Slider label="View center" min={-1} max={1} step={0.025} value={viewport.centerY} display={viewport.centerY.toFixed(2)} onChange={(event) => setViewport({ ...viewport, centerY: Number(event.target.value) })} />
          <button className="secondary-button wide" onClick={() => setViewport(frameEntrancePath(motion.path))}>Frame full path</button>
        </PanelSection>
        <PanelSection title="Entrance transform" meta="Shared globally">
          <Slider label="Duration" min={0.1} max={4} step={0.05} value={motion.duration} display={`${motion.duration.toFixed(2)}s`} onChange={(event) => onMotionChange({ ...motion, duration: Number(event.target.value) })} />
          <Slider label="Fade" min={0} max={1} step={0.01} value={motion.fade} onChange={(event) => onMotionChange({ ...motion, fade: Number(event.target.value) })} />
          <Slider label="Blur" min={0} max={20} step={0.25} value={motion.blur} display={`${motion.blur.toFixed(1)}px`} onChange={(event) => onMotionChange({ ...motion, blur: Number(event.target.value) })} />
          <Slider label="Scale from" min={0.2} max={1.5} step={0.01} value={motion.scaleFrom} onChange={(event) => onMotionChange({ ...motion, scaleFrom: Number(event.target.value) })} />
          <Slider label="Rotation offset" min={-0.8} max={0.8} step={0.01} value={motion.rotationOffset} display={`${(motion.rotationOffset * 57.2958).toFixed(1)}°`} onChange={(event) => onMotionChange({ ...motion, rotationOffset: Number(event.target.value) })} />
          <Slider label="Depth offset" min={-2} max={2} step={0.01} value={motion.depthOffset} onChange={(event) => onMotionChange({ ...motion, depthOffset: Number(event.target.value) })} />
        </PanelSection>
        <PanelSection title="Natural settle" meta="Deterministic">
          <Slider label="Spring amount" min={0} max={0.5} step={0.01} value={motion.springAmount} display={`${Math.round(motion.springAmount * 100)}%`} onChange={(event) => onMotionChange({ ...motion, springAmount: Number(event.target.value) })} />
          <Slider label="Spring bounces" min={0} max={3} step={0.25} value={motion.springBounces} display={motion.springBounces.toFixed(2)} onChange={(event) => onMotionChange({ ...motion, springBounces: Number(event.target.value) })} />
          <Slider label="Spring damping" min={0} max={10} step={0.25} value={motion.springDamping} display={motion.springDamping.toFixed(2)} onChange={(event) => onMotionChange({ ...motion, springDamping: Number(event.target.value) })} />
        </PanelSection>
        <PanelSection title="Ambient drift" meta="After arrival">
          <Slider label="Position drift" min={0} max={0.03} step={0.001} value={motion.driftAmount} display={`${(motion.driftAmount * 100).toFixed(1)}%`} onChange={(event) => onMotionChange({ ...motion, driftAmount: Number(event.target.value) })} />
          <Slider label="Drift speed" min={0} max={0.5} step={0.01} value={motion.driftSpeed} display={`${motion.driftSpeed.toFixed(2)} Hz`} onChange={(event) => onMotionChange({ ...motion, driftSpeed: Number(event.target.value) })} />
          <Slider label="Rotation drift" min={0} max={0.06} step={0.001} value={motion.driftRotation} display={`${(motion.driftRotation * 57.2958).toFixed(2)}°`} onChange={(event) => onMotionChange({ ...motion, driftRotation: Number(event.target.value) })} />
        </PanelSection>
        <PanelSection title="Transform curve" meta="Motion · scale · blur">
          <CurveEditor curve={motion.easing} onChange={(easing) => onMotionChange({ ...motion, easing })} />
          <div className="curve-presets">
            <button onClick={() => onMotionChange({ ...motion, easing: { x1: 0, y1: 0, x2: 1, y2: 1 } })}>Linear</button>
            <button onClick={() => onMotionChange({ ...motion, easing: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } })}>Ease out</button>
            <button onClick={() => onMotionChange({ ...motion, easing: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 } })}>Ease in/out</button>
          </div>
          <button className="secondary-button wide" onClick={() => { onReset(); setViewport(DEFAULT_ENTRANCE_VIEWPORT); }}><RotateCcw size={15} />Reset entrance template</button>
        </PanelSection>
      </aside>
    </section>
  );
}


