import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Copy, Plus, SkipBack, SkipForward, Trash2 } from "lucide-react";
import {
  cameraFrameInField,
  compositionWorldDimensions,
  CAMERA_EASE_OUT,
  DEFAULT_CAMERA_EASING,
  resolveCameraEasing,
  evaluateCamera,
  fieldPointToWorld,
  findKeyframeAt,
  snapTime,
  sortKeyframes,
  upsertCameraKeyframe,
  upsertKeyframe,
  type CameraKeyframe,
  type CameraPose,
  type CardStyle,
  type CommentRecord,
  type Composition,
  type EntranceMotionTemplate,
  type RenderSettings,
  type Take,
} from "@comment-field/engine";
import { CommentScene, type CacheStatus, type CommentSceneHandle } from "../renderer/CommentScene";
import { CurveEditor } from "./MotionEditors";
import { PanelSection, SelectField, Slider } from "./Controls";
import { frameToTime, formatFrame, timeToFrame } from "./KeyframeTimeline";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function CameraWorkspace({
  composition,
  take,
  entranceMotion,
  comments,
  style,
  renderSettings,
  time,
  sceneRef,
  onTimeChange,
  onKeyframesChange,
  onSettleOnHero,
  onBack,
  onCacheStatus,
  autoKey,
  onAutoKeyChange,
}: {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  style: CardStyle;
  renderSettings: RenderSettings;
  time: number;
  sceneRef: React.RefObject<CommentSceneHandle | null>;
  onTimeChange: (time: number) => void;
  onKeyframesChange: (keyframes: CameraKeyframe[]) => void;
  onSettleOnHero: () => void;
  onBack: () => void;
  onCacheStatus: (status: CacheStatus) => void;
  autoKey: boolean;
  onAutoKeyChange?: (value: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingPose, setPendingPose] = useState<CameraPose | null>(null);
  const [draggingMap, setDraggingMap] = useState(false);
  const dragRafRef = useRef(0);
  const dragLatestRef = useRef<CameraPose | null>(null);
  const poseContextRef = useRef({ time, autoKey, exactId: null as string | null, keyframes: take.cameraKeyframes });

  const sorted = useMemo(() => sortKeyframes(take.cameraKeyframes), [take.cameraKeyframes]);
  const exact = findKeyframeAt(sorted, time, composition.frameRate);
  const selected = sorted.find((keyframe) => keyframe.id === selectedId) ?? exact ?? null;
  const evaluated = evaluateCamera(composition, take, time);
  const pose = pendingPose ?? evaluated;

  poseContextRef.current = {
    time,
    autoKey,
    exactId: exact?.id ?? null,
    keyframes: take.cameraKeyframes,
  };

  // Drop uncommitted previews when the playhead moves; keep them after a map drag ends.
  useEffect(() => {
    setPendingPose(null);
  }, [time]);

  // Live preview of an uncommitted pose without rewriting project keyframes every pointer move.
  const previewTake = useMemo(() => {
    if (!pendingPose) return take;
    const keyframe: CameraKeyframe = {
      id: exact?.id ?? "__camera-preview__",
      time: snapTime(time, composition.frameRate),
      value: pendingPose,
      easing: exact?.easing ?? { ...DEFAULT_CAMERA_EASING },
      holdDuration: exact?.holdDuration ?? 0,
      interpolation: exact?.interpolation ?? "bezier",
      role: exact?.role,
    };
    const base = take.cameraKeyframes.filter((item) => item.id !== "__camera-preview__");
    return { ...take, cameraKeyframes: upsertCameraKeyframe(base, keyframe, composition.frameRate) };
  }, [take, pendingPose, time, exact, composition.frameRate]);

  const dimensions = compositionWorldDimensions(composition);
  const panLimitX = dimensions.width * composition.fieldBounds.width / 2;
  const panLimitY = dimensions.height * composition.fieldBounds.height / 2;
  const frame = cameraFrameInField(composition, pose);
  const minX = 0.5 - composition.fieldBounds.width / 2;
  const minY = 0.5 - composition.fieldBounds.height / 2;

  function commitPose(nextPose: CameraPose, keyframes = take.cameraKeyframes, atTime = time, exactId = exact?.id ?? null) {
    const keyframe: CameraKeyframe = {
      id: exactId ?? `camera-${crypto.randomUUID()}`,
      time: snapTime(atTime, composition.frameRate),
      value: nextPose,
      easing: exact?.easing ?? { ...DEFAULT_CAMERA_EASING },
      holdDuration: exact?.holdDuration ?? 0,
      interpolation: exact?.interpolation ?? "bezier",
      role: exactId ? exact?.role : undefined,
    };
    onKeyframesChange(upsertCameraKeyframe(keyframes, keyframe, composition.frameRate));
    setSelectedId(keyframe.id);
    setPendingPose(null);
  }

  function writePose(nextPose: CameraPose, force = false) {
    if (!exact && !autoKey && !force) {
      setPendingPose(nextPose);
      return;
    }
    commitPose(nextPose);
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
      const raw = clamp01((clientX - rect.left) / rect.width) * take.duration;
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

  function clientToField(map: HTMLDivElement, clientX: number, clientY: number) {
    const rect = map.getBoundingClientRect();
    return {
      x: minX + clamp01((clientX - rect.left) / rect.width) * composition.fieldBounds.width,
      y: minY + clamp01((clientY - rect.top) / rect.height) * composition.fieldBounds.height,
    };
  }

  function dragCameraFrame(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const map = event.currentTarget;
    map.setPointerCapture(event.pointerId);
    setDraggingMap(true);

    const startPose = pose;
    const pointerField = clientToField(map, event.clientX, event.clientY);
    const frameCenter = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    const grabOffset = { x: pointerField.x - frameCenter.x, y: pointerField.y - frameCenter.y };

    const schedulePose = (next: CameraPose) => {
      dragLatestRef.current = next;
      if (dragRafRef.current) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = 0;
        if (dragLatestRef.current) setPendingPose(dragLatestRef.current);
      });
    };

    const move = (clientX: number, clientY: number) => {
      const fieldPoint = clientToField(map, clientX, clientY);
      const center = {
        x: fieldPoint.x - grabOffset.x,
        y: fieldPoint.y - grabOffset.y,
      };
      const world = fieldPointToWorld(composition, center);
      schedulePose({
        ...startPose,
        x: Math.min(panLimitX, Math.max(-panLimitX, world.x)),
        y: Math.min(panLimitY, Math.max(-panLimitY, world.y)),
      });
    };

    move(event.clientX, event.clientY);

    const pointerMove = (moveEvent: PointerEvent) => move(moveEvent.clientX, moveEvent.clientY);
    const pointerUp = () => {
      map.removeEventListener("pointermove", pointerMove);
      map.removeEventListener("pointerup", pointerUp);
      map.removeEventListener("pointercancel", pointerUp);
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      const latest = dragLatestRef.current;
      dragLatestRef.current = null;
      setDraggingMap(false);
      if (!latest) return;
      const context = poseContextRef.current;
      if (context.exactId || context.autoKey) {
        commitPose(latest, context.keyframes, context.time, context.exactId);
      } else {
        setPendingPose(latest);
      }
    };

    map.addEventListener("pointermove", pointerMove);
    map.addEventListener("pointerup", pointerUp);
    map.addEventListener("pointercancel", pointerUp);
  }

  const transition = selected?.interpolation === "cut" ? "cut" : selected?.interpolation === "linear" ? "linear" : "smooth";
  const fps = composition.frameRate;
  const keyStatus = exact
    ? `Editing key at ${formatFrame(exact.time, fps)}`
    : pendingPose
      ? "Preview only — not saved yet"
      : autoKey
        ? "Auto-key on — moves create keys"
        : "No key at playhead";

  return (
    <section className="authoring-workspace animate-workspace camera-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div>
            <span>Take-specific camera</span>
            <strong>Drag the frame on the map, then save a keyframe at this time.</strong>
          </div>
        </div>
        <div className="camera-preview-stage" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
          <CommentScene
            ref={sceneRef}
            composition={composition}
            take={previewTake}
            entranceMotion={entranceMotion}
            comments={comments}
            cardStyle={style}
            renderSettings={renderSettings}
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
            {sorted.map((keyframe, index) => (
              <button
                key={keyframe.id}
                className={keyframe.id === selected?.id ? "is-active" : ""}
                style={{ left: `${(keyframe.time / Math.max(0.001, take.duration)) * 100}%` }}
                onPointerDown={(event) => dragKeyframe(event, keyframe)}
                onClick={() => { setSelectedId(keyframe.id); onTimeChange(keyframe.time); }}
                title={`Shot ${index + 1} · ${formatFrame(keyframe.time, composition.frameRate)}`}
              >
                <Camera size={12} />
              </button>
            ))}
          </div>
          <button className="icon-button" onClick={() => selectAdjacent(1)} aria-label="Next camera keyframe"><SkipForward size={15} /></button>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="How camera keys work" meta={`${sorted.length} keys`}>
          <ol className="camera-howto">
            <li>Scrub the timeline playhead to the <strong>frame</strong> you want.</li>
            <li>Drag the mint frame on the field map (or use the sliders).</li>
            <li>Click <strong>Add / update keyframe</strong> to store that pose on this frame.</li>
            <li>Repeat on another frame — playback interpolates between keys only.</li>
          </ol>
          <p className="panel-note">
            Before your first key the camera holds that first pose (it no longer flies in from field center).
            To start with a different framing, put a key on frame 0.
          </p>
          {onAutoKeyChange && (
            <label className="toggle-row">
              <span>Auto-key while editing</span>
              <input type="checkbox" checked={autoKey} onChange={(event) => onAutoKeyChange(event.target.checked)} />
            </label>
          )}
          <p className="panel-note">
            {autoKey
              ? "Auto-key is on: releasing the map or moving a slider writes a key at the playhead."
              : "Auto-key is off: moves stay as a preview until you add a keyframe."}
          </p>
        </PanelSection>
        <PanelSection title="Field map" meta={`${composition.fieldBounds.width}×${composition.fieldBounds.height} frames`}>
          <div
            className={`camera-field-map ${draggingMap ? "is-dragging" : ""}`}
            style={{ aspectRatio: `${Math.max(1, composition.fieldBounds.width)} / ${Math.max(1, composition.fieldBounds.height)}` }}
            onPointerDown={dragCameraFrame}
          >
            {composition.cards.map((card) => (
              <i
                key={card.cardId}
                style={{
                  left: `${((card.x - minX) / composition.fieldBounds.width) * 100}%`,
                  top: `${((card.y - minY) / composition.fieldBounds.height) * 100}%`,
                  opacity: Math.min(1, Math.max(0.25, (card.z + 1.5) / 3)),
                }}
              />
            ))}
            <div
              className="camera-map-frame"
              style={{
                left: `${((frame.x - minX) / composition.fieldBounds.width) * 100}%`,
                top: `${((frame.y - minY) / composition.fieldBounds.height) * 100}%`,
                width: `${(frame.width / composition.fieldBounds.width) * 100}%`,
                height: `${(frame.height / composition.fieldBounds.height) * 100}%`,
              }}
            />
          </div>
          <p className="data-note">Drag the frame by its body — it follows the pointer. Nearer cards render brighter.</p>
        </PanelSection>
        <PanelSection title="Camera pose" meta={keyStatus}>
          <Slider label="Pan X" min={-panLimitX} max={panLimitX} step={0.01} value={pose.x} display={pose.x.toFixed(2)} onChange={(event) => writePose({ ...pose, x: Number(event.target.value) })} />
          <Slider label="Pan Y" min={-panLimitY} max={panLimitY} step={0.01} value={pose.y} display={pose.y.toFixed(2)} onChange={(event) => writePose({ ...pose, y: Number(event.target.value) })} />
          <Slider label="Dolly" min={1.75} max={30} step={0.05} value={pose.z} display={pose.z.toFixed(2)} onChange={(event) => writePose({ ...pose, z: Number(event.target.value) })} />
          <Slider label="Field of view" min={20} max={80} step={1} value={pose.fov} display={`${pose.fov.toFixed(0)}°`} onChange={(event) => writePose({ ...pose, fov: Number(event.target.value) })} />
          <button className="accent-button wide" onClick={() => writePose(pose, true)}>
            <Plus size={15} />
            {exact ? "Update keyframe at playhead" : "Add keyframe at playhead"}
          </button>
          {pendingPose && !exact && !autoKey && (
            <p className="panel-note">This pose is only a preview. Add a keyframe or it will reset when you scrub away.</p>
          )}
          <div className="button-pair">
            <button className="secondary-button" disabled={!selected} onClick={duplicateSelected}><Copy size={15} />Duplicate</button>
            <button
              className="danger-button"
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                onKeyframesChange(take.cameraKeyframes.filter((item) => item.id !== selected.id));
                setSelectedId(null);
                setPendingPose(null);
              }}
            >
              <Trash2 size={15} />Delete
            </button>
          </div>
        </PanelSection>
        {selected && (
          <PanelSection title="Shot timing" meta={`Key ${sorted.findIndex((item) => item.id === selected.id) + 1}/${sorted.length}`}>
            <Slider
              label="Arrival frame"
              min={0}
              max={Math.max(timeToFrame(take.duration, fps), timeToFrame(selected.time, fps))}
              step={1}
              value={timeToFrame(selected.time, fps)}
              display={formatFrame(selected.time, fps)}
              onChange={(event) => updateSelected({ time: frameToTime(Number(event.target.value), fps) })}
            />
            <Slider
              label="Hold frames"
              min={0}
              max={Math.round(4 * fps)}
              step={1}
              value={timeToFrame(selected.holdDuration, fps)}
              display={formatFrame(selected.holdDuration, fps)}
              onChange={(event) => updateSelected({ holdDuration: frameToTime(Number(event.target.value), fps) })}
            />
            <SelectField
              label="Arrival"
              value={transition}
              onChange={(event) => {
                const value = event.target.value;
                // UI uses "smooth"; engine stores "bezier".
                const interpolation: CameraKeyframe["interpolation"] =
                  value === "linear" ? "linear" : value === "cut" ? "cut" : "bezier";
                updateSelected({
                  interpolation,
                  cut: interpolation === "cut",
                  easing: interpolation === "linear"
                    ? { x1: 0, y1: 0, x2: 1, y2: 1 }
                    : interpolation === "cut"
                      ? selected.easing
                      : (selected.interpolation === "bezier" ? selected.easing : { ...DEFAULT_CAMERA_EASING }),
                });
              }}
            >
              <option value="smooth">Smooth</option>
              <option value="linear">Linear</option>
              <option value="cut">Cut</option>
            </SelectField>
            {transition === "smooth" && (
              <>
                <p className="panel-note">
                  Smooth uses a gentle ease-in-out by default (even speed through the middle).
                  Key spacing sets duration; the curve only remaps speed inside that span.
                </p>
                <CurveEditor
                  curve={resolveCameraEasing(selected.easing)}
                  onChange={(easing) => updateSelected({ easing, interpolation: "bezier", cut: false })}
                />
                <div className="curve-presets">
                  <button type="button" onClick={() => updateSelected({ easing: { ...DEFAULT_CAMERA_EASING }, interpolation: "bezier", cut: false })}>Smooth</button>
                  <button type="button" onClick={() => updateSelected({ easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, interpolation: "linear", cut: false })}>Linear</button>
                  <button type="button" onClick={() => updateSelected({ easing: { ...CAMERA_EASE_OUT }, interpolation: "bezier", cut: false })}>Ease out</button>
                  <button type="button" onClick={() => updateSelected({ easing: { x1: 0.7, y1: 0, x2: 0.84, y2: 0 }, interpolation: "bezier", cut: false })}>Ease in</button>
                  <button type="button" onClick={() => updateSelected({ easing: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 }, interpolation: "bezier", cut: false })}>Ease in/out</button>
                </div>
              </>
            )}
          </PanelSection>
        )}
        <PanelSection title="Hero coordination" meta={take.hero ? "Available" : "Assign a hero first"}>
          <button className="secondary-button wide" disabled={!take.hero} onClick={onSettleOnHero}>
            <Camera size={15} />
            {take.cameraKeyframes.some((item) => item.role === "hero-end") ? "Re-align to hero" : "Settle on hero"}
          </button>
        </PanelSection>
      </aside>
    </section>
  );
}
