import { DEFAULT_PREVIEW_CACHE_SETTINGS } from "./previewCache";

export type PerformanceClass = "desktop" | "tablet" | "phone";

export interface PerformanceProfile {
  class: PerformanceClass;
  canvasPixelRatio: number;
  cardTexturePixelRatio: number;
  previewLongEdges: number[];
  previewMemoryBudgetBytes: number;
  previewFrameRate: number;
  draftFrameRate: number;
  blurQuality: "full" | "reduced";
}

export interface PerformanceCapabilities {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio?: number;
  deviceMemoryGb?: number;
}

const MB = 1024 * 1024;

export function selectPerformanceProfile(capabilities: PerformanceCapabilities): PerformanceProfile {
  const shortEdge = Math.min(capabilities.viewportWidth, capabilities.viewportHeight);
  const memory = capabilities.deviceMemoryGb ?? 8;
  const dpr = Math.max(1, capabilities.devicePixelRatio ?? 1);
  if (shortEdge < 600) {
    return {
      class: "phone", canvasPixelRatio: 1, cardTexturePixelRatio: 1,
      previewLongEdges: [540, 360], previewMemoryBudgetBytes: 96 * MB,
      previewFrameRate: 24, draftFrameRate: 12, blurQuality: "reduced",
    };
  }
  if (shortEdge < 900 || memory <= 4) {
    return {
      class: "tablet", canvasPixelRatio: Math.min(1.5, dpr), cardTexturePixelRatio: 1.5,
      previewLongEdges: [720, 540], previewMemoryBudgetBytes: 160 * MB,
      previewFrameRate: 24, draftFrameRate: 12, blurQuality: "reduced",
    };
  }
  return {
    class: "desktop", canvasPixelRatio: Math.min(2, dpr), cardTexturePixelRatio: 2,
    previewLongEdges: [...DEFAULT_PREVIEW_CACHE_SETTINGS.proxyLongEdges],
    previewMemoryBudgetBytes: DEFAULT_PREVIEW_CACHE_SETTINGS.memoryBudgetBytes,
    previewFrameRate: 24, draftFrameRate: 12, blurQuality: "full",
  };
}

export function performanceProfileKey(profile: PerformanceProfile) {
  return [profile.class, profile.canvasPixelRatio, profile.cardTexturePixelRatio, profile.previewLongEdges.join("-"), profile.previewMemoryBudgetBytes, profile.previewFrameRate, profile.blurQuality].join(":");
}
