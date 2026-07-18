import type { CardStyle, CommentRecord, Composition, EntranceMotionTemplate, GestureSample, RenderSettings, Take, Transform } from "@comment-field/engine";
import type { PerformanceTelemetrySnapshot, RuntimeCacheStatus } from "@comment-field/webgpu-runtime";

export type InteractionMode = "select" | "record" | "reflow";
export type TransformPatch = Partial<Pick<Transform, "x" | "y" | "scale" | "rotation">>;
export type CacheStatus = RuntimeCacheStatus;

export interface CommentSceneHandle {
  beginExport: (width: number, height: number) => void;
  renderFrame: (time: number, width: number, height: number) => Promise<Blob>;
  renderLiveFrame: (time: number) => void;
  renderPreviewFrame: (time: number, width: number, height: number, quality: number) => Promise<Blob>;
  showPreviewBitmap: (bitmap: ImageBitmap) => void;
  hidePreview: () => void;
  endExport: () => void;
  fitField: () => void;
  getPerformanceTelemetry: () => PerformanceTelemetrySnapshot | null;
}

export interface CommentSceneProps {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  renderSettings: RenderSettings;
  time: number;
  selectedCardId: string | null;
  selectedGestureIndex?: number | null;
  mode: InteractionMode;
  showTransformHandles?: boolean;
  showGesturePath?: boolean;
  onSelect: (cardId: string | null) => void;
  onSelectGestureSample?: (index: number | null) => void;
  onGestureSampleChange?: (index: number, patch: Partial<GestureSample>) => void;
  onTransformCard: (cardId: string, patch: TransformPatch, editReflow: boolean) => void;
  onGestureComplete: (samples: GestureSample[]) => void;
  onCacheStatus?: (status: CacheStatus) => void;
  onManipulationStart?: () => void;
  viewMode?: "camera" | "overview";
}
