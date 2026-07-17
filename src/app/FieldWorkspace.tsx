import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  Camera, CircleDot, Clapperboard, FileUp, Heart, ImagePlus, Layers3, Lock, MousePointer2,
  Move3d, Palette, RefreshCw, Shield, Sparkles, Trash2, Unlock, WandSparkles,
} from "lucide-react";
import type {
  BuildOrder, CardPlacement, CommentRecord, Composition, GestureSample, ParseResult, PreviewCacheStatus, Project, Take,
} from "@comment-field/engine";
import type { CacheStatus, CommentSceneHandle, InteractionMode, TransformPatch } from "../renderer/CommentScene";
import { CommentScene } from "../renderer/CommentScene";
import { Field, PanelSection, SelectField, Slider } from "./Controls";
import { CurveEditor } from "./MotionEditors";

type Workspace = "field" | "design" | "animate";
type AnimateTab = "entrance" | "camera" | "hero";
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
  clearPreviewCache: (reason?: string, state?: PreviewCacheStatus["state"]) => void;
  pausePlayback: () => void;
  beginManipulation: () => void;
  transformCard: (cardId: string, patch: TransformPatch, editReflow: boolean) => void;
  completeGesture: (samples: GestureSample[]) => void;
  scatter: () => void;
  fitFieldToComments: () => void;
  addProtectedRegion: () => void;
  removeHero: () => void;
  setHero: () => void;
  updateBuild: (key: keyof Take["build"], value: Take["build"][keyof Take["build"]]) => void;
  randomizeBuild: () => void;
  alignCameraToHero: () => void;
  bakeReflow: () => void;
}

export function FieldWorkspace(props: FieldWorkspaceProps) {
  const {
    project, composition, take, duration, time, playing, commentSource, commentPreview, selectedCardId,
    selectedPlacement, selectedComment, mode, fieldView, rightTab, cacheStatus, previewStatus, previewLabel,
    previewMemory, sceneRef, setCommentSource, setSelectedCardId, setMode, setFieldView, setRightTab, setWorkspace,
    setAnimateTab, setCacheStatus, mutateProject, mutateComposition, mutateTake, importComments, loadCommentFile,
    loadBackground, switchComposition, changeTakeDuration, clearPreviewCache, pausePlayback, beginManipulation,
    transformCard, completeGesture, scatter, fitFieldToComments, addProtectedRegion, removeHero, setHero, updateBuild,
    randomizeBuild, alignCameraToHero, bakeReflow,
  } = props;
  return (
    <>
      <aside className="left-panel panel-scroll">
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
            <Field label="Take length" type="number" min={1 / composition.frameRate} max={300} step={1 / composition.frameRate} value={duration} onChange={(event) => changeTakeDuration(Number(event.target.value))} />
            <SelectField label="Frame rate" value={composition.frameRate} onChange={(event) => mutateComposition((draft) => { draft.frameRate = Number(event.target.value); })}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></SelectField>
          </div>
        </PanelSection>
      </aside>

      <section className="workspace">
        <div className="viewer-toolbar">
          <div className="viewer-meta"><strong>{composition.name}</strong><span>{composition.fieldBounds.width}×{composition.fieldBounds.height} field · {composition.frameRate} fps</span></div>
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
          <CommentScene ref={sceneRef} composition={composition} take={take} entranceMotion={project.entranceMotion} comments={project.comments} cardStyle={project.cardStyle} time={time} selectedCardId={selectedCardId} mode={mode} viewMode={playing ? "camera" : fieldView} showTransformHandles onSelect={setSelectedCardId} onTransformCard={transformCard} onGestureComplete={completeGesture} onCacheStatus={setCacheStatus} onManipulationStart={beginManipulation} />
          {mode === "record" && <div className="record-hint"><CircleDot size={13} />Drag a path across the field</div>}
        </div>
      </section>

      <aside className="right-panel panel-scroll">
        <div className="panel-tabs"><button className={rightTab === "layout" ? "is-active" : ""} onClick={() => setRightTab("layout")}>Layout</button><button className={rightTab === "build" ? "is-active" : ""} onClick={() => setRightTab("build")}>Build</button><button className={rightTab === "hero" ? "is-active" : ""} onClick={() => setRightTab("hero")}>Hero</button></div>
        {rightTab === "layout" && <>
          <PanelSection title="Scatter field" meta="Deterministic">
            <Field label="Visible seed" value={composition.seed} onChange={(event) => mutateComposition((draft) => { draft.seed = event.target.value; })} />
            <Field label="Field width" type="number" min={1} max={8} step={1} value={composition.fieldBounds.width} onChange={(event) => mutateComposition((draft) => { draft.fieldBounds.width = Math.min(8, Math.max(1, Number(event.target.value))); })} />
            <Field label="Field height" type="number" min={1} max={8} step={1} value={composition.fieldBounds.height} onChange={(event) => mutateComposition((draft) => { draft.fieldBounds.height = Math.min(8, Math.max(1, Number(event.target.value))); })} />
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
          <PanelSection title="Selected card" meta={selectedComment?.handle || (selectedComment ? "Message-only" : "None")}>
            {selectedPlacement ? <>
              <p className="selected-copy">“{selectedComment?.message}”</p>
              <Slider label="Depth" min={-1} max={1.5} step={0.01} value={selectedPlacement.z} disabled={selectedPlacement.locked} onChange={(event) => mutateComposition((draft) => { const card = draft.cards.find((item) => item.cardId === selectedPlacement.cardId); if (card) card.z = Number(event.target.value); })} />
              <Slider label="Scale" min={0.35} max={2.5} step={0.01} value={selectedPlacement.scale} disabled={selectedPlacement.locked} onChange={(event) => transformCard(selectedPlacement.cardId, { scale: Number(event.target.value) }, false)} />
              <Slider label="Rotation" min={-0.8} max={0.8} step={0.01} value={selectedPlacement.rotation} disabled={selectedPlacement.locked} display={`${(selectedPlacement.rotation * 57.2958).toFixed(1)}°`} onChange={(event) => transformCard(selectedPlacement.cardId, { rotation: Number(event.target.value) }, false)} />
              <div className="button-pair">
                <button className="secondary-button" onClick={() => mutateComposition((draft) => { const card = draft.cards.find((item) => item.cardId === selectedPlacement.cardId); if (card) card.locked = !card.locked; })}>{selectedPlacement.locked ? <Unlock size={16} /> : <Lock size={16} />}{selectedPlacement.locked ? "Unlock" : "Lock"}</button>
                {take.hero?.cardId === selectedPlacement.cardId ? <button className="danger-button" onClick={removeHero}><Trash2 size={16} />Remove hero</button> : <button className="accent-button" onClick={setHero}><Sparkles size={16} />Make hero</button>}
              </div>
            </> : <p className="empty-copy">Select a post to move it, scale from its corners, or rotate from the top handle.</p>}
          </PanelSection>
        </>}
        {rightTab === "build" && <><PanelSection title="Trigger timing" meta={`${take.cardTriggers.length} triggers`}>
          <Field label="Build seed" value={take.build.seed} onChange={(event) => updateBuild("seed", event.target.value)} />
          <SelectField label="Order" value={take.build.order} onChange={(event) => updateBuild("order", event.target.value as BuildOrder)}><option value="random">Random</option><option value="left-to-right">Left to right</option><option value="outside-in">Outside inward</option><option value="depth">Depth order</option></SelectField>
          <Slider label="Stagger start" min={0} max={6} step={0.1} value={take.build.staggerStart} display={`${take.build.staggerStart.toFixed(1)}s`} onChange={(event) => updateBuild("staggerStart", Number(event.target.value))} />
          <Slider label="Stagger end" min={0} max={6} step={0.1} value={take.build.staggerEnd} display={`${take.build.staggerEnd.toFixed(1)}s`} onChange={(event) => updateBuild("staggerEnd", Number(event.target.value))} />
          <button className="accent-button wide" onClick={() => { setWorkspace("animate"); setAnimateTab("entrance"); }}><Clapperboard size={16} />Edit entrance template</button>
          <button className="secondary-button wide" onClick={randomizeBuild}><Sparkles size={16} />Randomize triggers</button>
          <button className={`record-button wide ${mode === "record" ? "is-recording" : ""}`} onClick={() => { setMode(mode === "record" ? "select" : "record"); pausePlayback(); }}><CircleDot size={16} />{mode === "record" ? "Recording: draw in viewer" : "Record mouse build"}</button>
        </PanelSection><PanelSection title="Take notes"><textarea className="take-notes" value={take.notes ?? ""} placeholder="Timing notes, alternates, review flags…" onChange={(event) => mutateTake((draft) => { draft.notes = event.target.value; })} /></PanelSection></>}
        {rightTab === "build" && <PanelSection title="Opacity curve" meta="Shared globally">
          <p className="panel-explainer">Shape the fade independently from position, scale, rotation, depth, and blur.</p>
          <Slider label="Fade amount" min={0} max={1} step={0.01} value={project.entranceMotion.fade} display={`${Math.round(project.entranceMotion.fade * 100)}%`} onChange={(event) => mutateProject((draft) => { draft.entranceMotion.fade = Number(event.target.value); })} />
          <CurveEditor curve={project.entranceMotion.opacityEasing} onChange={(opacityEasing) => mutateProject((draft) => { draft.entranceMotion.opacityEasing = opacityEasing; })} />
          <div className="curve-presets">
            <button onClick={() => mutateProject((draft) => { draft.entranceMotion.opacityEasing = { x1: 0, y1: 0, x2: 1, y2: 1 }; })}>Linear</button>
            <button onClick={() => mutateProject((draft) => { draft.entranceMotion.opacityEasing = { x1: 0.42, y1: 0, x2: 1, y2: 1 }; })}>Ease in</button>
            <button onClick={() => mutateProject((draft) => { draft.entranceMotion.opacityEasing = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }; })}>Ease out</button>
          </div>
        </PanelSection>}
        {rightTab === "hero" && <PanelSection title="Hero transition" meta={take.hero ? project.comments.find((item) => item.id === take.hero?.cardId)?.handle : "Not set"}>
          {!take.hero ? <div className="empty-hero"><Heart size={24} /><p>Select an eligible post, then choose <strong>Make hero</strong>.</p></div> : <>
            <p className="selected-copy">The active hero is rendered above every ordinary post.</p>
            <button className="accent-button wide" onClick={() => { setWorkspace("animate"); setAnimateTab("hero"); }}><Clapperboard size={16} />Edit hero path</button>
            <button className="secondary-button wide" onClick={alignCameraToHero}><Camera size={16} />Settle camera on hero</button>
            <button className="secondary-button wide" onClick={bakeReflow}><Move3d size={16} />Generate & edit reflow</button>
            <button className="danger-button wide" onClick={removeHero}><Trash2 size={16} />Remove hero</button>
          </>}
        </PanelSection>}
      </aside>
    </>
  );
}

