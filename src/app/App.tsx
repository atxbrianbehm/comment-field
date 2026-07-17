import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, CheckCheck, CircleDot, CircleHelp, Clapperboard, Copy, Download, FileUp, Heart, ImagePlus, Layers3, Lock,
  MousePointer2, Move3d, Palette, Pause, Play, Plus, RefreshCw, Save, Shield, Sparkles, Star,
  Trash2, Unlock, WandSparkles,
} from "lucide-react";
import {
  clearHeroPerformance,
  createDefaultProject,
  DEFAULT_ENTRANCE_MOTION,
  DEFAULT_COMMENT_TEXT,
  deserializeProject,
  fitFieldBoundsToComments,
  generateReflowTargets,
  heroEndTime,
  heroStartTime,
  parseCommentJson,
  parsePlainText,
  regenerateComposition,
  resolveBuildTriggers,
  resolveGestureTriggers,
  serializeProject,
  settleCameraOnHero,
  type BuildOrder,
  type Composition,
  type GestureSample,
  type HeroPerformance,
  type Project,
  type Take,
} from "@comment-field/engine";
import { exportPngSequence } from "../export/pngSequence";
import { loadAutosave, saveAutosave } from "../infrastructure/projectStore";
import { CommentScene, type CacheStatus, type CommentSceneHandle, type InteractionMode, type TransformPatch } from "../renderer/CommentScene";
import { CameraWorkspace, DesignWorkspace, EntranceWorkspace, HeroWorkspace } from "./AuthoringWorkspaces";
import { formatTimecode, KeyframeTimeline } from "./KeyframeTimeline";
import { Field, IconButton, PanelSection, SelectField, Slider } from "./Controls";
import { CurveEditor } from "./MotionEditors";
import { HelpOverlay } from "./HelpOverlay";
import { usePreviewPlayback } from "./usePreviewPlayback";
import { FieldWorkspace } from "./FieldWorkspace";
import { useAuthoringActions } from "./useAuthoringActions";

const clone = <T,>(value: T): T => structuredClone(value);
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [project, setProject] = useState<Project>(() => createDefaultProject());
  const [activeCompositionId, setActiveCompositionId] = useState("comp-landscape");
  const [activeTakeId, setActiveTakeId] = useState("take-01");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>("select");
  const [workspace, setWorkspace] = useState<"field" | "design" | "animate">("field");
  const [animateTab, setAnimateTab] = useState<"entrance" | "camera" | "hero">("entrance");
  const [fieldView, setFieldView] = useState<"camera" | "overview">("camera");
  const [rightTab, setRightTab] = useState<"layout" | "build" | "hero">("layout");
  const [autoKey, setAutoKey] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commentSource, setCommentSource] = useState(DEFAULT_COMMENT_TEXT);
  const [notice, setNotice] = useState("Ready");
  const [exportScale, setExportScale] = useState(0.5);
  const [exportProgress, setExportProgress] = useState<{ frame: number; total: number } | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>({ state: "rebuilding", ready: 0, total: 0, hits: 0, misses: 0, reason: "initial texture build" });
  const sceneRef = useRef<CommentSceneHandle>(null);
  const projectLoadedRef = useRef(false);

  const composition = project.compositions.find((item) => item.id === activeCompositionId) ?? project.compositions[0];
  const takes = project.takes.filter((item) => item.compositionId === composition.id);
  const take = project.takes.find((item) => item.id === activeTakeId && item.compositionId === composition.id) ?? takes[0];
  const duration = take?.duration ?? 8;
  const selectedPlacement = composition.cards.find((card) => card.cardId === selectedCardId) ?? null;
  const selectedComment = project.comments.find((comment) => comment.id === selectedCardId) ?? null;
  const representativeComment = selectedComment ?? project.comments[0];
  const commentPreview = useMemo(() => commentSource.trim().startsWith("[") ? parseCommentJson(commentSource) : parsePlainText(commentSource), [commentSource]);

  const mutateProject = useCallback((updater: (draft: Project) => void) => {
    setProject((current) => {
      const next = clone(current);
      updater(next);
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }, []);

  const mutateComposition = useCallback((updater: (draft: Composition) => void) => {
    mutateProject((draft) => {
      const target = draft.compositions.find((item) => item.id === activeCompositionId);
      if (target) updater(target);
    });
  }, [activeCompositionId, mutateProject]);

  const mutateTake = useCallback((updater: (draft: Take) => void) => {
    mutateProject((draft) => {
      const target = draft.takes.find((item) => item.id === take?.id);
      if (target) updater(target);
    });
  }, [mutateProject, take?.id]);

  const {
    time, playing, previewStatus, clearPreviewCache, pausePlayback, togglePlayback,
    beginManipulation, scrubTo, changeTakeDuration, setPlayhead, previewProgress,
    previewMemory, cachedPlaybackActive,
  } = usePreviewPlayback({
    composition,
    take,
    entranceMotion: project.entranceMotion,
    comments: project.comments,
    cardStyle: project.cardStyle,
    workspace,
    cacheStatus,
    sceneRef,
    mutateTake,
  });

  const {
    importComments, loadCommentFile, scatter, updateBuild, randomizeBuild, completeGesture, transformCard,
    switchComposition, addProtectedRegion, setHero, removeHero, bakeReflow, createTake, fitFieldToComments,
    alignCameraToHero, deleteTake, saveJson, loadJson, loadBackground, exportFrames, verifyDeterministicFrame,
  } = useAuthoringActions({
    project, composition, take, takes, duration, time, commentSource, selectedPlacement, selectedComment,
    exportScale, exportProgress, sceneRef, mutateProject, mutateComposition, mutateTake, pausePlayback,
    setPlayhead, setProject, setActiveCompositionId, setActiveTakeId, setSelectedCardId, setCommentSource, setNotice,
    setExportProgress, setFieldView, setMode, setRightTab, setWorkspace, setAnimateTab,
  });

  useEffect(() => {
    loadAutosave().then((saved) => {
      if (saved) {
        setProject(saved);
        const firstComposition = saved.compositions[0];
        const firstTake = saved.takes.find((item) => item.compositionId === firstComposition.id);
        setActiveCompositionId(firstComposition.id);
        if (firstTake) setActiveTakeId(firstTake.id);
        setPlayhead(firstTake?.duration ?? 8);
        setNotice("Restored autosave");
      }
      projectLoadedRef.current = true;
    }).catch(() => { projectLoadedRef.current = true; setNotice("Autosave unavailable"); });
  }, []);

  useEffect(() => {
    if (!projectLoadedRef.current) return;
    const timeout = window.setTimeout(() => saveAutosave(project).then(() => setNotice("Autosaved locally")).catch(() => setNotice("Autosave failed")), 500);
    return () => window.clearTimeout(timeout);
  }, [project]);

  useEffect(() => {
    if (takes.length && !takes.some((item) => item.id === activeTakeId)) setActiveTakeId(takes[0].id);
  }, [activeCompositionId, activeTakeId, takes]);

  if (!composition || !take || !representativeComment) return <main className="loading-state">Opening Comment Field…</main>;

  const previewLabel = previewStatus.state === "ready"
    ? `Preview Ready · ${previewStatus.width}×${previewStatus.height}`
    : previewStatus.state === "caching"
      ? `Preview Caching · ${previewStatus.readyFrames}/${previewStatus.totalFrames}`
      : previewStatus.state === "error"
        ? "Preview Error"
        : previewStatus.state === "stale"
          ? "Preview Stale"
          : "Preview Idle";

  return (
    <main className={`app-shell workspace-${workspace}`}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Layers3 size={18} /></div><div><strong>Comment Field</strong><span>Authoring workbench</span></div></div>
        <div className="workspace-navigation">
          <input className="project-name" value={project.name} onChange={(event) => mutateProject((draft) => { draft.name = event.target.value; })} aria-label="Project name" />
          <div className="workspace-switcher">
            <button className={workspace === "field" ? "is-active" : ""} onClick={() => { pausePlayback(); setWorkspace("field"); }}><Layers3 size={14} />Field</button>
            <button className={workspace === "design" ? "is-active" : ""} onClick={() => { pausePlayback(); setWorkspace("design"); }}><Palette size={14} />Design</button>
            <button className={workspace === "animate" ? "is-active" : ""} onClick={() => { pausePlayback(); setWorkspace("animate"); }}><Clapperboard size={14} />Animate</button>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="save-status"><CircleDot size={12} />{notice}</span>
          <IconButton label="Open help" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /></IconButton>
          <IconButton label="Save project JSON" onClick={saveJson}><Save size={18} /></IconButton>
          <label className="icon-button" title="Load project JSON"><FileUp size={18} /><input hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && loadJson(event.target.files[0])} /></label>
          <select className="export-scale" value={exportScale} onChange={(event) => setExportScale(Number(event.target.value))} aria-label="Export scale"><option value={0.25}>¼ res</option><option value={0.5}>½ res</option><option value={1}>Full res</option></select>
          <IconButton label="Verify deterministic frame" onClick={verifyDeterministicFrame}><CheckCheck size={18} /></IconButton>
          <button className="primary-button" onClick={exportFrames} disabled={Boolean(exportProgress)}><Download size={17} />{exportProgress ? `${exportProgress.frame}/${exportProgress.total}` : "Export PNGs"}</button>
        </div>
      </header>

      {workspace === "field" && <FieldWorkspace
        project={project} composition={composition} take={take} duration={duration} time={time} playing={playing}
        commentSource={commentSource} commentPreview={commentPreview} selectedCardId={selectedCardId}
        selectedPlacement={selectedPlacement} selectedComment={selectedComment} mode={mode} fieldView={fieldView}
        rightTab={rightTab} cacheStatus={cacheStatus} previewStatus={previewStatus} previewLabel={previewLabel}
        previewMemory={previewMemory} sceneRef={sceneRef} setCommentSource={setCommentSource}
        setSelectedCardId={setSelectedCardId} setMode={setMode} setFieldView={setFieldView} setRightTab={setRightTab}
        setWorkspace={setWorkspace} setAnimateTab={setAnimateTab} setCacheStatus={setCacheStatus}
        mutateProject={mutateProject} mutateComposition={mutateComposition} mutateTake={mutateTake}
        importComments={importComments} loadCommentFile={loadCommentFile} loadBackground={loadBackground}
        switchComposition={switchComposition} changeTakeDuration={changeTakeDuration} clearPreviewCache={clearPreviewCache}
        pausePlayback={pausePlayback} beginManipulation={beginManipulation} transformCard={transformCard}
        completeGesture={completeGesture} scatter={scatter} fitFieldToComments={fitFieldToComments}
        addProtectedRegion={addProtectedRegion} removeHero={removeHero} setHero={setHero} updateBuild={updateBuild}
        randomizeBuild={randomizeBuild} alignCameraToHero={alignCameraToHero} bakeReflow={bakeReflow}
      />}
      {workspace === "design" && <DesignWorkspace comment={representativeComment} style={project.cardStyle} onStyleChange={(key, value) => mutateProject((draft) => { Object.assign(draft.cardStyle, { [key]: value }); })} onBack={() => setWorkspace("field")} />}
      {workspace === "animate" && (
        <div className="animate-shell">
          <div className="animate-tabs">
            <button className={animateTab === "entrance" ? "is-active" : ""} onClick={() => setAnimateTab("entrance")}>Shared entrance</button>
            <button className={animateTab === "camera" ? "is-active" : ""} onClick={() => setAnimateTab("camera")}>Camera</button>
            <button className={animateTab === "hero" ? "is-active" : ""} onClick={() => setAnimateTab("hero")} disabled={!take.hero}>Hero path</button>
          </div>
          {animateTab === "entrance"
            ? <EntranceWorkspace
                comment={representativeComment}
                style={project.cardStyle}
                motion={project.entranceMotion}
                onMotionChange={(entranceMotion) => mutateProject((draft) => {
                  draft.entranceMotion = entranceMotion;
                  const active = draft.takes.find((item) => item.id === take.id);
                  if (active) active.entranceOverride = undefined;
                })}
                onReset={() => mutateProject((draft) => {
                  draft.entranceMotion = structuredClone(DEFAULT_ENTRANCE_MOTION);
                  const active = draft.takes.find((item) => item.id === take.id);
                  if (active) active.entranceOverride = undefined;
                })}
                onBack={() => setWorkspace("field")}
              />
            : animateTab === "camera"
              ? <CameraWorkspace
                  composition={composition}
                  take={take}
                  entranceMotion={project.entranceMotion}
                  comments={project.comments}
                  style={project.cardStyle}
                  time={time}
                  sceneRef={sceneRef}
                  onTimeChange={scrubTo}
                  onKeyframesChange={(cameraKeyframes) => mutateTake((draft) => { draft.cameraKeyframes = cameraKeyframes; })}
                  onSettleOnHero={alignCameraToHero}
                  onBack={() => setWorkspace("field")}
                  onCacheStatus={setCacheStatus}
                  autoKey={autoKey}
                />
              : <HeroWorkspace composition={composition} take={take} entranceMotion={project.entranceMotion} comments={project.comments} style={project.cardStyle} time={time} selectedCardId={take.hero?.cardId ?? selectedCardId} sceneRef={sceneRef} onTimeChange={scrubTo} onHeroChange={(hero) => mutateTake((draft) => { draft.hero = hero; })} onRemoveHero={removeHero} onBakeReflow={bakeReflow} onBack={() => setWorkspace("field")} onCacheStatus={setCacheStatus} autoKey={autoKey} />}
        </div>
      )}

      <footer className="transport">
        <button className="play-button" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}><span className={playing ? "icon-state visible" : "icon-state"}><Pause size={18} /></span><span className={!playing ? "icon-state visible play-icon" : "icon-state play-icon"}><Play size={18} /></span></button>
        <div className="timecode">{formatTimecode(time, composition.frameRate)}<span> / {formatTimecode(duration, composition.frameRate)}</span>{cachedPlaybackActive && <em>RAM</em>}</div>
        <KeyframeTimeline take={take} frameRate={composition.frameRate} time={time} previewProgress={previewProgress} expanded={workspace === "animate"} autoKey={autoKey} onAutoKeyChange={setAutoKey} onTimeChange={scrubTo} onDurationChange={changeTakeDuration} onCameraChange={(cameraKeyframes) => mutateTake((draft) => { draft.cameraKeyframes = cameraKeyframes; })} onHeroChange={(keyframes) => mutateTake((draft) => { if (draft.hero) draft.hero.keyframes = keyframes; })} />
        <div className="take-controls">
          <IconButton label={take.favorite ? "Unfavorite take" : "Favorite take"} active={take.favorite} onClick={() => mutateTake((draft) => { draft.favorite = !draft.favorite; })}><Star size={15} fill={take.favorite ? "currentColor" : "none"} /></IconButton>
          <input className="take-name" value={take.name} onChange={(event) => mutateTake((draft) => { draft.name = event.target.value; })} aria-label="Take name" />
          <select value={take.id} onChange={(event) => { const next = takes.find((item) => item.id === event.target.value); setActiveTakeId(event.target.value); setPlayhead(next?.duration ?? 8); }} aria-label="Active take">{takes.map((item) => <option key={item.id} value={item.id}>{item.favorite ? "★ " : ""}{item.name}</option>)}</select>
          <IconButton label="New take" onClick={() => createTake(false)}><Plus size={16} /></IconButton>
          <IconButton label="Duplicate take" onClick={() => createTake(true)}><Copy size={16} /></IconButton>
          <IconButton label="Delete take" onClick={deleteTake}><Trash2 size={16} /></IconButton>
        </div>
      </footer>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </main>
  );
}
