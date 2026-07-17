import type {
  CardStyle,
  CommentRecord,
  Composition,
  EntranceMotionTemplate,
  PreviewCacheSettings,
  Take,
} from "@comment-field/engine";

export const DEFAULT_PREVIEW_CACHE_SETTINGS: PreviewCacheSettings = {
  idleDelayMs: 400,
  memoryBudgetBytes: 256 * 1024 * 1024,
  proxyLongEdges: [960, 720, 540],
  webpQuality: 0.82,
  decodeAheadSeconds: 1,
  decodeBehindSeconds: 0.25,
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createPreviewCacheKey(
  composition: Composition,
  take: Take,
  entranceMotion: EntranceMotionTemplate,
  comments: CommentRecord[],
  cardStyle: CardStyle,
) {
  const source = JSON.stringify({
    composition: {
      id: composition.id,
      width: composition.width,
      height: composition.height,
      frameRate: composition.frameRate,
      seed: composition.seed,
      backgroundColor: composition.backgroundColor,
      backgroundImage: composition.backgroundImage,
      cards: composition.cards,
      camera: composition.camera,
      fieldBounds: composition.fieldBounds,
    },
    take: {
      id: take.id,
      duration: take.duration,
      build: take.build,
      entranceOverride: take.entranceOverride,
      gestureSamples: take.gestureSamples,
      cardTriggers: take.cardTriggers,
      hero: take.hero,
      reflowTargets: take.reflowTargets,
      cameraKeyframes: take.cameraKeyframes,
    },
    entranceMotion,
    comments,
    cardStyle,
  });
  return `preview-${hashString(source)}-${source.length}`;
}

export function fitPreviewDimensions(width: number, height: number, longEdge: number) {
  const scale = longEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function estimatePreviewMemory(
  width: number,
  height: number,
  totalFrames: number,
  frameRate: number,
  settings = DEFAULT_PREVIEW_CACHE_SETTINGS,
) {
  const compressedFrames = width * height * totalFrames * 0.32;
  const decodedWindowFrames = Math.ceil(frameRate * (settings.decodeAheadSeconds + settings.decodeBehindSeconds + 0.1));
  const decodedWindow = width * height * 4 * decodedWindowFrames;
  return Math.ceil(compressedFrames + decodedWindow);
}

export function choosePreviewDimensions(
  composition: Pick<Composition, "width" | "height" | "frameRate">,
  duration: number,
  settings = DEFAULT_PREVIEW_CACHE_SETTINGS,
) {
  const totalFrames = Math.max(1, Math.round(duration * composition.frameRate));
  for (const longEdge of settings.proxyLongEdges) {
    const dimensions = fitPreviewDimensions(composition.width, composition.height, longEdge);
    if (estimatePreviewMemory(dimensions.width, dimensions.height, totalFrames, composition.frameRate, settings) <= settings.memoryBudgetBytes) {
      return dimensions;
    }
  }
  return fitPreviewDimensions(composition.width, composition.height, settings.proxyLongEdges.at(-1) ?? 540);
}

export function previewFrameIndex(time: number, duration: number, frameRate: number) {
  const totalFrames = Math.max(1, Math.round(duration * frameRate));
  return Math.min(totalFrames - 1, Math.max(0, Math.floor(time * frameRate + 0.000001)));
}

export function wallClockPlaybackTime(playheadAtStart: number, startedAtMs: number, nowMs: number, duration: number) {
  return Math.min(duration, Math.max(0, playheadAtStart + (nowMs - startedAtMs) / 1000));
}

export function previewDecodeWindow(
  centerFrame: number,
  totalFrames: number,
  frameRate: number,
  settings = DEFAULT_PREVIEW_CACHE_SETTINGS,
) {
  const first = Math.max(0, centerFrame - Math.ceil(frameRate * settings.decodeBehindSeconds));
  const last = Math.min(totalFrames - 1, centerFrame + Math.ceil(frameRate * settings.decodeAheadSeconds));
  return { first, last };
}
