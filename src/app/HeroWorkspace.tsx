import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  evaluateCamera,
  fieldPointToWorld,
  findKeyframeAt,
  heroStartTime,
  projectWorldPoint,
  snapTime,
  sortedHeroKeyframes,
  upsertKeyframe,
  type CardStyle,
  type CommentRecord,
  type Composition,
  type EntranceMotionTemplate,
  type HeroKeyframe,
  type HeroPerformance,
  type Point2D,
  type RenderSettings,
  type Take,
} from "@comment-field/engine";
import { CommentScene, type CacheStatus, type CommentSceneHandle, type TransformPatch } from "../renderer/CommentScene";
import { frameToTime, formatFrame, timeToFrame } from "./KeyframeTimeline";
import { BezierOverlay, CurveEditor } from "./MotionEditors";
import { PanelSection, SelectField, Slider } from "./Controls";

const DEFAULT_HERO_PATH = { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.08 } };

export function HeroWorkspace({
  composition,
  take,
  entranceMotion,
  comments,
  style,
  renderSettings,
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
  onExportHeroStill,
}: {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  style: CardStyle;
  renderSettings: RenderSettings;
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
  onExportHeroStill?: () => void;
}) {
  // Hooks must run unconditionally — early-return used to crash React when
  // opening Hero with/without a hero assignment.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<HeroKeyframe | null>(null);
  useEffect(() => { setPending(null); }, [time]);

  const hero = take.hero;
  const source = useMemo(
    () => (hero ? composition.cards.find((card) => card.cardId === hero.cardId) ?? null : null),
    [composition.cards, hero],
  );

  const keys = useMemo(() => (hero ? sortedHeroKeyframes(hero) : []), [hero]);
  const poseKeys = useMemo(() => keys.filter((keyframe) => keyframe.value.kind === "pose"), [keys]);
  const exact = poseKeys.length ? findKeyframeAt(poseKeys, time, composition.frameRate) : undefined;
  const selected = pending
    ?? exact
    ?? poseKeys.find((keyframe) => keyframe.id === selectedId)
    ?? poseKeys.at(-1)
    ?? null;
  const selectedIndex = selected ? Math.max(0, keys.findIndex((keyframe) => keyframe.id === selected.id)) : 0;
  const previous = keys[Math.max(0, selectedIndex - 1)] ?? keys[0] ?? null;
  const selectedPose = selected?.value.kind === "pose" ? selected.value : null;
  const previousTransform = previous?.value.kind === "pose" ? previous.value.transform : source;
  const path = selected?.path ?? previous?.path ?? DEFAULT_HERO_PATH;

  const start = !previous || !previousTransform
    ? { x: 0.5, y: 0.5 }
    : previous.value.kind === "pose" && previous.value.targetSpace === "screen"
      ? { x: previousTransform.x, y: previousTransform.y }
      : projectWorldPoint(
        composition,
        evaluateCamera(composition, take, previous.time),
        { ...fieldPointToWorld(composition, previousTransform), z: previousTransform.z },
      );
  const endTransform = selectedPose?.transform ?? source;
  const end = !endTransform
    ? { x: 0.5, y: 0.5 }
    : selectedPose?.targetSpace === "screen"
      ? { x: selectedPose.transform.x, y: selectedPose.transform.y }
      : projectWorldPoint(
        composition,
        evaluateCamera(composition, take, selected?.time ?? time),
        { ...fieldPointToWorld(composition, endTransform), z: endTransform.z },
      );
  const control1 = { x: start.x + path.control1.x, y: start.y + path.control1.y };
  const control2 = { x: end.x + path.control2.x, y: end.y + path.control2.y };

  function writeKey(next: HeroKeyframe, force = false) {
    if (!hero) return;
    const atPlayhead = findKeyframeAt(poseKeys, time, composition.frameRate);
    if (!atPlayhead && !autoKey && !force) {
      setPending({ ...next, id: "hero-pending", time: snapTime(time, composition.frameRate) });
      return;
    }
    const committed = {
      ...next,
      id: atPlayhead?.id ?? `hero-pose-${crypto.randomUUID()}`,
      time: atPlayhead?.time ?? snapTime(time, composition.frameRate),
      path: next.path ?? path,
    };
    onHeroChange({ ...hero, keyframes: upsertKeyframe(hero.keyframes ?? keys, committed, composition.frameRate) });
    setSelectedId(committed.id);
    setPending(null);
  }

  function updateSelected(patch: Partial<HeroKeyframe>) {
    if (!hero || !selected) return;
    const next = { ...selected, ...patch, path: patch.path ?? selected.path ?? path };
    if (pending) setPending(next);
    else onHeroChange({ ...hero, keyframes: upsertKeyframe(hero.keyframes ?? keys, next, composition.frameRate) });
  }

  function updatePose(patch: Partial<Extract<HeroKeyframe["value"], { kind: "pose" }>>) {
    if (!selectedPose || !selected) return;
    writeKey({ ...selected, value: { ...selectedPose, ...patch }, path }, false);
  }

  function updatePath(point: "start" | "control1" | "control2" | "end", value: Point2D) {
    if (point === "start" || !selected) return;
    if (point === "end") {
      if (selectedPose) updatePose({ transform: { ...selectedPose.transform, x: value.x, y: value.y }, targetSpace: "screen" });
      return;
    }
    updateSelected({
      path: {
        ...path,
        [point]: point === "control1"
          ? { x: value.x - start.x, y: value.y - start.y }
          : { x: value.x - end.x, y: value.y - end.y },
      },
    });
  }

  if (!hero || !source) {
    return (
      <section className="authoring-workspace empty-authoring">
        <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
        <div><strong>No hero assigned</strong><p>Select a post in Field and choose Make hero.</p></div>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="authoring-workspace empty-authoring">
        <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
        <div><strong>Hero has no pose keys</strong><p>Remove and re-assign the hero, or add a pose key.</p></div>
      </section>
    );
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
              renderSettings={renderSettings}
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
          <input type="range" min={0} max={timeToFrame(take.duration, composition.frameRate)} step={1} value={timeToFrame(Math.min(time, take.duration), composition.frameRate)} onChange={(event) => onTimeChange(frameToTime(Number(event.target.value), composition.frameRate))} />
          <output>{formatFrame(time, composition.frameRate)}</output>
          <button className="secondary-button" onClick={() => onTimeChange(heroStartTime(hero))}><RotateCcw size={15} />To start</button>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Hero transform" meta={pending ? "Unkeyed pose" : `Key ${Math.max(1, poseKeys.findIndex((keyframe) => keyframe.id === selected.id) + 1)}/${Math.max(1, poseKeys.length)}`}>
          <Slider
            label="Arrival frame"
            min={0}
            max={Math.max(timeToFrame(take.duration, composition.frameRate), timeToFrame(selected.time, composition.frameRate))}
            step={1}
            value={timeToFrame(selected.time, composition.frameRate)}
            display={formatFrame(selected.time, composition.frameRate)}
            onChange={(event) => updateSelected({ time: frameToTime(Number(event.target.value), composition.frameRate) })}
          />
          {selectedPose && <>
          <Slider label="Scale" min={0.5} max={3.2} step={0.01} value={selectedPose.transform.scale} onChange={(event) => updatePose({ transform: { ...selectedPose.transform, scale: Number(event.target.value) } })} />
          <Slider label="Rotation" min={-0.8} max={0.8} step={0.01} value={selectedPose.transform.rotation} display={`${(selectedPose.transform.rotation * 57.2958).toFixed(1)}°`} onChange={(event) => updatePose({ transform: { ...selectedPose.transform, rotation: Number(event.target.value) } })} />
          <Slider label="Forward depth" min={0} max={3} step={0.01} value={selectedPose.transform.z} onChange={(event) => updatePose({ transform: { ...selectedPose.transform, z: Number(event.target.value) } })} />
          <Slider label="Surrounding dim" min={0} max={0.9} step={0.01} value={selectedPose.surroundingDim} onChange={(event) => updatePose({ surroundingDim: Number(event.target.value) })} />
          <Slider label="Surrounding blur" min={0} max={12} step={0.25} value={selectedPose.surroundingBlur} onChange={(event) => updatePose({ surroundingBlur: Number(event.target.value) })} />
          </>}
          <button className="accent-button wide" onClick={() => writeKey(pending ?? { ...selected, time, path }, true)}><Plus size={15} />{pending ? "Add pending key" : exact ? "Update key" : "Add hero key"}</button>
        </PanelSection>
        <PanelSection title="Hero timing curve" meta={selected.interpolation ?? "bezier"}>
          <SelectField label="Arrival" value={selected.interpolation ?? "bezier"} onChange={(event) => updateSelected({ interpolation: event.target.value as HeroKeyframe["interpolation"] })}><option value="bezier">Smooth</option><option value="linear">Linear</option><option value="cut">Cut</option></SelectField>
          {(selected.interpolation ?? "bezier") === "bezier" && <CurveEditor curve={selected.easing} onChange={(easing) => updateSelected({ easing })} />}
        </PanelSection>
        <PanelSection title="Local reflow" meta={`${Object.keys(take.reflowTargets).length} targets`}>
          <Slider label="Radius" min={0.1} max={0.7} step={0.01} value={hero.reflowRadius} onChange={(event) => onHeroChange({ ...hero, reflowRadius: Number(event.target.value) })} />
          <Slider label="Attraction" min={0} max={1} step={0.01} value={hero.attraction} onChange={(event) => onHeroChange({ ...hero, attraction: Number(event.target.value) })} />
          <Slider label="Falloff" min={0.2} max={4} step={0.1} value={hero.falloff} onChange={(event) => onHeroChange({ ...hero, falloff: Number(event.target.value) })} />
          <Slider label="Max displacement" min={0.02} max={0.3} step={0.01} value={hero.maxDisplacement} onChange={(event) => onHeroChange({ ...hero, maxDisplacement: Number(event.target.value) })} />
          <Slider label="Overlap passes" min={0} max={12} step={1} value={hero.overlapPasses} display={String(hero.overlapPasses)} onChange={(event) => onHeroChange({ ...hero, overlapPasses: Number(event.target.value) })} />
          <button className="accent-button wide" onClick={onBakeReflow}>Generate & edit reflow</button>
          {onExportHeroStill && (
            <button className="secondary-button wide" onClick={onExportHeroStill}>
              <Download size={15} />Export hero still
            </button>
          )}
          <button className="danger-button wide" onClick={onRemoveHero}><Trash2 size={16} />Remove hero</button>
        </PanelSection>
      </aside>
    </section>
  );
}
