import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, CheckCheck, CircleDot, Clapperboard, Copy, Download, FileUp, Heart, ImagePlus, Layers3, Lock,
  MousePointer2, Move3d, Palette, Pause, Play, Plus, RefreshCw, Save, Shield, Sparkles, Star,
  Trash2, Unlock, WandSparkles,
} from "lucide-react";
import { resolveBuildTriggers } from "../animation/build";
import { settleCameraOnHero } from "../animation/camera";
import { clearHeroPerformance, heroEndTime, heroStartTime } from "../animation/hero";
import { exportPngSequence } from "../export/pngSequence";
import { DEFAULT_COMMENT_TEXT } from "../fixtures/defaultComments";
import { parseCommentJson, parsePlainText } from "../import/parseComments";
import { fitFieldBoundsToComments, regenerateComposition } from "../layout/scatter";
import { createDefaultProject, DEFAULT_ENTRANCE_MOTION } from "../models/defaults";
import type { BuildOrder, Composition, GestureSample, HeroPerformance, PreviewCacheStatus, Project, Take } from "../models/types";
import { deserializeProject, loadAutosave, saveAutosave, serializeProject } from "../persistence/projectStore";
import { resolveGestureTriggers } from "../recording/gesture";
import { generateReflowTargets } from "../reflow/reflow";
import { CommentScene, type CacheStatus, type CommentSceneHandle, type InteractionMode, type TransformPatch } from "../renderer/CommentScene";
import {
  choosePreviewDimensions,
  createPreviewCacheKey,
  DEFAULT_PREVIEW_CACHE_SETTINGS,
  previewDecodeWindow,
  previewFrameIndex,
  wallClockPlaybackTime,
} from "../renderer/previewCache";
import { CameraWorkspace, DesignWorkspace, EntranceWorkspace, HeroWorkspace } from "./AuthoringWorkspaces";
import { formatTimecode, KeyframeTimeline } from "./KeyframeTimeline";
import { Field, IconButton, PanelSection, SelectField, Slider } from "./Controls";

const clone = <T,>(value: T): T => structuredClone(value);
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

interface PreviewCacheData {
  key: string;
  frames: Blob[];
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  memoryBytes: number;
}

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
  const [time, setTime] = useState(8);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<InteractionMode>("select");
  const [workspace, setWorkspace] = useState<"field" | "design" | "animate">("field");
  const [animateTab, setAnimateTab] = useState<"entrance" | "camera" | "hero">("entrance");
  const [fieldView, setFieldView] = useState<"camera" | "overview">("camera");
  const [rightTab, setRightTab] = useState<"layout" | "build" | "hero">("layout");
  const [autoKey, setAutoKey] = useState(false);
  const [commentSource, setCommentSource] = useState(DEFAULT_COMMENT_TEXT);
  const [notice, setNotice] = useState("Ready");
  const [exportScale, setExportScale] = useState(0.5);
  const [exportProgress, setExportProgress] = useState<{ frame: number; total: number } | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>({ state: "rebuilding", ready: 0, total: 0, hits: 0, misses: 0, reason: "initial texture build" });
  const [previewStatus, setPreviewStatus] = useState<PreviewCacheStatus>({
    state: "idle", readyFrames: 0, totalFrames: 0, width: 0, height: 0, frameRate: 0,
    memoryBytes: 0, key: "", reason: "waiting for active take", playbackMode: "live",
  });
  const sceneRef = useRef<CommentSceneHandle>(null);
  const playbackStartRef = useRef(0);
  const playheadRef = useRef(8);
  const playingRef = useRef(false);
  const previewJobRef = useRef(0);
  const previewCacheRef = useRef<PreviewCacheData | null>(null);
  const decodedFramesRef = useRef(new Map<number, ImageBitmap>());
  const decodingFramesRef = useRef(new Set<number>());
  const projectLoadedRef = useRef(false);

  const composition = project.compositions.find((item) => item.id === activeCompositionId) ?? project.compositions[0];
  const takes = project.takes.filter((item) => item.compositionId === composition.id);
  const take = project.takes.find((item) => item.id === activeTakeId && item.compositionId === composition.id) ?? takes[0];
  const duration = take?.duration ?? 8;
  const selectedPlacement = composition.cards.find((card) => card.cardId === selectedCardId) ?? null;
  const selectedComment = project.comments.find((comment) => comment.id === selectedCardId) ?? null;
  const representativeComment = selectedComment ?? project.comments[0];
  const commentPreview = useMemo(() => commentSource.trim().startsWith("[") ? parseCommentJson(commentSource) : parsePlainText(commentSource), [commentSource]);
  const previewKey = useMemo(
    () => createPreviewCacheKey(composition, take, take.entranceOverride ?? project.entranceMotion, project.comments, project.cardStyle),
    [composition, take, project.entranceMotion, project.comments, project.cardStyle],
  );

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

  useEffect(() => {
    loadAutosave().then((saved) => {
      if (saved) {
        setProject(saved);
        const firstComposition = saved.compositions[0];
        const firstTake = saved.takes.find((item) => item.compositionId === firstComposition.id);
        setActiveCompositionId(firstComposition.id);
        if (firstTake) setActiveTakeId(firstTake.id);
        setTime(firstTake?.duration ?? 8);
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

  function releaseDecodedFrames() {
    decodedFramesRef.current.forEach((bitmap) => bitmap.close());
    decodedFramesRef.current.clear();
    decodingFramesRef.current.clear();
  }

  function clearPreviewCache(reason = "preview cleared", state: PreviewCacheStatus["state"] = "idle") {
    previewJobRef.current += 1;
    releaseDecodedFrames();
    previewCacheRef.current = null;
    sceneRef.current?.hidePreview();
    setPreviewStatus({
      state,
      readyFrames: 0,
      totalFrames: Math.max(1, Math.round(duration * composition.frameRate)),
      width: 0,
      height: 0,
      frameRate: composition.frameRate,
      memoryBytes: 0,
      key: previewKey,
      reason,
      playbackMode: "live",
    });
  }

  function interruptPreviewBuild(reason: string) {
    if (previewStatus.state !== "caching") return;
    previewJobRef.current += 1;
    setPreviewStatus((current) => ({ ...current, state: "stale", reason, playbackMode: "live" }));
  }

  async function decodePreviewWindow(centerFrame: number) {
    const cache = previewCacheRef.current;
    if (!cache || cache.key !== previewKey || typeof createImageBitmap !== "function") return;
    const { first, last } = previewDecodeWindow(centerFrame, cache.frames.length, cache.frameRate);
    for (const [index, bitmap] of decodedFramesRef.current) {
      if (index >= first && index <= last) continue;
      bitmap.close();
      decodedFramesRef.current.delete(index);
    }
    const tasks: Promise<void>[] = [];
    for (let index = first; index <= last; index += 1) {
      if (decodedFramesRef.current.has(index) || decodingFramesRef.current.has(index)) continue;
      decodingFramesRef.current.add(index);
      tasks.push(createImageBitmap(cache.frames[index]).then((bitmap) => {
        decodingFramesRef.current.delete(index);
        if (previewCacheRef.current?.key === cache.key) decodedFramesRef.current.set(index, bitmap);
        else bitmap.close();
      }).catch(() => { decodingFramesRef.current.delete(index); }));
    }
    await Promise.all(tasks);
  }

  async function buildPreviewCache() {
    const scene = sceneRef.current;
    if (!scene || workspace !== "field" || playingRef.current || cacheStatus.state !== "ready") return;
    const token = ++previewJobRef.current;
    const settings = DEFAULT_PREVIEW_CACHE_SETTINGS;
    const { width, height } = choosePreviewDimensions(composition, duration, settings);
    const totalFrames = Math.max(1, Math.round(duration * composition.frameRate));
    const frames: Blob[] = [];
    let memoryBytes = 0;
    releaseDecodedFrames();
    previewCacheRef.current = null;
    setPreviewStatus({
      state: "caching", readyFrames: 0, totalFrames, width, height, frameRate: composition.frameRate,
      memoryBytes: 0, key: previewKey, reason: "rendering exact preview frames", playbackMode: "live",
    });
    try {
      for (let frame = 0; frame < totalFrames; frame += 1) {
        if (token !== previewJobRef.current || playingRef.current) {
          if (token === previewJobRef.current) {
            setPreviewStatus((current) => ({ ...current, state: "stale", reason: "preview caching paused for playback" }));
          }
          return;
        }
        const blob = await scene.renderPreviewFrame(frame / composition.frameRate, width, height, settings.webpQuality);
        if (token !== previewJobRef.current) return;
        frames.push(blob);
        memoryBytes += blob.size;
        if (frame === totalFrames - 1 || frame % 2 === 1) {
          setPreviewStatus((current) => ({ ...current, readyFrames: frame + 1, memoryBytes }));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
      if (token !== previewJobRef.current) return;
      previewCacheRef.current = {
        key: previewKey, frames, width, height, frameRate: composition.frameRate,
        duration, memoryBytes,
      };
      setPreviewStatus({
        state: "ready", readyFrames: totalFrames, totalFrames, width, height, frameRate: composition.frameRate,
        memoryBytes, key: previewKey, reason: "active take cached in memory", playbackMode: "live",
      });
      await decodePreviewWindow(previewFrameIndex(playheadRef.current, duration, composition.frameRate));
    } catch (error) {
      if (token !== previewJobRef.current) return;
      releaseDecodedFrames();
      previewCacheRef.current = null;
      setPreviewStatus({
        state: "error", readyFrames: frames.length, totalFrames, width, height, frameRate: composition.frameRate,
        memoryBytes, key: previewKey, reason: error instanceof Error ? error.message : "preview cache failed", playbackMode: "live",
      });
    }
  }

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) playheadRef.current = time;
  }, [time, playing]);

  useEffect(() => {
    clearPreviewCache("render-affecting state changed", "stale");
    return () => { previewJobRef.current += 1; };
  }, [previewKey]);

  useEffect(() => {
    if (previewStatus.state !== "stale" || workspace !== "field" || playing || cacheStatus.state !== "ready") return;
    const timeout = window.setTimeout(() => { void buildPreviewCache(); }, DEFAULT_PREVIEW_CACHE_SETTINGS.idleDelayMs);
    return () => window.clearTimeout(timeout);
  }, [previewKey, previewStatus.state, workspace, playing, cacheStatus.state]);

  useEffect(() => {
    if (workspace !== "field") interruptPreviewBuild("preview caching paused outside Field");
  }, [workspace]);

  useEffect(() => () => {
    previewJobRef.current += 1;
    releaseDecodedFrames();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const cache = previewCacheRef.current;
    const cachedPlayback = Boolean(cache && cache.key === previewKey && cache.frames.length === Math.round(duration * composition.frameRate));
    playbackStartRef.current = performance.now() - playheadRef.current * 1000;
    let frame = 0;
    let lastRenderedAt = 0;
    let lastUiUpdate = 0;
    const frameInterval = 1000 / composition.frameRate;
    setPreviewStatus((current) => ({ ...current, playbackMode: cachedPlayback ? "cached" : "live" }));
    const tick = (now: number) => {
      const elapsed = wallClockPlaybackTime(0, playbackStartRef.current, now, duration);
      if (elapsed >= duration) {
        playheadRef.current = duration;
        sceneRef.current?.hidePreview();
        sceneRef.current?.renderLiveFrame(duration);
        setPlaying(false);
        setTime(duration);
        setPreviewStatus((current) => ({ ...current, playbackMode: "live" }));
        return;
      }
      if (now - lastRenderedAt >= frameInterval) {
        lastRenderedAt = now;
        playheadRef.current = elapsed;
        if (cachedPlayback && cache) {
          const index = previewFrameIndex(elapsed, cache.duration, cache.frameRate);
          const bitmap = decodedFramesRef.current.get(index);
          if (bitmap) sceneRef.current?.showPreviewBitmap(bitmap);
          void decodePreviewWindow(index);
        } else {
          sceneRef.current?.renderLiveFrame(elapsed);
        }
        if (now - lastUiUpdate >= 100) {
          lastUiUpdate = now;
          setTime(elapsed);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      sceneRef.current?.hidePreview();
      sceneRef.current?.renderLiveFrame(playheadRef.current);
      setPreviewStatus((current) => ({ ...current, playbackMode: "live" }));
    };
  }, [playing, duration, composition.frameRate, previewKey]);

  function pausePlayback() {
    setPlaying(false);
    setTime(playheadRef.current);
    sceneRef.current?.hidePreview();
    sceneRef.current?.renderLiveFrame(playheadRef.current);
  }

  async function togglePlayback() {
    if (playing) {
      pausePlayback();
      return;
    }
    if (playheadRef.current >= duration) {
      playheadRef.current = 0;
      setTime(0);
    }
    const cache = previewCacheRef.current;
    if (cache?.key === previewKey) {
      await decodePreviewWindow(previewFrameIndex(playheadRef.current, cache.duration, cache.frameRate));
    }
    interruptPreviewBuild("preview caching paused for playback");
    setPlaying(true);
  }

  function beginManipulation() {
    pausePlayback();
    interruptPreviewBuild("preview caching paused for manipulation");
  }

  function scrubTo(value: number) {
    pausePlayback();
    playheadRef.current = value;
    setTime(value);
    sceneRef.current?.renderLiveFrame(value);
  }

  function changeTakeDuration(value: number) {
    pausePlayback();
    const snapped = Math.max(1 / composition.frameRate, Math.round(value * composition.frameRate) / composition.frameRate);
    mutateTake((draft) => { draft.duration = snapped; });
    if (playheadRef.current > snapped) {
      playheadRef.current = snapped;
      setTime(snapped);
      sceneRef.current?.renderLiveFrame(snapped);
    }
  }

  useEffect(() => {
    if (takes.length && !takes.some((item) => item.id === activeTakeId)) setActiveTakeId(takes[0].id);
  }, [activeCompositionId, activeTakeId, takes]);

  useEffect(() => {
    if (playheadRef.current > duration) playheadRef.current = duration;
    setTime((current) => Math.min(current, duration));
  }, [duration]);

  function importComments() {
    const result = commentSource.trim().startsWith("[") ? parseCommentJson(commentSource) : parsePlainText(commentSource);
    if (!result.records.length) { setNotice("No valid comments found"); return; }
    mutateProject((draft) => {
      draft.comments = result.records;
      draft.compositions = draft.compositions.map((item) => regenerateComposition(item, result.records.map((record) => record.id)));
      for (const draftTake of draft.takes) {
        const parent = draft.compositions.find((item) => item.id === draftTake.compositionId);
        if (!parent) continue;
        draftTake.gestureSamples = [];
        draftTake.cardTriggers = resolveBuildTriggers(parent.cards, draftTake.build);
        if (draftTake.hero && !result.records.some((record) => record.id === draftTake.hero?.cardId)) draftTake.hero = null;
        draftTake.reflowTargets = {};
      }
    });
    setSelectedCardId(null);
    setTime(duration);
    setNotice(`Loaded ${result.records.length} comments`);
  }

  async function loadCommentFile(file: File) {
    setCommentSource(await file.text());
    setNotice(`Previewing ${file.name}`);
  }

  function scatter() {
    mutateProject((draft) => {
      const target = draft.compositions.find((item) => item.id === composition.id)!;
      Object.assign(target, regenerateComposition(target, draft.comments.map((comment) => comment.id)));
      for (const draftTake of draft.takes.filter((item) => item.compositionId === target.id)) draftTake.reflowTargets = {};
    });
    setTime(duration);
    setNotice(`Scattered with “${composition.seed}”`);
  }

  function updateBuild<K extends keyof Take["build"]>(key: K, value: Take["build"][K]) {
    mutateTake((draft) => {
      draft.build[key] = value;
      draft.cardTriggers = resolveBuildTriggers(composition.cards, draft.build);
      draft.gestureSamples = [];
    });
  }

  function randomizeBuild() {
    mutateTake((draft) => {
      draft.build.seed = makeId("build");
      draft.cardTriggers = resolveBuildTriggers(composition.cards, draft.build);
      draft.gestureSamples = [];
    });
    setTime(duration);
    setNotice("Randomized and baked trigger times");
  }

  function completeGesture(samples: GestureSample[]) {
    const triggers = resolveGestureTriggers(samples, composition.cards, 0.16, composition, take);
    mutateTake((draft) => { draft.gestureSamples = samples; draft.cardTriggers = triggers; });
    setMode("select");
    setTime(duration);
    setNotice(`Baked ${triggers.length} gesture triggers`);
  }

  function transformCard(cardId: string, patch: TransformPatch, editReflow: boolean) {
    if (editReflow && take.hero) {
      if (cardId === take.hero.cardId) return;
      setProject((current) => {
        const target = current.takes.find((item) => item.id === take.id);
        const existing = target?.reflowTargets[cardId];
        if (!target || !existing) return current;
        return {
          ...current,
          updatedAt: new Date().toISOString(),
          takes: current.takes.map((item) => item.id === target.id ? {
            ...item,
            reflowTargets: { ...item.reflowTargets, [cardId]: { ...existing, ...patch } },
          } : item),
        };
      });
      return;
    }
    setProject((current) => {
      const target = current.compositions.find((item) => item.id === composition.id);
      const card = target?.cards.find((item) => item.cardId === cardId);
      if (!target || !card || card.locked) return current;
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        compositions: current.compositions.map((item) => item.id === target.id ? {
          ...item,
          cards: item.cards.map((itemCard) => itemCard.cardId === cardId ? { ...itemCard, ...patch } : itemCard),
        } : item),
      };
    });
  }

  function switchComposition(id: string) {
    pausePlayback();
    const firstTake = project.takes.find((item) => item.compositionId === id);
    setActiveCompositionId(id);
    if (firstTake) setActiveTakeId(firstTake.id);
    setSelectedCardId(null);
    setTime(firstTake?.duration ?? 8);
  }

  function addProtectedRegion() {
    mutateComposition((draft) => draft.protectedRegions.push({ id: makeId("region"), name: `Protected ${draft.protectedRegions.length + 1}`, x: 0.38, y: 0.36, width: 0.24, height: 0.28 }));
    setNotice("Added central protected region");
  }

  function setHero() {
    if (!selectedPlacement || !selectedComment?.heroEligible) return;
    const startTime = Math.min(4, duration * 0.55);
    const path = { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.08 } };
    const easing = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
    const hero: HeroPerformance = {
      cardId: selectedPlacement.cardId,
      keyframes: [
        { id: makeId("hero-source"), time: startTime, value: { kind: "source" }, interpolation: "bezier", easing, holdDuration: 0, path },
        { id: makeId("hero-pose"), time: startTime + 1.2, value: { kind: "pose", transform: { x: 0.5, y: 0.5, z: 1.4, scale: 1.7, rotation: 0 }, targetSpace: "screen", surroundingDim: 0.4, surroundingBlur: 2.5 }, interpolation: "bezier", easing, holdDuration: 0, path },
      ],
      reflowRadius: 0.34,
      attraction: 0.48,
      falloff: 1.4,
      maxDisplacement: 0.12,
      overlapPasses: 4,
      reflowDuration: 1.1,
      easing: "ease-out",
      reflowEasing: "ease-out",
    };
    mutateTake((draft) => { draft.hero = hero; draft.reflowTargets = {}; });
    setRightTab("hero");
    setWorkspace("animate");
    setAnimateTab("hero");
    setNotice(`${selectedComment.username} is the hero`);
  }

  function removeHero() {
    mutateProject((draft) => {
      const index = draft.takes.findIndex((item) => item.id === take.id);
      if (index >= 0) draft.takes[index] = clearHeroPerformance(draft.takes[index]);
    });
    setMode("select");
    setAnimateTab("entrance");
    setNotice("Hero removed; ordinary entrance restored");
  }

  function bakeReflow() {
    if (!take.hero) return;
    const targets = generateReflowTargets(composition, take.hero);
    mutateTake((draft) => { draft.reflowTargets = targets; });
    setWorkspace("field");
    setMode("reflow");
    setTime(Math.min(duration, heroStartTime(take.hero) + Math.max(heroEndTime(take.hero) - heroStartTime(take.hero), take.hero.reflowDuration)));
    setNotice(`Baked ${Object.keys(targets).length} editable reflow targets`);
  }

  function createTake(duplicate: boolean) {
    const siblingCount = takes.length + 1;
    const source = duplicate && take ? clone(take) : clone(takes[0]);
    source.id = makeId("take");
    source.name = `Take ${String(siblingCount).padStart(2, "0")}`;
    source.favorite = false;
    if (!duplicate) {
      source.duration = 8;
      source.build.seed = `${composition.seed}-build-${siblingCount}`;
      source.gestureSamples = [];
      source.cardTriggers = resolveBuildTriggers(composition.cards, source.build);
      source.entranceOverride = undefined;
      source.hero = null;
      source.reflowTargets = {};
      source.cameraKeyframes = [];
      source.notes = "";
    }
    mutateProject((draft) => draft.takes.push(source));
    setActiveTakeId(source.id);
    setTime(source.duration);
    setNotice(duplicate ? "Duplicated take" : "Created take");
  }

  function fitFieldToComments() {
    mutateProject((draft) => {
      const target = draft.compositions.find((item) => item.id === composition.id)!;
      target.fieldBounds = fitFieldBoundsToComments(draft.comments.length, target.width / target.height);
      Object.assign(target, regenerateComposition(target, draft.comments.map((comment) => comment.id)));
      for (const draftTake of draft.takes.filter((item) => item.compositionId === target.id)) draftTake.reflowTargets = {};
    });
    setFieldView("overview");
    requestAnimationFrame(() => sceneRef.current?.fitField());
    setNotice("Fit the field to the current comment count");
  }

  function alignCameraToHero() {
    if (!take.hero) return;
    const endTime = Math.min(duration, heroEndTime(take.hero));
    const cameraKeyframes = settleCameraOnHero(composition, take);
    mutateTake((draft) => { draft.cameraKeyframes = cameraKeyframes; });
    setWorkspace("animate");
    setAnimateTab("camera");
    setTime(endTime);
    setNotice("Camera settle aligned to the hero transition");
  }

  function deleteTake() {
    if (takes.length <= 1) { setNotice("Each composition needs one take"); return; }
    const next = takes.find((item) => item.id !== take.id)!;
    mutateProject((draft) => { draft.takes = draft.takes.filter((item) => item.id !== take.id); });
    setActiveTakeId(next.id);
  }

  function saveJson() {
    downloadBlob(new Blob([serializeProject(project)], { type: "application/json" }), `${project.id}.comment-field.json`);
    setNotice("Downloaded project JSON");
  }

  async function loadJson(file: File) {
    try {
      const loaded = deserializeProject(await file.text());
      setProject(loaded);
      setActiveCompositionId(loaded.compositions[0].id);
      setActiveTakeId(loaded.takes.find((item) => item.compositionId === loaded.compositions[0].id)?.id ?? loaded.takes[0].id);
      setSelectedCardId(null);
      setTime(loaded.takes.find((item) => item.compositionId === loaded.compositions[0].id)?.duration ?? 8);
      setWorkspace("field");
      setNotice("Project loaded");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load project"); }
  }

  function loadBackground(file: File) {
    const reader = new FileReader();
    reader.onload = () => mutateComposition((draft) => { draft.backgroundImage = String(reader.result); });
    reader.readAsDataURL(file);
  }

  async function exportFrames() {
    if (!sceneRef.current || exportProgress) { setNotice("Return to Field or Hero view before exporting"); return; }
    const width = Math.round(composition.width * exportScale);
    const height = Math.round(composition.height * exportScale);
    try {
      pausePlayback();
      setExportProgress({ frame: 0, total: Math.round(duration * composition.frameRate) });
      sceneRef.current.beginExport(width, height);
      const blob = await exportPngSequence(sceneRef.current.renderFrame, {
        width,
        height,
        frameRate: composition.frameRate,
        duration,
        prefix: `${composition.name.replace(/\W+/g, "-").toLowerCase()}-${take.name.replace(/\W+/g, "-").toLowerCase()}`,
      }, (progress) => {
        if (progress.frame === progress.total || progress.frame % 5 === 0) setExportProgress(progress);
      });
      downloadBlob(blob, `${project.id}-${composition.id}-${take.id}-png.zip`);
      setNotice("PNG sequence exported");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Export failed"); }
    finally { sceneRef.current?.endExport(); setExportProgress(null); }
  }

  async function verifyDeterministicFrame() {
    if (!sceneRef.current) { setNotice("Return to Field or Hero view to verify"); return; }
    try {
      setNotice("Checking frame determinism…");
      const width = Math.max(64, Math.round(composition.width * exportScale));
      const height = Math.max(64, Math.round(composition.height * exportScale));
      sceneRef.current.beginExport(width, height);
      const first = await sceneRef.current.renderFrame(time, width, height);
      const second = await sceneRef.current.renderFrame(time, width, height);
      const [firstHash, secondHash] = await Promise.all([
        crypto.subtle.digest("SHA-256", await first.arrayBuffer()),
        crypto.subtle.digest("SHA-256", await second.arrayBuffer()),
      ]);
      const encode = (value: ArrayBuffer) => [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const hashA = encode(firstHash);
      const hashB = encode(secondHash);
      setNotice(hashA === hashB ? `Deterministic frame ${hashA.slice(0, 8)}` : "Frame mismatch detected");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Determinism check failed"); }
    finally { sceneRef.current?.endExport(); }
  }

  if (!composition || !take || !representativeComment) return <main className="loading-state">Opening Comment Field…</main>;

  const previewProgress = previewStatus.totalFrames > 0 ? previewStatus.readyFrames / previewStatus.totalFrames : 0;
  const previewLabel = previewStatus.state === "ready"
    ? `Preview Ready · ${previewStatus.width}×${previewStatus.height}`
    : previewStatus.state === "caching"
      ? `Preview Caching · ${previewStatus.readyFrames}/${previewStatus.totalFrames}`
      : previewStatus.state === "error"
        ? "Preview Error"
        : previewStatus.state === "stale"
          ? "Preview Stale"
          : "Preview Idle";
  const previewMemory = `${(previewStatus.memoryBytes / (1024 * 1024)).toFixed(1)} MB`;
  const cachedPlaybackActive = playing && previewStatus.playbackMode === "cached";

  const fieldWorkspace = (
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
          <IconButton label="Save project JSON" onClick={saveJson}><Save size={18} /></IconButton>
          <label className="icon-button" title="Load project JSON"><FileUp size={18} /><input hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && loadJson(event.target.files[0])} /></label>
          <select className="export-scale" value={exportScale} onChange={(event) => setExportScale(Number(event.target.value))} aria-label="Export scale"><option value={0.25}>¼ res</option><option value={0.5}>½ res</option><option value={1}>Full res</option></select>
          <IconButton label="Verify deterministic frame" onClick={verifyDeterministicFrame}><CheckCheck size={18} /></IconButton>
          <button className="primary-button" onClick={exportFrames} disabled={Boolean(exportProgress)}><Download size={17} />{exportProgress ? `${exportProgress.frame}/${exportProgress.total}` : "Export PNGs"}</button>
        </div>
      </header>

      {workspace === "field" && fieldWorkspace}
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
          <select value={take.id} onChange={(event) => { pausePlayback(); const next = takes.find((item) => item.id === event.target.value); setActiveTakeId(event.target.value); playheadRef.current = next?.duration ?? 8; setTime(next?.duration ?? 8); }} aria-label="Active take">{takes.map((item) => <option key={item.id} value={item.id}>{item.favorite ? "★ " : ""}{item.name}</option>)}</select>
          <IconButton label="New take" onClick={() => createTake(false)}><Plus size={16} /></IconButton>
          <IconButton label="Duplicate take" onClick={() => createTake(true)}><Copy size={16} /></IconButton>
          <IconButton label="Delete take" onClick={deleteTake}><Trash2 size={16} /></IconButton>
        </div>
      </footer>
    </main>
  );
}
