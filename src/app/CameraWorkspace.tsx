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


