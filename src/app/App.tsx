import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, CheckCheck, CircleDot, CircleHelp, Clapperboard, Copy, Download, FileUp, Heart, ImagePlus, Layers3, Lock,
  MousePointer2, Move3d, Palette, Pause, Play, Plus, Redo2, RefreshCw, Save, Shield, Sparkles, Star,
  Trash2, Undo2, Unlock, WandSparkles,
} from "lucide-react";
import { Suspense, lazy } from "react";
import {
  clearHeroPerformance,
  createDefaultProject,
  DEFAULT_ENTRANCE_MOTION,
  DEFAULT_EXIT_MOTION,
  DEFAULT_COMMENT_TEXT,
  deserializeProject,
  editGestureSample,
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
import { loadAutosave, saveAutosave } from "../infrastructure/projectStore";
import { CommentScene, type CacheStatus, type CommentSceneHandle, type InteractionMode, type TransformPatch } from "../renderer/CommentScene";
import { formatFrameRange, KeyframeTimeline } from "./KeyframeTimeline";
import { Field, IconButton, PanelSection, SelectField, Slider } from "./Controls";
import { CurveEditor } from "./MotionEditors";
import { usePreviewPlayback } from "./usePreviewPlayback";
import { FieldWorkspace } from "./FieldWorkspace";
import { useAuthoringActions } from "./useAuthoringActions";
import { useProjectHistory } from "./useProjectHistory";

const CameraWorkspace = lazy(() => import("./CameraWorkspace").then((module) => ({ default: module.CameraWorkspace })));
const DesignWorkspace = lazy(() => import("./DesignWorkspace").then((module) => ({ default: module.DesignWorkspace })));
const EntranceWorkspace = lazy(() => import("./EntranceWorkspace").then((module) => ({ default: module.EntranceWorkspace })));
const ExitWorkspace = lazy(() => import("./ExitWorkspace").then((module) => ({ default: module.ExitWorkspace })));
const HeroWorkspace = lazy(() => import("./HeroWorkspace").then((module) => ({ default: module.HeroWorkspace })));
const HelpOverlay = lazy(() => import("./HelpOverlay").then((module) => ({ default: module.HelpOverlay })));

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
  const {
    project,
    setProject,
    mutateProject,
    replaceProject,
    undo,
    redo,
    beginCoalescing,
    endCoalescing,
    canUndo,
    canRedo,
    historyEpoch, // keeps undo/redo button state in sync
  } = useProjectHistory(createDefaultProject());
  void historyEpoch;
  const [activeCompositionId, setActiveCompositionId] = useState("comp-landscape");
  const [activeTakeId, setActiveTakeId] = useState("take-01");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [selectedGestureIndex, setSelectedGestureIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<InteractionMode>("select");
  const [workspace, setWorkspace] = useState<"field" | "design" | "animate">("field");
  const [animateTab, setAnimateTab] = useState<"entrance" | "exit" | "camera" | "hero">("entrance");
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
  const [projectHydrated, setProjectHydrated] = useState(false);

  const composition = project.compositions.find((item) => item.id === activeCompositionId) ?? project.compositions[0];
  const takes = project.takes.filter((item) => item.compositionId === composition.id);
  const take = project.takes.find((item) => item.id === activeTakeId && item.compositionId === composition.id) ?? takes[0];
  const duration = take?.duration ?? 8;
  const selectedPlacement = composition.cards.find((card) => card.cardId === selectedCardId) ?? null;
  const selectedComment = project.comments.find((comment) => comment.id === selectedCardId) ?? null;
  const representativeComment = selectedComment ?? project.comments[0];
  const commentPreview = useMemo(() => {
    const trimmed = commentSource.trim();
    if (!trimmed) return { records: [], errors: [] as Array<{ line: number; source: string; reason: string }> };
    try {
      return trimmed.startsWith("[") && trimmed.endsWith("]")
        ? parseCommentJson(commentSource)
        : parsePlainText(commentSource);
    } catch {
      return { records: [], errors: [{ line: 1, source: "preview", reason: "Could not parse comments" }] };
    }
  }, [commentSource]);

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

  const updateGestureSample = useCallback((index: number, patch: Partial<GestureSample>) => {
    mutateTake((draft) => {
      draft.gestureSamples = editGestureSample(draft.gestureSamples, index, patch, composition.frameRate);
      draft.cardTriggers = resolveGestureTriggers(draft.gestureSamples, composition.cards, 0.16, composition, draft);
    });
  }, [composition, mutateTake]);

  const {
    time, playing, previewStatus, clearPreviewCache, pausePlayback, togglePlayback,
    beginManipulation: beginPreviewManipulation, scrubTo, changeTakeDuration, setPlayhead, previewProgress,
    previewMemory, cachedPlaybackActive,
  } = usePreviewPlayback({
    composition,
    take,
    entranceMotion: project.entranceMotion,
    comments: project.comments,
    cardStyle: project.cardStyle,
    renderSettings: project.renderSettings,
    workspace,
    cacheStatus,
    sceneRef,
    mutateTake,
  });

  const beginManipulation = useCallback(() => {
    beginCoalescing();
    beginPreviewManipulation();
  }, [beginCoalescing, beginPreviewManipulation]);

  const endManipulation = useCallback(() => {
    endCoalescing();
  }, [endCoalescing]);

  const {
    importComments, loadCommentFile, scatter, updateBuild, randomizeBuild, completeGesture, transformCard, transformCards,
    switchComposition, addProtectedRegion, setHero, removeHero, bakeReflow, createTake, fitFieldToComments,
    alignCameraToHero, deleteTake, saveJson, loadJson, loadBackground, exportFrames, exportHeroStill,
    verifyDeterministicFrame,
  } = useAuthoringActions({
    project, composition, take, takes, duration, time, commentSource, selectedPlacement, selectedComment,
    exportScale, exportProgress, sceneRef, mutateProject, mutateComposition, mutateTake, pausePlayback,
    setPlayhead, setProject, replaceProject, setActiveCompositionId, setActiveTakeId, setSelectedCardId, setSelectedCardIds, setCommentSource, setNotice,
    setExportProgress, setFieldView, setMode, setRightTab, setWorkspace, setAnimateTab,
  });

  function handleUndo() {
    if (undo()) setNotice("Undid last change");
  }

  function handleRedo() {
    if (redo()) setNotice("Redid change");
  }

  function handleSelectCard(cardId: string | null, options?: { additive?: boolean; ids?: string[] | null }) {
    // Explicit multi-set (marquee). Empty array clears when not additive.
    if (options && "ids" in options && options.ids !== undefined && options.ids !== null) {
      if (options.additive) {
        const next = [...new Set([...selectedCardIds, ...options.ids])];
        setSelectedCardIds(next);
        setSelectedCardId(next[next.length - 1] ?? null);
        return;
      }
      setSelectedCardIds(options.ids);
      setSelectedCardId(options.ids[options.ids.length - 1] ?? null);
      return;
    }
    if (!cardId) {
      if (!options?.additive) {
        setSelectedCardIds([]);
        setSelectedCardId(null);
      }
      return;
    }
    if (options?.additive) {
      setSelectedCardIds((current) => {
        const next = current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId];
        setSelectedCardId(next[next.length - 1] ?? null);
        return next;
      });
      return;
    }
    setSelectedCardIds([cardId]);
    setSelectedCardId(cardId);
  }

  function clearSelection() {
    setSelectedCardIds([]);
    setSelectedCardId(null);
  }

  useEffect(() => {
    let cancelled = false;
    loadAutosave().then((saved) => {
      if (cancelled) return;
      if (saved) {
        replaceProject(saved);
        const firstComposition = saved.compositions[0];
        const firstTake = saved.takes.find((item) => item.compositionId === firstComposition.id);
        setActiveCompositionId(firstComposition.id);
        if (firstTake) setActiveTakeId(firstTake.id);
        setPlayhead(firstTake?.duration ?? 8);
        setNotice("Restored autosave");
      }
      projectLoadedRef.current = true;
      setProjectHydrated(true);
    }).catch(() => {
      if (cancelled) return;
      projectLoadedRef.current = true;
      setProjectHydrated(true);
      setNotice("Autosave unavailable");
    });
    return () => { cancelled = true; };
  }, [replaceProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
        setNotice("Selection cleared");
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        const ids = composition.cards.map((card) => card.cardId);
        if (!ids.length) {
          setNotice("No posts to select");
          return;
        }
        setSelectedCardIds(ids);
        setSelectedCardId(ids[ids.length - 1] ?? null);
        setNotice(`Selected all ${ids.length} posts`);
        return;
      }
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    // Never persist the pre-hydration default project over a real autosave.
    if (!projectHydrated || !projectLoadedRef.current) return;
    const timeout = window.setTimeout(() => saveAutosave(project).then(() => setNotice("Autosaved locally")).catch(() => setNotice("Autosave failed")), 500);
    return () => window.clearTimeout(timeout);
  }, [project, projectHydrated]);

  useEffect(() => {
    if (takes.length && !takes.some((item) => item.id === activeTakeId)) setActiveTakeId(takes[0].id);
  }, [activeCompositionId, activeTakeId, takes]);

  useEffect(() => {
    setSelectedCardIds([]);
    setSelectedCardId(null);
  }, [activeCompositionId]);

  useEffect(() => {
    if (selectedGestureIndex !== null && !take?.gestureSamples[selectedGestureIndex]) setSelectedGestureIndex(null);
  }, [selectedGestureIndex, take?.id, take?.gestureSamples.length]);

  if (!projectHydrated || !composition || !take || !representativeComment) return <main className="loading-state">Opening Comment Field…</main>;

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
          <IconButton label="Undo (Ctrl+Z)" onClick={handleUndo} disabled={!canUndo}><Undo2 size={18} /></IconButton>
          <IconButton label="Redo (Ctrl+Y)" onClick={handleRedo} disabled={!canRedo}><Redo2 size={18} /></IconButton>
          <IconButton label="Open help" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /></IconButton>
          <IconButton label="Save project JSON" onClick={saveJson}><Save size={18} /></IconButton>
          <label className="icon-button" title="Load project JSON"><FileUp size={18} /><input hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && loadJson(event.target.files[0])} /></label>
          <select className="export-scale" value={exportScale} onChange={(event) => setExportScale(Number(event.target.value))} aria-label="Export scale"><option value={0.25}>¼ res</option><option value={0.5}>½ res</option><option value={1}>Full res</option></select>
          <label className="export-alpha-toggle" title="Export cards over a transparent plate (no background color or image)">
            <input
              type="checkbox"
              checked={project.renderSettings.transparentExport}
              onChange={(event) => mutateProject((draft) => { draft.renderSettings.transparentExport = event.target.checked; })}
            />
            <span>Alpha</span>
          </label>
          <IconButton label="Verify deterministic frame" onClick={verifyDeterministicFrame}><CheckCheck size={18} /></IconButton>
          <button className="primary-button" onClick={exportFrames} disabled={Boolean(exportProgress)}><Download size={17} />{exportProgress ? `${exportProgress.frame}/${exportProgress.total}` : "Export PNGs"}</button>
        </div>
      </header>

      {workspace === "field" && <FieldWorkspace
        project={project} composition={composition} take={take} duration={duration} time={time} playing={playing}
        commentSource={commentSource} commentPreview={commentPreview} selectedCardId={selectedCardId}
        selectedCardIds={selectedCardIds}
        selectedGestureIndex={selectedGestureIndex} setSelectedGestureIndex={setSelectedGestureIndex}
        selectedPlacement={selectedPlacement} selectedComment={selectedComment} mode={mode} fieldView={fieldView}
        rightTab={rightTab} cacheStatus={cacheStatus} previewStatus={previewStatus} previewLabel={previewLabel}
        previewMemory={previewMemory} sceneRef={sceneRef} setCommentSource={setCommentSource}
        setSelectedCardId={setSelectedCardId} onSelectCard={handleSelectCard} setMode={setMode} setFieldView={setFieldView} setRightTab={setRightTab}
        setWorkspace={setWorkspace} setAnimateTab={setAnimateTab} setCacheStatus={setCacheStatus}
        mutateProject={mutateProject} mutateComposition={mutateComposition} mutateTake={mutateTake}
        importComments={importComments} loadCommentFile={loadCommentFile} loadBackground={loadBackground}
        switchComposition={switchComposition} changeTakeDuration={changeTakeDuration} onTimeChange={scrubTo} clearPreviewCache={clearPreviewCache}
        pausePlayback={pausePlayback} beginManipulation={beginManipulation} endManipulation={endManipulation} transformCard={transformCard} transformCards={transformCards}
        completeGesture={(samples) => { completeGesture(samples); setSelectedGestureIndex(samples.length ? 0 : null); }}
        updateGestureSample={updateGestureSample} scatter={scatter} fitFieldToComments={fitFieldToComments}
        addProtectedRegion={addProtectedRegion} removeHero={removeHero} setHero={setHero} updateBuild={updateBuild}
        randomizeBuild={randomizeBuild} alignCameraToHero={alignCameraToHero} bakeReflow={bakeReflow}
        onExportHeroStill={() => { void exportHeroStill(); }}
      />}
      <Suspense fallback={<main className="loading-state">Loading workspace…</main>}>
      {workspace === "design" && <DesignWorkspace
        comment={representativeComment}
        style={project.cardStyle}
        renderSettings={project.renderSettings}
        onStyleChange={(key, value) => mutateProject((draft) => { Object.assign(draft.cardStyle, { [key]: value }); })}
        onSceneShadowChange={(key, value) => mutateProject((draft) => { Object.assign(draft.renderSettings.sceneShadow, { [key]: value }); })}
        onCardLightingChange={(key, value) => mutateProject((draft) => { Object.assign(draft.renderSettings.cardLighting, { [key]: value }); })}
        onBack={() => setWorkspace("field")}
      />}
      {workspace === "animate" && (
        <div className="animate-shell">
          <div className="animate-tabs">
            <button className={animateTab === "entrance" ? "is-active" : ""} onClick={() => setAnimateTab("entrance")}>Shared entrance</button>
            <button className={animateTab === "exit" ? "is-active" : ""} onClick={() => setAnimateTab("exit")}>Shared exit</button>
            <button className={animateTab === "camera" ? "is-active" : ""} onClick={() => setAnimateTab("camera")}>Camera</button>
            <button className={animateTab === "hero" ? "is-active" : ""} onClick={() => setAnimateTab("hero")} disabled={!take.hero}>Hero path</button>
          </div>
          {animateTab === "entrance"
            ? <EntranceWorkspace
                comment={representativeComment}
                style={project.cardStyle}
                motion={project.entranceMotion}
                frameRate={composition.frameRate}
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
            : animateTab === "exit"
              ? <ExitWorkspace
                  comment={representativeComment}
                  style={project.cardStyle}
                  population={take.population}
                  frameRate={composition.frameRate}
                  onPopulationChange={(population) => mutateTake((draft) => { draft.population = population; })}
                  onReset={() => mutateTake((draft) => {
                    draft.population.exitMotion = structuredClone(DEFAULT_EXIT_MOTION);
                    draft.population.exitDuration = 0.45;
                    draft.population.exitDistance = 0.32;
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
                  renderSettings={project.renderSettings}
                  time={time}
                  sceneRef={sceneRef}
                  onTimeChange={scrubTo}
                  onKeyframesChange={(cameraKeyframes) => mutateTake((draft) => { draft.cameraKeyframes = cameraKeyframes; })}
                  onSettleOnHero={alignCameraToHero}
                  onBack={() => setWorkspace("field")}
                  onCacheStatus={setCacheStatus}
                  autoKey={autoKey}
                  onAutoKeyChange={setAutoKey}
                />
              : <HeroWorkspace composition={composition} take={take} entranceMotion={project.entranceMotion} comments={project.comments} style={project.cardStyle} renderSettings={project.renderSettings} time={time} selectedCardId={take.hero?.cardId ?? selectedCardId} sceneRef={sceneRef} onTimeChange={scrubTo} onHeroChange={(hero) => mutateTake((draft) => { draft.hero = hero; })} onRemoveHero={removeHero} onBakeReflow={bakeReflow} onBack={() => setWorkspace("field")} onCacheStatus={setCacheStatus} autoKey={autoKey} onExportHeroStill={() => { void exportHeroStill(); }} />}
        </div>
      )}
      </Suspense>

      <footer className="transport">
        <button className="play-button" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}><span className={playing ? "icon-state visible" : "icon-state"}><Pause size={18} /></span><span className={!playing ? "icon-state visible play-icon" : "icon-state play-icon"}><Play size={18} /></span></button>
        <div className="timecode">{formatFrameRange(time, duration, composition.frameRate)}{cachedPlaybackActive && <em>RAM</em>}</div>
        <KeyframeTimeline take={take} frameRate={composition.frameRate} time={time} previewProgress={previewProgress} expanded={workspace === "animate"} autoKey={autoKey} selectedGestureIndex={selectedGestureIndex} onGestureSelect={setSelectedGestureIndex} onGestureChange={updateGestureSample} onAutoKeyChange={setAutoKey} onTimeChange={scrubTo} onDurationChange={changeTakeDuration} onCameraChange={(cameraKeyframes) => mutateTake((draft) => { draft.cameraKeyframes = cameraKeyframes; })} onHeroChange={(keyframes) => mutateTake((draft) => { if (draft.hero) draft.hero.keyframes = keyframes; })} />
        <div className="take-controls">
          <IconButton label={take.favorite ? "Unfavorite take" : "Favorite take"} active={take.favorite} onClick={() => mutateTake((draft) => { draft.favorite = !draft.favorite; })}><Star size={15} fill={take.favorite ? "currentColor" : "none"} /></IconButton>
          <input className="take-name" value={take.name} onChange={(event) => mutateTake((draft) => { draft.name = event.target.value; })} aria-label="Take name" />
          <select value={take.id} onChange={(event) => { const next = takes.find((item) => item.id === event.target.value); setActiveTakeId(event.target.value); setPlayhead(next?.duration ?? 8); }} aria-label="Active take">{takes.map((item) => <option key={item.id} value={item.id}>{item.favorite ? "★ " : ""}{item.name}</option>)}</select>
          <IconButton label="New take" onClick={() => createTake(false)}><Plus size={16} /></IconButton>
          <IconButton label="Duplicate take" onClick={() => createTake(true)}><Copy size={16} /></IconButton>
          <IconButton label="Delete take" onClick={deleteTake}><Trash2 size={16} /></IconButton>
        </div>
      </footer>
      {helpOpen && <Suspense fallback={null}><HelpOverlay onClose={() => setHelpOpen(false)} /></Suspense>}
    </main>
  );
}
