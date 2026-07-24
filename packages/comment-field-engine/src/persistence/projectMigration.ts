import { DEFAULT_CAMERA_EASING, isLegacyCameraSnapEasing } from "../animation/camera";
import { PROJECT_VERSION, type CubicBezierCurve, type Project, type Take } from "../models/types";
import {
  DEFAULT_BUILD,
  DEFAULT_CARD_POPULATION,
  DEFAULT_ENTRANCE_MOTION,
  DEFAULT_EXIT_MOTION,
  DEFAULT_RENDER_SETTINGS,
  EVEN_ARRIVAL_EASING,
  PUNCH_EARLY_ARRIVAL_EASING,
  RAMP_UP_ARRIVAL_EASING,
} from "../models/defaults";
import { cloneValue } from "../utils/clone";

function curvesMatch(a: CubicBezierCurve | undefined, b: CubicBezierCurve) {
  if (!a) return false;
  return Math.abs(a.x1 - b.x1) < 1e-6
    && Math.abs(a.y1 - b.y1) < 1e-6
    && Math.abs(a.x2 - b.x2) < 1e-6
    && Math.abs(a.y2 - b.y2) < 1e-6;
}

/**
 * Clone + fill missing fields + stamp the current schema version.
 * Used for both save and load so every persisted file carries a complete parameter set
 * (timing curves, burst settings, plates, render settings, etc.) without wiping authored values.
 */
export function prepareProjectForPersistence(project: Project): Project {
  return migrateProject(project);
}

export function serializeProject(project: Project): string {
  const prepared = prepareProjectForPersistence(project);
  return JSON.stringify({ ...prepared, updatedAt: new Date().toISOString() }, null, 2);
}

export function deserializeProject(source: string): Project {
  const parsed = JSON.parse(source) as Project;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.compositions) || !Array.isArray(parsed.takes)) {
    throw new Error("This file is not a Comment Field project.");
  }
  if (typeof parsed.version === "number" && parsed.version > PROJECT_VERSION) {
    throw new Error(`Project version ${parsed.version} is newer than this app supports.`);
  }
  return prepareProjectForPersistence(parsed);
}

export function migrateProject(project: Project): Project {
  const migrated = cloneValue(project);
  const legacyVersion = migrated.version;
  migrated.version = PROJECT_VERSION;
  migrated.renderSettings ??= cloneValue(DEFAULT_RENDER_SETTINGS);
  migrated.renderSettings.motionBlur ??= cloneValue(DEFAULT_RENDER_SETTINGS.motionBlur);
  migrated.renderSettings.motionBlur.enabled ??= false;
  migrated.renderSettings.motionBlur.shutterAngle ??= DEFAULT_RENDER_SETTINGS.motionBlur.shutterAngle;
  migrated.renderSettings.motionBlur.strength ??= DEFAULT_RENDER_SETTINGS.motionBlur.strength;
  migrated.renderSettings.sceneShadow ??= cloneValue(DEFAULT_RENDER_SETTINGS.sceneShadow);
  migrated.renderSettings.sceneShadow.enabled ??= DEFAULT_RENDER_SETTINGS.sceneShadow.enabled;
  migrated.renderSettings.sceneShadow.opacity ??= DEFAULT_RENDER_SETTINGS.sceneShadow.opacity;
  migrated.renderSettings.sceneShadow.softness ??= DEFAULT_RENDER_SETTINGS.sceneShadow.softness;
  migrated.renderSettings.sceneShadow.distance ??= DEFAULT_RENDER_SETTINGS.sceneShadow.distance;
  migrated.renderSettings.sceneShadow.angle ??= DEFAULT_RENDER_SETTINGS.sceneShadow.angle;
  migrated.renderSettings.sceneShadow.color ??= DEFAULT_RENDER_SETTINGS.sceneShadow.color;
  migrated.renderSettings.cardLighting ??= cloneValue(DEFAULT_RENDER_SETTINGS.cardLighting);
  migrated.renderSettings.cardLighting.enabled ??= DEFAULT_RENDER_SETTINGS.cardLighting.enabled;
  migrated.renderSettings.cardLighting.ambient ??= DEFAULT_RENDER_SETTINGS.cardLighting.ambient;
  migrated.renderSettings.cardLighting.intensity ??= DEFAULT_RENDER_SETTINGS.cardLighting.intensity;
  migrated.renderSettings.cardLighting.angle ??= DEFAULT_RENDER_SETTINGS.cardLighting.angle;
  migrated.renderSettings.cardLighting.edge ??= DEFAULT_RENDER_SETTINGS.cardLighting.edge;
  migrated.renderSettings.cardWobble ??= cloneValue(DEFAULT_RENDER_SETTINGS.cardWobble);
  migrated.renderSettings.cardWobble.enabled ??= false;
  migrated.renderSettings.cardWobble.amount ??= DEFAULT_RENDER_SETTINGS.cardWobble.amount;
  migrated.renderSettings.cardWobble.speed ??= DEFAULT_RENDER_SETTINGS.cardWobble.speed;
  migrated.renderSettings.cardWobble.variation ??= DEFAULT_RENDER_SETTINGS.cardWobble.variation;
  if (legacyVersion < 21) migrated.renderSettings.cardWobble.enabled = false;
  migrated.renderSettings.transparentExport ??= DEFAULT_RENDER_SETTINGS.transparentExport;
  const legacyDurations = new Map<string, number>();
  for (const composition of migrated.compositions) {
    const legacyComposition = composition as CompositionWithLegacyDuration;
    legacyDurations.set(composition.id, legacyComposition.duration ?? 8);
    composition.fieldBounds ??= legacyVersion < 5 ? { width: 1, height: 1 } : { width: 3, height: 3 };
    if (!composition.backgroundPlate && legacyComposition.backgroundImage) {
      composition.backgroundPlate = {
        source: legacyComposition.backgroundImage,
        name: "Legacy background plate",
        mediaType: "image",
        visible: true,
        opacity: 1,
        fit: "cover",
        includeInExport: true,
      };
    }
    if (composition.backgroundPlate) {
      composition.backgroundPlate.name ||= "Background plate";
      composition.backgroundPlate.mediaType ??= composition.backgroundPlate.source.startsWith("data:video/") ? "video" : "image";
      composition.backgroundPlate.visible ??= true;
      composition.backgroundPlate.opacity ??= 1;
      composition.backgroundPlate.fit ??= "cover";
      composition.backgroundPlate.includeInExport ??= false;
    }
    delete legacyComposition.duration;
    delete legacyComposition.backgroundImage;
  }
  migrated.cardStyle.strokeWidth ??= 0;
  migrated.cardStyle.strokeColor ??= "#1B1B18";
  migrated.cardStyle.postType ??= "x";
  migrated.cardStyle.showAvatar ??= true;
  migrated.cardStyle.showDisplayName ??= true;
  migrated.cardStyle.showHandle ??= true;
  migrated.cardStyle.showTimestamp ??= true;
  migrated.cardStyle.showEngagement ??= true;
  if (legacyVersion < 2) {
    const legacyMotions = migrated.takes.map((take) => {
      const legacyBuild = take.build as Take["build"] & Partial<{
        duration: number; fade: number; blur: number; scaleFrom: number; drift: number; easing: string;
      }>;
      const drift = legacyBuild.drift ?? 0;
      const easing = legacyBuild.easing === "linear"
        ? { x1: 0, y1: 0, x2: 1, y2: 1 }
        : legacyBuild.easing === "ease-in-out"
          ? { x1: 0.65, y1: 0, x2: 0.35, y2: 1 }
          : { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
      return {
        ...cloneValue(DEFAULT_ENTRANCE_MOTION),
        duration: legacyBuild.duration ?? DEFAULT_ENTRANCE_MOTION.duration,
        fade: legacyBuild.fade ?? DEFAULT_ENTRANCE_MOTION.fade,
        blur: legacyBuild.blur ?? DEFAULT_ENTRANCE_MOTION.blur,
        scaleFrom: legacyBuild.scaleFrom ?? DEFAULT_ENTRANCE_MOTION.scaleFrom,
        path: {
          start: { x: baseDirection(drift), y: drift * 0.35 },
          control1: { x: baseDirection(drift) * 0.7, y: drift * 0.25 },
          control2: { x: baseDirection(drift) * 0.25, y: drift * 0.1 },
        },
        easing,
      };
    });
    migrated.entranceMotion = legacyMotions[0] ?? cloneValue(DEFAULT_ENTRANCE_MOTION);
    migrated.takes.forEach((take, index) => {
      take.entranceOverride = JSON.stringify(legacyMotions[index]) === JSON.stringify(migrated.entranceMotion)
        ? undefined
        : legacyMotions[index];
    });
  } else {
    migrated.entranceMotion ??= cloneValue(DEFAULT_ENTRANCE_MOTION);
  }
  migrated.entranceMotion.opacityEasing ??= cloneValue(migrated.entranceMotion.easing);
  migrated.entranceMotion.pathMode ??= DEFAULT_ENTRANCE_MOTION.pathMode;
  migrated.entranceMotion.rainDistance ??= DEFAULT_ENTRANCE_MOTION.rainDistance;
  migrated.entranceMotion.rainLateral ??= DEFAULT_ENTRANCE_MOTION.rainLateral;
  migrated.entranceMotion.pathVariation ??= legacyVersion < 21 ? 0 : DEFAULT_ENTRANCE_MOTION.pathVariation;
  for (const take of migrated.takes) {
    if (take.entranceOverride) {
      take.entranceOverride.opacityEasing ??= cloneValue(take.entranceOverride.easing);
      take.entranceOverride.pathMode ??= DEFAULT_ENTRANCE_MOTION.pathMode;
      take.entranceOverride.rainDistance ??= DEFAULT_ENTRANCE_MOTION.rainDistance;
      take.entranceOverride.rainLateral ??= DEFAULT_ENTRANCE_MOTION.rainLateral;
      take.entranceOverride.pathVariation ??= legacyVersion < 21 ? 0 : DEFAULT_ENTRANCE_MOTION.pathVariation;
    }
  }
  if (legacyVersion < 4) {
    const preserveLegacyMotion = (motion: Project["entranceMotion"]) => {
      motion.springAmount = 0;
      motion.springBounces = 0;
      motion.springDamping = 0;
      motion.driftAmount = 0;
      motion.driftSpeed = 0;
      motion.driftRotation = 0;
    };
    preserveLegacyMotion(migrated.entranceMotion);
    for (const take of migrated.takes) {
      if (take.entranceOverride) preserveLegacyMotion(take.entranceOverride);
    }
  } else {
    migrated.entranceMotion.springAmount ??= DEFAULT_ENTRANCE_MOTION.springAmount;
    migrated.entranceMotion.springBounces ??= DEFAULT_ENTRANCE_MOTION.springBounces;
    migrated.entranceMotion.springDamping ??= DEFAULT_ENTRANCE_MOTION.springDamping;
    migrated.entranceMotion.driftAmount ??= DEFAULT_ENTRANCE_MOTION.driftAmount;
    migrated.entranceMotion.driftSpeed ??= DEFAULT_ENTRANCE_MOTION.driftSpeed;
    migrated.entranceMotion.driftRotation ??= DEFAULT_ENTRANCE_MOTION.driftRotation;
  }
  for (const take of migrated.takes) {
    take.duration ??= legacyDurations.get(take.compositionId) ?? 8;
    take.build ??= {
      ...cloneValue(DEFAULT_BUILD),
      seed: `${take.id}-build`,
    };
    take.build.seed ??= `${take.id}-build`;
    take.build.fade ??= DEFAULT_BUILD.fade;
    take.build.scaleFrom ??= DEFAULT_BUILD.scaleFrom;
    take.build.blur ??= DEFAULT_BUILD.blur;
    take.build.drift ??= DEFAULT_BUILD.drift;
    take.build.duration ??= DEFAULT_BUILD.duration;
    take.build.easing ??= DEFAULT_BUILD.easing;
    take.build.staggerStart ??= DEFAULT_BUILD.staggerStart;
    take.build.staggerEnd ??= DEFAULT_BUILD.staggerEnd;
    take.build.order ??= DEFAULT_BUILD.order;
    // Pre-v19 builds used linear stagger only; keep that so saved trigger density does not jump.
    take.build.staggerEasing ??= legacyVersion < 19
      ? { ...EVEN_ARRIVAL_EASING }
      : cloneValue(DEFAULT_BUILD.staggerEasing);
    take.gestureSamples ??= [];
    take.cardTriggers ??= [];
    take.reflowTargets ??= {};
    take.cameraKeyframes ??= [];
    take.population ??= {
      ...cloneValue(DEFAULT_CARD_POPULATION),
      enabled: false,
      seed: `${take.build?.seed ?? take.id}-population`,
    };
    take.population.enabled ??= false;
    take.population.seed ??= `${take.build?.seed ?? take.id}-population`;
    take.population.initialPopulation ??= DEFAULT_CARD_POPULATION.initialPopulation;
    // Default is hold-through-shot (no mid-take leave/return). Authors can re-enable churn.
    take.population.respawn ??= false;
    take.population.lifeMin ??= DEFAULT_CARD_POPULATION.lifeMin;
    take.population.lifeMax ??= DEFAULT_CARD_POPULATION.lifeMax;
    take.population.gapMin ??= DEFAULT_CARD_POPULATION.gapMin;
    take.population.gapMax ??= DEFAULT_CARD_POPULATION.gapMax;
    take.population.exitDuration ??= DEFAULT_CARD_POPULATION.exitDuration;
    take.population.wanderAmount ??= DEFAULT_CARD_POPULATION.wanderAmount;
    take.population.scaleVariation ??= DEFAULT_CARD_POPULATION.scaleVariation;
    take.population.depthVariation ??= DEFAULT_CARD_POPULATION.depthVariation;
    take.population.exitDistance ??= DEFAULT_CARD_POPULATION.exitDistance;
    take.population.exitMotion ??= cloneValue(DEFAULT_EXIT_MOTION);
    take.population.exitMotion.pathMode ??= DEFAULT_EXIT_MOTION.pathMode;
    take.population.exitMotion.path ??= cloneValue(DEFAULT_EXIT_MOTION.path);
    take.population.exitMotion.easing ??= cloneValue(DEFAULT_EXIT_MOTION.easing);
    take.population.exitMotion.opacityEasing ??= cloneValue(take.population.exitMotion.easing ?? DEFAULT_EXIT_MOTION.opacityEasing);
    take.population.exitMotion.fade ??= DEFAULT_EXIT_MOTION.fade;
    take.population.exitMotion.blur ??= DEFAULT_EXIT_MOTION.blur;
    take.population.exitMotion.scaleTo ??= DEFAULT_EXIT_MOTION.scaleTo;
    take.population.exitMotion.rotationOffset ??= DEFAULT_EXIT_MOTION.rotationOffset;
    take.population.exitMotion.depthOffset ??= DEFAULT_EXIT_MOTION.depthOffset;
    take.population.exitMotion.pathVariation ??= legacyVersion < 21 ? 0 : DEFAULT_EXIT_MOTION.pathVariation;
    take.population.postHeroBurst ??= DEFAULT_CARD_POPULATION.postHeroBurst;
    take.population.postHeroBurstStartTime ??= Math.max(0, take.duration - 2);
    take.population.postHeroBurstDuration ??= DEFAULT_CARD_POPULATION.postHeroBurstDuration;
    take.population.postHeroBurstEasing ??= { ...EVEN_ARRIVAL_EASING };
    // v19 reads arrival curves as cumulative density over time (same mental model as motion
    // eases). Older projects treated the same control points as a delay quantile, so swap the
    // two shipped presets so Front-load / Back-load still land the same.
    if (legacyVersion < 19 && take.population.postHeroBurstEasing) {
      if (curvesMatch(take.population.postHeroBurstEasing, RAMP_UP_ARRIVAL_EASING)) {
        take.population.postHeroBurstEasing = { ...PUNCH_EARLY_ARRIVAL_EASING };
      } else if (curvesMatch(take.population.postHeroBurstEasing, PUNCH_EARLY_ARRIVAL_EASING)) {
        take.population.postHeroBurstEasing = { ...RAMP_UP_ARRIVAL_EASING };
      }
    }
    take.population.postHeroEntranceDuration ??= (take.entranceOverride ?? migrated.entranceMotion).duration;
    take.population.postHeroLifeMin ??= take.population.lifeMin;
    take.population.postHeroLifeMax ??= take.population.lifeMax;
    take.population.postHeroExitDuration ??= take.population.exitDuration;
    take.cameraKeyframes = take.cameraKeyframes.map((keyframe) => {
      const legacy = keyframe as typeof keyframe & { pose?: typeof keyframe.value; cut?: boolean };
      const value = keyframe.value ?? legacy.pose;
      const isLinear = keyframe.easing?.x1 === 0 && keyframe.easing?.y1 === 0 && keyframe.easing?.x2 === 1 && keyframe.easing?.y2 === 1;
      const interpolation = keyframe.interpolation ?? (legacy.cut ? "cut" : isLinear ? "linear" : "bezier");
      // v10: old "smooth" default was a near-step ease-out; rewrite to gentle ease-in-out.
      const easing = legacyVersion < 10 && isLegacyCameraSnapEasing(keyframe.easing)
        ? { ...DEFAULT_CAMERA_EASING }
        : keyframe.easing;
      const next = { ...keyframe, value, interpolation, easing };
      delete (next as typeof legacy).pose;
      delete (next as typeof legacy).cut;
      return next;
    });
    if (take.hero) {
      const legacyHero = take.hero as typeof take.hero & {
        startTime?: number;
        duration?: number;
        target?: import("../models/types").Transform;
        path?: import("../models/types").SpatialBezierPath;
        timingCurve?: import("../models/types").CubicBezierCurve;
        surroundingDim?: number;
        surroundingBlur?: number;
        targetSpace?: "world" | "screen";
      };
      take.hero.reflowEasing ??= take.hero.easing ?? "ease-out";
      const path = legacyHero.path ?? {
        start: { x: 0, y: 0 },
        control1: { x: 0, y: 0.08 },
        control2: { x: 0, y: -0.08 },
      };
      const timingCurve = legacyHero.timingCurve ?? { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
      if (!Array.isArray(take.hero.keyframes)) {
        const startTime = legacyHero.startTime ?? Math.min(4, take.duration * 0.55);
        const endTime = startTime + (legacyHero.duration ?? 1.2);
        const target = legacyHero.target ?? { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 };
        take.hero.keyframes = [
          { id: `hero-source-${take.hero.cardId}`, time: startTime, value: { kind: "source" }, interpolation: "bezier", easing: timingCurve, holdDuration: 0, path },
          { id: `hero-pose-${take.hero.cardId}`, time: endTime, value: { kind: "pose", transform: target, targetSpace: legacyHero.targetSpace ?? (legacyVersion < 5 ? "world" : "screen"), surroundingDim: legacyHero.surroundingDim ?? 0, surroundingBlur: legacyHero.surroundingBlur ?? 0 }, interpolation: "bezier", easing: timingCurve, holdDuration: 0, path },
        ];
      }
      delete legacyHero.startTime;
      delete legacyHero.duration;
      delete legacyHero.target;
      delete legacyHero.path;
      delete legacyHero.timingCurve;
      delete legacyHero.surroundingDim;
      delete legacyHero.surroundingBlur;
      delete legacyHero.targetSpace;
    }
    // Before v17 the burst cue was implicitly locked to the final hero key,
    // even though a start time was serialized. Preserve that rendered timing
    // while making the cue independently art-directable going forward.
    if (legacyVersion < 17 && take.hero?.keyframes?.length) {
      take.population.postHeroBurstStartTime = Math.max(...take.hero.keyframes.map((keyframe) => keyframe.time));
    }
    // Timeline length is shot duration. Events past Out (from older longer takes,
    // unit mixups, etc.) must not keep expanding the scrubbable range.
    clampTakeTimingToDuration(take);
  }
  return migrated;
}

function clampTime(value: number, duration: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(duration, value));
}

function clampTakeTimingToDuration(take: Take) {
  const duration = Math.max(0, take.duration);
  take.population.postHeroBurstStartTime = clampTime(take.population.postHeroBurstStartTime, duration);
  if (take.population.postHeroBurstDuration > duration) {
    take.population.postHeroBurstDuration = duration;
  }
  take.cardTriggers = take.cardTriggers.map((trigger) => ({
    ...trigger,
    triggerTime: clampTime(trigger.triggerTime, duration),
  }));
  take.gestureSamples = take.gestureSamples.map((sample) => ({
    ...sample,
    time: clampTime(sample.time, duration),
  }));
  take.cameraKeyframes = take.cameraKeyframes.map((keyframe) => ({
    ...keyframe,
    time: clampTime(keyframe.time, duration),
  }));
  if (take.hero?.keyframes) {
    take.hero.keyframes = take.hero.keyframes.map((keyframe) => ({
      ...keyframe,
      time: clampTime(keyframe.time, duration),
    }));
  }
  if (take.build.staggerStart > duration) take.build.staggerStart = 0;
  if (take.build.staggerEnd > duration) take.build.staggerEnd = duration;
  if (take.build.staggerEnd < take.build.staggerStart) {
    take.build.staggerEnd = take.build.staggerStart;
  }
}

type CompositionWithLegacyDuration = Project["compositions"][number] & { duration?: number; backgroundImage?: string };

function baseDirection(drift: number) {
  return drift;
}
