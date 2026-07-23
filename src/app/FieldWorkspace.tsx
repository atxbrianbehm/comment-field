import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  Camera, CircleDot, Clapperboard, Download, FileUp, Heart, ImagePlus, Layers3, Lock, MousePointer2,
  Move3d, Palette, RefreshCw, Shield, Sparkles, Trash2, Unlock, WandSparkles,
} from "lucide-react";
import { useState } from "react";
import {
  alignCardPlacements,
  distributeCardPlacements,
  heroEndTime,
  regenerateComposition,
  type AlignMode,
  type BuildOrder,
  type CardPlacement,
  type CommentRecord,
  type Composition,
  type DistributeAxis,
  type GestureSample,
  type ParseResult,
  type PreviewCacheStatus,
  type Project,
  type Take,
} from "@comment-field/engine";
import type { CacheStatus, CommentSceneHandle, InteractionMode, SelectOptions, TransformPatch } from "../renderer/CommentScene";
import { CommentScene } from "../renderer/CommentScene";
import { Field, PanelSection, SelectField, Slider } from "./Controls";
import { CurveEditor } from "./MotionEditors";

function styleToggle(label: string, checked: boolean, onChange: (value: boolean) => void) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

type Workspace = "field" | "design" | "animate";
type AnimateTab = "entrance" | "exit" | "camera" | "hero";
type FieldView = "camera" | "overview";
type RightTab = "layout" | "build" | "hero";

interface FieldWorkspaceProps {
  project: Project;
  composition: Composition;
  take: Take;
  duration: number;
  time: number;
  playing: boolean;
  commentSource: string;
  commentPreview: ParseResult;
  selectedCardId: string | null;
  selectedCardIds: string[];
  selectedGestureIndex: number | null;
  selectedPlacement: CardPlacement | null;
  selectedComment: CommentRecord | null;
  mode: InteractionMode;
  fieldView: FieldView;
  rightTab: RightTab;
  cacheStatus: CacheStatus;
  previewStatus: PreviewCacheStatus;
  previewLabel: string;
  previewMemory: string;
  sceneRef: RefObject<CommentSceneHandle | null>;
  setCommentSource: Dispatch<SetStateAction<string>>;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  onSelectCard: (cardId: string | null, options?: SelectOptions) => void;
  setSelectedGestureIndex: Dispatch<SetStateAction<number | null>>;
  setMode: Dispatch<SetStateAction<InteractionMode>>;
  setFieldView: Dispatch<SetStateAction<FieldView>>;
  setRightTab: Dispatch<SetStateAction<RightTab>>;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  setAnimateTab: Dispatch<SetStateAction<AnimateTab>>;
  setCacheStatus: Dispatch<SetStateAction<CacheStatus>>;
  mutateProject: (updater: (draft: Project) => void) => void;
  mutateComposition: (updater: (draft: Composition) => void) => void;
  mutateTake: (updater: (draft: Take) => void) => void;
  importComments: () => void;
  loadCommentFile: (file: File) => Promise<void>;
  loadBackground: (file: File) => void;
  switchComposition: (id: string) => void;
  changeTakeDuration: (value: number) => void;
  onTimeChange: (value: number) => void;
  clearPreviewCache: (reason?: string, state?: PreviewCacheStatus["state"]) => void;
  pausePlayback: () => void;
  beginManipulation: () => void;
  endManipulation?: () => void;
  transformCard: (cardId: string, patch: TransformPatch, editReflow: boolean) => void;
  transformCards: (moves: Array<{ cardId: string; patch: TransformPatch }>, editReflow: boolean) => void;
  completeGesture: (samples: GestureSample[]) => void;
  updateGestureSample: (index: number, patch: Partial<GestureSample>) => void;
  scatter: () => void;
  fitFieldToComments: () => void;
  addProtectedRegion: () => void;
  removeHero: () => void;
  setHero: () => void;
  updateBuild: (key: keyof Take["build"], value: Take["build"][keyof Take["build"]]) => void;
  randomizeBuild: () => void;
  alignCameraToHero: () => void;
  bakeReflow: () => void;
  /** Download a flat PNG of the assigned hero card. */
  onExportHeroStill?: () => void;
}

export function FieldWorkspace(props: FieldWorkspaceProps) {
  const [mobilePanel, setMobilePanel] = useState<"closed" | "comments" | "controls">("closed");
  const {
    project, composition, take, duration, time, playing, commentSource, commentPreview, selectedCardId, selectedCardIds, selectedGestureIndex,
    selectedPlacement, selectedComment, mode, fieldView, rightTab, cacheStatus, previewStatus, previewLabel,
    previewMemory, sceneRef, setCommentSource, setSelectedCardId, onSelectCard, setSelectedGestureIndex, setMode, setFieldView, setRightTab, setWorkspace,
    setAnimateTab, setCacheStatus, mutateProject, mutateComposition, mutateTake, importComments, loadCommentFile,
    loadBackground, switchComposition, changeTakeDuration, onTimeChange, clearPreviewCache, pausePlayback, beginManipulation, endManipulation,
    transformCard, transformCards, completeGesture, updateGestureSample, scatter, fitFieldToComments, addProtectedRegion, removeHero, setHero, updateBuild,
    randomizeBuild, alignCameraToHero, bakeReflow, onExportHeroStill,
  } = props;

  function applyPlacementMap(map: Record<string, { x: number; y: number }>) {
    const moves = Object.entries(map).map(([cardId, point]) => ({ cardId, patch: point }));
    if (moves.length) transformCards(moves, mode === "reflow");
  }

  function runAlign(modeName: AlignMode) {
    applyPlacementMap(alignCardPlacements(composition.cards, selectedCardIds, modeName));
  }

  function runDistribute(axis: DistributeAxis) {
    applyPlacementMap(distributeCardPlacements(composition.cards, selectedCardIds, axis));
  }
  const multiScreen = composition.fieldBounds.width > 1 || composition.fieldBounds.height > 1;
  const finalBurstEntranceDuration = take.population.postHeroEntranceDuration ?? (take.entranceOverride ?? project.entranceMotion).duration;
  const finalBurstLifeMin = take.population.postHeroLifeMin ?? take.population.lifeMin;
  const finalBurstLifeMax = take.population.postHeroLifeMax ?? take.population.lifeMax;
  const finalBurstExitDuration = take.population.postHeroExitDuration ?? take.population.exitDuration;
  const finalBurstEasing = take.population.postHeroBurstEasing ?? { x1: 0, y1: 0, x2: 1, y2: 1 };
  const finalBurstStartTime = take.hero ? heroEndTime(take.hero) : (take.population.postHeroBurstStartTime ?? Math.max(0, duration - 2));

  function applyFieldBounds(width: number, height: number) {
    mutateProject((draft) => {
      const target = draft.compositions.find((item) => item.id === composition.id);
      if (!target) return;
      target.fieldBounds.width = Math.min(8, Math.max(1, width));
      target.fieldBounds.height = Math.min(8, Math.max(1, height));
      Object.assign(target, regenerateComposition(target, draft.comments.map((comment) => comment.id)));
      for (const draftTake of draft.takes.filter((item) => item.compositionId === target.id)) draftTake.reflowTargets = {};
    });
    if (width <= 1 && height <= 1) setFieldView("camera");
  }

  function setMultiScreen(enabled: boolean) {
    // Default multi-screen is a vertical stack (1×3) so the camera can move up/down through frames.
    if (enabled) applyFieldBounds(1, 3);
    else applyFieldBounds(1, 1);
  }

  function setFieldDimension(axis: "width" | "height", value: number) {
    let nextWidth = axis === "width" ? value : composition.fieldBounds.width;
    let nextHeight = axis === "height" ? value : composition.fieldBounds.height;
    nextWidth = Math.min(8, Math.max(1, Number.isFinite(nextWidth) ? nextWidth : 1));
    nextHeight = Math.min(8, Math.max(1, Number.isFinite(nextHeight) ? nextHeight : 1));
    // Keep multi-screen on: if both axes would collapse to 1×1 (e.g. default 1×3 → height 1),
    // expand the other axis so 1-screen-high / 1-screen-wide layouts are possible.
    if (nextWidth <= 1 && nextHeight <= 1) {
      if (axis === "height") nextWidth = 3;
      else nextHeight = 3;
    }
    applyFieldBounds(nextWidth, nextHeight);
  }

  const telemetry = sceneRef.current?.getPerformanceTelemetry();
  return (
    <>
      <nav className="mobile-context-nav" aria-label="Mobile field panels">
        <button className={mobilePanel === "closed" ? "is-active" : ""} onClick={() => setMobilePanel("closed")}>Stage</button>
        <button className={mobilePanel === "comments" ? "is-active" : ""} onClick={() => setMobilePanel("comments")}>Comments</button>
        <button className={mobilePanel === "controls" ? "is-active" : ""} onClick={() => setMobilePanel("controls")}>Controls</button>
      </nav>
      {mobilePanel !== "closed" && <button className="mobile-sheet-backdrop" aria-label="Close mobile panel" onClick={() => setMobilePanel("closed")} />}
      <aside className={`left-panel panel-scroll mobile-sheet ${mobilePanel === "comments" ? "is-open" : ""}`}>
        <button className="mobile-sheet-close" onClick={() => setMobilePanel("closed")}><span />Close</button>
        <PanelSection title="Comments" meta={`${project.comments.length} cards`}>
          <textarea className="comments-source" value={commentSource} onChange={(event) => setCommentSource(event.target.value)} spellCheck={false} />
          <div className="parse-preview"><span>{commentPreview.records.length} valid</span><span>{commentPreview.errors.length} malformed</span></div>
          {commentPreview.errors.length > 0 && <div className="import-errors">{commentPreview.errors.slice(0, 3).map((error) => <span key={`${error.line}-${error.reason}`}>Line {error.line}: {error.reason}</span>)}</div>}
          <div className="button-pair"><button className="secondary-button" onClick={importComments}><RefreshCw size={16} />Apply</button><label className="secondary-button file-button"><FileUp size={16} />Import file<input hidden type="file" accept="text/plain,application/json,.txt,.json" onChange={(event) => event.target.files?.[0] && loadCommentFile(event.target.files[0])} /></label></div>
        </PanelSection>
        <PanelSection title="Shared card design" meta="One template">
          <p className="empty-copy">Edit one representative post and propagate it throughout every composition.</p>
          <button className="accent-button wide" onClick={() => setWorkspace("design")}><Palette size={16} />Open Design workspace</button>
        </PanelSection>
        <PanelSection title="Background">
          <div className="inline-controls"><Field label="Color" type="color" value={composition.backgroundColor} onChange={(event) => mutateComposition((draft) => { draft.backgroundColor = event.target.value; })} />
            <label className="secondary-button file-button"><ImagePlus size={16} />Image<input hidden type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && loadBackground(event.target.files[0])} /></label></div>
        </PanelSection>
        <PanelSection title="Compositions" meta="Shared copy + design">
          <div className="composition-list">{project.compositions.map((item) => <button key={item.id} className={item.id === composition.id ? "is-active" : ""} onClick={() => switchComposition(item.id)}><span>{item.name}</span><small>{item.width} × {item.height}</small></button>)}</div>
          <div className="composition-settings">
            <Field
              label="Take length (frames)"
              type="number"
              min={1}
              max={Math.round(300 * composition.frameRate)}
              step={1}
              value={Math.round(duration * composition.frameRate)}
              onChange={(event) => changeTakeDuration(Math.max(1, Math.round(Number(event.target.value))) / composition.frameRate)}
            />
            <SelectField label="Frame rate" value={composition.frameRate} onChange={(event) => mutateComposition((draft) => { draft.frameRate = Number(event.target.value); })}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></SelectField>
          </div>
        </PanelSection>
      </aside>

      <section className="workspace">
        <div className="viewer-toolbar">
          <div className="viewer-meta"><strong>{composition.name}</strong><span>{multiScreen ? `${composition.fieldBounds.width}×${composition.fieldBounds.height} field · ` : ""}{composition.frameRate} fps</span></div>
          <div className="view-switcher">
            <button className={fieldView === "camera" ? "is-active" : ""} onClick={() => setFieldView("camera")}><Camera size={14} />Camera</button>
            <button className={fieldView === "overview" ? "is-active" : ""} onClick={() => { setFieldView("overview"); requestAnimationFrame(() => sceneRef.current?.fitField()); }}><Layers3 size={14} />Overview</button>
          </div>
          <details className={`cache-badge ${previewStatus.state}`}>
            <summary>
              <span>Assets {cacheStatus.state === "ready" ? "Ready" : "Rebuilding"} · {cacheStatus.ready}/{cacheStatus.total}</span>
              <strong>{previewLabel}</strong>
            </summary>
            <div>
              <span>{cacheStatus.hits} texture hits · {cacheStatus.misses} misses</span>
              <span>{previewStatus.frameRate || composition.frameRate} fps · {previewMemory}</span>
              <span>Decode · {previewStatus.decoderBackend ?? "pending"}</span>
              {telemetry && <span>Render {telemetry.sceneRender.averageMs.toFixed(1)} ms · Readback {telemetry.gpuReadback.averageMs.toFixed(1)} ms · Encode {telemetry.frameEncode.averageMs.toFixed(1)} ms</span>}
              <code>{previewStatus.key.slice(0, 24) || "no preview key"}</code>
              <strong>{previewStatus.reason}</strong>
              <div className="cache-actions">
                <button className="secondary-button" onClick={() => clearPreviewCache("manual rebuild requested", "stale")}>Rebuild preview</button>
                <button className="secondary-button" onClick={() => clearPreviewCache()}>Clear preview</button>
              </div>
            </div>
          </details>
          <div className="mode-switcher">
            <button className={mode === "select" ? "is-active" : ""} onClick={() => setMode("select")}><MousePointer2 size={15} />Arrange</button>
            <button className={mode === "record" ? "is-recording" : ""} onClick={() => { setMode(mode === "record" ? "select" : "record"); pausePlayback(); }}><CircleDot size={15} />{mode === "record" ? "Draw through cards" : "Record build"}</button>
            <button className={mode === "reflow" ? "is-active" : ""} disabled={!take.hero} onClick={() => setMode(mode === "reflow" ? "select" : "reflow")}><Move3d size={15} />Edit reflow</button>
          </div>
        </div>
        <div className="stage-wrap">
          <div className="stage-grid" />
          <CommentScene
            ref={sceneRef}
            composition={composition}
            take={take}
            entranceMotion={project.entranceMotion}
            comments={project.comments}
            cardStyle={project.cardStyle}
            renderSettings={project.renderSettings}
            time={time}
            selectedCardId={selectedCardId}
            selectedCardIds={selectedCardIds}
            selectedGestureIndex={selectedGestureIndex}
            mode={mode}
            viewMode={playing ? "camera" : fieldView}
            showTransformHandles
            showGesturePath={rightTab === "build"}
            onSelect={onSelectCard}
            onSelectGestureSample={setSelectedGestureIndex}
            onGestureSampleChange={updateGestureSample}
            onTransformCard={transformCard}
            onTransformCards={transformCards}
            onGestureComplete={completeGesture}
            onCacheStatus={setCacheStatus}
            onManipulationStart={beginManipulation}
            onManipulationEnd={endManipulation}
          />
          {mode === "record" && <div className="record-hint"><CircleDot size={13} />Drag a path across the field</div>}
        </div>
      </section>

      <aside className={`right-panel panel-scroll mobile-sheet ${mobilePanel === "controls" ? "is-open" : ""}`}>
        <button className="mobile-sheet-close" onClick={() => setMobilePanel("closed")}><span />Close</button>
        <div className="mobile-mode-actions" aria-label="Field interaction mode">
          <button className={mode === "select" ? "is-active" : ""} onClick={() => setMode("select")}><MousePointer2 size={16} />Arrange</button>
          <button className={mode === "record" ? "is-active" : ""} onClick={() => { setMode(mode === "record" ? "select" : "record"); pausePlayback(); }}><CircleDot size={16} />Record</button>
          <button className={mode === "reflow" ? "is-active" : ""} disabled={!take.hero} onClick={() => setMode(mode === "reflow" ? "select" : "reflow")}><Move3d size={16} />Reflow</button>
        </div>
        <div className="panel-tabs"><button className={rightTab === "layout" ? "is-active" : ""} onClick={() => setRightTab("layout")}>Layout</button><button className={rightTab === "build" ? "is-active" : ""} onClick={() => setRightTab("build")}>Build</button><button className={rightTab === "hero" ? "is-active" : ""} onClick={() => setRightTab("hero")}>Hero</button></div>
        {rightTab === "layout" && <>
          <PanelSection title="Scatter field" meta="Deterministic">
            <Field label="Visible seed" value={composition.seed} onChange={(event) => mutateComposition((draft) => { draft.seed = event.target.value; })} />
            {styleToggle("Multi-screen field", multiScreen, setMultiScreen)}
            {multiScreen ? (
              <>
                <p className="panel-note">
                  Width/height are screen counts (not pixels). Examples: <strong>1×3</strong> tall stack, <strong>3×1</strong> one screen high and three wide, <strong>3×3</strong> grid.
                </p>
                <Field label="Screens wide" type="number" min={1} max={8} step={1} value={composition.fieldBounds.width} onChange={(event) => setFieldDimension("width", Number(event.target.value))} />
                <Field label="Screens high" type="number" min={1} max={8} step={1} value={composition.fieldBounds.height} onChange={(event) => setFieldDimension("height", Number(event.target.value))} />
                <div className="button-pair">
                  <button type="button" className="secondary-button" onClick={() => applyFieldBounds(1, 3)}>1 wide · 3 high</button>
                  <button type="button" className="secondary-button" onClick={() => applyFieldBounds(3, 1)}>3 wide · 1 high</button>
                </div>
                <button type="button" className="secondary-button wide" onClick={() => applyFieldBounds(3, 3)}>3×3 grid</button>
              </>
            ) : (
              <p className="panel-note">Cards stay inside a single camera frame. Turn this on only if you want to animate across extra screens.</p>
            )}
            <Slider label="Density" min={0.3} max={1} step={0.05} value={composition.scatter.density} onChange={(event) => mutateComposition((draft) => { draft.scatter.density = Number(event.target.value); })} />
            <Slider label="Spacing" min={0.04} max={0.25} step={0.01} value={composition.scatter.minSpacing} onChange={(event) => mutateComposition((draft) => { draft.scatter.minSpacing = Number(event.target.value); })} />
            <Slider label="Size variation" min={0} max={0.5} step={0.01} value={composition.scatter.sizeVariation} onChange={(event) => mutateComposition((draft) => { draft.scatter.sizeVariation = Number(event.target.value); })} />
            <Slider label="Rotation" min={0} max={0.2} step={0.01} value={composition.scatter.rotationVariation} onChange={(event) => mutateComposition((draft) => { draft.scatter.rotationVariation = Number(event.target.value); })} />
            <Slider label="Depth near" min={-1.5} max={1.5} step={0.05} value={composition.scatter.depthMin} onChange={(event) => mutateComposition((draft) => { draft.scatter.depthMin = Number(event.target.value); })} />
            <Slider label="Depth far" min={-1.5} max={1.5} step={0.05} value={composition.scatter.depthMax} onChange={(event) => mutateComposition((draft) => { draft.scatter.depthMax = Number(event.target.value); })} />
            <button className="primary-button wide" onClick={scatter}><WandSparkles size={16} />Generate field</button>
            <div className="button-pair">
              <button className="secondary-button" onClick={fitFieldToComments}>Fit to comments</button>
              <button className="secondary-button" onClick={() => { setFieldView("overview"); requestAnimationFrame(() => sceneRef.current?.fitField()); }}>Fit field</button>
            </div>
            <button className="secondary-button wide" onClick={() => setFieldView("camera")}><Camera size={15} />Frame camera</button>
          </PanelSection>
          <PanelSection title="Protected regions" meta={`${composition.protectedRegions.length}`}>
            <button className="secondary-button wide" onClick={addProtectedRegion}><Shield size={16} />Add central region</button>
          </PanelSection>
          <PanelSection title="Selection" meta={selectedCardIds.length > 1 ? `${selectedCardIds.length} posts` : (selectedComment?.handle || (selectedComment ? "Message-only" : "None"))}>
            {selectedCardIds.length > 0 && (
              <>
                <p className="panel-note">
                  {selectedCardIds.length} selected. Esc clears · Ctrl/Cmd+A selects all.
                  {selectedCardIds.length > 1 ? " Drag any selected post to move the group. Alt-drag pans overview." : ""}
                </p>
                <button type="button" className="secondary-button wide" onClick={() => onSelectCard(null, { ids: [] })}>Clear selection</button>
                <button
                  type="button"
                  className="secondary-button wide"
                  onClick={() => {
                    const ids = composition.cards.map((card) => card.cardId);
                    onSelectCard(ids[ids.length - 1] ?? null, { ids });
                  }}
                >
                  Select all posts
                </button>
              </>
            )}
            {selectedCardIds.length > 1 && (
              <>
                <div className="align-grid">
                  <button type="button" className="secondary-button" onClick={() => runAlign("left")}>Align left</button>
                  <button type="button" className="secondary-button" onClick={() => runAlign("center")}>Align center</button>
                  <button type="button" className="secondary-button" onClick={() => runAlign("right")}>Align right</button>
                  <button type="button" className="secondary-button" onClick={() => runAlign("top")}>Align top</button>
                  <button type="button" className="secondary-button" onClick={() => runAlign("middle")}>Align middle</button>
                  <button type="button" className="secondary-button" onClick={() => runAlign("bottom")}>Align bottom</button>
                </div>
                <div className="button-pair">
                  <button type="button" className="secondary-button" disabled={selectedCardIds.length < 3} onClick={() => runDistribute("horizontal")}>Distribute H</button>
                  <button type="button" className="secondary-button" disabled={selectedCardIds.length < 3} onClick={() => runDistribute("vertical")}>Distribute V</button>
                </div>
              </>
            )}
            {selectedPlacement ? <>
              <p className="selected-copy">“{selectedComment?.message}”</p>
              <Slider label="Depth" min={-1} max={1.5} step={0.01} value={selectedPlacement.z} disabled={selectedPlacement.locked} onChange={(event) => mutateComposition((draft) => { const card = draft.cards.find((item) => item.cardId === selectedPlacement.cardId); if (card) card.z = Number(event.target.value); })} />
              <Slider label="Scale" min={0.35} max={2.5} step={0.01} value={selectedPlacement.scale} disabled={selectedPlacement.locked || selectedCardIds.length > 1} onChange={(event) => transformCard(selectedPlacement.cardId, { scale: Number(event.target.value) }, false)} />
              <Slider label="Rotation" min={-0.8} max={0.8} step={0.01} value={selectedPlacement.rotation} disabled={selectedPlacement.locked || selectedCardIds.length > 1} display={`${(selectedPlacement.rotation * 57.2958).toFixed(1)}°`} onChange={(event) => transformCard(selectedPlacement.cardId, { rotation: Number(event.target.value) }, false)} />
              <div className="button-pair">
                <button className="secondary-button" onClick={() => mutateComposition((draft) => { const card = draft.cards.find((item) => item.cardId === selectedPlacement.cardId); if (card) card.locked = !card.locked; })}>{selectedPlacement.locked ? <Unlock size={16} /> : <Lock size={16} />}{selectedPlacement.locked ? "Unlock" : "Lock"}</button>
                {take.hero?.cardId === selectedPlacement.cardId ? <button className="danger-button" onClick={removeHero}><Trash2 size={16} />Remove hero</button> : <button className="accent-button" onClick={setHero}><Sparkles size={16} />Make hero</button>}
              </div>
            </> : <p className="empty-copy">Select a post to move it. In Overview, drag empty space to marquee-select, or Alt-drag to pan.</p>}
          </PanelSection>
        </>}
        {rightTab === "build" && <><PanelSection title="Trigger timing" meta={`${take.cardTriggers.length} triggers`}>
          <Field label="Build seed" value={take.build.seed} onChange={(event) => updateBuild("seed", event.target.value)} />
          <SelectField label="Order" value={take.build.order} onChange={(event) => updateBuild("order", event.target.value as BuildOrder)}><option value="random">Random</option><option value="left-to-right">Left to right</option><option value="outside-in">Outside inward</option><option value="depth">Depth order</option></SelectField>
          <Slider
            label="Stagger start"
            min={0}
            max={Math.round(6 * composition.frameRate)}
            step={1}
            value={Math.round(take.build.staggerStart * composition.frameRate)}
            display={`${Math.round(take.build.staggerStart * composition.frameRate)}f`}
            onChange={(event) => updateBuild("staggerStart", Number(event.target.value) / composition.frameRate)}
          />
          <Slider
            label="Stagger end"
            min={0}
            max={Math.round(6 * composition.frameRate)}
            step={1}
            value={Math.round(take.build.staggerEnd * composition.frameRate)}
            display={`${Math.round(take.build.staggerEnd * composition.frameRate)}f`}
            onChange={(event) => updateBuild("staggerEnd", Number(event.target.value) / composition.frameRate)}
          />
          <button className="accent-button wide" onClick={() => { setWorkspace("animate"); setAnimateTab("entrance"); }}><Clapperboard size={16} />Edit entrance template</button>
          <button className="secondary-button wide" onClick={randomizeBuild}><Sparkles size={16} />Randomize triggers</button>
          <button className={`record-button wide ${mode === "record" ? "is-recording" : ""}`} onClick={() => { setMode(mode === "record" ? "select" : "record"); pausePlayback(); }}><CircleDot size={16} />{mode === "record" ? "Recording: draw in viewer" : "Record mouse build"}</button>
        </PanelSection>
        <PanelSection title="Tweet population" meta={take.population.enabled ? "Living field" : "Single build"}>
          <p className="panel-explainer">Give each post a deterministic life: enter, drift, leave, wait, and return. The same seed always produces the same performance.</p>
          {styleToggle("Continuous field", take.population.enabled, (enabled) => mutateTake((draft) => { draft.population.enabled = enabled; }))}
          <button className="accent-button wide" onClick={() => mutateTake((draft) => {
            Object.assign(draft.population, {
              enabled: true,
              initialPopulation: 0.35,
              lifeMin: 1.8,
              lifeMax: 4.5,
              gapMin: 0.45,
              gapMax: 1.35,
              exitDuration: 0.45,
              wanderAmount: 0.025,
              scaleVariation: 0.04,
              depthVariation: 1.2,
              exitDistance: 0.32,
              postHeroBurst: 0.9,
              postHeroBurstDuration: 0.5,
              postHeroBurstEasing: { x1: 0.55, y1: 0, x2: 0.85, y2: 0.25 },
              postHeroEntranceDuration: 1 / 3,
              postHeroLifeMin: 0.75,
              postHeroLifeMax: 1.5,
              postHeroExitDuration: 1 / 3,
            });
          })}><Sparkles size={16} />Apply client-note preset</button>
          <button className="secondary-button wide" onClick={() => { setWorkspace("animate"); setAnimateTab("exit"); }}><Clapperboard size={16} />Edit out animation</button>
          {take.population.enabled && <>
            <Field label="Population seed" value={take.population.seed} onChange={(event) => mutateTake((draft) => { draft.population.seed = event.target.value; })} />
            <Slider label="Visible at start" min={0} max={1} step={0.05} value={take.population.initialPopulation} display={`${Math.round(take.population.initialPopulation * 100)}%`} onChange={(event) => mutateTake((draft) => { draft.population.initialPopulation = Number(event.target.value); })} />
            <Slider label="Shortest life" min={6} max={Math.round(8 * composition.frameRate)} step={1} value={Math.round(take.population.lifeMin * composition.frameRate)} display={`${Math.round(take.population.lifeMin * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.lifeMin = Number(event.target.value) / composition.frameRate; })} />
            <Slider label="Longest life" min={12} max={Math.round(12 * composition.frameRate)} step={1} value={Math.round(take.population.lifeMax * composition.frameRate)} display={`${Math.round(take.population.lifeMax * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.lifeMax = Number(event.target.value) / composition.frameRate; })} />
            <Slider label="Shortest gap" min={0} max={Math.round(4 * composition.frameRate)} step={1} value={Math.round(take.population.gapMin * composition.frameRate)} display={`${Math.round(take.population.gapMin * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.gapMin = Number(event.target.value) / composition.frameRate; })} />
            <Slider label="Longest gap" min={0} max={Math.round(6 * composition.frameRate)} step={1} value={Math.round(take.population.gapMax * composition.frameRate)} display={`${Math.round(take.population.gapMax * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.gapMax = Number(event.target.value) / composition.frameRate; })} />
            <Slider label="Exit duration" min={3} max={Math.round(2 * composition.frameRate)} step={1} value={Math.round(take.population.exitDuration * composition.frameRate)} display={`${Math.round(take.population.exitDuration * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.exitDuration = Number(event.target.value) / composition.frameRate; })} />
            <Slider label="Wander" min={0} max={0.12} step={0.0025} value={take.population.wanderAmount} display={`${(take.population.wanderAmount * 100).toFixed(1)}%`} onChange={(event) => mutateTake((draft) => { draft.population.wanderAmount = Number(event.target.value); })} />
            <Slider label="Card size jitter" min={0} max={0.6} step={0.005} value={take.population.scaleVariation} display={`${Math.round(take.population.scaleVariation * 100)}%`} onChange={(event) => mutateTake((draft) => { draft.population.scaleVariation = Number(event.target.value); })} />
            <Slider label="Depth / apparent size" min={0} max={2.5} step={0.05} value={take.population.depthVariation} display={take.population.depthVariation.toFixed(2)} onChange={(event) => mutateTake((draft) => { draft.population.depthVariation = Number(event.target.value); })} />
            <p className="panel-note">Cards stay close to the shared template size. Near/far Z now creates most of the apparent size difference.</p>
            <Slider label="Exit distance" min={0} max={1.2} step={0.025} value={take.population.exitDistance} display={take.population.exitDistance.toFixed(2)} onChange={(event) => mutateTake((draft) => { draft.population.exitDistance = Number(event.target.value); })} />
          </>}
        </PanelSection>
        <PanelSection title="Final burst" meta={take.hero ? `Hero end · ${Math.round(finalBurstStartTime * composition.frameRate)}f` : `Manual · ${Math.round(finalBurstStartTime * composition.frameRate)}f`}>
          <p className="panel-explainer">Give the ending its own denser, faster performance. The bias curve redistributes arrivals inside the selected window.</p>
          <button className="accent-button wide" onClick={() => mutateTake((draft) => {
            Object.assign(draft.population, {
              enabled: true,
              postHeroBurst: 0.95,
              postHeroBurstStartTime: Math.max(0, draft.duration - 2),
              postHeroBurstDuration: 10 / composition.frameRate,
              postHeroBurstEasing: { x1: 0.55, y1: 0, x2: 0.85, y2: 0.25 },
              postHeroEntranceDuration: 8 / composition.frameRate,
              postHeroLifeMin: 18 / composition.frameRate,
              postHeroLifeMax: 36 / composition.frameRate,
              postHeroExitDuration: 8 / composition.frameRate,
            });
          })}><Sparkles size={16} />Apply fast-ending preset</button>
          <button className="secondary-button wide" onClick={() => { pausePlayback(); onTimeChange(Math.max(0, finalBurstStartTime - 0.5)); }}><Clapperboard size={16} />Cue final burst</button>
          <Slider label="Burst start" min={0} max={Math.round(duration * composition.frameRate)} step={1} value={Math.round(finalBurstStartTime * composition.frameRate)} display={`${Math.round(finalBurstStartTime * composition.frameRate)}f`} disabled={Boolean(take.hero)} onChange={(event) => mutateTake((draft) => { draft.population.postHeroBurstStartTime = Number(event.target.value) / composition.frameRate; })} />
          <Slider label="Burst amount" min={0} max={1} step={0.05} value={take.population.postHeroBurst} display={`${Math.round(take.population.postHeroBurst * 100)}%`} onChange={(event) => mutateTake((draft) => { draft.population.postHeroBurst = Number(event.target.value); })} />
          <Slider label="Arrival window" min={1} max={Math.round(4 * composition.frameRate)} step={1} value={Math.round(take.population.postHeroBurstDuration * composition.frameRate)} display={`${Math.round(take.population.postHeroBurstDuration * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.postHeroBurstDuration = Number(event.target.value) / composition.frameRate; })} />
          <Slider label="Build duration" min={2} max={Math.round(2 * composition.frameRate)} step={1} value={Math.round(finalBurstEntranceDuration * composition.frameRate)} display={`${Math.round(finalBurstEntranceDuration * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.postHeroEntranceDuration = Number(event.target.value) / composition.frameRate; })} />
          <Slider label="Shortest burst life" min={4} max={Math.round(6 * composition.frameRate)} step={1} value={Math.round(finalBurstLifeMin * composition.frameRate)} display={`${Math.round(finalBurstLifeMin * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.postHeroLifeMin = Math.min(Number(event.target.value) / composition.frameRate, draft.population.postHeroLifeMax ?? draft.population.lifeMax); })} />
          <Slider label="Longest burst life" min={6} max={Math.round(8 * composition.frameRate)} step={1} value={Math.round(finalBurstLifeMax * composition.frameRate)} display={`${Math.round(finalBurstLifeMax * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.postHeroLifeMax = Math.max(Number(event.target.value) / composition.frameRate, draft.population.postHeroLifeMin ?? draft.population.lifeMin); })} />
          <Slider label="Burst exit duration" min={2} max={Math.round(2 * composition.frameRate)} step={1} value={Math.round(finalBurstExitDuration * composition.frameRate)} display={`${Math.round(finalBurstExitDuration * composition.frameRate)}f`} onChange={(event) => mutateTake((draft) => { draft.population.postHeroExitDuration = Number(event.target.value) / composition.frameRate; })} />
          <div className="population-curve-label"><strong>Arrival bias</strong><span>Weighted delay</span></div>
          <CurveEditor curve={finalBurstEasing} onChange={(postHeroBurstEasing) => mutateTake((draft) => { draft.population.postHeroBurstEasing = postHeroBurstEasing; })} />
          <div className="curve-presets">
            <button onClick={() => mutateTake((draft) => { draft.population.postHeroBurstEasing = { x1: 0.55, y1: 0, x2: 0.85, y2: 0.25 }; })}>Front-load</button>
            <button onClick={() => mutateTake((draft) => { draft.population.postHeroBurstEasing = { x1: 0, y1: 0, x2: 1, y2: 1 }; })}>Even</button>
            <button onClick={() => mutateTake((draft) => { draft.population.postHeroBurstEasing = { x1: 0.15, y1: 0.75, x2: 0.45, y2: 1 }; })}>Back-load</button>
          </div>
          <p className="panel-note">{take.hero ? "The burst follows the hero’s final key automatically." : "No hero is assigned, so the burst uses the manual start frame above."} Cue it, then play through the arrival window to judge the curve.</p>
        </PanelSection>
        {take.gestureSamples.length > 0 && <PanelSection title="Recorded path" meta={selectedGestureIndex === null ? `${take.gestureSamples.length} points` : `Point ${selectedGestureIndex + 1}/${take.gestureSamples.length}`}>
          <p className="panel-explainer">Tap a point in the viewer or its diamond in the timeline, then art-direct its screen position and arrival time.</p>
          {selectedGestureIndex === null ? <button className="secondary-button wide" onClick={() => setSelectedGestureIndex(0)}>Select first point</button> : (() => {
            const sample = take.gestureSamples[selectedGestureIndex];
            if (!sample) return null;
            return <>
              <Slider
                label="Point frame"
                min={0}
                max={Math.round(duration * composition.frameRate)}
                step={1}
                value={Math.round(sample.time * composition.frameRate)}
                display={`${Math.round(sample.time * composition.frameRate)}f`}
                onChange={(event) => updateGestureSample(selectedGestureIndex, { time: Number(event.target.value) / composition.frameRate })}
              />
              <Slider label="Screen X" min={0} max={1} step={0.005} value={sample.x} display={`${Math.round(sample.x * 100)}%`} onChange={(event) => updateGestureSample(selectedGestureIndex, { x: Number(event.target.value) })} />
              <Slider label="Screen Y" min={0} max={1} step={0.005} value={sample.y} display={`${Math.round(sample.y * 100)}%`} onChange={(event) => updateGestureSample(selectedGestureIndex, { y: Number(event.target.value) })} />
              <div className="button-pair">
                <button className="secondary-button" disabled={selectedGestureIndex <= 0} onClick={() => setSelectedGestureIndex(selectedGestureIndex - 1)}>Previous point</button>
                <button className="secondary-button" disabled={selectedGestureIndex >= take.gestureSamples.length - 1} onClick={() => setSelectedGestureIndex(selectedGestureIndex + 1)}>Next point</button>
              </div>
            </>;
          })()}
        </PanelSection>}
        <PanelSection title="Take notes"><textarea className="take-notes" value={take.notes ?? ""} placeholder="Timing notes, alternates, review flags…" onChange={(event) => mutateTake((draft) => { draft.notes = event.target.value; })} /></PanelSection></>}
        {rightTab === "build" && <PanelSection title="In opacity curve" meta="Entrance opacity only">
          <p className="panel-explainer">Shape the fade independently from position, scale, rotation, depth, and blur.</p>
          <Slider label="Fade amount" min={0} max={1} step={0.01} value={project.entranceMotion.fade} display={`${Math.round(project.entranceMotion.fade * 100)}%`} onChange={(event) => mutateProject((draft) => { draft.entranceMotion.fade = Number(event.target.value); })} />
          <CurveEditor curve={project.entranceMotion.opacityEasing} onChange={(opacityEasing) => mutateProject((draft) => { draft.entranceMotion.opacityEasing = opacityEasing; })} />
          <div className="curve-presets">
            <button onClick={() => mutateProject((draft) => { draft.entranceMotion.opacityEasing = { x1: 0, y1: 0, x2: 1, y2: 1 }; })}>Linear</button>
            <button onClick={() => mutateProject((draft) => { draft.entranceMotion.opacityEasing = { x1: 0.42, y1: 0, x2: 1, y2: 1 }; })}>Ease in</button>
            <button onClick={() => mutateProject((draft) => { draft.entranceMotion.opacityEasing = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }; })}>Ease out</button>
          </div>
        </PanelSection>}
        {rightTab === "build" && <PanelSection title="Motion blur" meta={project.renderSettings.motionBlur.enabled ? "On" : "Off"}>
          <p className="panel-explainer">Apply deterministic directional blur from card, hero, and camera movement. Production export and cached playback use the same shutter.</p>
          <button className={`secondary-button wide ${project.renderSettings.motionBlur.enabled ? "is-active" : ""}`} aria-pressed={project.renderSettings.motionBlur.enabled} onClick={() => mutateProject((draft) => { draft.renderSettings.motionBlur.enabled = !draft.renderSettings.motionBlur.enabled; })}>
            {project.renderSettings.motionBlur.enabled ? "Disable motion blur" : "Enable motion blur"}
          </button>
          {project.renderSettings.motionBlur.enabled && <>
            <Slider label="Shutter angle" min={45} max={360} step={15} value={project.renderSettings.motionBlur.shutterAngle} display={`${project.renderSettings.motionBlur.shutterAngle.toFixed(0)}°`} onChange={(event) => mutateProject((draft) => { draft.renderSettings.motionBlur.shutterAngle = Number(event.target.value); })} />
            <Slider label="Strength" min={0.25} max={2} step={0.05} value={project.renderSettings.motionBlur.strength} display={`${project.renderSettings.motionBlur.strength.toFixed(2)}×`} onChange={(event) => mutateProject((draft) => { draft.renderSettings.motionBlur.strength = Number(event.target.value); })} />
          </>}
        </PanelSection>}
        {rightTab === "hero" && (
          <PanelSection title="Hero transition" meta={take.hero ? project.comments.find((item) => item.id === take.hero?.cardId)?.handle : "Not set"}>
            {!take.hero ? (
              <div className="empty-hero"><Heart size={24} /><p>Select an eligible post, then choose <strong>Make hero</strong>.</p></div>
            ) : (
              <>
                <p className="selected-copy">The active hero is rendered above every ordinary post.</p>
                <button className="accent-button wide" onClick={() => { setWorkspace("animate"); setAnimateTab("hero"); }}>
                  <Clapperboard size={16} />Edit hero path
                </button>
                <button className="secondary-button wide" onClick={alignCameraToHero}>
                  <Camera size={16} />Settle camera on hero
                </button>
                <button className="secondary-button wide" onClick={bakeReflow}>
                  <Move3d size={16} />Generate & edit reflow
                </button>
                {onExportHeroStill && (
                  <button type="button" className="secondary-button wide" onClick={onExportHeroStill}>
                    <Download size={16} />Export hero still
                  </button>
                )}
                <button className="danger-button wide" onClick={removeHero}>
                  <Trash2 size={16} />Remove hero
                </button>
              </>
            )}
          </PanelSection>
        )}
      </aside>
    </>
  );
}

