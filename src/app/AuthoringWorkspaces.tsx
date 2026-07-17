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

function styleToggle(label: string, checked: boolean, onChange: (value: boolean) => void) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

export function DesignWorkspace({
  comment,
  style,
  onStyleChange,
  onBack,
}: {
  comment: CommentRecord;
  style: CardStyle;
  onStyleChange: <K extends keyof CardStyle>(key: K, value: CardStyle[K]) => void;
  onBack: () => void;
}) {
  return (
    <section className="authoring-workspace design-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div><span>Shared card template</span><strong>Design one post. Update every post.</strong></div>
        </div>
        <div className="design-preview-surface">
          <CardPreview comment={comment} style={style} className="design-card-preview" />
          <p>Representative content · {comment.handle || "message-only post"}</p>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Card surface" meta="Shared globally">
          <Field label="Card color" type="color" value={style.background} onChange={(event) => onStyleChange("background", event.target.value)} />
          <Slider label="Width" min={300} max={620} step={10} value={style.width} display={`${style.width}px`} onChange={(event) => onStyleChange("width", Number(event.target.value))} />
          <Slider label="Opacity" min={0.2} max={1} step={0.01} value={style.backgroundOpacity} onChange={(event) => onStyleChange("backgroundOpacity", Number(event.target.value))} />
          <Slider label="Stroke width" min={0} max={12} step={0.5} value={style.strokeWidth} display={`${style.strokeWidth}px`} onChange={(event) => onStyleChange("strokeWidth", Number(event.target.value))} />
          <Field label="Stroke color" type="color" value={style.strokeColor} onChange={(event) => onStyleChange("strokeColor", event.target.value)} />
          <Slider label="Corner radius" min={0} max={48} step={1} value={style.cornerRadius} display={`${style.cornerRadius}px`} onChange={(event) => onStyleChange("cornerRadius", Number(event.target.value))} />
          <Slider label="Shadow" min={0} max={0.6} step={0.01} value={style.shadow} onChange={(event) => onStyleChange("shadow", Number(event.target.value))} />
          <Slider label="Padding" min={12} max={40} step={1} value={style.padding} display={`${style.padding}px`} onChange={(event) => onStyleChange("padding", Number(event.target.value))} />
        </PanelSection>
        <PanelSection title="Content visibility">
          {styleToggle("Avatar", style.showAvatar, (value) => onStyleChange("showAvatar", value))}
          {styleToggle("Display name", style.showDisplayName, (value) => onStyleChange("showDisplayName", value))}
          {styleToggle("Handle", style.showHandle, (value) => onStyleChange("showHandle", value))}
          {styleToggle("Timestamp", style.showTimestamp, (value) => onStyleChange("showTimestamp", value))}
          {styleToggle("Engagement row", style.showEngagement, (value) => onStyleChange("showEngagement", value))}
        </PanelSection>
        <PanelSection title="Typography">
          <Slider label="Avatar" min={24} max={72} step={1} value={style.avatarSize} display={`${style.avatarSize}px`} onChange={(event) => onStyleChange("avatarSize", Number(event.target.value))} />
          <Slider label="Body size" min={14} max={30} step={1} value={style.bodySize} display={`${style.bodySize}px`} onChange={(event) => onStyleChange("bodySize", Number(event.target.value))} />
          <Slider label="Name weight" min={400} max={800} step={100} value={style.displayNameWeight} display={String(style.displayNameWeight)} onChange={(event) => onStyleChange("displayNameWeight", Number(event.target.value))} />
        </PanelSection>
      </aside>
    </section>
  );
}

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

export function CameraWorkspace({
  composition,
  take,
  entranceMotion,
  comments,
  style,
  time,
  sceneRef,
  onTimeChange,
  onKeyframesChange,
  onSettleOnHero,
  onBack,
  onCacheStatus,
  autoKey,
}: {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  style: CardStyle;
  time: number;
  sceneRef: React.RefObject<CommentSceneHandle | null>;
  onTimeChange: (time: number) => void;
  onKeyframesChange: (keyframes: CameraKeyframe[]) => void;
  onSettleOnHero: () => void;
  onBack: () => void;
  onCacheStatus: (status: CacheStatus) => void;
  autoKey: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingPose, setPendingPose] = useState<CameraPose | null>(null);
  const sorted = useMemo(() => sortKeyframes(take.cameraKeyframes), [take.cameraKeyframes]);
  const exact = findKeyframeAt(sorted, time, composition.frameRate);
  const selected = sorted.find((keyframe) => keyframe.id === selectedId) ?? exact ?? null;
  const pose = pendingPose ?? evaluateCamera(composition, take, time);
  useEffect(() => { setPendingPose(null); }, [time]);
  const dimensions = compositionWorldDimensions(composition);
  const panLimitX = dimensions.width * composition.fieldBounds.width / 2;
  const panLimitY = dimensions.height * composition.fieldBounds.height / 2;
  const frame = cameraFrameInField(composition, pose);
  const minX = 0.5 - composition.fieldBounds.width / 2;
  const minY = 0.5 - composition.fieldBounds.height / 2;

  function writePose(nextPose: CameraPose, force = false) {
    if (!exact && !autoKey && !force) {
      setPendingPose(nextPose);
      return;
    }
    const keyframe: CameraKeyframe = {
      id: exact?.id ?? `camera-${crypto.randomUUID()}`,
      time: snapTime(time, composition.frameRate),
      value: nextPose,
      easing: exact?.easing ?? { ...DEFAULT_CAMERA_EASING },
      holdDuration: exact?.holdDuration ?? 0,
      interpolation: exact?.interpolation ?? "bezier",
      role: exact?.role,
    };
    onKeyframesChange(upsertCameraKeyframe(take.cameraKeyframes, keyframe, composition.frameRate));
    setSelectedId(keyframe.id);
    setPendingPose(null);
  }

  function updateSelected(patch: Partial<CameraKeyframe>) {
    if (!selected) return;
    const next = { ...selected, ...patch };
    onKeyframesChange(upsertKeyframe(take.cameraKeyframes, next, composition.frameRate));
    setSelectedId(next.id);
    if (patch.time !== undefined) onTimeChange(patch.time);
  }

  function selectAdjacent(direction: -1 | 1) {
    if (!sorted.length) return;
    const currentIndex = selected ? sorted.findIndex((item) => item.id === selected.id) : -1;
    const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : sorted.length - 1) : Math.min(sorted.length - 1, Math.max(0, currentIndex + direction));
    const keyframe = sorted[nextIndex];
    setSelectedId(keyframe.id);
    onTimeChange(keyframe.time);
  }

  function duplicateSelected() {
    if (!selected) return;
    const duplicate: CameraKeyframe = {
      ...structuredClone(selected),
      id: `camera-${crypto.randomUUID()}`,
      role: undefined,
      time: selected.time + 0.5,
    };
    onKeyframesChange(upsertCameraKeyframe(take.cameraKeyframes, duplicate, composition.frameRate));
    setSelectedId(duplicate.id);
    onTimeChange(duplicate.time);
  }

  function dragKeyframe(event: React.PointerEvent<HTMLButtonElement>, keyframe: CameraKeyframe) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(keyframe.id);
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const move = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const raw = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * take.duration;
      const snapped = Math.round(raw * composition.frameRate) / composition.frameRate;
      const next = { ...keyframe, time: snapped, role: undefined };
      onKeyframesChange(upsertKeyframe(take.cameraKeyframes, next, composition.frameRate));
      onTimeChange(snapped);
    };
    const target = event.currentTarget;
    const pointerMove = (moveEvent: PointerEvent) => move(moveEvent.clientX);
    const pointerUp = () => {
      target.removeEventListener("pointermove", pointerMove);
      target.removeEventListener("pointerup", pointerUp);
      target.removeEventListener("pointercancel", pointerUp);
    };
    target.addEventListener("pointermove", pointerMove);
    target.addEventListener("pointerup", pointerUp);
    target.addEventListener("pointercancel", pointerUp);
  }

  function dragCameraFrame(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (clientX: number, clientY: number) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const fieldPoint = {
        x: minX + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * composition.fieldBounds.width,
        y: minY + Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) * composition.fieldBounds.height,
      };
      const world = fieldPointToWorld(composition, fieldPoint);
      writePose({ ...pose, x: world.x, y: world.y });
    };
    move(event.clientX, event.clientY);
    const target = event.currentTarget;
    const pointerMove = (moveEvent: PointerEvent) => move(moveEvent.clientX, moveEvent.clientY);
    const pointerUp = () => {
      target.removeEventListener("pointermove", pointerMove);
      target.removeEventListener("pointerup", pointerUp);
      target.removeEventListener("pointercancel", pointerUp);
    };
    target.addEventListener("pointermove", pointerMove);
    target.addEventListener("pointerup", pointerUp);
    target.addEventListener("pointercancel", pointerUp);
  }

  const transition = selected?.interpolation === "cut" ? "cut" : selected?.interpolation === "linear" ? "linear" : "smooth";

  return (
    <section className="authoring-workspace animate-workspace camera-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div><span>Take-specific camera</span><strong>Move across the oversized field and settle into each shot.</strong></div>
        </div>
        <div className="camera-preview-stage" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
          <CommentScene
            ref={sceneRef}
            composition={composition}
            take={take}
            entranceMotion={entranceMotion}
            comments={comments}
            cardStyle={style}
            time={time}
            selectedCardId={null}
            mode="select"
            viewMode="camera"
            onSelect={() => {}}
            onTransformCard={() => {}}
            onGestureComplete={() => {}}
            onCacheStatus={onCacheStatus}
          />
        </div>
        <div className="camera-key-strip">
          <button className="icon-button" onClick={() => selectAdjacent(-1)} aria-label="Previous camera keyframe"><SkipBack size={15} /></button>
          <div className="camera-key-track">
            {sorted.map((keyframe, index) => <button
              key={keyframe.id}
              className={keyframe.id === selected?.id ? "is-active" : ""}
              style={{ left: `${(keyframe.time / take.duration) * 100}%` }}
              onPointerDown={(event) => dragKeyframe(event, keyframe)}
              onClick={() => { setSelectedId(keyframe.id); onTimeChange(keyframe.time); }}
              title={`Shot ${index + 1} · ${keyframe.time.toFixed(2)}s`}
            ><Camera size={12} /></button>)}
          </div>
          <button className="icon-button" onClick={() => selectAdjacent(1)} aria-label="Next camera keyframe"><SkipForward size={15} /></button>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Field map" meta={`${composition.fieldBounds.width}×${composition.fieldBounds.height} frames`}>
          <div className="camera-field-map" onPointerDown={dragCameraFrame}>
            {composition.cards.map((card) => <i key={card.cardId} style={{ left: `${((card.x - minX) / composition.fieldBounds.width) * 100}%`, top: `${((card.y - minY) / composition.fieldBounds.height) * 100}%`, opacity: Math.min(1, Math.max(0.25, (card.z + 1.5) / 3)) }} />)}
            <div className="camera-map-frame" style={{ left: `${((frame.x - minX) / composition.fieldBounds.width) * 100}%`, top: `${((frame.y - minY) / composition.fieldBounds.height) * 100}%`, width: `${(frame.width / composition.fieldBounds.width) * 100}%`, height: `${(frame.height / composition.fieldBounds.height) * 100}%` }} />
          </div>
          <p className="data-note">Drag anywhere in the map to place the camera at the current playhead. Nearer cards render brighter.</p>
        </PanelSection>
        <PanelSection title="Camera pose" meta={exact ? "Keyframe at playhead" : pendingPose ? "Unkeyed pose" : autoKey ? "Auto-key enabled" : "Preview until Add Key"}>
          <Slider label="Pan X" min={-panLimitX} max={panLimitX} step={0.01} value={pose.x} display={pose.x.toFixed(2)} onChange={(event) => writePose({ ...pose, x: Number(event.target.value) })} />
          <Slider label="Pan Y" min={-panLimitY} max={panLimitY} step={0.01} value={pose.y} display={pose.y.toFixed(2)} onChange={(event) => writePose({ ...pose, y: Number(event.target.value) })} />
          <Slider label="Dolly" min={1.75} max={30} step={0.05} value={pose.z} display={pose.z.toFixed(2)} onChange={(event) => writePose({ ...pose, z: Number(event.target.value) })} />
          <Slider label="Field of view" min={20} max={80} step={1} value={pose.fov} display={`${pose.fov.toFixed(0)}°`} onChange={(event) => writePose({ ...pose, fov: Number(event.target.value) })} />
          <button className="accent-button wide" onClick={() => writePose(pose, true)}><Plus size={15} />{exact ? "Update keyframe" : pendingPose ? "Add pending key" : "Add keyframe"}</button>
          <div className="button-pair">
            <button className="secondary-button" disabled={!selected} onClick={duplicateSelected}><Copy size={15} />Duplicate</button>
            <button className="danger-button" disabled={!selected} onClick={() => { if (!selected) return; onKeyframesChange(take.cameraKeyframes.filter((item) => item.id !== selected.id)); setSelectedId(null); }}><Trash2 size={15} />Delete</button>
          </div>
        </PanelSection>
        {selected && <PanelSection title="Shot timing" meta={`Key ${sorted.findIndex((item) => item.id === selected.id) + 1}/${sorted.length}`}>
          <Slider label="Arrival time" min={0} max={Math.max(take.duration, selected.time)} step={1 / composition.frameRate} value={selected.time} display={`${selected.time.toFixed(2)}s`} onChange={(event) => updateSelected({ time: Number(event.target.value) })} />
          <Slider label="Hold" min={0} max={4} step={0.05} value={selected.holdDuration} display={`${selected.holdDuration.toFixed(2)}s`} onChange={(event) => updateSelected({ holdDuration: Number(event.target.value) })} />
          <SelectField label="Arrival" value={transition} onChange={(event) => {
            const value = event.target.value;
            updateSelected({ interpolation: value as CameraKeyframe["interpolation"], easing: value === "linear" ? { x1: 0, y1: 0, x2: 1, y2: 1 } : { ...DEFAULT_CAMERA_EASING } });
          }}><option value="smooth">Smooth</option><option value="linear">Linear</option><option value="cut">Cut</option></SelectField>
          {selected.interpolation === "bezier" && <CurveEditor curve={selected.easing} onChange={(easing) => updateSelected({ easing, interpolation: "bezier" })} />}
        </PanelSection>}
        <PanelSection title="Hero coordination" meta={take.hero ? "Available" : "Assign a hero first"}>
          <button className="secondary-button wide" disabled={!take.hero} onClick={onSettleOnHero}><Camera size={15} />{take.cameraKeyframes.some((item) => item.role === "hero-end") ? "Re-align to hero" : "Settle on hero"}</button>
        </PanelSection>
      </aside>
    </section>
  );
}

export function HeroWorkspace({
  composition,
  take,
  entranceMotion,
  comments,
  style,
  time,
  selectedCardId,
  sceneRef,
  onTimeChange,
  onHeroChange,
  onRemoveHero,
  onBakeReflow,
  onBack,
  onCacheStatus,
  autoKey,
}: {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  style: CardStyle;
  time: number;
  selectedCardId: string | null;
  sceneRef: React.RefObject<CommentSceneHandle | null>;
  onTimeChange: (time: number) => void;
  onHeroChange: (hero: HeroPerformance) => void;
  onRemoveHero: () => void;
  onBakeReflow: () => void;
  onBack: () => void;
  onCacheStatus: (status: CacheStatus) => void;
  autoKey: boolean;
}) {
  const hero = take.hero;
  const source = composition.cards.find((card) => card.cardId === hero?.cardId);
  if (!hero || !source) {
    return (
      <section className="authoring-workspace empty-authoring">
        <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
        <div><strong>No hero assigned</strong><p>Select a post in Field and choose Make hero.</p></div>
      </section>
    );
  }
  const activeHero = hero;
  const keys = sortedHeroKeyframes(activeHero);
  const poseKeys = keys.filter((keyframe) => keyframe.value.kind === "pose");
  const exact = findKeyframeAt(poseKeys, time, composition.frameRate);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<HeroKeyframe | null>(null);
  useEffect(() => { setPending(null); }, [time]);
  const selected = pending ?? exact ?? poseKeys.find((keyframe) => keyframe.id === selectedId) ?? poseKeys.at(-1)!;
  const selectedIndex = Math.max(0, keys.findIndex((keyframe) => keyframe.id === selected.id));
  const previous = keys[Math.max(0, selectedIndex - 1)] ?? keys[0];
  const selectedPose = selected.value.kind === "pose" ? selected.value : null;
  const previousTransform = previous.value.kind === "pose" ? previous.value.transform : source;
  const start = previous.value.kind === "pose" && previous.value.targetSpace === "screen"
    ? { x: previousTransform.x, y: previousTransform.y }
    : projectWorldPoint(composition, evaluateCamera(composition, take, previous.time), { ...fieldPointToWorld(composition, previousTransform), z: previousTransform.z });
  const end = selectedPose?.targetSpace === "screen"
    ? { x: selectedPose.transform.x, y: selectedPose.transform.y }
    : projectWorldPoint(composition, evaluateCamera(composition, take, selected.time), { ...fieldPointToWorld(composition, selectedPose?.transform ?? source), z: selectedPose?.transform.z ?? source.z });
  const control1 = { x: start.x + selected.path.control1.x, y: start.y + selected.path.control1.y };
  const control2 = { x: end.x + selected.path.control2.x, y: end.y + selected.path.control2.y };

  function writeKey(next: HeroKeyframe, force = false) {
    const atPlayhead = findKeyframeAt(poseKeys, time, composition.frameRate);
    if (!atPlayhead && !autoKey && !force) {
      setPending({ ...next, id: "hero-pending", time: snapTime(time, composition.frameRate) });
      return;
    }
    const committed = { ...next, id: atPlayhead?.id ?? `hero-pose-${crypto.randomUUID()}`, time: atPlayhead?.time ?? snapTime(time, composition.frameRate) };
    onHeroChange({ ...activeHero, keyframes: upsertKeyframe(activeHero.keyframes ?? keys, committed, composition.frameRate) });
    setSelectedId(committed.id);
    setPending(null);
  }

  function updateSelected(patch: Partial<HeroKeyframe>) {
    const next = { ...selected, ...patch };
    if (pending) setPending(next);
    else onHeroChange({ ...activeHero, keyframes: upsertKeyframe(activeHero.keyframes ?? keys, next, composition.frameRate) });
  }

  function updatePose(patch: Partial<Extract<HeroKeyframe["value"], { kind: "pose" }>>) {
    if (!selectedPose) return;
    writeKey({ ...selected, value: { ...selectedPose, ...patch } }, false);
  }

  function updatePath(point: "start" | "control1" | "control2" | "end", value: Point2D) {
    if (point === "start") return;
    if (point === "end") {
      if (selectedPose) updatePose({ transform: { ...selectedPose.transform, x: value.x, y: value.y }, targetSpace: "screen" });
      return;
    }
    updateSelected({
      path: {
        ...selected.path,
        [point]: point === "control1"
          ? { x: value.x - start.x, y: value.y - start.y }
          : { x: value.x - end.x, y: value.y - end.y },
      },
    });
  }

  return (
    <section className="authoring-workspace animate-workspace hero-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div><span>Take-specific hero path</span><strong>Move the hero above the field and shape its route.</strong></div>
        </div>
        <BezierOverlay className="hero-bezier-stage" style={{ aspectRatio: `${composition.width} / ${composition.height}` }} start={start} control1={control1} control2={control2} end={end} editable={["control1", "control2", "end"]} onChange={updatePath}>
          <div className="hero-scene-host">
            <CommentScene
              ref={sceneRef}
              composition={composition}
              take={take}
              entranceMotion={entranceMotion}
              comments={comments}
              cardStyle={style}
              time={time}
              selectedCardId={selectedCardId}
              mode="select"
              viewMode="camera"
              onSelect={() => {}}
              onTransformCard={(_cardId: string, _patch: TransformPatch) => {}}
              onGestureComplete={() => {}}
              onCacheStatus={onCacheStatus}
            />
          </div>
        </BezierOverlay>
        <div className="motion-transport">
          <span className="transport-label">Hero preview</span>
          <input type="range" min={0} max={take.duration} step={1 / composition.frameRate} value={Math.min(time, take.duration)} onChange={(event) => onTimeChange(Number(event.target.value))} />
          <output>{time.toFixed(2)}s</output>
          <button className="secondary-button" onClick={() => onTimeChange(heroStartTime(hero))}><RotateCcw size={15} />To start</button>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Hero transform" meta={pending ? "Unkeyed pose" : `Key ${poseKeys.findIndex((keyframe) => keyframe.id === selected.id) + 1}/${poseKeys.length}`}>
          <Slider label="Arrival" min={0} max={Math.max(take.duration, selected.time)} step={1 / composition.frameRate} value={selected.time} display={`${selected.time.toFixed(2)}s`} onChange={(event) => updateSelected({ time: Number(event.target.value) })} />
          {selectedPose && <>
          <Slider label="Scale" min={0.5} max={3.2} step={0.01} value={selectedPose.transform.scale} onChange={(event) => updatePose({ transform: { ...selectedPose.transform, scale: Number(event.target.value) } })} />
          <Slider label="Rotation" min={-0.8} max={0.8} step={0.01} value={selectedPose.transform.rotation} display={`${(selectedPose.transform.rotation * 57.2958).toFixed(1)}°`} onChange={(event) => updatePose({ transform: { ...selectedPose.transform, rotation: Number(event.target.value) } })} />
          <Slider label="Forward depth" min={0} max={3} step={0.01} value={selectedPose.transform.z} onChange={(event) => updatePose({ transform: { ...selectedPose.transform, z: Number(event.target.value) } })} />
          <Slider label="Surrounding dim" min={0} max={0.9} step={0.01} value={selectedPose.surroundingDim} onChange={(event) => updatePose({ surroundingDim: Number(event.target.value) })} />
          <Slider label="Surrounding blur" min={0} max={12} step={0.25} value={selectedPose.surroundingBlur} onChange={(event) => updatePose({ surroundingBlur: Number(event.target.value) })} />
          </>}
          <button className="accent-button wide" onClick={() => writeKey(pending ?? { ...selected, time }, true)}><Plus size={15} />{pending ? "Add pending key" : exact ? "Update key" : "Add hero key"}</button>
        </PanelSection>
        <PanelSection title="Hero timing curve" meta={selected.interpolation ?? "bezier"}>
          <SelectField label="Arrival" value={selected.interpolation ?? "bezier"} onChange={(event) => updateSelected({ interpolation: event.target.value as HeroKeyframe["interpolation"] })}><option value="bezier">Smooth</option><option value="linear">Linear</option><option value="cut">Cut</option></SelectField>
          {selected.interpolation === "bezier" && <CurveEditor curve={selected.easing} onChange={(easing) => updateSelected({ easing })} />}
        </PanelSection>
        <PanelSection title="Local reflow" meta={`${Object.keys(take.reflowTargets).length} targets`}>
          <Slider label="Radius" min={0.1} max={0.7} step={0.01} value={hero.reflowRadius} onChange={(event) => onHeroChange({ ...hero, reflowRadius: Number(event.target.value) })} />
          <Slider label="Attraction" min={0} max={1} step={0.01} value={hero.attraction} onChange={(event) => onHeroChange({ ...hero, attraction: Number(event.target.value) })} />
          <Slider label="Falloff" min={0.2} max={4} step={0.1} value={hero.falloff} onChange={(event) => onHeroChange({ ...hero, falloff: Number(event.target.value) })} />
          <Slider label="Max displacement" min={0.02} max={0.3} step={0.01} value={hero.maxDisplacement} onChange={(event) => onHeroChange({ ...hero, maxDisplacement: Number(event.target.value) })} />
          <Slider label="Overlap passes" min={0} max={12} step={1} value={hero.overlapPasses} display={String(hero.overlapPasses)} onChange={(event) => onHeroChange({ ...hero, overlapPasses: Number(event.target.value) })} />
          <button className="accent-button wide" onClick={onBakeReflow}>Generate & edit reflow</button>
          <button className="danger-button wide" onClick={onRemoveHero}><Trash2 size={16} />Remove hero</button>
        </PanelSection>
      </aside>
    </section>
  );
}
