import { resolveBuildTriggers } from "../animation/build";
import { DEFAULT_COMMENTS } from "../fixtures/defaultComments";
import { generateScatter } from "../layout/scatter";
import { cloneValue } from "../utils/clone";
import type { BuildPerformance, CardStyle, Composition, EntranceMotionTemplate, Project, RenderSettings, ScatterSettings, Take } from "./types";
import { PROJECT_VERSION } from "./types";

export const DEFAULT_CARD_STYLE: CardStyle = {
  width: 420,
  background: "#FFFFFF",
  backgroundOpacity: 0.96,
  strokeWidth: 0,
  strokeColor: "#1B1B18",
  cornerRadius: 18,
  shadow: 0.32,
  avatarSize: 46,
  bodySize: 20,
  displayNameWeight: 700,
  padding: 20,
  showAvatar: true,
  showDisplayName: true,
  showHandle: true,
  showTimestamp: true,
  showEngagement: true,
};

export const DEFAULT_ENTRANCE_MOTION: EntranceMotionTemplate = {
  duration: 0.7,
  fade: 1,
  blur: 7,
  scaleFrom: 0.72,
  rotationOffset: -0.04,
  depthOffset: -0.18,
  springAmount: 0.12,
  springBounces: 1,
  springDamping: 3.5,
  driftAmount: 0.006,
  driftSpeed: 0.13,
  driftRotation: 0.012,
  path: {
    start: { x: 0, y: 0.09 },
    control1: { x: -0.01, y: 0.065 },
    control2: { x: 0, y: 0.025 },
  },
  pathMode: "shared",
  rainDistance: 0.55,
  rainLateral: 0.22,
  easing: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
  opacityEasing: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
};

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  motionBlur: {
    enabled: false,
    shutterAngle: 180,
    strength: 1,
  },
  transparentExport: false,
};

export const DEFAULT_SCATTER: ScatterSettings = {
  density: 1,
  minSpacing: 0.13,
  sizeVariation: 0.18,
  rotationVariation: 0.05,
  depthMin: -0.45,
  depthMax: 0.55,
  edgeMargin: 0.07,
  centerExclusion: 0.1,
  overlapAllowance: 0.18,
};

export const DEFAULT_BUILD: BuildPerformance = {
  seed: "build-01",
  fade: 1,
  scaleFrom: 0.72,
  blur: 7,
  drift: 0.05,
  duration: 0.7,
  easing: "ease-out",
  staggerStart: 0,
  staggerEnd: 2.6,
  order: "random",
};

function createComposition(id: string, name: string, width: number, height: number, seed: string): Composition {
  const composition: Composition = {
    id,
    name,
    width,
    height,
    frameRate: 24,
    seed,
    backgroundColor: "#B4492F",
    scatter: { ...DEFAULT_SCATTER },
    cards: [],
    camera: { fov: 42, x: 0, y: 0, z: 5 },
    fieldBounds: { width: 1, height: 1 },
    protectedRegions: [],
  };
  composition.cards = generateScatter(DEFAULT_COMMENTS.map((comment) => comment.id), seed, composition.scatter, composition.protectedRegions, composition.fieldBounds);
  return composition;
}

function createTake(id: string, composition: Composition, name: string): Take {
  const build = { ...DEFAULT_BUILD, seed: `${composition.seed}-build` };
  return {
    id,
    compositionId: composition.id,
    name,
    duration: 8,
    build,
    gestureSamples: [],
    cardTriggers: resolveBuildTriggers(composition.cards, build),
    hero: null,
    reflowTargets: {},
    cameraKeyframes: [],
    notes: "",
    favorite: false,
  };
}

export function createDefaultProject(): Project {
  const landscape = createComposition("comp-landscape", "Landscape 16:9", 1920, 1080, "papas-169-01");
  const portrait = createComposition("comp-portrait", "Portrait 9:16", 1080, 1920, "papas-916-01");
  return {
    version: PROJECT_VERSION,
    id: "comment-field-papas",
    name: "Papa Murphy's Comment Field",
    comments: DEFAULT_COMMENTS,
    cardStyle: { ...DEFAULT_CARD_STYLE },
    entranceMotion: cloneValue(DEFAULT_ENTRANCE_MOTION),
    renderSettings: cloneValue(DEFAULT_RENDER_SETTINGS),
    assets: [],
    compositions: [landscape, portrait],
    takes: [createTake("take-01", landscape, "Take 01"), createTake("take-portrait-01", portrait, "Portrait Take 01")],
    updatedAt: new Date(0).toISOString(),
  };
}
