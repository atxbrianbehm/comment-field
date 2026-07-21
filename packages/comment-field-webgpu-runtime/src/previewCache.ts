import type {
  CardStyle,
  CommentRecord,
  Composition,
  EntranceMotionTemplate,
  RenderSettings,
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

/**
 * Bump when entrance/layout evaluation or preview pixel orientation changes without a
 * matching project-data change. Stale IDB frames would otherwise play inverted/old motion.
 */
export const PREVIEW_CACHE_EVAL_VERSION = 4;

export function createPreviewCacheKey(
  composition: Composition,
  take: Take,
  entranceMotion: EntranceMotionTemplate,
  comments: CommentRecord[],
  cardStyle: CardStyle,
  renderSettings?: RenderSettings,
) {
  const source = JSON.stringify({
    evalVersion: PREVIEW_CACHE_EVAL_VERSION,
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
    renderSettings,
  });
  return `preview-v${PREVIEW_CACHE_EVAL_VERSION}-${hashString(source)}-${source.length}`;
}

/**
 * Pack GPU readback into tight RGBA rows for ImageData / canvas encode.
 * WebGPU copyTextureToBuffer is top-down (matches canvas). WebGL readPixels is bottom-up and needs flipY.
 * Always flipping WebGPU frames inverted cached playback vs live, so rain looked like it randomly reversed.
 */
export function packReadbackPixels(pixels: Uint8Array, width: number, height: number, flipY = false) {
  const rowBytes = width * 4;
  const minimumBytes = rowBytes * height;
  if (pixels.length < minimumBytes) throw new Error("WebGPU preview readback returned incomplete pixel data");
  const sourceStride = height <= 1 ? rowBytes : (pixels.length - rowBytes) / (height - 1);
  if (!Number.isInteger(sourceStride) || sourceStride < rowBytes) throw new Error("WebGPU preview readback returned an invalid row stride");
  const packed = new Uint8ClampedArray(minimumBytes);
  for (let row = 0; row < height; row += 1) {
    const destRow = flipY ? height - row - 1 : row;
    packed.set(pixels.subarray(row * sourceStride, row * sourceStride + rowBytes), destRow * rowBytes);
  }
  return packed;
}

/** @deprecated Use packReadbackPixels — kept for WebGL bottom-up readbacks. */
export function flipWebGpuReadback(pixels: Uint8Array, width: number, height: number) {
  return packReadbackPixels(pixels, width, height, true);
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

export function progressivePreviewOrder(totalFrames: number) {
  const order: number[] = [];
  for (let frame = 0; frame < totalFrames; frame += 2) order.push(frame);
  for (let frame = 1; frame < totalFrames; frame += 2) order.push(frame);
  return order;
}

export function nearestReadyPreviewFrame(frames: readonly unknown[], requested: number) {
  if (frames[requested]) return requested;
  for (let offset = 1; offset < frames.length; offset += 1) {
    if (requested - offset >= 0 && frames[requested - offset]) return requested - offset;
    if (requested + offset < frames.length && frames[requested + offset]) return requested + offset;
  }
  return -1;
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
