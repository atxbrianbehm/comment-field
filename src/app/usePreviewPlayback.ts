import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CardStyle, CommentRecord, Composition, EntranceMotionTemplate, PreviewCacheStatus, RenderSettings, Take } from "@comment-field/engine";
import {
  choosePreviewDimensions,
  createPreviewCacheKey,
  DEFAULT_PREVIEW_CACHE_SETTINGS,
  previewDecodeWindow,
  previewFrameIndex,
  performanceProfileKey,
  progressivePreviewOrder,
  nearestReadyPreviewFrame,
  PreviewDecodeService,
  selectPerformanceProfile,
  wallClockPlaybackTime,
} from "@comment-field/webgpu-runtime";
import type { CacheStatus, CommentSceneHandle } from "../renderer/CommentScene";
import { loadStoredPreviewCache, pruneStoredPreviewCache, saveStoredPreviewCache } from "../infrastructure/previewStore";

interface PreviewCacheData {
  key: string;
  frames: Array<Blob | null>;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  memoryBytes: number;
  readyFrames: number;
  draftReady: boolean;
}

interface PreviewPlaybackInput {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  renderSettings: RenderSettings;
  workspace: "field" | "design" | "animate";
  cacheStatus: CacheStatus;
  sceneRef: RefObject<CommentSceneHandle | null>;
  mutateTake: (updater: (draft: Take) => void) => void;
}

const initialStatus = (): PreviewCacheStatus => ({
  state: "idle", readyFrames: 0, totalFrames: 0, width: 0, height: 0, frameRate: 0,
  memoryBytes: 0, key: "", reason: "waiting for active take", playbackMode: "live", decoderBackend: "pending",
});

export function usePreviewPlayback(input: PreviewPlaybackInput) {
  const { composition, take, entranceMotion, comments, cardStyle, renderSettings, workspace, cacheStatus, sceneRef, mutateTake } = input;
  const duration = take.duration ?? 8;
  const [time, setTime] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewCacheStatus>(initialStatus);
  const playbackStartRef = useRef(0);
  const playheadRef = useRef(duration);
  const playingRef = useRef(false);
  const previewJobRef = useRef(0);
  const previewCacheRef = useRef<PreviewCacheData | null>(null);
  const decodedFramesRef = useRef(new Map<number, ImageBitmap>());
  const decodingFramesRef = useRef(new Set<number>());
  const previewDecoderRef = useRef<PreviewDecodeService | null>(null);
  const performanceProfile = useMemo(() => selectPerformanceProfile({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  }), []);
  const previewFrameRate = Math.min(performanceProfile.previewFrameRate, composition.frameRate);
  const previewKey = useMemo(() => [
    createPreviewCacheKey(composition, take, take.entranceOverride ?? entranceMotion, comments, cardStyle, renderSettings),
    performanceProfileKey(performanceProfile),
  ].join("-"), [composition, take, entranceMotion, comments, cardStyle, renderSettings, performanceProfile]);

  function releaseDecodedFrames() {
    decodedFramesRef.current.forEach((bitmap) => bitmap.close());
    decodedFramesRef.current.clear();
    decodingFramesRef.current.clear();
  }

  function clearPreviewCache(reason = "preview cleared", state: PreviewCacheStatus["state"] = "idle") {
    previewJobRef.current += 1;
    releaseDecodedFrames();
    previewCacheRef.current = null;
    void pruneStoredPreviewCache(state === "stale" && !reason.startsWith("manual") ? previewKey : undefined);
    sceneRef.current?.hidePreview();
    setPreviewStatus({
      state, readyFrames: 0, totalFrames: Math.max(1, Math.round(duration * previewFrameRate)),
      width: 0, height: 0, frameRate: previewFrameRate, memoryBytes: 0, key: previewKey,
      reason, playbackMode: "live", decoderBackend: previewDecoderRef.current?.backend ?? "pending",
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
      const sourceIndex = nearestReadyPreviewFrame(cache.frames, index);
      if (sourceIndex < 0) continue;
      const source = cache.frames[sourceIndex];
      if (!source) continue;
      decodingFramesRef.current.add(index);
      tasks.push((previewDecoderRef.current?.decode(source) ?? createImageBitmap(source)).then((bitmap) => {
        decodingFramesRef.current.delete(index);
        if (previewCacheRef.current?.key === cache.key) decodedFramesRef.current.set(index, bitmap);
        else bitmap.close();
      }).catch(() => { decodingFramesRef.current.delete(index); }));
    }
    await Promise.all(tasks);
    const backend = previewDecoderRef.current?.backend ?? "main-thread";
    setPreviewStatus((current) => current.decoderBackend === backend ? current : { ...current, decoderBackend: backend });
  }

  async function buildPreviewCache() {
    const scene = sceneRef.current;
    if (!scene || workspace !== "field" || playingRef.current || cacheStatus.state !== "ready") return;
    const token = ++previewJobRef.current;
    const settings = { ...DEFAULT_PREVIEW_CACHE_SETTINGS, proxyLongEdges: performanceProfile.previewLongEdges, memoryBudgetBytes: performanceProfile.previewMemoryBudgetBytes };
    const { width, height } = choosePreviewDimensions(composition, duration, settings);
    const totalFrames = Math.max(1, Math.round(duration * previewFrameRate));
    const stored = previewCacheRef.current ? null : await loadStoredPreviewCache(previewKey).catch(() => null);
    if (token !== previewJobRef.current) return;
    const existing = previewCacheRef.current?.key === previewKey
      ? previewCacheRef.current
      : stored && stored.width === width && stored.height === height && stored.frameRate === previewFrameRate && stored.duration === duration
        ? stored
        : null;
    const frames = existing?.frames ?? Array<Blob | null>(totalFrames).fill(null);
    let memoryBytes = existing?.memoryBytes ?? 0;
    let readyFrames = existing?.readyFrames ?? 0;
    releaseDecodedFrames();
    const cache: PreviewCacheData = existing ?? {
      key: previewKey, frames, width, height, frameRate: previewFrameRate, duration,
      memoryBytes, readyFrames, draftReady: false,
    };
    previewCacheRef.current = cache;
    setPreviewStatus({
      state: "caching", readyFrames: 0, totalFrames, width, height, frameRate: previewFrameRate,
      memoryBytes, key: previewKey, reason: existing?.draftReady ? "restored persistent 12 fps draft; refining exact 24 fps preview" : "building fast 12 fps draft pass", playbackMode: "live",
      decoderBackend: previewDecoderRef.current?.backend ?? "pending",
    });
    try {
      const order = progressivePreviewOrder(totalFrames);
      for (const frame of order) {
        if (frames[frame]) continue;
        if (token !== previewJobRef.current || playingRef.current) {
          if (token === previewJobRef.current) setPreviewStatus((current) => ({ ...current, state: "stale", reason: "preview caching paused for playback" }));
          return;
        }
        const blob = await scene.renderPreviewFrame(frame / previewFrameRate, width, height, settings.webpQuality);
        if (token !== previewJobRef.current) return;
        frames[frame] = blob;
        memoryBytes += blob.size;
        readyFrames += 1;
        cache.memoryBytes = memoryBytes;
        cache.readyFrames = readyFrames;
        const becameDraftReady = !cache.draftReady && frames.every((value, index) => index % 2 === 1 || Boolean(value));
        if (becameDraftReady) {
          cache.draftReady = true;
          await saveStoredPreviewCache({ ...cache, frames: [...cache.frames] });
        }
        if (readyFrames === totalFrames || readyFrames % 2 === 0 || cache.draftReady) {
          setPreviewStatus((current) => ({
            ...current, readyFrames, memoryBytes,
            reason: cache.draftReady && readyFrames < totalFrames ? "12 fps draft ready; refining exact 24 fps preview" : current.reason,
          }));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
      if (token !== previewJobRef.current) return;
      cache.memoryBytes = memoryBytes; cache.readyFrames = totalFrames; cache.draftReady = true;
      await saveStoredPreviewCache({ ...cache, frames: [...cache.frames] });
      setPreviewStatus({
        state: "ready", readyFrames: totalFrames, totalFrames, width, height, frameRate: previewFrameRate,
        memoryBytes, key: previewKey, reason: "active take cached in memory", playbackMode: "live",
        decoderBackend: previewDecoderRef.current?.backend ?? "pending",
      });
      await decodePreviewWindow(previewFrameIndex(playheadRef.current, duration, previewFrameRate));
    } catch (error) {
      if (token !== previewJobRef.current) return;
      releaseDecodedFrames();
      previewCacheRef.current = null;
      setPreviewStatus({
        state: "error", readyFrames, totalFrames, width, height, frameRate: previewFrameRate,
        memoryBytes, key: previewKey, reason: error instanceof Error ? error.message : "preview cache failed", playbackMode: "live",
        decoderBackend: previewDecoderRef.current?.backend ?? "pending",
      });
    }
  }

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => {
    const decoder = new PreviewDecodeService();
    previewDecoderRef.current = decoder;
    return () => { previewDecoderRef.current = null; decoder.dispose(); };
  }, []);
  useEffect(() => { if (!playing) playheadRef.current = time; }, [time, playing]);
  useEffect(() => {
    clearPreviewCache("render-affecting state changed", "stale");
    return () => { previewJobRef.current += 1; };
  }, [previewKey]);
  useEffect(() => {
    if (previewStatus.state !== "stale" || workspace !== "field" || playing || cacheStatus.state !== "ready") return;
    const timeout = window.setTimeout(() => { void buildPreviewCache(); }, DEFAULT_PREVIEW_CACHE_SETTINGS.idleDelayMs);
    return () => window.clearTimeout(timeout);
  }, [previewKey, previewStatus.state, workspace, playing, cacheStatus.state]);
  useEffect(() => { if (workspace !== "field") interruptPreviewBuild("preview caching paused outside Field"); }, [workspace]);
  useEffect(() => () => { previewJobRef.current += 1; releaseDecodedFrames(); }, []);

  useEffect(() => {
    if (!playing) return;
    const cache = previewCacheRef.current;
    const cachedPlayback = Boolean(cache && cache.key === previewKey && cache.draftReady);
    playbackStartRef.current = performance.now() - playheadRef.current * 1000;
    let frame = 0;
    let lastRenderedAt = 0;
    let lastUiUpdate = 0;
    const frameInterval = 1000 / (cachedPlayback && cache ? cache.frameRate : composition.frameRate);
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
        } else sceneRef.current?.renderLiveFrame(elapsed);
        if (now - lastUiUpdate >= 100) { lastUiUpdate = now; setTime(elapsed); }
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
  }, [playing, duration, composition.frameRate, previewFrameRate, previewKey]);

  function pausePlayback() {
    setPlaying(false);
    setTime(playheadRef.current);
    sceneRef.current?.hidePreview();
    sceneRef.current?.renderLiveFrame(playheadRef.current);
  }

  async function togglePlayback() {
    if (playing) { pausePlayback(); return; }
    if (playheadRef.current >= duration) { playheadRef.current = 0; setTime(0); }
    const cache = previewCacheRef.current;
    if (cache?.key === previewKey) await decodePreviewWindow(previewFrameIndex(playheadRef.current, cache.duration, cache.frameRate));
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
    if (playheadRef.current > snapped) scrubTo(snapped);
  }

  function setPlayhead(value: number) {
    pausePlayback();
    playheadRef.current = value;
    setTime(value);
  }

  useEffect(() => {
    if (playheadRef.current > duration) playheadRef.current = duration;
    setTime((current) => Math.min(current, duration));
  }, [duration]);

  return {
    time, playing, previewStatus, setPreviewStatus, clearPreviewCache, pausePlayback, togglePlayback,
    beginManipulation, scrubTo, changeTakeDuration, setPlayhead,
    previewProgress: previewStatus.totalFrames > 0 ? previewStatus.readyFrames / previewStatus.totalFrames : 0,
    previewMemory: `${(previewStatus.memoryBytes / (1024 * 1024)).toFixed(1)} MB`, performanceProfile,
    cachedPlaybackActive: playing && previewStatus.playbackMode === "cached",
  };
}
