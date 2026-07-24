export const PROJECT_VERSION = 21;

export interface CommentRecord {
  id: string;
  username: string;
  handle: string;
  message: string;
  timestamp: string;
  replies: number;
  reposts: number;
  likes: number;
  heroEligible: boolean;
  avatarColor: string;
}

export type SocialPostType = "x" | "instagram" | "facebook";

export interface CardStyle {
  postType: SocialPostType;
  width: number;
  background: string;
  backgroundOpacity: number;
  strokeWidth: number;
  strokeColor: string;
  cornerRadius: number;
  shadow: number;
  avatarSize: number;
  bodySize: number;
  displayNameWeight: number;
  padding: number;
  showAvatar: boolean;
  showDisplayName: boolean;
  showHandle: boolean;
  showTimestamp: boolean;
  showEngagement: boolean;
}

export interface ScatterSettings {
  density: number;
  minSpacing: number;
  sizeVariation: number;
  rotationVariation: number;
  depthMin: number;
  depthMax: number;
  edgeMargin: number;
  centerExclusion: number;
  overlapAllowance: number;
}

export interface Transform {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

export interface CardPlacement extends Transform {
  cardId: string;
  locked: boolean;
}

export interface ProtectedRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraState {
  fov: number;
  x: number;
  y: number;
  z: number;
}

export type CameraPose = CameraState;

export interface FieldBounds {
  width: number;
  height: number;
}

export type BackgroundPlateFit = "cover" | "contain" | "stretch";
export type BackgroundPlateMediaType = "image" | "video";

export interface BackgroundPlate {
  source: string;
  name: string;
  mediaType: BackgroundPlateMediaType;
  visible: boolean;
  opacity: number;
  fit: BackgroundPlateFit;
  includeInExport: boolean;
}

export interface CameraKeyframe {
  id: string;
  time: number;
  value?: CameraPose;
  /** @deprecated schema-v5 compatibility */
  pose?: CameraPose;
  easing: CubicBezierCurve;
  holdDuration: number;
  interpolation?: KeyframeInterpolation;
  /** @deprecated schema-v5 compatibility */
  cut?: boolean;
  role?: "hero-start" | "hero-end";
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  seed: string;
  backgroundColor: string;
  backgroundPlate?: BackgroundPlate;
  scatter: ScatterSettings;
  cards: CardPlacement[];
  camera: CameraState;
  fieldBounds: FieldBounds;
  protectedRegions: ProtectedRegion[];
}

export type BuildOrder = "random" | "left-to-right" | "outside-in" | "depth";
export type EasingName = "linear" | "ease-out" | "ease-in-out";

export interface Point2D {
  x: number;
  y: number;
}

export interface CubicBezierCurve {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type KeyframeInterpolation = "bezier" | "linear" | "cut";

export interface TimedKeyframe<T> {
  id: string;
  time: number;
  value?: T;
  interpolation?: KeyframeInterpolation;
  easing: CubicBezierCurve;
  holdDuration: number;
  /** @deprecated compatibility for camera keys */
  cut?: boolean;
}

export interface SpatialBezierPath {
  start: Point2D;
  control1: Point2D;
  control2: Point2D;
}

export interface SpringMotionSettings {
  springAmount: number;
  springBounces: number;
  springDamping: number;
}

export interface AmbientDriftSettings {
  driftAmount: number;
  driftSpeed: number;
  driftRotation: number;
}

/** Shared: one authored bezier for every card. Rain: each card pops up from below with a deterministic random lateral path. */
export type EntrancePathMode = "shared" | "rain";

export interface EntranceMotionTemplate extends SpringMotionSettings, AmbientDriftSettings {
  duration: number;
  fade: number;
  blur: number;
  scaleFrom: number;
  rotationOffset: number;
  depthOffset: number;
  path: SpatialBezierPath;
  /** How entrance offsets are authored: one shared path, or per-card pop-up from below. */
  pathMode: EntrancePathMode;
  /** Field-space vertical travel for rain mode (cards start this far below their settle point). */
  rainDistance: number;
  /** Max |x| lateral start offset for rain mode; each card picks a deterministic value in [-spread, spread]. */
  rainLateral: number;
  /** Deterministic per-card perturbation of the authored path in field-space units. */
  pathVariation: number;
  easing: CubicBezierCurve;
  opacityEasing: CubicBezierCurve;
}

export interface MotionBlurSettings {
  enabled: boolean;
  shutterAngle: number;
  strength: number;
}

export interface SceneShadowSettings {
  enabled: boolean;
  opacity: number;
  softness: number;
  distance: number;
  angle: number;
  color: string;
}

export interface CardLightingSettings {
  enabled: boolean;
  ambient: number;
  intensity: number;
  angle: number;
  edge: number;
}

export interface CardWobbleSettings {
  enabled: boolean;
  /** Maximum bend angle in radians. */
  amount: number;
  /** Base oscillation frequency in Hertz. */
  speed: number;
  /** Per-card speed and amplitude spread from 0-1. */
  variation: number;
}

export interface RenderSettings {
  motionBlur: MotionBlurSettings;
  sceneShadow: SceneShadowSettings;
  cardLighting: CardLightingSettings;
  cardWobble: CardWobbleSettings;
  /** When true, PNG sequence export clears to transparent and omits the composition background. */
  transparentExport: boolean;
}

export interface PreviewCacheSettings {
  idleDelayMs: number;
  memoryBudgetBytes: number;
  proxyLongEdges: number[];
  webpQuality: number;
  decodeAheadSeconds: number;
  decodeBehindSeconds: number;
}

export interface PreviewCacheStatus {
  state: "idle" | "stale" | "caching" | "ready" | "error";
  readyFrames: number;
  totalFrames: number;
  width: number;
  height: number;
  frameRate: number;
  memoryBytes: number;
  key: string;
  reason: string;
  playbackMode: "live" | "cached";
  decoderBackend?: string;
}

export interface BuildPerformance {
  seed: string;
  fade: number;
  scaleFrom: number;
  blur: number;
  drift: number;
  duration: number;
  easing: EasingName;
  staggerStart: number;
  staggerEnd: number;
  /**
   * Cumulative arrival curve across the stagger interval (x = time, y = fraction triggered).
   * Ease-in ramps density up; ease-out punches early; linear is even spacing.
   */
  staggerEasing: CubicBezierCurve;
  order: BuildOrder;
}

export interface GestureSample {
  time: number;
  x: number;
  y: number;
}

export interface CardTrigger {
  cardId: string;
  triggerTime: number;
  influence: number;
}

/** Take-specific seeded orchestration for a field that stays alive after its first build. */
export interface CardPopulationSettings {
  enabled: boolean;
  seed: string;
  /** Fraction of cards already living behind the action at frame zero. */
  initialPopulation: number;
  /**
   * When false (default), each card appears once, holds, then plays the shared out
   * animation once — no mid-take leave/return. A subset is reserved for the final burst.
   * When true, classic life/gap churn re-enters cards after they leave.
   */
  respawn: boolean;
  lifeMin: number;
  lifeMax: number;
  gapMin: number;
  gapMax: number;
  exitDuration: number;
  wanderAmount: number;
  scaleVariation: number;
  depthVariation: number;
  exitDistance: number;
  exitMotion: ExitMotionTemplate;
  /** Fraction relaunched after the final hero key. */
  postHeroBurst: number;
  /** Manual trigger used when the take has no hero performance. */
  postHeroBurstStartTime: number;
  /** Window in seconds across which eligible cards relaunch. */
  postHeroBurstDuration: number;
  /**
   * Cumulative arrival curve inside the burst interval (x = time, y = fraction arrived).
   * Same mental model as entrance/camera eases: ease-in ramps up, ease-out punches early.
   */
  postHeroBurstEasing: CubicBezierCurve;
  postHeroEntranceDuration: number;
  postHeroLifeMin: number;
  postHeroLifeMax: number;
  postHeroExitDuration: number;
}

export type ExitPathMode = "shared" | "scatter";

/** Shared transform and spatial shape used whenever a population card leaves. */
export interface ExitMotionTemplate {
  pathMode: ExitPathMode;
  path: SpatialBezierPath;
  easing: CubicBezierCurve;
  opacityEasing: CubicBezierCurve;
  fade: number;
  blur: number;
  scaleTo: number;
  rotationOffset: number;
  depthOffset: number;
  /** Deterministic per-card perturbation of the authored path in field-space units. */
  pathVariation: number;
}

export interface HeroPerformance {
  cardId: string;
  keyframes?: HeroKeyframe[];
  reflowRadius: number;
  attraction: number;
  falloff: number;
  maxDisplacement: number;
  overlapPasses: number;
  reflowDuration: number;
  easing: EasingName;
  reflowEasing: EasingName;
  /** @deprecated schema-v5 compatibility */
  startTime?: number;
  duration?: number;
  target?: Transform;
  path?: SpatialBezierPath;
  timingCurve?: CubicBezierCurve;
  surroundingDim?: number;
  surroundingBlur?: number;
  targetSpace?: "world" | "screen";
}

export type HeroKeyframeValue =
  | { kind: "source" }
  | {
      kind: "pose";
      transform: Transform;
      targetSpace: "world" | "screen";
      surroundingDim: number;
      surroundingBlur: number;
    };

export interface HeroKeyframe extends TimedKeyframe<HeroKeyframeValue> {
  value: HeroKeyframeValue;
  interpolation: KeyframeInterpolation;
  path: SpatialBezierPath;
}

export interface Take {
  id: string;
  compositionId: string;
  name: string;
  duration: number;
  build: BuildPerformance;
  entranceOverride?: EntranceMotionTemplate;
  gestureSamples: GestureSample[];
  cardTriggers: CardTrigger[];
  population: CardPopulationSettings;
  hero: HeroPerformance | null;
  reflowTargets: Record<string, Transform>;
  cameraKeyframes: CameraKeyframe[];
  notes?: string;
  favorite?: boolean;
}

export interface AssetReference {
  id: string;
  name: string;
  kind: "background" | "avatar";
  dataUrl: string;
}

export interface Project {
  version: number;
  id: string;
  name: string;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  entranceMotion: EntranceMotionTemplate;
  renderSettings: RenderSettings;
  assets: AssetReference[];
  compositions: Composition[];
  takes: Take[];
  updatedAt: string;
}

export interface EvaluatedCard extends Transform {
  cardId: string;
  opacity: number;
  blur: number;
  isHero: boolean;
  layerPriority: number;
}

export interface SceneState {
  cards: EvaluatedCard[];
  camera: CameraPose;
  time: number;
}
